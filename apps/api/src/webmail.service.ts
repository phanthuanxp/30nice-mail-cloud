import { Injectable, UnauthorizedException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { randomBytes } from 'node:crypto';

type WebmailSession = { email: string; password: string; expiresAt: number };
type MailAddress = { address?: string; name?: string };

@Injectable()
export class WebmailService {
  private readonly sessions = new Map<string, WebmailSession>();
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly host = process.env.MAILCOW_IMAP_HOST || 'mx.30nice.vn';
  private readonly smtpHost = process.env.MAILCOW_SMTP_HOST || this.host;

  private makeClient(email: string, password: string) {
    const client = new ImapFlow({ host: this.host, port: 993, secure: true, auth: { user: email, pass: password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, logger: false, clientInfo: { name: '30NICE Mail', version: '1.0' } });
    client.on('error', () => undefined);
    return client;
  }

  async login(emailInput: string, password: string, sourceIp: string) {
    const email = emailInput.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email) || !password || password.length > 256) throw new BadRequestException('Vui lòng nhập email và mật khẩu hợp lệ');
    const key = `${sourceIp}:${email}`;
    const now = Date.now();
    for (const [token, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(token);
    for (const [attemptKey, value] of this.attempts) if (value.resetAt <= now) this.attempts.delete(attemptKey);
    const attempt = this.attempts.get(key);
    if (attempt && attempt.resetAt > now && attempt.count >= 8) throw new HttpException('Đăng nhập tạm khóa. Vui lòng thử lại sau 15 phút.', HttpStatus.TOO_MANY_REQUESTS);
    const window = !attempt || attempt.resetAt <= now ? { count: 0, resetAt: now + 15 * 60_000 } : attempt;
    try {
      const client = this.makeClient(email, password);
      try { await client.connect(); } finally { await client.logout().catch(() => undefined); }
    } catch {
      window.count++;
      this.attempts.set(key, window);
      throw new UnauthorizedException('Email hoặc mật khẩu chưa chính xác');
    }
    this.attempts.delete(key);
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { email, password, expiresAt: now + 8 * 60 * 60_000 });
    return { token, email, expiresAt: now + 8 * 60 * 60_000 };
  }

  logout(token?: string) { if (token) this.sessions.delete(token); }

  profile(token?: string) { return { email: this.session(token).email }; }

  private session(token?: string) {
    const session = token ? this.sessions.get(token) : undefined;
    if (!token || !session || session.expiresAt <= Date.now()) {
      if (token) this.sessions.delete(token);
      throw new UnauthorizedException('Phiên đã hết hạn. Vui lòng đăng nhập lại.');
    }
    return session;
  }

  private async withClient<T>(token: string | undefined, callback: (client: ImapFlow, session: WebmailSession) => Promise<T>): Promise<T> {
    const session = this.session(token);
    const client = this.makeClient(session.email, session.password);
    try { await client.connect(); return await callback(client, session); }
    finally { await client.logout().catch(() => undefined); }
  }

  async folders(token?: string) {
    return this.withClient(token, async client => {
      const folders = await client.list();
      const result = [];
      for (const folder of folders) {
        const status = await client.status(folder.path, { messages: true, unseen: true }).catch(() => false as const);
        const counts = status || { messages: 0, unseen: 0 };
        result.push({ path: folder.path, name: folder.name, specialUse: folder.specialUse || null, messages: counts.messages || 0, unread: counts.unseen || 0 });
      }
      return result;
    });
  }

  async messages(token: string | undefined, folder: string, query = '', requestedPage = 1, filter: 'all' | 'unread' | 'starred' = 'all') {
    if (!folder || folder.length > 255) throw new BadRequestException('Thư mục không hợp lệ');
    if (query.length > 200) throw new BadRequestException('Từ khóa tìm kiếm tối đa 200 ký tự');
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1_000_000) : 1;
    const pageSize = 50;
    return this.withClient(token, async client => {
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const term = query.trim().toLocaleLowerCase();
        const criteria: { all?: boolean; text?: string; seen?: boolean; flagged?: boolean } = {};
        if (term) criteria.text = term;
        else criteria.all = true;
        if (filter === 'unread') criteria.seen = false;
        else if (filter === 'starred') criteria.flagged = true;
        const matching = await client.search(criteria, { uid: true });
        const matchingUids = Array.isArray(matching) ? matching : [];
        const total = matchingUids.length;
        const pageUids = matchingUids.slice(Math.max(0, total - page * pageSize), Math.max(0, total - (page - 1) * pageSize)).reverse();
        if (!pageUids.length) return { folder, total, page, pageSize, messages: [] };
        const fetched = await client.fetchAll(pageUids, { envelope: true, flags: true, internalDate: true, size: true, uid: true }, { uid: true });
        const messages = fetched.map(item => {
          const from = (item.envelope?.from || []) as MailAddress[];
          const to = (item.envelope?.to || []) as MailAddress[];
          const date = item.envelope?.date || item.internalDate || null;
          return { uid: item.uid, subject: item.envelope?.subject || '(Không có tiêu đề)', from: from.map(address => ({ address: address.address || '', name: address.name || '' })), to: to.map(address => ({ address: address.address || '', name: address.name || '' })), date: date ? new Date(date).toISOString() : null, seen: item.flags?.has('\\Seen') || false, flagged: item.flags?.has('\\Flagged') || false, size: item.size || 0 };
        }).sort((a, b) => b.uid - a.uid);
        return { folder, total, page, pageSize, messages };
      } finally { lock.release(); }
    });
  }

  async read(token: string | undefined, folder: string, uid: number) {
    if (!Number.isSafeInteger(uid) || uid < 1) throw new BadRequestException('Thư không hợp lệ');
    return this.withClient(token, async client => {
      const lock = await client.getMailboxLock(folder);
      try {
        const overview = await client.fetchOne(String(uid), { size: true }, { uid: true });
        if (!overview) throw new BadRequestException('Không tìm thấy thư');
        if ((overview.size || 0) > 15 * 1024 * 1024) throw new BadRequestException('Thư lớn hơn 15 MB. Vui lòng mở thư bằng ứng dụng email hỗ trợ tệp lớn.');
        const message = await client.fetchOne(String(uid), { source: true, envelope: true, flags: true }, { uid: true });
        if (!message || !message.source) throw new BadRequestException('Không tìm thấy thư');
        const parsed = await simpleParser(message.source);
        if (!message.flags?.has('\\Seen')) await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
        const safeHtml = parsed.html ? sanitizeHtml(parsed.html, { allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, a: ['href', 'name', 'target', 'rel'] }, allowedSchemes: ['http', 'https', 'mailto'], disallowedTagsMode: 'discard', transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) } }) : '';
        const fromValues = parsed.from?.value || [];
        const toHeader = Array.isArray(parsed.to) ? parsed.to.flatMap(value => value.value) : parsed.to?.value || [];
        const from = fromValues.map(value => ({ address: value.address || '', name: value.name || '' }));
        const to = toHeader.map(value => ({ address: value.address || '', name: value.name || '' }));
        const ccValues = Array.isArray(parsed.cc) ? parsed.cc.flatMap(value => value.value) : parsed.cc?.value || [];
        const ccAddresses = ccValues.map(value => ({ address: value.address || '', name: value.name || '' })).filter(value => value.address || value.name);
        const cc = ccAddresses.map(value => value.address || value.name).join(', ');
        return { uid, folder, subject: parsed.subject || '(Không có tiêu đề)', from, to, cc, ccAddresses, date: parsed.date ? new Date(parsed.date).toISOString() : null, seen: true, flagged: message.flags?.has('\\Flagged') || false, size: message.source.length, text: parsed.text || '', html: safeHtml, attachments: (parsed.attachments || []).map((item, index) => ({ index, filename: item.filename || 'Tệp đính kèm', contentType: item.contentType, size: item.size })) };
      } finally { lock.release(); }
    });
  }

  async attachment(token: string | undefined, folder: string, uid: number, index: number) {
    if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(index) || index < 0 || index > 100) throw new BadRequestException('Tệp đính kèm không hợp lệ');
    return this.withClient(token, async client => {
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const overview = await client.fetchOne(String(uid), { size: true }, { uid: true });
        if (!overview) throw new BadRequestException('Không tìm thấy thư');
        if ((overview.size || 0) > 15 * 1024 * 1024) throw new BadRequestException('Email lớn hơn giới hạn tải tệp 15 MB');
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message || !message.source) throw new BadRequestException('Không tìm thấy thư');
        const parsed = await simpleParser(message.source);
        const file = parsed.attachments[index];
        if (!file) throw new BadRequestException('Không tìm thấy tệp đính kèm');
        const filename = (file.filename || 'tep-dinh-kem').replace(/[\r\n"\\/]/g, '_').slice(0, 180);
        return { content: file.content, filename, contentType: file.contentType || 'application/octet-stream' };
      } finally { lock.release(); }
    });
  }

  async setFlag(token: string | undefined, folder: string, uid: number, flag: 'seen' | 'unseen' | 'flagged' | 'unflagged') {
    return this.withClient(token, async client => {
      const lock = await client.getMailboxLock(folder);
      try {
        const add = flag === 'seen' || flag === 'flagged';
        const imapFlag = flag === 'seen' || flag === 'unseen' ? '\\Seen' : '\\Flagged';
        return add ? client.messageFlagsAdd(uid, [imapFlag], { uid: true }) : client.messageFlagsRemove(uid, [imapFlag], { uid: true });
      } finally { lock.release(); }
    });
  }

  async moveToTrash(token: string | undefined, folder: string, uid: number) {
    return this.withClient(token, async client => {
      const folders = await client.list();
      const trash = folders.find(item => item.specialUse === '\\Trash') || folders.find(item => /^(trash|deleted items|thư đã xóa)$/i.test(item.name));
      if (!trash) throw new BadRequestException('Hộp thư chưa có thư mục Thùng rác');
      const lock = await client.getMailboxLock(folder);
      try { return await client.messageMove(uid, trash.path, { uid: true }); }
      finally { lock.release(); }
    });
  }

  async send(token: string | undefined, input: { to?: string; cc?: string; subject?: string; text?: string }, files: Array<{ buffer: Buffer; filename: string; contentType: string }> = []) {
    const session = this.session(token);
    const to = (input.to || '').split(',').map(value => value.trim()).filter(Boolean);
    const cc = (input.cc || '').split(',').map(value => value.trim()).filter(Boolean);
    const validAddress = (address: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address);
    if (!to.length || to.length > 20 || to.some(address => !validAddress(address))) throw new BadRequestException('Nhập địa chỉ người nhận hợp lệ, tối đa 20 người');
    if (cc.length > 20 || cc.some(address => !validAddress(address))) throw new BadRequestException('Địa chỉ CC không hợp lệ');
    if (files.length > 5 || files.reduce((total, file) => total + file.buffer.length, 0) > 20 * 1024 * 1024) throw new BadRequestException('Tổng dung lượng tệp đính kèm tối đa là 20 MB');
    const subject = (input.subject || '').trim().slice(0, 998);
    const text = input.text || '';
    if (!text.trim() && !subject) throw new BadRequestException('Email cần có tiêu đề hoặc nội dung');
    if (text.length > 50_000) throw new BadRequestException('Nội dung thư vượt quá giới hạn 50 KB');
    const port = Number(process.env.MAILCOW_SMTP_PORT || 465);
    const messageOptions = { from: session.email, to, cc: cc.length ? cc : undefined, subject, text, attachments: files.map(file => ({ filename: file.filename.replace(/[\r\n"\\/]/g, '_').slice(0, 180), content: file.buffer, contentType: file.contentType })), headers: { 'X-30NICE-Webmail': '1' } };
    const renderer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
    const transport = nodemailer.createTransport({ host: this.smtpHost, port, secure: port === 465, auth: { user: session.email, pass: session.password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
    try {
      const rendered = await renderer.sendMail(messageOptions);
      if (!Buffer.isBuffer(rendered.message)) throw new Error('MIME message was not buffered');
      const sent = await transport.sendMail({ raw: rendered.message, envelope: { from: session.email, to: [...to, ...cc] } });
      let savedToSent = false;
      try {
        const client = this.makeClient(session.email, session.password);
        try {
          await client.connect();
          const folders = await client.list();
          const sentFolder = folders.find(folder => folder.specialUse === '\\Sent') || folders.find(folder => /^(sent|sent items|thư đã gửi)$/i.test(folder.name));
          if (sentFolder) savedToSent = Boolean(await client.append(sentFolder.path, rendered.message, ['\\Seen']));
        } finally { await client.logout().catch(() => undefined); }
      } catch { savedToSent = false; }
      return { accepted: sent.accepted.length, messageId: rendered.messageId || sent.messageId, savedToSent };
    } catch { throw new BadRequestException('Không gửi được thư. Vui lòng kiểm tra người nhận hoặc thử lại sau.'); }
    finally { renderer.close(); transport.close(); }
  }
}


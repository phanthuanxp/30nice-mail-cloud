import { Injectable, UnauthorizedException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import sanitizeHtml = require('sanitize-html');
import { randomBytes } from 'node:crypto';

type WebmailSession = { email: string; password: string; expiresAt: number };
type MailAddress = { address?: string; name?: string };
type DraftInput = { draftId?: string; replaceUid?: number; to?: string; cc?: string; bcc?: string; subject?: string; text?: string; html?: string };

@Injectable()
export class WebmailService {
  private readonly sessions = new Map<string, WebmailSession>();
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly maxSessions = 10_000;
  private readonly maxAttemptBuckets = 50_000;
  private readonly host = process.env.MAILCOW_IMAP_HOST || 'mx.30nice.vn';
  private readonly smtpHost = process.env.MAILCOW_SMTP_HOST || this.host;

  private makeClient(email: string, password: string) {
    const client = new ImapFlow({ host: this.host, port: 993, secure: true, auth: { user: email, pass: password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, logger: false, clientInfo: { name: '30NICE Mail', version: '1.0' } });
    client.on('error', () => undefined);
    return client;
  }

  async login(emailInput: string, password: string, sourceIp: string) {
    const email = emailInput.trim().toLowerCase();
    if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || !password || password.length > 256) throw new BadRequestException('Vui lòng nhập email và mật khẩu hợp lệ');
    const clientIp = (sourceIp || 'unknown').slice(0, 64);
    const keys = [
      { key: `pair:${clientIp}:${email}`, limit: 8 },
      { key: `ip:${clientIp}`, limit: 40 },
      { key: `account:${email}`, limit: 12 },
    ];
    const now = Date.now();
    for (const [token, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(token);
    for (const [attemptKey, value] of this.attempts) if (value.resetAt <= now) this.attempts.delete(attemptKey);
    if (keys.some(({ key, limit }) => (this.attempts.get(key)?.count || 0) >= limit)) throw new HttpException('Đăng nhập tạm khóa. Vui lòng thử lại sau 15 phút.', HttpStatus.TOO_MANY_REQUESTS);
    try {
      const client = this.makeClient(email, password);
      try { await client.connect(); } finally { await client.logout().catch(() => undefined); }
    } catch {
      if (this.attempts.size + keys.length > this.maxAttemptBuckets) {
        for (const [attemptKey, value] of this.attempts) if (value.resetAt <= now) this.attempts.delete(attemptKey);
        while (this.attempts.size + keys.length > this.maxAttemptBuckets) {
          const oldest = this.attempts.keys().next().value;
          if (oldest === undefined) break;
          this.attempts.delete(oldest);
        }
      }
      for (const { key } of keys) {
        const attempt = this.attempts.get(key);
        const bucket = !attempt || attempt.resetAt <= now ? { count: 0, resetAt: now + 15 * 60_000 } : attempt;
        bucket.count++;
        this.attempts.set(key, bucket);
      }
      throw new UnauthorizedException('Email hoặc mật khẩu chưa chính xác');
    }
    for (const { key } of keys) this.attempts.delete(key);
    if (this.sessions.size >= this.maxSessions) throw new HttpException('Hệ thống đang có quá nhiều phiên đăng nhập. Vui lòng thử lại sau.', HttpStatus.SERVICE_UNAVAILABLE);
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

  private async resolveFolder(client: ImapFlow, requested: string) {
    if (!requested || requested.length > 255) throw new BadRequestException('Thư mục không hợp lệ');
    const folder = (await client.list()).find(item => item.path === requested);
    if (!folder) throw new BadRequestException('Không tìm thấy thư mục trong hộp thư này');
    return folder.path;
  }

  private assertUid(uid: number) {
    if (!Number.isSafeInteger(uid) || uid < 1) throw new BadRequestException('Thư không hợp lệ');
  }

  private sanitizeMessageHtml(html: string) {
    if (!html) return '';
    return sanitizeHtml(html, {
      allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'h1', 'h2', 'h3', 'hr', 'figure', 'figcaption'],
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        '*': ['style'],
        a: ['href', 'name', 'target', 'rel'],
        img: ['src', 'alt', 'title', 'width', 'height'],
        td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
        th: ['colspan', 'rowspan', 'align', 'valign', 'width'],
        table: ['width', 'cellpadding', 'cellspacing', 'border', 'align'],
      },
      allowedStyles: {
        '*': {
          color: [/^#[\da-f]{3,8}$/i, /^rgba?\([\d.%\s,]+\)$/i],
          'background-color': [/^#[\da-f]{3,8}$/i, /^rgba?\([\d.%\s,]+\)$/i, /^transparent$/i],
          'font-family': [/^[\w\s,"'-]+$/],
          'font-size': [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i],
          'font-weight': [/^(?:normal|bold|[1-9]00)$/i],
          'font-style': [/^(?:normal|italic|oblique)$/i],
          'text-align': [/^(?:left|right|center|justify)$/i],
          'text-decoration': [/^(?:none|underline|line-through)$/i],
          'vertical-align': [/^(?:top|middle|bottom|baseline)$/i],
          'white-space': [/^(?:normal|nowrap|pre-wrap)$/i],
          width: [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i],
          height: [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i],
          'max-width': [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i],
          'border-collapse': [/^(?:collapse|separate)$/i],
        },
      },
      allowedSchemes: ['http', 'https', 'mailto', 'cid'],
      allowedSchemesByTag: { img: ['cid', 'http', 'https'] },
      allowProtocolRelative: false,
      disallowedTagsMode: 'discard',
      transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
    });
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
    if (!folder || (folder !== '*' && folder.length > 255)) throw new BadRequestException('Thư mục không hợp lệ');
    if (query.length > 200) throw new BadRequestException('Từ khóa tìm kiếm tối đa 200 ký tự');
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1_000_000) : 1;
    const pageSize = 50;
    return this.withClient(token, async client => {
      const term = query.trim().toLocaleLowerCase();
      if (folder === '*' && !term) throw new BadRequestException('Nhập từ khóa để tìm trong toàn bộ hộp thư');
      const criteria: { all?: boolean; text?: string; seen?: boolean; flagged?: boolean } = {};
      if (term) criteria.text = term;
      else criteria.all = true;
      if (filter === 'unread') criteria.seen = false;
      else if (filter === 'starred') criteria.flagged = true;

      const listedFolders = await client.list();
      const folders = folder === '*'
        ? listedFolders.filter(item => item.specialUse !== '\\Trash' && item.specialUse !== '\\Junk' && !/^(trash|deleted items|junk|spam|thư rác|thùng rác)$/i.test(item.name))
        : listedFolders.filter(item => item.path === folder);
      if (folder !== '*' && !folders.length) throw new BadRequestException('Không tìm thấy thư mục trong hộp thư này');
      let total = 0;
      const candidates: Array<{ uid: number; folder: string; date: string | null; subject: string; from: Array<{ address: string; name: string }>; to: Array<{ address: string; name: string }>; seen: boolean; flagged: boolean; draft: boolean; size: number }> = [];
      for (const mailbox of folders) {
        const lock = await client.getMailboxLock(mailbox.path, { readOnly: true });
        try {
        const matching = await client.search(criteria, { uid: true });
        const matchingUids = Array.isArray(matching) ? matching : [];
        total += matchingUids.length;
        const candidateUids = folder === '*'
          ? matchingUids.slice(-page * pageSize).reverse()
          : matchingUids.slice(Math.max(0, matchingUids.length - page * pageSize), Math.max(0, matchingUids.length - (page - 1) * pageSize)).reverse();
        if (!candidateUids.length) continue;
        const fetched = await client.fetchAll(candidateUids, { envelope: true, flags: true, internalDate: true, size: true, uid: true }, { uid: true });
        candidates.push(...fetched.map(item => {
          const from = (item.envelope?.from || []) as MailAddress[];
          const to = (item.envelope?.to || []) as MailAddress[];
          const date = item.envelope?.date || item.internalDate || null;
          return { uid: item.uid, folder: mailbox.path, subject: item.envelope?.subject || '(Không có tiêu đề)', from: from.map(address => ({ address: address.address || '', name: address.name || '' })), to: to.map(address => ({ address: address.address || '', name: address.name || '' })), date: date ? new Date(date).toISOString() : null, seen: item.flags?.has('\\Seen') || false, flagged: item.flags?.has('\\Flagged') || false, draft: item.flags?.has('\\Draft') || false, size: item.size || 0 };
        }));
        } finally { lock.release(); }
      }
      candidates.sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0));
      const messages = candidates.slice((page - 1) * pageSize, page * pageSize);
      return { folder, total, page, pageSize, messages };
    });
  }

  async read(token: string | undefined, folder: string, uid: number, externalImages = false) {
    this.assertUid(uid);
    return this.withClient(token, async client => {
      const mailbox = await this.resolveFolder(client, folder);
      const lock = await client.getMailboxLock(mailbox);
      try {
        const overview = await client.fetchOne(String(uid), { size: true }, { uid: true });
        if (!overview) throw new BadRequestException('Không tìm thấy thư');
        if ((overview.size || 0) > 15 * 1024 * 1024) throw new BadRequestException('Thư lớn hơn 15 MB. Vui lòng mở thư bằng ứng dụng email hỗ trợ tệp lớn.');
        const message = await client.fetchOne(String(uid), { source: true, envelope: true, flags: true }, { uid: true });
        if (!message || !message.source) throw new BadRequestException('Không tìm thấy thư');
        const parsed = await simpleParser(message.source, { keepCidLinks: true });
        if (!message.flags?.has('\\Seen')) await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
        const safeHtml = this.sanitizeMessageHtml(typeof parsed.html === 'string' ? parsed.html : '');
        const inlineContent = new Map<string, number>();
        (parsed.attachments || []).forEach((attachment, index) => {
          const contentId = String(attachment.contentId || '').replace(/^<|>$/g, '').trim().toLowerCase();
          if (contentId) inlineContent.set(contentId, index);
        });
        let hasRemoteImages = false;
        const htmlWithImages = safeHtml.replace(/\bsrc=(['"])cid:([^'"]+)\1/gi, (match, quote: string, rawContentId: string) => {
          let contentId = rawContentId;
          try { contentId = decodeURIComponent(contentId); } catch { /* Keep the original content ID. */ }
          const index = inlineContent.get(contentId.replace(/&amp;/gi, '&').replace(/^<|>$/g, '').trim().toLowerCase());
          return index === undefined ? '' : `src="/api/api/v1/webmail/messages/${uid}/attachments/${index}?folder=${encodeURIComponent(folder)}&inline=1"`;
        });
        const html = htmlWithImages.replace(/<img\b[^>]*>/gi, tag => {
          if (!/\bsrc\s*=\s*(['"])https?:\/\//i.test(tag)) return tag;
          hasRemoteImages = true;
          return externalImages ? tag : tag.replace(/\s+src\s*=\s*(['"])https?:\/\/[^'"]*\1/i, '');
        });
        const fromValues = parsed.from?.value || [];
        const toHeader = Array.isArray(parsed.to) ? parsed.to.flatMap(value => value.value) : parsed.to?.value || [];
        const from = fromValues.map(value => ({ address: value.address || '', name: value.name || '' }));
        const to = toHeader.map(value => ({ address: value.address || '', name: value.name || '' }));
        const ccValues = Array.isArray(parsed.cc) ? parsed.cc.flatMap(value => value.value) : parsed.cc?.value || [];
        const ccAddresses = ccValues.map(value => ({ address: value.address || '', name: value.name || '' })).filter(value => value.address || value.name);
        const cc = ccAddresses.map(value => value.address || value.name).join(', ');
        const bccValues = Array.isArray(parsed.bcc) ? parsed.bcc.flatMap(value => value.value) : parsed.bcc?.value || [];
        const bccAddresses = bccValues.map(value => ({ address: value.address || '', name: value.name || '' })).filter(value => value.address || value.name);
        const bcc = bccAddresses.map(value => value.address || value.name).join(', ');
        const draftIdHeader = parsed.headers.get('x-30nice-draft-id');
        const draftId = typeof draftIdHeader === 'string' ? draftIdHeader : undefined;
        return { uid, folder, subject: parsed.subject || '(Không có tiêu đề)', from, to, cc, ccAddresses, bcc, bccAddresses, draftId, date: parsed.date ? new Date(parsed.date).toISOString() : null, seen: true, flagged: message.flags?.has('\\Flagged') || false, draft: message.flags?.has('\\Draft') || false, size: message.source.length, text: parsed.text || '', html, hasRemoteImages, externalImagesVisible: externalImages, attachments: (parsed.attachments || []).map((item, index) => ({ index, filename: item.filename || 'Tệp đính kèm', contentType: item.contentType, size: item.size })) };
      } finally { lock.release(); }
    });
  }

  async attachment(token: string | undefined, folder: string, uid: number, index: number, inline = false) {
    this.assertUid(uid);
    if (!Number.isSafeInteger(index) || index < 0 || index > 100) throw new BadRequestException('Tệp đính kèm không hợp lệ');
    return this.withClient(token, async client => {
      const mailbox = await this.resolveFolder(client, folder);
      const lock = await client.getMailboxLock(mailbox, { readOnly: true });
      try {
        const overview = await client.fetchOne(String(uid), { size: true }, { uid: true });
        if (!overview) throw new BadRequestException('Không tìm thấy thư');
        if ((overview.size || 0) > 15 * 1024 * 1024) throw new BadRequestException('Email lớn hơn giới hạn tải tệp 15 MB');
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message || !message.source) throw new BadRequestException('Không tìm thấy thư');
        const parsed = await simpleParser(message.source);
        const file = parsed.attachments[index];
        if (!file) throw new BadRequestException('Không tìm thấy tệp đính kèm');
        if (inline && !/^image\/(?:png|jpeg|gif|webp|avif)$/i.test(file.contentType || '')) throw new BadRequestException('Chỉ cho phép hiển thị ảnh an toàn trong nội dung thư');
        const filename = (file.filename || 'tep-dinh-kem').replace(/[\r\n"\\/]/g, '_').slice(0, 180);
        return { content: file.content, filename, contentType: file.contentType || 'application/octet-stream' };
      } finally { lock.release(); }
    });
  }

  async setFlag(token: string | undefined, folder: string, uid: number, flag: 'seen' | 'unseen' | 'flagged' | 'unflagged') {
    this.assertUid(uid);
    return this.withClient(token, async client => {
      const mailbox = await this.resolveFolder(client, folder);
      const lock = await client.getMailboxLock(mailbox);
      try {
        const add = flag === 'seen' || flag === 'flagged';
        const imapFlag = flag === 'seen' || flag === 'unseen' ? '\\Seen' : '\\Flagged';
        return add ? client.messageFlagsAdd(uid, [imapFlag], { uid: true }) : client.messageFlagsRemove(uid, [imapFlag], { uid: true });
      } finally { lock.release(); }
    });
  }

  async moveToTrash(token: string | undefined, folder: string, uid: number) {
    this.assertUid(uid);
    return this.withClient(token, async client => {
      const folders = await client.list();
      if (!folders.some(item => item.path === folder)) throw new BadRequestException('Không tìm thấy thư mục trong hộp thư này');
      const trash = folders.find(item => item.specialUse === '\\Trash') || folders.find(item => /^(trash|deleted items|thư đã xóa)$/i.test(item.name));
      if (!trash) throw new BadRequestException('Hộp thư chưa có thư mục Thùng rác');
      const lock = await client.getMailboxLock(folder);
      try { return await client.messageMove(uid, trash.path, { uid: true }); }
      finally { lock.release(); }
    });
  }

  async moveToArchive(token: string | undefined, folder: string, uid: number) {
    this.assertUid(uid);
    return this.withClient(token, async client => {
      const folders = await client.list();
      if (!folders.some(item => item.path === folder)) throw new BadRequestException('Không tìm thấy thư mục trong hộp thư này');
      const archive = folders.find(item => item.specialUse === '\\Archive') || folders.find(item => /^(archive|archived|lưu trữ)$/i.test(item.name));
      if (!archive) throw new BadRequestException('Hộp thư chưa có thư mục Lưu trữ');
      const lock = await client.getMailboxLock(folder);
      try { return await client.messageMove(uid, archive.path, { uid: true }); }
      finally { lock.release(); }
    });
  }

  async moveToInbox(token: string | undefined, folder: string, uid: number) {
    this.assertUid(uid);
    return this.withClient(token, async client => {
      const folders = await client.list();
      if (!folders.some(item => item.path === folder)) throw new BadRequestException('Không tìm thấy thư mục trong hộp thư này');
      const inbox = folders.find(item => item.specialUse === '\\Inbox') || folders.find(item => item.path.toUpperCase() === 'INBOX');
      if (!inbox) throw new BadRequestException('Không tìm thấy thư mục Hộp thư đến');
      const lock = await client.getMailboxLock(folder);
      try { return await client.messageMove(uid, inbox.path, { uid: true }); }
      finally { lock.release(); }
    });
  }

  async send(token: string | undefined, input: DraftInput, files: Array<{ buffer: Buffer; filename: string; contentType: string }> = []) {
    const session = this.session(token);
    const to = (input.to || '').split(',').map(value => value.trim()).filter(Boolean);
    const cc = (input.cc || '').split(',').map(value => value.trim()).filter(Boolean);
    const bcc = (input.bcc || '').split(',').map(value => value.trim()).filter(Boolean);
    const validAddress = (address: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address);
    const recipients = [...to, ...cc, ...bcc];
    if (!to.length || recipients.length > 20 || recipients.some(address => !validAddress(address))) throw new BadRequestException('Nhập địa chỉ người nhận hợp lệ, tối đa 20 người cho To, CC và BCC');
    if (new Set(recipients.map(address => address.toLowerCase())).size !== recipients.length) throw new BadRequestException('Mỗi địa chỉ chỉ được nhập một lần trong To, CC hoặc BCC');
    if (files.length > 5 || files.reduce((total, file) => total + file.buffer.length, 0) > 20 * 1024 * 1024) throw new BadRequestException('Tổng dung lượng tệp đính kèm tối đa là 20 MB');
    const subject = (input.subject || '').trim().slice(0, 998);
    const text = input.text || '';
    const html = this.sanitizeMessageHtml(input.html || '');
    if (!text.trim() && !html.replace(/<[^>]*>/g, '').trim() && !subject) throw new BadRequestException('Email cần có tiêu đề hoặc nội dung');
    if (text.length > 50_000) throw new BadRequestException('Nội dung thư vượt quá giới hạn 50 KB');
    if (html.length > 100_000) throw new BadRequestException('Định dạng thư vượt quá giới hạn cho phép');
    const port = Number(process.env.MAILCOW_SMTP_PORT || 465);
    const messageOptions = { from: session.email, to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined, subject, text, html: html || undefined, attachments: files.map(file => ({ filename: file.filename.replace(/[\r\n"\\/]/g, '_').slice(0, 180), content: file.buffer, contentType: file.contentType })), headers: { 'X-30NICE-Webmail': '1' } };
    const renderer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
    const transport = nodemailer.createTransport({ host: this.smtpHost, port, secure: port === 465, auth: { user: session.email, pass: session.password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
    try {
      const rendered = await renderer.sendMail({ ...messageOptions, bcc: undefined });
      if (!Buffer.isBuffer(rendered.message)) throw new Error('MIME message was not buffered');
      const sent = await transport.sendMail({ raw: rendered.message, envelope: { from: session.email, to: recipients } });
      if (!sent.accepted.length) throw new BadRequestException('Máy chủ không chấp nhận người nhận. Kiểm tra lại địa chỉ rồi thử lại.');
      let savedToSent = false;
      try {
        const client = this.makeClient(session.email, session.password);
        try {
          await client.connect();
          const folders = await client.list();
          const sentFolder = folders.find(folder => folder.specialUse === '\\Sent') || folders.find(folder => /^(sent|sent items|thư đã gửi)$/i.test(folder.name));
          if (sentFolder) {
            const sentCopy = await renderer.sendMail(messageOptions);
            if (!Buffer.isBuffer(sentCopy.message)) throw new Error('Sent copy MIME message was not buffered');
            savedToSent = Boolean(await client.append(sentFolder.path, sentCopy.message, ['\\Seen']));
          }
        } finally { await client.logout().catch(() => undefined); }
      } catch { savedToSent = false; }
      const draftRemoved = input.draftId ? await this.removeDraftCopies(session.email, session.password, input.draftId, input.replaceUid) : true;
      const addresses = (values: typeof sent.accepted) => values.map(value => String(value)).filter(Boolean);
      return { accepted: addresses(sent.accepted), rejected: addresses(sent.rejected), messageId: rendered.messageId || sent.messageId, savedToSent, draftRemoved };
    } catch (reason) {
      if (reason instanceof BadRequestException) throw reason;
      throw new BadRequestException('Không gửi được thư. Vui lòng kiểm tra kết nối hoặc thử lại sau.');
    }
    finally { renderer.close(); transport.close(); }
  }

  async saveDraft(token: string | undefined, input: DraftInput, files: Array<{ buffer: Buffer; filename: string; contentType: string }> = []) {
    const session = this.session(token);
    const draftId = input.draftId || '';
    if (!/^[a-z0-9-]{16,80}$/i.test(draftId)) throw new BadRequestException('Mã thư nháp không hợp lệ');
    const to = (input.to || '').split(',').map(value => value.trim()).filter(Boolean);
    const cc = (input.cc || '').split(',').map(value => value.trim()).filter(Boolean);
    const bcc = (input.bcc || '').split(',').map(value => value.trim()).filter(Boolean);
    const recipients = [...to, ...cc, ...bcc];
    if (recipients.length > 20 || recipients.some(value => value.length > 254)) throw new BadRequestException('Danh sách người nhận trong thư nháp không hợp lệ');
    const html = this.sanitizeMessageHtml(input.html || '');
    if ((input.subject || '').length > 998 || (input.text || '').length > 50_000 || html.length > 100_000) throw new BadRequestException('Thư nháp vượt quá giới hạn cho phép');
    if (files.length > 5 || files.reduce((total, file) => total + file.buffer.length, 0) > 20 * 1024 * 1024) throw new BadRequestException('Tổng dung lượng tệp đính kèm tối đa là 20 MB');
    return this.withClient(token, async client => {
      const folders = await client.list();
      const drafts = folders.find(item => item.specialUse === '\\Drafts') || folders.find(item => /^(drafts|draft|thư nháp)$/i.test(item.name));
      if (!drafts) throw new BadRequestException('Hộp thư chưa có thư mục Thư nháp');
      const lock = await client.getMailboxLock(drafts.path);
      const renderer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
      try {
        const existing = await client.search({ header: { 'X-30NICE-Draft-Id': draftId } }, { uid: true });
        const oldUids = new Set(Array.isArray(existing) ? existing : []);
        if (input.replaceUid && Number.isSafeInteger(input.replaceUid)) oldUids.add(input.replaceUid);
        const rendered = await renderer.sendMail({
          from: session.email,
          to: to.length ? to : undefined,
          cc: cc.length ? cc : undefined,
          bcc: bcc.length ? bcc : undefined,
          subject: input.subject || '',
          text: input.text || '',
          html: html || undefined,
          headers: { 'X-30NICE-Draft-Id': draftId },
          attachments: files.map(file => ({ filename: file.filename.replace(/[\r\n"\\/]/g, '_').slice(0, 180), content: file.buffer, contentType: file.contentType })),
        });
        if (!Buffer.isBuffer(rendered.message)) throw new Error('Draft MIME message was not buffered');
        const appended = await client.append(drafts.path, rendered.message, ['\\Draft', '\\Seen']);
        if (!appended) throw new BadRequestException('Không thể lưu thư nháp');
        if (oldUids.size) await client.messageDelete([...oldUids], { uid: true });
        return { draftId, uid: appended.uid || null, saved: true };
      } finally { lock.release(); renderer.close(); }
    });
  }

  private async removeDraftCopies(email: string, password: string, draftId: string, replaceUid?: number) {
    if (!/^[a-z0-9-]{16,80}$/i.test(draftId)) return false;
    const client = this.makeClient(email, password);
    try {
      await client.connect();
      const folders = await client.list();
      const drafts = folders.find(item => item.specialUse === '\\Drafts') || folders.find(item => /^(drafts|draft|thư nháp)$/i.test(item.name));
      if (!drafts) return false;
      const lock = await client.getMailboxLock(drafts.path);
      try {
        const found = await client.search({ header: { 'X-30NICE-Draft-Id': draftId } }, { uid: true });
        const uids = new Set(Array.isArray(found) ? found : []);
        if (replaceUid && Number.isSafeInteger(replaceUid)) uids.add(replaceUid);
        return uids.size ? await client.messageDelete([...uids], { uid: true }) : true;
      } finally { lock.release(); }
    } catch { return false; }
    finally { await client.logout().catch(() => undefined); }
  }

  async discardDraft(token: string | undefined, input: { draftId?: string; replaceUid?: number }) {
    const session = this.session(token);
    if (!input.draftId || !/^[a-z0-9-]{16,80}$/i.test(input.draftId)) throw new BadRequestException('Mã thư nháp không hợp lệ');
    const deleted = await this.removeDraftCopies(session.email, session.password, input.draftId, input.replaceUid);
    if (!deleted) throw new BadRequestException('Không thể xóa thư nháp');
    return { discarded: true };
  }
}


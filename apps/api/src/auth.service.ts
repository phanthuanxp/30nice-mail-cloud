import { ForbiddenException, HttpException, HttpStatus, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from './database.service';

type Role = 'super_admin' | 'tenant_admin' | 'mailbox_user';
type Session = { sub: string; role: Role; tenantId?: string; exp: number; mfaAt?: number };
type Identity = Omit<Session, 'exp'> & { accountKey: string };
type PendingAuth = Identity & { kind: 'setup' | 'login'; secret?: string; expiresAt: number; failures: number };
type Credential = { secret_ciphertext: string; enabled_at: Date | null; last_totp_counter: string | number | null; recovery_hashes: string[] };

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { output += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string) {
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of input.replace(/=+$/g, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(output);
}

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly pendingAuth = new Map<string, PendingAuth>();
  private readonly memoryCredentials = new Map<string, Credential>();
  private readonly secret = process.env.CONTROL_PLANE_SESSION_SECRET || '';
  private readonly email = process.env.CONTROL_PLANE_ADMIN_EMAIL || '';
  private readonly password = process.env.CONTROL_PLANE_ADMIN_PASSWORD || '';
  private mfaSchemaReady?: Promise<boolean>;

  private encode(value: string) { return Buffer.from(value).toString('base64url'); }
  private sign(body: string) { return createHmac('sha256', this.secret).update(body).digest('base64url'); }
  private digest(value: string) { return createHash('sha256').update(value).digest(); }
  private equal(left: string, right: string) { return timingSafeEqual(this.digest(left), this.digest(right)); }
  private mfaKey() {
    if (!this.secret) throw new ServiceUnavailableException('Chưa cấu hình khóa mã hóa MFA. Liên hệ quản trị viên hệ thống.');
    return scryptSync(this.secret, '30nice-control-plane-mfa-v1', 32);
  }

  private checkLimit(keys: string[]) {
    const now = Date.now();
    for (const [key, item] of this.attempts) if (item.resetAt <= now) this.attempts.delete(key);
    if (this.attempts.size > 20_000) for (const key of this.attempts.keys()) { this.attempts.delete(key); if (this.attempts.size <= 15_000) break; }
    for (const key of keys) {
      const item = this.attempts.get(key);
      if (item && item.count >= 8 && item.resetAt > now) throw new HttpException('Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
  private recordFailure(keys: string[]) {
    const now = Date.now();
    for (const key of keys) {
      const item = this.attempts.get(key);
      this.attempts.set(key, { count: item && item.resetAt > now ? item.count + 1 : 1, resetAt: item && item.resetAt > now ? item.resetAt : now + 15 * 60 * 1000 });
    }
  }
  private clearAttempts(keys: string[]) { for (const key of keys) this.attempts.delete(key); }

  private async ensureMfaSchema() {
    if (!this.database) return false;
    this.mfaSchemaReady ??= this.database.query(`
      CREATE TABLE IF NOT EXISTS mfa_credentials (
        account_key TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        tenant_id UUID,
        secret_ciphertext TEXT NOT NULL,
        enabled_at TIMESTAMPTZ,
        last_totp_counter BIGINT,
        recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `).then(result => result !== null);
    try { return await this.mfaSchemaReady; }
    catch (error) { this.mfaSchemaReady = undefined; throw error; }
  }

  private encryptSecret(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.mfaKey(), iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }
  private decryptSecret(value: string) {
    const [iv, tag, encrypted] = value.split('.');
    if (!iv || !tag || !encrypted) throw new Error('Invalid encrypted MFA secret');
    const decipher = createDecipheriv('aes-256-gcm', this.mfaKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  }

  private async credential(accountKey: string) {
    if (await this.ensureMfaSchema()) {
      const rows = await this.database.query<Credential>('SELECT secret_ciphertext, enabled_at, last_totp_counter, recovery_hashes FROM mfa_credentials WHERE account_key=$1 LIMIT 1', [accountKey]);
      return rows?.[0];
    }
    return this.memoryCredentials.get(accountKey);
  }

  private newPending(identity: Identity, kind: 'setup' | 'login', secret?: string) {
    const now = Date.now();
    for (const [token, pending] of this.pendingAuth) if (pending.expiresAt <= now) this.pendingAuth.delete(token);
    if (this.pendingAuth.size >= 10_000) throw new ServiceUnavailableException('Tạm thời không thể tạo phiên xác thực MFA. Vui lòng thử lại.');
    const token = randomBytes(32).toString('base64url');
    this.pendingAuth.set(token, { ...identity, kind, secret, expiresAt: now + 5 * 60_000, failures: 0 });
    return token;
  }
  private pending(token: unknown, kind: 'setup' | 'login') {
    if (typeof token !== 'string' || token.length > 100) throw new UnauthorizedException('Phiên MFA không hợp lệ. Hãy đăng nhập lại.');
    const value = this.pendingAuth.get(token);
    if (!value || value.expiresAt <= Date.now() || value.kind !== kind) {
      this.pendingAuth.delete(token);
      throw new UnauthorizedException('Phiên MFA đã hết hạn. Hãy đăng nhập lại.');
    }
    return { token, value };
  }
  private failPending(token: string, value: PendingAuth) {
    value.failures++;
    if (value.failures >= 8) this.pendingAuth.delete(token);
  }

  async login(emailInput: unknown, passwordInput: unknown, ip = 'unknown') {
    const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
    const password = typeof passwordInput === 'string' ? passwordInput : '';
    const keys = [`ip:${ip || 'unknown'}`, `email:${email || 'unknown'}`, `pair:${ip || 'unknown'}:${email || 'unknown'}`];
    this.checkLimit(keys);
    if (!email || email.length > 320 || !password || password.length > 1024) {
      this.recordFailure(keys);
      throw new UnauthorizedException('Thông tin đăng nhập không đúng');
    }
    await this.database.ensureSeed();

    let identity: Identity | undefined;
    if (this.secret && this.email && this.password && this.equal(email, this.email.trim().toLowerCase()) && this.equal(password, this.password)) {
      identity = { accountKey: `admin:${this.email.trim().toLowerCase()}`, sub: this.email, role: 'super_admin' };
    } else {
      const rows = await this.database.query<{ id: string; email: string; role: 'tenant_admin' | 'mailbox_user'; tenant_id: string; password_hash: string }>(
        'select m.id::text as id,m.email,m.role,m.tenant_id::text as tenant_id,m.password_hash from tenant_members m join tenants t on t.id=m.tenant_id where lower(m.email)=lower($1) and m.status=\'active\' and t.status=\'active\' limit 1', [email]);
      const member = rows?.[0];
      if (member?.password_hash && this.verifyPassword(password, member.password_hash)) {
        identity = { accountKey: `member:${member.id}`, sub: member.email, role: member.role, tenantId: member.tenant_id };
      }
    }
    if (!identity) {
      this.recordFailure(keys);
      throw new UnauthorizedException('Thông tin đăng nhập không đúng');
    }
    this.clearAttempts(keys);
    const credential = await this.credential(identity.accountKey);
    if (credential?.enabled_at) return { mfaRequired: true, challengeToken: this.newPending(identity, 'login') };
    return { mfaSetupRequired: true, setupToken: this.newPending(identity, 'setup') };
  }

  private issue(input: Omit<Session, 'exp'>) {
    const session: Session = { ...input, mfaAt: Date.now(), exp: Date.now() + 8 * 60 * 60 * 1000 };
    const body = this.encode(JSON.stringify(session));
    return { accessToken: `${body}.${this.sign(body)}`, expiresAt: session.exp, user: { email: session.sub, role: session.role, tenantId: session.tenantId } };
  }

  private totpCounter(secret: string, codeInput: unknown, now = Date.now()) {
    const code = typeof codeInput === 'string' ? codeInput.replace(/\s/g, '') : '';
    if (!/^\d{6}$/.test(code)) return null;
    const key = base32Decode(secret);
    const current = Math.floor(now / 30_000);
    for (const counter of [current, current - 1, current + 1]) {
      if (counter < 0) continue;
      const message = Buffer.alloc(8);
      message.writeBigUInt64BE(BigInt(counter));
      const digest = createHmac('sha1', key).update(message).digest();
      const offset = digest[digest.length - 1] & 15;
      const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
      const expected = String(binary % 1_000_000).padStart(6, '0');
      if (this.equal(expected, code)) return counter;
    }
    return null;
  }
  private generateRecoveryCodes() {
    return Array.from({ length: 10 }, () => randomBytes(10).toString('hex').match(/.{1,5}/g)!.join('-').toUpperCase());
  }
  private recoveryHash(code: string) { return createHash('sha256').update(code.replace(/[^a-f0-9]/gi, '').toLowerCase()).digest('hex'); }

  async beginMfaSetup(setupToken: unknown) {
    const { value } = this.pending(setupToken, 'setup');
    const secret = base32Encode(randomBytes(20));
    value.secret = secret;
    const label = encodeURIComponent(`${value.sub} (${value.role === 'super_admin' ? '30NICE' : '30NICE Tenant'})`);
    const issuer = encodeURIComponent('30NICE Mail Cloud');
    return { secret, issuer: '30NICE Mail Cloud', account: value.sub, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
  }

  async completeMfaSetup(setupToken: unknown, code: unknown) {
    const { token, value } = this.pending(setupToken, 'setup');
    if (!value.secret) throw new BadRequestException('Hãy tạo khóa xác thực trước khi xác nhận');
    const counter = this.totpCounter(value.secret, code);
    if (counter === null) { this.failPending(token, value); throw new UnauthorizedException('Mã xác thực không đúng hoặc đã hết hạn'); }
    const recoveryCodes = this.generateRecoveryCodes();
    const credential: Credential = { secret_ciphertext: this.encryptSecret(value.secret), enabled_at: new Date(), last_totp_counter: counter, recovery_hashes: recoveryCodes.map(codeValue => this.recoveryHash(codeValue)) };
    if (await this.ensureMfaSchema()) {
      const inserted = await this.database.query(`INSERT INTO mfa_credentials (account_key,email,tenant_id,secret_ciphertext,enabled_at,last_totp_counter,recovery_hashes)
        VALUES ($1,$2,$3,$4,now(),$5,$6::jsonb)
        ON CONFLICT (account_key) DO UPDATE SET email=EXCLUDED.email,tenant_id=EXCLUDED.tenant_id,secret_ciphertext=EXCLUDED.secret_ciphertext,enabled_at=now(),last_totp_counter=EXCLUDED.last_totp_counter,recovery_hashes=EXCLUDED.recovery_hashes,updated_at=now()
        WHERE mfa_credentials.enabled_at IS NULL RETURNING account_key`, [value.accountKey, value.sub, value.tenantId || null, credential.secret_ciphertext, counter, JSON.stringify(credential.recovery_hashes)]);
      if (!inserted?.length) {
        this.pendingAuth.delete(token);
        throw new UnauthorizedException('MFA đã được bật trong một phiên khác. Hãy đăng nhập lại.');
      }
    } else {
      if (this.memoryCredentials.get(value.accountKey)?.enabled_at) {
        this.pendingAuth.delete(token);
        throw new UnauthorizedException('MFA đã được bật trong một phiên khác. Hãy đăng nhập lại.');
      }
      this.memoryCredentials.set(value.accountKey, credential);
    }
    this.pendingAuth.delete(token);
    return { ...this.issue(value), recoveryCodes };
  }

  async verifyMfa(challengeToken: unknown, codeInput: unknown) {
    const { token, value } = this.pending(challengeToken, 'login');
    const credential = await this.credential(value.accountKey);
    if (!credential?.enabled_at) { this.pendingAuth.delete(token); throw new UnauthorizedException('MFA chưa được bật. Hãy đăng nhập lại để thiết lập.'); }
    let accepted = false;
    const code = typeof codeInput === 'string' ? codeInput.trim() : '';
    const counter = this.totpCounter(this.decryptSecret(credential.secret_ciphertext), code);
    if (counter !== null) {
      if (await this.ensureMfaSchema()) {
        const changed = await this.database.query(`UPDATE mfa_credentials SET last_totp_counter=$2,updated_at=now() WHERE account_key=$1 AND (last_totp_counter IS NULL OR last_totp_counter < $2) RETURNING account_key`, [value.accountKey, counter]);
        accepted = Boolean(changed?.length);
      } else if (credential.last_totp_counter == null || Number(credential.last_totp_counter) < counter) {
        credential.last_totp_counter = counter;
        accepted = true;
      }
    }
    if (!accepted) {
      const hash = this.recoveryHash(code);
      const index = credential.recovery_hashes.findIndex(item => this.equal(item, hash));
      if (index >= 0) {
        const remaining = [...credential.recovery_hashes];
        remaining.splice(index, 1);
        if (await this.ensureMfaSchema()) {
          const changed = await this.database.query(`UPDATE mfa_credentials SET recovery_hashes=$2::jsonb,updated_at=now() WHERE account_key=$1 AND recovery_hashes @> $3::jsonb RETURNING account_key`, [value.accountKey, JSON.stringify(remaining), JSON.stringify([credential.recovery_hashes[index]])]);
          accepted = Boolean(changed?.length);
        } else { credential.recovery_hashes = remaining; accepted = true; }
      }
    }
    if (!accepted) { this.failPending(token, value); throw new UnauthorizedException('Mã xác thực không đúng hoặc đã được sử dụng'); }
    this.pendingAuth.delete(token);
    return this.issue(value);
  }

  private verifyPassword(password: string, encoded: string) {
    try {
      const [prefix, salt, hash] = encoded.split('$');
      if (prefix !== 'scrypt' || !salt || !hash || !/^[a-f0-9]{64}$/i.test(hash)) return false;
      const derived = scryptSync(password, salt, 32);
      const expected = Buffer.from(hash, 'hex');
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch { return false; }
  }

  async mfaStatus(header?: string) {
    const session = this.verify(header);
    const accountKey = session.role === 'super_admin' ? `admin:${session.sub.trim().toLowerCase()}` : await this.memberAccountKey(session);
    const credential = await this.credential(accountKey);
    return { enabled: Boolean(credential?.enabled_at), recoveryCodesRemaining: credential?.recovery_hashes.length || 0 };
  }
  private async memberAccountKey(session: Session) {
    const rows = await this.database.query<{ id: string }>('SELECT id::text AS id FROM tenant_members WHERE lower(email)=lower($1) AND tenant_id=$2::uuid LIMIT 1', [session.sub, session.tenantId]);
    if (!rows?.[0]) throw new UnauthorizedException('Tài khoản không còn hoạt động');
    return `member:${rows[0].id}`;
  }

  requireSuperAdmin(header?: string) { const session = this.verify(header); if (session.role !== 'super_admin') throw new ForbiddenException('Chỉ Super Admin được thực hiện thao tác này'); return session; }
  async verifyActive(header?: string) {
    const session = this.verify(header);
    if (!Number.isFinite(session.mfaAt)) throw new UnauthorizedException('Phiên đăng nhập cũ chưa xác thực hai bước. Vui lòng đăng nhập lại để hoàn tất MFA.');
    if (session.role === 'super_admin') return session;
    let rows;
    try { rows = await this.database.query<{ member_status: string; tenant_status: string }>('select m.status as member_status,t.status as tenant_status from tenant_members m join tenants t on t.id=m.tenant_id where lower(m.email)=lower($1) and m.tenant_id=$2::uuid limit 1', [session.sub, session.tenantId]); }
    catch { throw new ServiceUnavailableException('Không thể kiểm tra trạng thái tài khoản. Vui lòng thử lại sau.'); }
    const row = rows?.[0];
    if (!row || row.member_status !== 'active' || row.tenant_status !== 'active') throw new UnauthorizedException('Tài khoản đã bị khóa hoặc tenant không còn hoạt động. Vui lòng đăng nhập lại sau khi được mở khóa.');
    return session;
  }
  verify(header?: string) {
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Cần đăng nhập');
    const token = header.slice(7);
    if (token.length > 4096 || !this.secret) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');
    const [body, signature] = parts;
    if (!this.equal(this.sign(body), signature)) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');
    try {
      const session = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
      if (!session || typeof session.sub !== 'string' || !session.sub || !['super_admin', 'tenant_admin', 'mailbox_user'].includes(session.role) || !Number.isFinite(session.exp) || session.exp <= Date.now() || (session.role !== 'super_admin' && (typeof session.tenantId !== 'string' || !session.tenantId))) throw new Error('invalid');
      return session;
    } catch { throw new UnauthorizedException('Phiên đăng nhập không hợp lệ'); }
  }
}

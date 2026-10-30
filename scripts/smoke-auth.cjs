const assert = require('node:assert/strict');
const { createHmac, scryptSync } = require('node:crypto');
const { AuthService } = require('../apps/api/dist/auth.service.js');
const { MailCloudService } = require('../apps/api/dist/mail-cloud.service.js');
const { BadRequestException, ForbiddenException, HttpException, UnauthorizedException } = require('@nestjs/common');

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function decodeBase32(input) {
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of input) {
    value = (value << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
function totp(secret, time = Date.now()) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(number % 1_000_000).padStart(6, '0');
}
const expectReject = async (promise, type) => assert.rejects(promise, error => error instanceof type);

class FakeDatabase {
  credentials = new Map();
  authFailureLimits = new Map();
  tenantStatus = 'active';
  memberStatus = 'active';

  async ensureSeed() {}
  async query(sql, values = []) {
    if (sql.includes('CREATE TABLE IF NOT EXISTS mfa_credentials')) return [];
    if (sql.includes('SELECT EXISTS (')) return [{ blocked: values[0].some(key => (this.authFailureLimits.get(key)?.count || 0) >= 8) }];
    if (sql.includes('DELETE FROM auth_failure_limits')) { for (const key of values[0] || []) this.authFailureLimits.delete(key); return []; }
    if (sql.includes('SELECT secret_ciphertext')) return this.credentials.has(values[0]) ? [this.credentials.get(values[0])] : [];
    if (sql.includes('INSERT INTO mfa_credentials')) {
      const [accountKey, email, tenantId, secret, counter, hashes] = values;
      this.credentials.set(accountKey, { secret_ciphertext: secret, enabled_at: new Date(), last_totp_counter: counter, recovery_hashes: JSON.parse(hashes) });
      return [{ account_key: accountKey }];
    }
    if (sql.includes('SET last_totp_counter=')) {
      const row = this.credentials.get(values[0]);
      if (row && (row.last_totp_counter == null || Number(row.last_totp_counter) < Number(values[1]))) {
        row.last_totp_counter = values[1];
        return [{ account_key: values[0] }];
      }
      return [];
    }
    if (sql.includes('SET recovery_hashes=')) {
      const row = this.credentials.get(values[0]);
      const used = JSON.parse(values[2])[0];
      if (row && row.recovery_hashes.includes(used)) {
        row.recovery_hashes = JSON.parse(values[1]);
        return [{ account_key: values[0] }];
      }
      return [];
    }
    if (sql.includes('m.status as member_status')) return [{ member_status: this.memberStatus, tenant_status: this.tenantStatus }];
    if (sql.includes('tenant_members m join tenants')) {
      return this.tenantStatus === 'active' && this.memberStatus === 'active'
        ? [{ id: 'member-id', email: 'member@example.com', role: 'tenant_admin', tenant_id: 'tenant-uuid', password_hash: this.passwordHash }]
        : [];
    }
    if (sql.includes('FROM tenant_members WHERE')) return [{ id: 'member-id' }];
    if (sql.includes('select id::text,status from tenants')) return this.tenantStatus === 'missing' ? [] : [{ id: 'tenant-uuid', status: this.tenantStatus }];
    return [];
  }
  async transaction(work) {
    return work(async (sql, values = []) => {
      if (sql.includes('INSERT INTO auth_failure_limits')) {
        if (!this.authFailureLimits.has(values[0])) this.authFailureLimits.set(values[0], { count: 0 });
        return [];
      }
      if (sql.includes('SELECT failure_count FROM auth_failure_limits')) {
        const row = this.authFailureLimits.get(values[0]);
        return row ? [{ failure_count: row.count }] : [];
      }
      if (sql.includes('UPDATE auth_failure_limits SET')) {
        const row = this.authFailureLimits.get(values[0]);
        if (row) row.count++;
        return [];
      }
      return [];
    });
  }
}

async function enroll(auth, email, password, ip) {
  const login = await auth.login(email, password, ip);
  assert.equal(login.mfaSetupRequired, true, 'first password login must require MFA enrollment');
  assert.equal(login.accessToken, undefined, 'password alone must never issue a control-plane token');
  const setup = await auth.beginMfaSetup(login.setupToken);
  assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\//);
  const result = await auth.completeMfaSetup(login.setupToken, totp(setup.secret));
  assert.equal(result.recoveryCodes.length, 10);
  assert.equal(new Set(result.recoveryCodes).size, 10);
  assert.ok(result.accessToken);
  return { ...result, secret: setup.secret };
}

async function main() {
  process.env.CONTROL_PLANE_SESSION_SECRET = 'smoke-test-session-secret';
  process.env.CONTROL_PLANE_ADMIN_EMAIL = 'admin@example.com';
  process.env.CONTROL_PLANE_ADMIN_PASSWORD = 'smoke-admin-password';
  const salt = 'test-salt';
  const passwordHash = `scrypt$${salt}$${scryptSync('tenant-user-password', salt, 32).toString('hex')}`;
  const database = new FakeDatabase();
  database.passwordHash = passwordHash;
  const auth = new AuthService(database);

  const admin = await enroll(auth, 'ADMIN@example.com', 'smoke-admin-password', '127.0.0.1');
  assert.equal(auth.verify(`Bearer ${admin.accessToken}`).role, 'super_admin');
  const storedAdminMfa = database.credentials.get('admin:admin@example.com');
  assert.ok(storedAdminMfa.secret_ciphertext && !storedAdminMfa.secret_ciphertext.includes(admin.secret), 'TOTP secret must be encrypted at rest');
  const adminChallenge = await auth.login('admin@example.com', 'smoke-admin-password', '127.0.0.1');
  assert.equal(adminChallenge.mfaRequired, true);
  const adminSession = await auth.verifyMfa(adminChallenge.challengeToken, admin.recoveryCodes[0]);
  assert.equal(auth.verify(`Bearer ${adminSession.accessToken}`).role, 'super_admin');
  assert.equal((await auth.mfaStatus(`Bearer ${adminSession.accessToken}`)).recoveryCodesRemaining, 9);
  const reuseChallenge = await auth.login('admin@example.com', 'smoke-admin-password', '127.0.0.1');
  await expectReject(auth.verifyMfa(reuseChallenge.challengeToken, admin.recoveryCodes[0]), UnauthorizedException);
  const replayChallenge = await auth.login('admin@example.com', 'smoke-admin-password', '127.0.0.1');
  await expectReject(auth.verifyMfa(replayChallenge.challengeToken, totp(admin.secret)), UnauthorizedException);
  const freshTotp = totp(admin.secret, Date.now() + 30_000);
  const totpChallenge = await auth.login('admin@example.com', 'smoke-admin-password', '127.0.0.1');
  const freshSession = await auth.verifyMfa(totpChallenge.challengeToken, freshTotp);
  assert.equal(auth.verify(`Bearer ${freshSession.accessToken}`).role, 'super_admin');

  const nearbyCodes = [totp(admin.secret, Date.now() - 30_000), totp(admin.secret), totp(admin.secret, Date.now() + 30_000)];
  let wrongMfaCode = '000000';
  while (nearbyCodes.includes(wrongMfaCode)) wrongMfaCode = String(Number(wrongMfaCode) + 1).padStart(6, '0');
  for (let attempt = 0; attempt < 8; attempt++) {
    const challenge = await auth.login('admin@example.com', 'smoke-admin-password', '192.0.2.77');
    await expectReject(auth.verifyMfa(challenge.challengeToken, wrongMfaCode), UnauthorizedException);
  }
  const throttledMfa = await auth.login('admin@example.com', 'smoke-admin-password', '192.0.2.77');
  await assert.rejects(auth.verifyMfa(throttledMfa.challengeToken, wrongMfaCode), error => error instanceof HttpException && error.getStatus() === 429);

  const legacyBody = Buffer.from(JSON.stringify({ sub: 'admin@example.com', role: 'super_admin', exp: Date.now() + 60_000 })).toString('base64url');
  const legacyToken = `${legacyBody}.${auth.sign(legacyBody)}`;
  await expectReject(auth.verifyActive(`Bearer ${legacyToken}`), UnauthorizedException);

  const tenant = await enroll(auth, 'member@example.com', 'tenant-user-password', '127.0.0.2');
  assert.equal(auth.verify(`Bearer ${tenant.accessToken}`).role, 'tenant_admin');
  assert.equal((await auth.verifyActive(`Bearer ${tenant.accessToken}`)).role, 'tenant_admin');
  assert.throws(() => auth.requireSuperAdmin(`Bearer ${tenant.accessToken}`), ForbiddenException);
  await expectReject(auth.login('member@example.com', 'wrong-password', '127.0.0.3'), UnauthorizedException);
  await expectReject(Promise.resolve().then(() => auth.verify('Bearer malformed.token.extra')), UnauthorizedException);
  const lockedToken = tenant.accessToken;
  database.tenantStatus = 'suspended';
  const mailCloud = new MailCloudService(database, {});
  await expectReject(mailCloud.assertTenant('tenant-uuid'), ForbiddenException);
  await expectReject(auth.verifyActive(`Bearer ${lockedToken}`), UnauthorizedException);
  database.tenantStatus = 'active'; database.memberStatus = 'disabled';
  await expectReject(auth.verifyActive(`Bearer ${lockedToken}`), UnauthorizedException);
  await expectReject(auth.login('member@example.com', 'tenant-user-password', '127.0.0.5'), UnauthorizedException);
  database.memberStatus = 'active';

  const throttledAuth = new AuthService(database);
  for (let i = 0; i < 8; i++) await expectReject(throttledAuth.login('bad@example.com', 'wrong-password', '198.51.100.5'), UnauthorizedException);
  await assert.rejects(throttledAuth.login('bad@example.com', 'wrong-password', '198.51.100.5'), error => error instanceof HttpException && error.getStatus() === 429);

  const writes = [];
  const memberDb = { query: async () => null, transaction: async work => work(async (sql, values = []) => { writes.push({ sql, values }); return sql.includes('pg_advisory_xact_lock') ? [] : [{ id: 'member-id', email: 'other@example.com', role: 'tenant_admin', status: values[2] }]; }) };
  const memberService = new MailCloudService(memberDb, {});
  await memberService.updateMemberStatus('tenant-uuid', 'member-id', 'disabled', 'admin@example.com');
  const blockedService = new MailCloudService({ query: async () => null, transaction: async work => work(async () => []) }, {});
  await expectReject(blockedService.updateMemberStatus('tenant-uuid', 'last-admin', 'disabled', 'peer@example.com'), BadRequestException);
  assert.deepEqual(writes[0].values, ['tenant-uuid']);
  assert.match(writes[0].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(writes[1].values, ['member-id', 'tenant-uuid', 'disabled', 'admin@example.com']);
  assert.match(writes[1].sql, /m\.tenant_id=\$2::uuid/);
  assert.match(writes[1].sql, /lower\(m\.email\)<>lower\(\$4\)/);
  assert.match(writes[1].sql, /active\.status='active'/);
  console.log('Auth smoke checks passed: mandatory TOTP enrollment/challenge, recovery codes, replay prevention, session validation, tenant revocation, and throttling.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const { AuthService } = require('../apps/api/dist/auth.service.js');
const { MailCloudService } = require('../apps/api/dist/mail-cloud.service.js');
const { BadRequestException, ForbiddenException, HttpException, UnauthorizedException } = require('@nestjs/common');
const { scryptSync } = require('node:crypto');

const expectReject = async (promise, type) => {
  await assert.rejects(promise, error => error instanceof type);
};

async function main() {
  process.env.CONTROL_PLANE_SESSION_SECRET = 'smoke-test-session-secret';
  process.env.CONTROL_PLANE_ADMIN_EMAIL = 'admin@example.com';
  process.env.CONTROL_PLANE_ADMIN_PASSWORD = 'smoke-admin-password';
  const salt = 'test-salt';
  const passwordHash = `scrypt$${salt}$${scryptSync('tenant-user-password', salt, 32).toString('hex')}`;
  let tenantStatus = 'active';
  let memberStatus = 'active';
  const database = {
    ensureSeed: async () => undefined,
    query: async (sql) => {
      if (sql.includes('m.status as member_status')) {
        return [{ member_status: memberStatus, tenant_status: tenantStatus }];
      }
      if (sql.includes('tenant_members m join tenants')) {
        return tenantStatus === 'active' && memberStatus === 'active'
          ? [{ email: 'member@example.com', role: 'tenant_admin', tenant_id: 'tenant-uuid', password_hash: passwordHash }]
          : [];
      }
      if (sql.includes('select id::text,status from tenants')) {
        return tenantStatus === 'missing' ? [] : [{ id: 'tenant-uuid', status: tenantStatus }];
      }
      return [];
    },
  };
  const auth = new AuthService(database);
  const admin = await auth.login('ADMIN@example.com', 'smoke-admin-password', '127.0.0.1');
  assert.equal(auth.verify(`Bearer ${admin.accessToken}`).role, 'super_admin');
  const tenant = await auth.login('member@example.com', 'tenant-user-password', '127.0.0.2');
  assert.equal(auth.verify(`Bearer ${tenant.accessToken}`).role, 'tenant_admin');
  assert.equal((await auth.verifyActive(`Bearer ${tenant.accessToken}`)).role, 'tenant_admin');
  assert.throws(() => auth.requireSuperAdmin(`Bearer ${tenant.accessToken}`), ForbiddenException);
  await expectReject(auth.login('member@example.com', 'wrong-password', '127.0.0.3'), UnauthorizedException);
  await expectReject(Promise.resolve().then(() => auth.verify('Bearer malformed.token.extra')), UnauthorizedException);
  const locked = await auth.login('member@example.com', 'tenant-user-password', '127.0.0.4');
  tenantStatus = 'suspended';
  const mailCloud = new MailCloudService(database, {});
  await expectReject(mailCloud.assertTenant('tenant-uuid'), ForbiddenException);
  await expectReject(auth.verifyActive(`Bearer ${locked.accessToken}`), UnauthorizedException);
  tenantStatus = 'active'; memberStatus = 'disabled';
  await expectReject(auth.verifyActive(`Bearer ${locked.accessToken}`), UnauthorizedException);
  await expectReject(auth.login('member@example.com', 'tenant-user-password', '127.0.0.5'), UnauthorizedException);
  memberStatus = 'active';

  const throttledAuth = new AuthService(database);
  for (let i = 0; i < 8; i++) {
    await expectReject(throttledAuth.login('bad@example.com', 'wrong-password', '198.51.100.5'), UnauthorizedException);
  }
  await assert.rejects(
    throttledAuth.login('bad@example.com', 'wrong-password', '198.51.100.5'),
    error => error instanceof HttpException && error.getStatus() === 429,
  );
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
  console.log('Auth/member smoke checks passed: session validation, immediate revocation, tenant status, serialized self/last-admin guard, scoped update, and throttling.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

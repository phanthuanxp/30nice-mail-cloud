const assert = require('node:assert/strict');
const { AuthService } = require('../apps/api/dist/auth.service.js');
const { MailCloudService } = require('../apps/api/dist/mail-cloud.service.js');
const { ForbiddenException, HttpException, UnauthorizedException } = require('@nestjs/common');
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
  const database = {
    ensureSeed: async () => undefined,
    query: async (sql) => {
      if (sql.includes('tenant_members m join tenants')) {
        return tenantStatus === 'active'
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
  assert.throws(() => auth.requireSuperAdmin(`Bearer ${tenant.accessToken}`), ForbiddenException);
  await expectReject(auth.login('member@example.com', 'wrong-password', '127.0.0.3'), UnauthorizedException);
  await expectReject(Promise.resolve().then(() => auth.verify('Bearer malformed.token.extra')), UnauthorizedException);
  const locked = await auth.login('member@example.com', 'tenant-user-password', '127.0.0.4');
  tenantStatus = 'suspended';
  const mailCloud = new MailCloudService(database, {});
  await expectReject(mailCloud.assertTenant('tenant-uuid'), ForbiddenException);
  assert.equal(auth.verify(`Bearer ${locked.accessToken}`).role, 'tenant_admin');

  const throttledAuth = new AuthService(database);
  for (let i = 0; i < 8; i++) {
    await expectReject(throttledAuth.login('bad@example.com', 'wrong-password', '198.51.100.5'), UnauthorizedException);
  }
  await assert.rejects(
    throttledAuth.login('bad@example.com', 'wrong-password', '198.51.100.5'),
    error => error instanceof HttpException && error.getStatus() === 429,
  );
  console.log('Auth smoke checks passed: session validation, role gate, inactive tenant, and login throttling.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

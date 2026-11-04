const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');
const { MailCloudService } = require('../apps/api/dist/mail-cloud.service.js');

async function main() {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://test.invalid/unused';
  try {
    const writes = [];
    const db = { query: async (sql, values) => {
      writes.push({ sql, values });
      return sql.startsWith('insert into tenants') ? [{ id: 'tenant-test', name: values[0], slug: values[1] }] : [];
    } };
    const service = new MailCloudService(db, {});
    for (const input of [null, {}, { name: 42, slug: 'abc' }, { name: 'ABC', slug: [] }, { name: ' ', slug: 'abc' }, { name: 'A'.repeat(121), slug: 'abc' }, { name: 'ABC', slug: 'a'.repeat(65) }, { name: 'ABC', slug: '../abc' }]) {
      await assert.rejects(service.createTenant(input), BadRequestException);
    }
    assert.equal(writes.length, 0, 'invalid inputs must not reach storage');
    const result = await service.createTenant({ name: ' Công ty ABC ', slug: ' ABC-COMPANY ' }, 'owner@example.com', 'request-test');
    assert.equal(result.slug, 'abc-company');
    assert.deepEqual(writes[0].values, ['Công ty ABC', 'abc-company']);
    assert.deepEqual(writes[1].values, ['tenant-test', 'owner@example.com', 'tenant.create', 'tenant', 'tenant-test', 'request-test']);
    const duplicate = new MailCloudService({ query: async () => { throw Object.assign(new Error('database unique error'), { code: '23505' }); } }, {});
    await assert.rejects(duplicate.createTenant({ name: 'ABC', slug: 'abc' }), error => error instanceof BadRequestException && error.message === 'Mã khách hàng đã tồn tại');
    const offline = new Error('storage unavailable');
    const unavailable = new MailCloudService({ query: async () => { throw offline; } }, {});
    await assert.rejects(unavailable.createTenant({ name: 'ABC', slug: 'abc' }), error => error === offline);
    const beforeMemberWrites = writes.length;
    for (const input of [
      { email: 'user@example.com', password: 'valid-password-123', role: 'super_admin' },
      { email: 'user@example.com', password: 'valid-password-123', role: {} },
      { email: 42, password: 'valid-password-123' },
      { email: 'user@example.com', password: [] },
      { email: 'user@example.com', password: 'x'.repeat(1025) },
      null,
    ]) await assert.rejects(service.createMember('tenant-test', input), BadRequestException);
    assert.equal(writes.length, beforeMemberWrites, 'invalid member roles and credentials must not reach storage');
    console.log('Customer creation checks passed: validation, normalization, duplicate translation, audit attribution and storage failures.');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

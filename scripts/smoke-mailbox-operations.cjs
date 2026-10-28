const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');
const { MailCloudService } = require('../apps/api/dist/mail-cloud.service.js');

async function main() {
  let stored = { id: 'mailbox-id', tenantId: 'tenant-id', address: 'user@example.test', quotaGb: 5, status: 'active' };
  let failMailcow = false;
  let rollbackCount = 0;
  const resetCalls = [];
  const database = {
    query: async (sql, values = []) => {
      if (sql.startsWith('select address from mailboxes')) return values[0] === stored.id && values[1] === stored.tenantId ? [{ address: stored.address }] : [];
      if (sql.startsWith('select address,quota_gb')) return [{ address: stored.address, quotaGb: stored.quotaGb, status: stored.status }];
      if (sql.startsWith('update mailboxes set quota_gb=$3')) {
        stored = { ...stored, quotaGb: values[2], status: values[3] };
        return [{ ...stored }];
      }
      if (sql.startsWith('update mailboxes set quota_gb=$2')) {
        rollbackCount++;
        stored = { ...stored, quotaGb: values[1], status: values[2] };
        return [{ ...stored }];
      }
      return [];
    },
    status: async () => ({ configured: true, connected: true }),
  };
  const mailcow = {
    editMailbox: async (...args) => {
      if (failMailcow) throw new Error('Mailcow temporarily unavailable');
      resetCalls.push(args);
    },
  };
  const service = new MailCloudService(database, mailcow);

  const changed = await service.updateMailbox('tenant-id', 'mailbox-id', { quotaGb: 20, status: 'disabled' });
  assert.equal(changed.quotaGb, 20);
  assert.equal(changed.status, 'disabled');
  assert.equal(stored.quotaGb, 20);

  failMailcow = true;
  await assert.rejects(
    service.updateMailbox('tenant-id', 'mailbox-id', { quotaGb: 10, status: 'active' }),
    error => error instanceof BadRequestException,
  );
  assert.equal(stored.quotaGb, 20, 'database quota is restored after Mailcow rejects the update');
  assert.equal(stored.status, 'disabled', 'database status is restored after Mailcow rejects the update');
  assert.equal(rollbackCount, 1);
  failMailcow = false;
  const reset = await service.resetMailboxPassword('tenant-id', 'mailbox-id');
  assert.equal(reset.address, stored.address);
  assert.match(reset.temporaryPassword, /A1!$/);
  assert.ok(reset.temporaryPassword.length >= 20);
  assert.deepEqual(resetCalls.at(-1).slice(0, 3), [stored.address, undefined, undefined]);
  assert.equal(resetCalls.at(-1)[3], reset.temporaryPassword);
  await assert.rejects(service.resetMailboxPassword('other-tenant', 'mailbox-id'));
  console.log('Mailbox operations smoke checks passed: quota/status rollback and tenant-scoped one-time password reset.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

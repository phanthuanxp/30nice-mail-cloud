const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');
const { MailCloudService } = require('../apps/api/dist/mail-cloud.service.js');

async function main() {
  let stored = { id: 'mailbox-id', tenantId: 'tenant-id', address: 'user@example.test', quotaGb: 5, status: 'active' };
  let failMailcow = false;
  let rollbackCount = 0;
  const database = {
    query: async (sql, values = []) => {
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
    editMailbox: async () => {
      if (failMailcow) throw new Error('Mailcow temporarily unavailable');
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
  console.log('Mailbox operations smoke checks passed: quota/status update and rollback after Mailcow failure.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

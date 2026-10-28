const assert = require('node:assert/strict');
const { ImapFlow } = require('imapflow');
const { WebmailService } = require('../apps/api/dist/webmail.service.js');

let folderList = [
  { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox' },
  { path: 'Sent', name: 'Sent', specialUse: '\\Sent' },
];
let fetchedUids;
ImapFlow.prototype.connect = async function () {};
ImapFlow.prototype.logout = async function () {};
ImapFlow.prototype.list = async function () { return folderList; };
ImapFlow.prototype.getMailboxLock = async function () { return { release() {} }; };
ImapFlow.prototype.search = async function () { return Array.from({ length: 350 }, (_, index) => index + 1); };
ImapFlow.prototype.fetchAll = async function (uids) {
  fetchedUids = uids;
  return [
    { envelope: { date: new Date('2026-10-20T10:00:00Z'), to: [
      { address: 'alice@example.test', name: 'Alice Nguyen' },
      { address: 'user@example.test', name: 'Current User' },
      { address: 'bad-address', name: '' },
    ], cc: [{ address: 'team@example.test', name: 'Team' }] } },
    { envelope: { date: new Date('2026-10-25T10:00:00Z'), to: [
      { address: 'alice@example.test', name: 'Alice Nguyen' },
      { address: 'bob@example.test', name: 'Bob' },
    ], cc: [] } },
  ];
};

async function main() {
  const service = new WebmailService();
  const session = await service.login('user@example.test', 'test-password', '127.0.0.1');
  const contacts = await service.contacts(session.token);
  assert.equal(fetchedUids.length, 300, 'only a bounded set of recent message headers is scanned');
  assert.equal(fetchedUids[0], 350, 'most recent UIDs are examined first');
  assert.deepEqual(contacts.map(contact => contact.address), [
    'alice@example.test', 'bob@example.test', 'team@example.test',
  ]);
  assert.equal(contacts.find(contact => contact.address === 'alice@example.test').name, 'Alice Nguyen');
  assert.ok(!contacts.some(contact => contact.address === 'user@example.test'));
  assert.ok(!contacts.some(contact => contact.address === 'bad-address'));

  folderList = [{ path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox' }];
  assert.deepEqual(await service.contacts(session.token), [], 'mailboxes without a Sent folder receive an empty suggestion list');
  console.log('Webmail contacts checks passed: mailbox-scoped recent recipients, bounded header scan, own/invalid address filtering.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');
const { WebmailService } = require('../apps/api/dist/webmail.service.js');

function fixture(folderPath, moveResult = { uidValidity: 42n, uidMap: new Map([[42, 1]]) }) {
  const calls = { locks: [], deleted: [], moved: [] };
  const client = {
    connect: async () => undefined,
    logout: async () => undefined,
    list: async () => [
      { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox' },
      { path: 'Archive', name: 'Archive', specialUse: '\\Archive' },
      { path: 'Trash', name: 'Trash', specialUse: '\\Trash' },
    ],
    getMailboxLock: async path => {
      calls.locks.push(path);
      return { release: () => calls.locks.push(`released:${path}`) };
    },
    messageMove: async (uid, destination, options) => { calls.moved.push({ uid, destination, options }); return moveResult; },
    messageDelete: async (uid, options) => { calls.deleted.push({ uid, options, folderPath }); return true; },
  };
  const service = new WebmailService();
  service.session = () => ({ email: 'user@example.com', password: 'test', expiresAt: Date.now() + 60_000 });
  service.makeClient = () => client;
  return { service, calls };
}

(async () => {
  {
    const { service, calls } = fixture('INBOX');
    await assert.rejects(service.deletePermanently('session', 'INBOX', 42), error => error instanceof BadRequestException);
    assert.deepEqual(calls.deleted, [], 'must not delete a message outside Trash');
    assert.deepEqual(calls.locks, [], 'must reject before locking a non-Trash folder');
  }
  {
    const { service, calls } = fixture('Trash');
    assert.equal(await service.deletePermanently('session', 'Trash', 42), true);
    assert.deepEqual(calls.deleted, [{ uid: 42, options: { uid: true }, folderPath: 'Trash' }]);
    assert.deepEqual(calls.locks, ['Trash', 'released:Trash'], 'must release the IMAP lock');
  }
  for (const [method, source, destination] of [
    ['moveToTrash', 'INBOX', 'Trash'],
    ['moveToArchive', 'INBOX', 'Archive'],
    ['moveToInbox', 'Trash', 'INBOX'],
  ]) {
    const { service, calls } = fixture(source);
    const response = await service[method]('session', source, 42);
    assert.equal(JSON.stringify(response), '{"ok":true}');
    assert.deepEqual(calls.moved, [{ uid: 42, destination, options: { uid: true } }]);
    assert.deepEqual(calls.locks, [source, `released:${source}`]);
  }
  {
    const { service, calls } = fixture('INBOX', false);
    await assert.rejects(service.moveToTrash('session', 'INBOX', 42), BadRequestException);
    assert.deepEqual(calls.locks, ['INBOX', 'released:INBOX']);
  }
  console.log('Permanent deletion is restricted to Trash and releases the IMAP lock.');
})().catch(error => { console.error(error); process.exit(1); });

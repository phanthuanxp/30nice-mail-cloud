const assert = require('node:assert/strict');
const { ImapFlow } = require('imapflow');
const { BadRequestException } = require('@nestjs/common');
const { WebmailService } = require('../apps/api/dist/webmail.service.js');

const folders = [
  { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox' },
  { path: 'Sent', name: 'Sent', specialUse: '\\Sent' },
];
const criteriaSeen = [];
ImapFlow.prototype.connect = async function () {};
ImapFlow.prototype.logout = async function () {};
ImapFlow.prototype.list = async function () { return folders; };
ImapFlow.prototype.getMailboxLock = async function () { return { release() {} }; };
ImapFlow.prototype.search = async function (criteria) { criteriaSeen.push(criteria); return [1, 2, 3]; };
ImapFlow.prototype.fetchAll = async function (uids) {
  return uids.map(uid => ({ uid, envelope: { date: new Date('2026-10-20T10:00:00Z'), from: [], to: [] }, flags: new Set() }));
};

async function main() {
  const service = new WebmailService();
  const session = await service.login('user@example.test', 'test-password', '127.0.0.1');
  const result = await service.messages(session.token, '*', 'from:alice@example.test to:bob@example.test cc:ops@example.test subject:"Invoice Q3" after:2026/10/01 before:2026-10-28 is:unread is:starred quarterly report');
  assert.equal(result.total, 6);
  assert.equal(criteriaSeen.length, 2, 'search spans non-trash folders');
  for (const criteria of criteriaSeen) {
    assert.equal(criteria.from, 'alice@example.test');
    assert.equal(criteria.to, 'bob@example.test');
    assert.equal(criteria.cc, 'ops@example.test');
    assert.equal(criteria.subject, 'Invoice Q3');
    assert.equal(criteria.since.toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(criteria.before.toISOString(), '2026-10-28T00:00:00.000Z');
    assert.equal(criteria.seen, false);
    assert.equal(criteria.flagged, true);
    assert.equal(criteria.text, 'quarterly report');
  }
  const beforeConflict = criteriaSeen.length;
  const conflict = await service.messages(session.token, '*', 'is:read', 1, 'unread');
  assert.equal(conflict.total, 0, 'conflicting search operators and tabs return no messages');
  assert.equal(criteriaSeen.length, beforeConflict, 'conflicting filters skip IMAP searches');
  assert.equal((await service.messages(session.token, '*', 'is:read is:unread')).total, 0, 'contradictory status operators return no messages');
  await assert.rejects(service.messages(session.token, '*', 'after:2026/02/30'), BadRequestException);
  const ordinary = await service.messages(session.token, '*', '"Quarterly Report"');
  assert.equal(criteriaSeen.at(-1).text, 'quarterly report', 'free-text search remains case-insensitive');
  console.log('Webmail search smoke checks passed: IMAP criteria, date validation, unread/star filters, conflict handling, folder scope, and free text.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

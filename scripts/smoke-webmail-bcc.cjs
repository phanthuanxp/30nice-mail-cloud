const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { WebmailService } = require('../apps/api/dist/webmail.service.js');

const originalCreateTransport = nodemailer.createTransport;
let smtpRaw;
let smtpEnvelope;
let sentCopy;
let draftCopy;
let deletedDraftCount = 0;
let nextSmtpError;
let nextSmtpResult;
const folders = [
  { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox' },
  { path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts' },
  { path: 'Sent', name: 'Sent', specialUse: '\\Sent' },
];
ImapFlow.prototype.connect = async function () {};
ImapFlow.prototype.logout = async function () {};
ImapFlow.prototype.list = async function () { return folders; };
ImapFlow.prototype.getMailboxLock = async function () { return { release() {} }; };
ImapFlow.prototype.search = async function () { return []; };
ImapFlow.prototype.messageDelete = async function () { deletedDraftCount++; return true; };
ImapFlow.prototype.append = async function (folder, message) {
  if (folder === 'Sent') sentCopy = Buffer.from(message);
  if (folder === 'Drafts') draftCopy = Buffer.from(message);
  return { uid: 17 };
};
nodemailer.createTransport = function (options) {
  if (options.streamTransport) return originalCreateTransport.call(this, options);
  return {
    async sendMail(message) {
      if (nextSmtpError) { const error = nextSmtpError; nextSmtpError = null; throw error; }
      if (nextSmtpResult) { const result = nextSmtpResult; nextSmtpResult = null; return result; }
      smtpRaw = Buffer.from(message.raw);
      smtpEnvelope = message.envelope;
      return { accepted: message.envelope.to, rejected: [], messageId: '<smoke@example.test>' };
    },
    close() {},
  };
};

async function main() {
  try {
    const service = new WebmailService();
    const session = await service.login('user@example.test', 'test-password', '127.0.0.1');
    const result = await service.send(session.token, {
      to: 'to@example.test', cc: 'cc@example.test', bcc: 'hidden@example.test',
      subject: 'Kiểm tra BCC', text: 'Nội dung kiểm tra',
    });
    assert.deepEqual(smtpEnvelope.to, ['to@example.test', 'cc@example.test', 'hidden@example.test']);
    assert.doesNotMatch(smtpRaw.toString(), /^Bcc:/im, 'BCC header must not be exposed to SMTP recipients');
    assert.equal(result.accepted.length, 3);
    assert.equal(result.savedToSent, true);
    const deletesBeforeRejectedSends = deletedDraftCount;
    nextSmtpError = Object.assign(new Error('All recipients were rejected'), { code: 'EENVELOPE', accepted: [], rejected: ['bad@example.test'] });
    const rejectedResult = await service.send(session.token, {
      draftId: 'all-rejected-draft-0001', to: 'bad@example.test', subject: 'Giữ bản nháp', text: 'Thử gửi lại',
    });
    assert.deepEqual(rejectedResult.accepted, []);
    assert.deepEqual(rejectedResult.rejected, ['bad@example.test']);
    assert.equal(rejectedResult.savedToSent, false);
    assert.equal(rejectedResult.draftRemoved, false, 'a rejected send must retain its draft');
    nextSmtpResult = { accepted: [], rejected: ['bad2@example.test'], messageId: '<rejected@example.test>' };
    const allRejectedResult = await service.send(session.token, {
      draftId: 'all-rejected-draft-0002', to: 'bad2@example.test', text: 'Thử lại',
    });
    assert.deepEqual(allRejectedResult.rejected, ['bad2@example.test'], 'resolved SMTP all-rejected responses must preserve rejected addresses');
    assert.equal(allRejectedResult.draftRemoved, false);
    assert.equal(deletedDraftCount, deletesBeforeRejectedSends, 'all-rejected sends must not delete any draft copy');
    const sent = await simpleParser(sentCopy);
    assert.equal(sent.to.value[0].address, 'to@example.test');
    assert.equal(sent.cc.value[0].address, 'cc@example.test');
    assert.equal(sent.bcc.value[0].address, 'hidden@example.test');

    await assert.rejects(() => service.send(session.token, {
      to: 'to@example.test', bcc: 'TO@example.test', text: 'x',
    }), /Mỗi địa chỉ chỉ được nhập một lần/);
    await assert.rejects(() => service.send(session.token, {
      to: 'to@example.test', bcc: 'not-an-email', text: 'x',
    }), /địa chỉ người nhận hợp lệ/);
    const tooMany = Array.from({ length: 21 }, (_, index) => 'user' + index + '@example.test').join(',');
    await assert.rejects(() => service.send(session.token, {
      to: 'to@example.test', bcc: tooMany, text: 'x',
    }), /tối đa 20 người/);

    await service.saveDraft(session.token, {
      draftId: 'bcc-smoke-draft-0001', to: 'to@example.test',
      bcc: 'hidden@example.test', subject: 'Nháp BCC', text: 'Nội dung nháp',
    });
    const draft = await simpleParser(draftCopy);
    assert.equal(draft.bcc.value[0].address, 'hidden@example.test');
    console.log('Webmail BCC checks passed: SMTP privacy, Sent, drafts, validation.');
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

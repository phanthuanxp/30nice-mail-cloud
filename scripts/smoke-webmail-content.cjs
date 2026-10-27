const assert=require('node:assert/strict');
const {ImapFlow}=require('imapflow');
const {WebmailService}=require('../apps/api/dist/webmail.service.js');

const source=[
  'From: sender@example.test',
  'To: user@example.test',
  'Subject: Hình ảnh thư',
  'MIME-Version: 1.0',
  'Content-Type: multipart/related; boundary="mail-boundary"',
  '',
  '--mail-boundary',
  'Content-Type: text/html; charset=utf-8',
  'Content-Transfer-Encoding: 8bit',
  '',
  '<p>Nội dung thư</p><img src="https://tracker.example/pixel.png"><img src="cid:logo@example.test">',
  '--mail-boundary',
  'Content-Type: image/png',
  'Content-ID: <logo@example.test>',
  'Content-Disposition: inline; filename="logo.png"',
  'Content-Transfer-Encoding: base64',
  '',
  'aGVsbG8=',
  '--mail-boundary--',
  '',
].join('\r\n');

ImapFlow.prototype.connect=async function(){};
ImapFlow.prototype.logout=async function(){};
ImapFlow.prototype.list=async function(){return [{path:'INBOX',name:'INBOX',specialUse:'\\Inbox'}];};
ImapFlow.prototype.getMailboxLock=async function(){return {release(){}};};
ImapFlow.prototype.fetchOne=async function(_uid,query){
  if(query.size) return {size:Buffer.byteLength(source)};
  return {source:Buffer.from(source),flags:new Set()};
};
ImapFlow.prototype.messageFlagsAdd=async function(){};

async function main(){
  const service=new WebmailService();
  const session=await service.login('user@example.test','test-password','127.0.0.1');
  const hidden=await service.read(session.token,'INBOX',1);
  assert.equal(hidden.hasRemoteImages,true);
  assert.equal(hidden.externalImagesVisible,false);
  assert.doesNotMatch(hidden.html,/tracker\.example/,'remote image URL is not returned before consent');
  assert.match(hidden.html,/\/attachments\/0\?/,'inline CID images continue to use the authenticated attachment route');

  const visible=await service.read(session.token,'INBOX',1,true);
  assert.equal(visible.hasRemoteImages,true);
  assert.equal(visible.externalImagesVisible,true);
  assert.match(visible.html,/https:\/\/tracker\.example\/pixel\.png/,'remote image is returned after explicit opt-in');
  console.log('Webmail content smoke checks passed: external images hidden by default; inline images preserved; opt-in loads external content.');
}

main().catch(error=>{console.error(error);process.exitCode=1;});


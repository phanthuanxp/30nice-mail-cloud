const assert=require('node:assert/strict');
const {ImapFlow}=require('imapflow');
const {WebmailService}=require('../apps/api/dist/webmail.service.js');

const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const webmailStateSource=fs.readFileSync(path.join(__dirname,'../apps/portal/app/webmail/webmail-state.ts'),'utf8');
const webmailStateCode=ts.transpileModule(webmailStateSource,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const webmailStateModule={exports:{}};
new Function('exports','require','module',webmailStateCode)(webmailStateModule.exports,require,webmailStateModule);
const {updateMessageFlagState}=webmailStateModule.exports;
assert.deepEqual(updateMessageFlagState({seen:false,flagged:true},'seen'),{seen:true,flagged:true});
assert.deepEqual(updateMessageFlagState({seen:true,flagged:true},'unseen'),{seen:false,flagged:true});
assert.deepEqual(updateMessageFlagState({seen:false,flagged:true},'unflagged'),{seen:false,flagged:false});
const webmailUi=fs.readFileSync(path.join(__dirname,'../apps/portal/app/webmail/webmail-client.tsx'),'utf8');
assert.doesNotMatch(webmailUi,/flagged: flag === 'flagged'/,'updating read state does not clear the star in local UI');
assert.doesNotMatch(webmailUi,/window\.prompt\(/,'link insertion uses the in-app Vietnamese dialog');
assert.match(webmailUi,/role="dialog" aria-modal="true" aria-labelledby="wm-link-dialog-title"/,'link dialog is labelled and modal');
assert.match(webmailUi,/event.key === 'Escape'/,'Escape closes the link dialog');
assert.match(webmailUi,/event.shiftKey && document.activeElement === first/,'keyboard focus wraps inside the dialog');
assert.match(webmailUi,/anchor.textContent = url.href/,'a link inserted at the caret gets visible link text');

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
  console.log('Webmail content smoke checks passed: remote images require consent; inline images work; link dialog is keyboard accessible and inserts links at a selection or caret.');
}

main().catch(error=>{console.error(error);process.exitCode=1;});


const assert=require('node:assert/strict');const {randomBytes,randomUUID}=require('node:crypto');const {Client}=require('pg');const {migrate}=require('./migrate.cjs');
const {DatabaseService}=require('../apps/api/dist/database.service.js');const {MailcowService}=require('../apps/api/dist/mailcow.service.js');const {MailboxOperations}=require('../apps/api/dist/mailbox-operations.js');const {WebmailService}=require('../apps/api/dist/webmail.service.js');
async function main(){
 if(process.env.RUN_REAL_MAILCOW_TEST!=='YES')throw Error('Real Mailcow integration is opt-in.');
 const url=process.env.REAL_TEST_DATABASE_URL;if(!url||!/^\/mailcloud_qa_[a-f0-9]+$/.test(new URL(url).pathname))throw Error('A dedicated mailcloud_qa_ database is required.');
 process.env.DATABASE_URL=url;process.env.NODE_ENV='production';process.env.MAIL_ADAPTER_MODE='production';process.env.CONTROL_PLANE_SESSION_SECRET='qa-ephemeral-key-'+randomBytes(24).toString('hex');
 const nonce=randomBytes(8).toString('hex'),domain='qa-30nice-'+nonce+'.invalid',address='probe@'+domain;assert.match(domain,/^qa-30nice-[a-f0-9]{16}\.invalid$/);
 console.log('QA fixture domain: '+domain);
 let ownsFixture=false,db;const mailcow=new MailcowService();
 async function cleanup(kind,value){if(!ownsFixture||!/^qa-30nice-[a-f0-9]{16}\.invalid$/.test(domain)||(kind==='mailbox'&&value!==address)||(kind!=='mailbox'&&value!==domain))throw Error('Refusing unscoped cleanup');const r=await fetch(process.env.MAILCOW_API_URL.replace(/\/$/,'')+'/api/v1/delete/'+kind,{method:'POST',headers:{'X-API-Key':process.env.MAILCOW_API_KEY,'Content-Type':'application/json'},body:JSON.stringify([value]),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Fixture cleanup failed');const result=await r.json();if(!Array.isArray(result)||result.some(x=>x.type==='danger'||x.type==='error'))throw Error('Fixture cleanup not acknowledged');}
 try{
  await migrate(url);db=new DatabaseService();assert.equal(await mailcow.getDomain(domain),null);ownsFixture=true;await mailcow.ensureDomain(domain);assert.ok(await mailcow.getDomain(domain));
  const tenant=(await db.query("insert into tenants(name,slug) values('Internal acceptance',$1) returning id::text",['qa-'+nonce]))[0];await db.query("insert into domains(tenant_id,domain,status,provisioning_status) values($1,$2,'verified','ready')",[tenant.id,domain]);
  const ops=new MailboxOperations(db,mailcow);const created=await ops.create(tenant.id,{address,quotaGb:1},'system:internal-qa');await ops.processOne();const job=(await db.query('select status,last_error from provisioning_jobs where id=$1',[created.provisioningJobId]))[0];assert.equal(job.status,'succeeded',job.last_error||'Provider did not confirm mailbox');
  if(process.env.SMTP_PASSWORD_TEST_ONLY==='YES'){
   const nodemailer=require('nodemailer');
   const password='S!'+randomBytes(24).toString('base64url')+'9a';
   await mailcow.addSmtpPassword(address,'30NICE SMTP '+nonce+' Internal QA',password);
   const credentials=await mailcow.smtpPasswords(address);
   assert.equal(credentials.length,1);
   assert.deepEqual(Object.keys(credentials[0]).sort(),['active','id','name']);
   const smtp=()=>nodemailer.createTransport({host:'mx.30nice.vn',port:587,requireTLS:true,auth:{user:address,pass:password},socketTimeout:12000});
   try{assert.equal(await smtp().verify(),true);}
   finally{await mailcow.revokeSmtpPassword(credentials[0].id);}
   assert.deepEqual(await mailcow.smtpPasswords(address),[]);
   await new Promise(resolve=>setTimeout(resolve,310000));
   await assert.rejects(smtp().verify(),{code:'EAUTH'});
   console.log('PASS: real SMTP app password creation, SMTP authentication, revocation and rejected reuse.');
   return;
  }
  const webmail=new WebmailService(db);const login=await webmail.login(address,created.temporaryPassword,'internal-qa');const token=login.token;const folders=await webmail.folders(token);assert.ok(folders.some(f=>f.path==='INBOX'));assert.ok(folders.some(f=>f.specialUse==='\\Drafts'),'Fresh mailbox must expose Drafts');
  const restarted=new WebmailService(db);await restarted.resumeSession(token);assert.equal(restarted.profile(token).email,address);
  const draftId=randomUUID();await restarted.saveDraft(token,{draftId,to:address,subject:'Internal draft '+nonce,text:'Internal acceptance only',html:'<p>Internal acceptance only</p>'},[{filename:'qa.txt',contentType:'text/plain',buffer:Buffer.from('fixture attachment')}]);const drafts=folders.find(f=>f.specialUse==='\\Drafts');assert.ok((await restarted.messages(token,drafts.path,'',1)).messages.length>0);
  const result=await restarted.send(token,{to:address,subject:'Internal loopback '+nonce,text:'Internal acceptance to this same test mailbox only.',html:'<p>Internal acceptance to this same test mailbox only.</p>'});assert.ok(result.accepted.includes(address));
  let received=false;for(let n=0;n<20&&!received;n++){const list=await restarted.messages(token,'*',nonce,1);received=list.messages.some(m=>m.subject==='Internal loopback '+nonce);if(!received)await new Promise(r=>setTimeout(r,1000));}assert.ok(received,'Internal loopback message must be readable');
  await ops.update(tenant.id,created.id,{quotaGb:2});assert.equal((await mailcow.getMailboxes(domain)).find(m=>m.address===address).quotaBytes,2*1024**3);
  await ops.update(tenant.id,created.id,{status:'disabled'});await restarted.resumeSession(token);assert.throws(()=>restarted.profile(token));await ops.update(tenant.id,created.id,{status:'active'});
  const reset=await ops.resetPassword(tenant.id,created.id);await webmail.resumeSession(token);assert.throws(()=>webmail.profile(token));const fresh=await webmail.login(address,reset.temporaryPassword,'internal-qa');await webmail.logout(fresh.token);
  console.log('PASS: real Mailcow domain/mailbox provisioning, fresh folders, encrypted session restart, draft/attachment, internal self-send/read, quota read-back, disable/enable, password reset and revocation.');
 }finally{
  if(ownsFixture){const exists=(await mailcow.getMailboxes(domain)).some(m=>m.address===address);if(exists)await cleanup('mailbox',address);if(await mailcow.getDomain(domain))await cleanup('domain',domain);assert.equal(await mailcow.getDomain(domain),null);console.log('PASS: isolated .invalid fixtures removed.');}
  if(db)await db.onModuleDestroy();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

const assert=require('node:assert/strict');
const {inspectDns,recordsFor,validDomain}=require('../apps/api/dist/dns-setup.js');
const {MailcowService}=require('../apps/api/dist/mailcow.service.js');
const {MailCloudService}=require('../apps/api/dist/mail-cloud.service.js');
const {NotFoundException,BadRequestException}=require('@nestjs/common');
const key={selector:'customer2026',value:'v=DKIM1; k=rsa; p=QUJDRA=='};
const missing=()=>Promise.reject(Object.assign(Error('missing'),{code:'ENODATA'}));
async function main(){
 let values={'example.test':[['v=spf1 mx a -all']],'_dmarc.example.test':[['v=DMARC1; p=quarantine']],'customer2026._domainkey.example.test':[['v=DKIM1; k=rsa; p=QU','JDRA==']],'_30nice-verification.example.test':[['30nice-token']]};
 const resolver={resolveMx:async()=>[{exchange:'MX.30NICE.VN.',priority:10}],resolveTxt:async n=>values[n]||missing(),resolveCname:missing,resolve4:async()=>['5.189.185.36'],resolve6:missing};
 let checks=await inspectDns('example.test','30nice-token',key,resolver);
 for(const name of ['mx','spf','dkim','dmarc','ownership','webmail'])assert.equal(checks[name].ok,true,name);
 assert.equal(checks.autoconfig.state,'missing');assert.equal(checks.autodiscover.ok,false);
 values['example.test']=[['v=spf1 mx -all'],['v=spf1 ip4:5.189.185.36 -all']];
 values['customer2026._domainkey.example.test']=[['v=DKIM1; p=V1JPTkc=']];
 values['_dmarc.example.test']=[['v=DMARC1; p=wrong']];
 checks=await inspectDns('example.test','30nice-token',key,resolver);
 assert.equal(checks.spf.ok,false);assert.equal(checks.dkim.ok,false);assert.equal(checks.dmarc.ok,false);
 values['customer2026._domainkey.example.test']=[['v=DKIM2; p=QUJDRA==']];
 checks=await inspectDns('example.test','30nice-token',key,resolver);assert.equal(checks.dkim.ok,false);
 values['customer2026._domainkey.example.test']=[['v=DKIM1; p=QUJDRA==; p=QUJDRA==']];
 checks=await inspectDns('example.test','30nice-token',key,resolver);assert.equal(checks.dkim.ok,false);
 values['example.test']=[['v=spf1 include:other.example -all']];
 checks=await inspectDns('example.test','30nice-token',key,resolver);assert.equal(checks.spf.state,'review');
 const timed={...resolver,resolveTxt:async()=>{throw Object.assign(Error('timeout'),{code:'ETIMEOUT'});},resolve6:async()=>['2001:db8::1']};
 checks=await inspectDns('example.test',null,key,timed);assert.equal(checks.dkim.state,'error');assert.equal(checks.webmail.ok,false);
 const records=recordsFor('example.test','30nice-token',key);assert.equal(records.find(x=>x.id==='dkim').host,'customer2026._domainkey');assert.equal(records.find(x=>x.id==='webmail').value,'mail.30nice.vn');assert.equal(records.filter(x=>x.group==='optional').length,2);
 for(const bad of ['../example.com','example.com;id','mail.-bad.com','EXAMPLE.COM','example.com/','localhost'])assert.equal(validDomain(bad),false,bad);
 const db={query:async()=>[]};const service=new MailCloudService(db,{});
 await assert.rejects(service.dnsHealth('other-tenant','domain-id'),NotFoundException);
 const pending=new MailCloudService({query:async()=>[{id:'d',domain:'example.test',status:'pending',verification_token:null}]},{});
 await assert.rejects(pending.activateWebmail('t','d'),BadRequestException);
 process.env.MAIL_ADAPTER_MODE='production';process.env.MAILCOW_API_URL='https://mailcow.test';process.env.MAILCOW_API_KEY='fixture';
 const original=global.fetch;let writes=0;
 global.fetch=async(url,options={})=>{if(options.method==='POST')writes++;return {ok:true,json:async()=>({dkim_selector:'customer2026',dkim_txt:key.value,privkey:'DO-NOT-LEAK'})};};
 try{const adapter=new MailcowService();const publicKey=await adapter.ensureDkim('example.test');assert.deepEqual(publicKey,key);assert.equal(writes,0);assert.equal(JSON.stringify(publicKey).includes('DO-NOT-LEAK'),false);}finally{global.fetch=original;}
 console.log('DNS setup checks passed: split TXT, DKIM key/selector match, duplicate SPF, optional records, resolver failures, IPv6 guard, tenant scope and no key rotation/leak.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

const assert=require('node:assert/strict');
process.env.MAIL_ADAPTER_MODE='production';
process.env.MAILCOW_API_URL='https://mailcow.test';
process.env.MAILCOW_API_KEY='server-only-test-key';
const calls=[];
let existingDomains=[];
global.fetch=async (url,options={})=>{calls.push({url,options});return {ok:true,status:200,json:async()=>url.endsWith('/get/domain/all')?existingDomains:[{type:'success',msg:'ok'}]};};
const {MailcowService}=require('../apps/api/dist/mailcow.service.js');
(async()=>{const service=new MailcowService();const health=await service.health();assert.equal(health.healthy,true);await service.addDomain('example.test');await service.addMailbox('example.test','user',5,'temporary-password');await service.editMailbox('user@example.test',10,'disabled');existingDomains=[{domain_name:'already.test'}];await service.ensureDomain('already.test');existingDomains=[];await service.ensureDomain('new.test');assert.equal(calls.length,7);assert.equal(calls[0].options.headers['X-API-Key'],'server-only-test-key');assert.equal(calls[1].url,'https://mailcow.test/api/v1/add/domain');assert.equal(calls[2].url,'https://mailcow.test/api/v1/add/mailbox');assert.equal(calls[3].url,'https://mailcow.test/api/v1/edit/mailbox');assert.equal(calls[4].url,'https://mailcow.test/api/v1/get/domain/all');assert.equal(calls[5].url,'https://mailcow.test/api/v1/get/domain/all');assert.equal(calls[6].url,'https://mailcow.test/api/v1/add/domain');console.log(JSON.stringify({ok:true,mode:health.mode,calls:calls.map(call=>call.url)}));})().catch(error=>{console.error(error);process.exit(1);});


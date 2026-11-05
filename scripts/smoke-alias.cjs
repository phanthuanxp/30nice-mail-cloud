const assert=require('node:assert/strict');
const {BadRequestException,NotFoundException}=require('@nestjs/common');
const {MailCloudService}=require('../apps/api/dist/mail-cloud.service');
async function main(){
 let domain=true,target=true,collision=false,owned=true,fail=false;
 const calls=[],writes=[];
 const db={query:async()=>[],transaction:async work=>work(async(sql,values=[])=>{
   writes.push({sql,values});
   if(sql.includes('pg_advisory'))return [];
   if(sql.startsWith('select id from domains')){assert.equal(values[0],'tenant-a');return domain?[{id:'domain'}]:[];}
   if(sql.startsWith('select id from mailboxes where tenant_id')){assert.equal(values[0],'tenant-a');return target?[{id:'mailbox'}]:[];}
   if(sql.includes('union all'))return collision?[{id:'collision'}]:[];
   if(sql.startsWith('insert into aliases'))return [{id:'alias-1',source:values[1],destination:values[2],active:true}];
   if(sql.startsWith('select id::text,source')){assert.deepEqual(values,['alias-1','tenant-a']);return owned?[{id:'alias-1',source:'sales@example.com',destination:'info@example.com'}]:[];}
   if(sql.startsWith('update aliases'))return [{id:'alias-1',active:values[2]}];
   throw Error('Unexpected query: '+sql);
 })};
 const adapter={ensureAlias:async(...args)=>{calls.push(args);if(fail)throw Error('uncertain remote result');},setAliasActive:async(...args)=>calls.push(args)};
 const service=new MailCloudService(db,adapter);
 await assert.rejects(service.createAlias('tenant-a',{source:'bad',destination:'info@example.com'}),BadRequestException);
 for(const mode of ['domain','target','collision']){
   domain=mode!=='domain';target=mode!=='target';collision=mode==='collision';
   await assert.rejects(service.createAlias('tenant-a',{source:'sales@example.com',destination:'info@example.com'}),BadRequestException);
 }
 assert.equal(calls.length,0,'invalid ownership/collisions must never call Mailcow');
 domain=target=true;collision=false;
 const result=await service.createAlias('tenant-a',{source:' SALES@EXAMPLE.COM ',destination:'info@example.com'},'actor@example.com');
 assert.equal(result.source,'sales@example.com');assert.deepEqual(calls[0],['sales@example.com','info@example.com']);
 owned=false;await assert.rejects(service.updateAliasActive('tenant-a','alias-1',false),NotFoundException);
 assert.equal(calls.length,1,'foreign alias must never reach Mailcow');
 owned=true;await service.updateAliasActive('tenant-a','alias-1',false);
 assert.deepEqual(calls[1],['sales@example.com','info@example.com',false]);
 fail=true;const before=writes.filter(x=>x.sql.startsWith('insert into aliases')).length;
 await assert.rejects(service.createAlias('tenant-a',{source:'other@example.com',destination:'info@example.com'}),BadRequestException);
 assert.equal(writes.filter(x=>x.sql.startsWith('insert into aliases')).length,before,'failed remote sync must not insert an alias');
 console.log('Alias checks passed: validation, tenant ownership, collisions, scoped toggle, and failed synchronization.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

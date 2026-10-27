const assert=require('node:assert/strict');
const {BadRequestException}=require('@nestjs/common');
const {MailCloudService}=require('../apps/api/dist/mail-cloud.service.js');

async function main(){
  let stored=null;
  let upstreamHasDomain=false;
  let ensureCalls=0;
  const database={
    query:async(sql,values=[])=>{
      if(sql.startsWith('select id::text,tenant_id::text as "tenantId",domain,status,verification_token from domains')) return stored&&stored.domain===values[0]?[{...stored}]:[];
      if(sql.startsWith('insert into domains')){
        stored={id:'domain-id',tenantId:values[0],domain:values[1],status:'pending',verification_token:values[2]};
        return [{...stored}];
      }
      return [];
    },
    status:async()=>({configured:true,connected:true}),
  };
  const mailcow={
    ensureDomain:async()=>{
      ensureCalls++;
      if(ensureCalls===1){upstreamHasDomain=true;throw new Error('Connection lost after Mailcow accepted request');}
      assert.equal(upstreamHasDomain,true);
    },
  };
  const service=new MailCloudService(database,mailcow);

  await assert.rejects(service.createDomain('tenant-a',{domain:'example.test'}),BadRequestException);
  assert.ok(stored,'pending domain is retained for retry after transient Mailcow failure');
  const retried=await service.createDomain('tenant-a',{domain:'EXAMPLE.TEST'});
  assert.equal(retried.id,'domain-id');
  assert.equal(ensureCalls,2,'retry reconciles with Mailcow without inserting a second domain');

  await assert.rejects(
    service.createDomain('tenant-b',{domain:'example.test'}),
    error=>error instanceof BadRequestException&&error.message.includes('khách hàng khác'),
  );
  assert.equal(ensureCalls,2,'another tenant cannot claim or provision an existing domain');
  console.log('Domain provisioning smoke checks passed: retry after ambiguous failure and cross-tenant collision protection.');
}

main().catch(error=>{console.error(error);process.exitCode=1;});


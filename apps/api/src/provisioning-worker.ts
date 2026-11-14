import 'reflect-metadata';
import {readFileSync,existsSync} from 'node:fs';
import {DatabaseService} from './database.service';
import {MailcowService} from './mailcow.service';
import {MailboxOperations} from './mailbox-operations';
const path='/opt/30nice-mail-cloud/.env.prod';
if(existsSync(path))for(const line of readFileSync(path,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2];}
export async function suspendExpiredTrials(db:DatabaseService,mailcow:MailcowService){
 const candidates=await db.query<{id:string;tenant_id:string;domain:string}>(
  "select d.id::text,d.tenant_id::text,d.domain from domains d join tenants t on t.id=d.tenant_id where t.trial_ends_at<=now() and d.status='verified'");
 for(const candidate of candidates??[]){
  try{
   await db.transaction(async q=>{
    await q('select pg_advisory_xact_lock(hashtextextended($1,0))',[`mailboxes:${candidate.tenant_id}`]);
    const [row]=await q(`select d.id from domains d join tenants t on t.id=d.tenant_id
      where d.id=$1::uuid and d.trial_restore_domain is null and t.trial_ends_at<=now()`,[candidate.id]);
    if(!row)return [];
    const remote=await mailcow.getDomain(candidate.domain);
    if(!remote)return [];
    const boxes=await mailcow.getMailboxes(candidate.domain);
    return q('update domains set trial_restore_domain=$2,trial_restore_mailboxes=$3 where id=$1::uuid',
      [candidate.id,Number(remote.active)===1,boxes.filter(box=>box.active).map(box=>box.address)]);
   });
   await db.transaction(async q=>{
    await q('select pg_advisory_xact_lock(hashtextextended($1,0))',[`mailboxes:${candidate.tenant_id}`]);
    const [row]=await q(`select d.id from domains d join tenants t on t.id=d.tenant_id
      where d.id=$1::uuid and d.trial_restore_domain is not null and t.trial_ends_at<=now()`,[candidate.id]);
    if(!row)return [];
    const remote=await mailcow.getDomain(candidate.domain);
    if(!remote)return [];
    for(const box of await mailcow.getMailboxes(candidate.domain))if(box.active)await mailcow.editMailbox(box.address,undefined,'disabled');
    if(Number(remote.active)===1)await mailcow.setDomainActive(candidate.domain,false);
    return [];
   });
  }catch{console.error('Chưa tạm khóa được tên miền dùng thử; sẽ thử lại.',candidate.id);}
 }
}
export async function reconcile(db:DatabaseService,mailcow:MailcowService){
 await suspendExpiredTrials(db,mailcow);
 const snapshotAt=(await db.query<{at:string}>('select clock_timestamp()::text as at'))?.[0]?.at;
 const [remoteDomains,remoteBoxes]=await Promise.all([mailcow.getDomains(),mailcow.getMailboxes()]);
 await db.query('delete from webmail_sessions where expires_at<=now()');
 const domains=await db.query<{id:string;tenant_id:string;domain:string}>("select d.id::text,d.tenant_id::text,d.domain from domains d join tenants t on t.id=d.tenant_id where d.status='verified' and t.status='active' and d.trial_restore_domain is null");
 for(const d of domains||[]){
  const found=remoteDomains.find((r:{domain_name?:string;active?:number})=>r.domain_name===d.domain&&Number(r.active)===1);
  await db.query('update domains set provisioning_status=$3,provisioning_error=$4,provisioned_at=case when $3=\'ready\' then now() else provisioned_at end where id=$1::uuid and tenant_id=$2::uuid',[d.id,d.tenant_id,found?'ready':'failed',found?null:'Tên miền chưa hoạt động trong Mailcow. Chọn Kết nối dịch vụ email.']);
  const local=await db.query<{id:string;address:string;quota_gb:number;status:string;provisioning_state:string}>('select id::text,address,quota_gb,status,provisioning_state from mailboxes where domain_id=$1::uuid and tenant_id=$2::uuid',[d.id,d.tenant_id]);
  for(const m of local||[]){if(m.provisioning_state==='pending')continue;const remote=remoteBoxes.find(r=>r.address===m.address);const same=remote&&remote.quotaBytes===m.quota_gb*1024**3&&remote.active===(m.status==='active');
   await db.query('update mailboxes set observed_quota_bytes=$3,observed_active=$4,used_bytes=$5,synced_at=now(),provisioning_state=$6 where id=$1::uuid and tenant_id=$2::uuid and (synced_at is null or synced_at<$7::timestamptz)',[m.id,d.tenant_id,remote?.quotaBytes??null,remote?.active??null,remote?.usedBytes??null,remote?(same?'ready':'reconcile'):'failed',snapshotAt]);
  }
 }
}
async function start(){
 const db=new DatabaseService(),mailcow=new MailcowService(),ops=new MailboxOperations(db,mailcow);let stopping=false,nextReconcile=0;
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true;});
 try{while(!stopping){try{
   await db.query("insert into worker_heartbeats(name,last_seen) values('provisioning',now()) on conflict(name) do update set last_seen=now()");
   if(Date.now()>=nextReconcile){await reconcile(db,mailcow);nextReconcile=Date.now()+300000;}
   const worked=await ops.processOne();if(process.argv.includes('--once'))break;if(!worked)await new Promise(r=>setTimeout(r,2000));
  }catch{console.error('Tác vụ nền tạm thời chưa hoàn tất; sẽ thử lại.');if(process.argv.includes('--once'))throw new Error('Worker check failed');await new Promise(r=>setTimeout(r,5000));}}
 }finally{await db.onModuleDestroy();}
}
if(require.main===module)void start().catch(()=>{process.exitCode=1;});

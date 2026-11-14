import {BadRequestException,NotFoundException,ServiceUnavailableException,HttpException} from '@nestjs/common';
import {randomBytes,randomUUID} from 'node:crypto';
import {DatabaseService} from './database.service';
import {MailcowService} from './mailcow.service';
import {openJobSecret,sealJobSecret} from './job-secrets';
const GB=1024**3;
type Query=Parameters<Parameters<DatabaseService['transaction']>[0]>[0];
type Box=Record<string,unknown>&{id:string;address:string;quota_gb:number;status:string;provisioning_state:string;domain_id:string};
type Job=Record<string,unknown>&{id:string;tenant_id:string;idempotency_key:string;secret_ciphertext:string;lease_token:string;attempts:number;payload:{quotaGb:number;actorEmail?:string}};
export class MailboxOperations{
 constructor(private db:DatabaseService,private mailcow:MailcowService){}
 private async transaction<T extends Record<string,unknown>>(work:(q:Query)=>Promise<T[]>){try{const result=await this.db.transaction(work);if(!result)throw new ServiceUnavailableException('Cơ sở dữ liệu chưa sẵn sàng.');return result;}catch(e){if(e instanceof HttpException)throw e;if((e as {code?:string}).code==='23505')throw new BadRequestException('Địa chỉ hoặc tác vụ đã tồn tại. Hãy làm mới danh sách để kiểm tra.');throw new ServiceUnavailableException('Chưa xác nhận được giao dịch. Hãy làm mới và đối soát trạng thái trước khi thử lại.');}}
 private lock(q:Query,tenant:string){return q('select pg_advisory_xact_lock(hashtextextended($1,0))',[`mailboxes:${tenant}`]);}
 private async audit(q:Query,tenant:string,actor:string,action:string,id:string){await q("insert into audit_logs(tenant_id,actor_email,action,resource_type,resource_id) values($1::uuid,$2,$3,'mailbox',$4)",[tenant,actor,action,id]);}
 private async limits(q:Query,tenant:string,domain:string){
  const rows=await q<{domain:string;status:string;tenant_status:string;trial_expired:boolean;mailbox_limit:number|null;storage_gb:number|null;mailbox_max_gb:number|null}>("select d.domain,d.status,t.status as tenant_status,coalesce(t.trial_ends_at<=now(),false) as trial_expired,p.mailbox_limit,p.storage_gb,p.mailbox_max_gb from domains d join tenants t on t.id=d.tenant_id left join service_plans p on p.id=t.plan_id where d.tenant_id=$1::uuid and d.domain=$2",[tenant,domain]);
  const owned=rows[0];if(owned?.trial_expired)throw new BadRequestException('Gói dùng thử đã hết hạn. Hãy nâng cấp để tiếp tục.');if(!owned||owned.status!=='verified'||owned.tenant_status!=='active')throw new BadRequestException('Tên miền phải được xác minh và khách hàng đang hoạt động.');
  const remote=await this.mailcow.getDomain(domain);if(!remote)throw new BadRequestException('Tên miền chưa có trong Mailcow. Mở Tên miền và chọn Kết nối dịch vụ email.');
  if(Number(remote.active)!==1)throw new BadRequestException('Tên miền đang bị tạm ngưng trong Mailcow.');
  const allDomains=await q<{domain:string}>('select domain from domains where tenant_id=$1::uuid',[tenant]);
  const names=new Set(allDomains.map(d=>d.domain));
  const remoteBoxes=(await this.mailcow.getMailboxes()).filter(m=>names.has(m.address.split('@')[1]));
  const local=await q<{address:string;quota_gb:number}>('select address,quota_gb from mailboxes where tenant_id=$1::uuid',[tenant]);
  const allocation=new Map(remoteBoxes.map(m=>[m.address,m.quotaBytes]));
  for(const m of local)allocation.set(m.address,Math.max(allocation.get(m.address)||0,Number(m.quota_gb)*GB));
  const domainAllocation=[...allocation].filter(([address])=>address.endsWith('@'+domain));
  const domainLimit=Number(remote.max_quota_for_domain),maxBox=Number(remote.max_quota_for_mbox),countLimit=Number(remote.max_num_mboxes_for_domain);
  if(![domainLimit,maxBox,countLimit].every(n=>Number.isFinite(n)&&n>=0))throw new ServiceUnavailableException('Chưa đọc được hạn mức chính xác từ Mailcow.');
  return {domain,domainLimitBytes:domainLimit,maxMailboxBytes:Math.min(maxBox,owned.mailbox_max_gb?owned.mailbox_max_gb*GB:Infinity),domainMailboxLimit:countLimit,domainAllocatedBytes:domainAllocation.reduce((sum,[,n])=>sum+n,0),domainMailboxCount:domainAllocation.length,tenantAllocatedBytes:[...allocation.values()].reduce((a,b)=>a+b,0),tenantMailboxCount:allocation.size,tenantStorageLimitBytes:owned.storage_gb?owned.storage_gb*GB:null,tenantMailboxLimit:owned.mailbox_limit,allocation,remoteBoxes};
 }
 async capacity(tenant:string,domain:string){return (await this.transaction(async q=>{await this.lock(q,tenant);const c=await this.limits(q,tenant,domain);const {allocation,remoteBoxes,...publicCapacity}=c;return [{...publicCapacity,remainingBytes:Math.max(0,Math.min(c.domainLimitBytes-c.domainAllocatedBytes,(c.tenantStorageLimitBytes??Infinity)-c.tenantAllocatedBytes)),remainingMailboxes:Math.max(0,Math.min(c.domainMailboxLimit-c.domainMailboxCount,(c.tenantMailboxLimit??Infinity)-c.tenantMailboxCount))}];}))[0];}
 private validateCapacity(c:Awaited<ReturnType<MailboxOperations['limits']>>,quota:number,address?:string){const current=address?(c.allocation.get(address)||0):0;const added=quota*GB-current;
  if(quota*GB>c.maxMailboxBytes)throw new BadRequestException(`Dung lượng mỗi hộp thư tối đa ${Math.floor(c.maxMailboxBytes/GB)} GiB.`);
  if(c.domainAllocatedBytes+added>c.domainLimitBytes||(c.tenantStorageLimitBytes!==null&&c.tenantAllocatedBytes+added>c.tenantStorageLimitBytes))throw new BadRequestException('Không còn đủ dung lượng cấp phát. Hãy điều chỉnh dung lượng hoặc liên hệ nâng gói.');
  if(!address&&(c.domainMailboxCount>=c.domainMailboxLimit||(c.tenantMailboxLimit!==null&&c.tenantMailboxCount>=c.tenantMailboxLimit)))throw new BadRequestException('Đã hết số lượng hộp thư trong gói dịch vụ.');
 }
 async create(tenant:string,body:{address?:unknown;quotaGb?:unknown;password?:unknown}={},actor='system'){
  const address=typeof body.address==='string'?body.address.trim().toLowerCase():'';const quota=body.quotaGb===undefined?5:body.quotaGb;
  if(!/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(address)||address.split('@')[0].includes('..')||typeof quota!=='number'||!Number.isInteger(quota)||quota<1||quota>1000)throw new BadRequestException('Nhập địa chỉ hợp lệ và dung lượng nguyên từ 1 đến 1000 GiB.');
  if(body.password!==undefined&&(typeof body.password!=='string'||body.password.length<12||body.password.length>256))throw new BadRequestException('Mật khẩu hộp thư phải từ 12 đến 256 ký tự.');
  const password=typeof body.password==='string'?body.password:`N${randomBytes(18).toString('base64url')}A1!`;
  const sealed=sealJobSecret(password,`${tenant}:${address}`);const jobId=randomUUID();
  return (await this.transaction(async q=>{await this.lock(q,tenant);const c=await this.limits(q,tenant,address.split('@')[1]);
   if(c.allocation.has(address))throw new BadRequestException('Địa chỉ này đã tồn tại. Chọn đối soát nếu hộp thư chưa có trong danh sách.');this.validateCapacity(c,quota);
   const existing=await q("select id from provisioning_jobs where idempotency_key=$1",[`mailbox:${address}`]);if(existing.length)throw new BadRequestException('Địa chỉ đã có lịch sử cấp phát. Chọn Thử lại trong lịch sử.');
   const box=(await q<Box>("insert into mailboxes(tenant_id,domain_id,address,quota_gb,status,provisioning_state) select $1::uuid,d.id,$3,$4,'active','pending' from domains d where d.tenant_id=$1::uuid and d.domain=$2 returning *",[tenant,address.split('@')[1],address,quota]))[0];
   await q("insert into provisioning_jobs(id,tenant_id,idempotency_key,job_type,payload,secret_ciphertext) values($1::uuid,$2::uuid,$3,'mailbox.provision',$4::jsonb,$5)",[jobId,tenant,`mailbox:${address}`,JSON.stringify({quotaGb:quota,actorEmail:actor}),sealed]);
   await this.audit(q,tenant,actor,'mailbox.queued',box.id);
   return [{id:box.id,tenantId:tenant,address,quotaGb:quota,status:box.status,provisioningState:'pending',provisioningStatus:'queued',provisioningJobId:jobId,temporaryPassword:body.password===undefined?password:undefined}];
  }))[0];
 }
 async retry(tenant:string,id:string,actor='system'){
  return (await this.transaction<Record<string,unknown>>(async q=>{await this.lock(q,tenant);const job=(await q<Job>("select * from provisioning_jobs where id=$1::uuid and tenant_id=$2::uuid and job_type='mailbox.provision' and status in ('failed','dead_letter') for update",[id,tenant]))[0];if(!job)throw new NotFoundException('Không có tác vụ lỗi có thể thử lại.');
   const address=job.idempotency_key.replace(/^mailbox:/,'');const quota=Number(job.payload.quotaGb??5);if(!Number.isInteger(quota)||quota<1||quota>1000)throw new BadRequestException('Dữ liệu tác vụ cũ không hợp lệ. Cần kiểm tra thủ công.');
   const c=await this.limits(q,tenant,address.split('@')[1]);const remote=c.remoteBoxes.find(m=>m.address===address);
   const prior=(await q<Box>('select * from mailboxes where address=$1 and tenant_id=$2::uuid',[address,tenant]))[0];
   if(remote){
    const state=remote.quotaBytes===quota*GB&&(!prior||remote.active===(prior.status==='active'))?'ready':'reconcile';
    const box=prior??(await q<Box>("insert into mailboxes(tenant_id,domain_id,address,quota_gb,status,provisioning_state) select $1::uuid,id,$3,$4,$5,$6 from domains where tenant_id=$1::uuid and domain=$2 returning *",[tenant,address.split('@')[1],address,quota,remote.active?'active':'disabled',state]))[0];
    await q('update mailboxes set provisioning_state=$3,observed_quota_bytes=$4,observed_active=$5,used_bytes=$6,synced_at=now() where id=$1::uuid and tenant_id=$2::uuid',[box.id,tenant,state,remote.quotaBytes,remote.active,remote.usedBytes]);
    await q("update provisioning_jobs set status=$3,secret_ciphertext=null,lease_token=null,lease_expires_at=null,last_error=$4,updated_at=now() where id=$1::uuid and tenant_id=$2::uuid",[id,tenant,state==='ready'?'succeeded':'dead_letter',state==='ready'?'Đã đối soát hộp thư có sẵn; mật khẩu không thay đổi.':'Hạn mức thực tế khác yêu cầu. Cần đối soát trước khi tiếp tục.']);
    await this.audit(q,tenant,actor,'mailbox.reconciled',box.id);return [{address,provisioningStatus:state==='ready'?'succeeded':'dead_letter',message:'Đã kiểm tra tài nguyên có sẵn; không thay đổi mật khẩu.'}];
   }
   this.validateCapacity(c,quota,prior?address:undefined);
   const password=`N${randomBytes(18).toString('base64url')}A1!`;
   if(!prior)await q("insert into mailboxes(tenant_id,domain_id,address,quota_gb,status,provisioning_state) select $1::uuid,id,$3,$4,'active','pending' from domains where tenant_id=$1::uuid and domain=$2",[tenant,address.split('@')[1],address,quota]);
   else await q("update mailboxes set provisioning_state='pending' where id=$1::uuid and tenant_id=$2::uuid",[prior.id,tenant]);
   await q("update provisioning_jobs set status='queued',attempts=0,secret_ciphertext=$3,lease_token=null,lease_expires_at=null,next_attempt_at=now(),last_error=null,updated_at=now() where id=$1::uuid and tenant_id=$2::uuid",[id,tenant,sealJobSecret(password,`${tenant}:${address}`)]);
   await this.audit(q,tenant,actor,'mailbox.retry_queued',id);return [{address,provisioningStatus:'queued',temporaryPassword:password}];
  }))[0];
 }
 async processOne(){
  const lease=randomUUID();const jobs=await this.db.query<Job>("update provisioning_jobs j set status='running',attempts=attempts+1,lease_token=$1::uuid,lease_expires_at=now()+interval '2 minutes',updated_at=now() from (select id from provisioning_jobs where job_type='mailbox.provision' and secret_ciphertext is not null and ((status='queued' and next_attempt_at<=now()) or (status='running' and lease_expires_at<now())) order by created_at for update skip locked limit 1) candidate where j.id=candidate.id returning j.*",[lease]);
  const job=jobs?.[0];if(!job)return false;const tenant=job.tenant_id,address=job.idempotency_key.replace(/^mailbox:/,'');
  try{
   await this.transaction(async q=>{await this.lock(q,tenant);const live=await q("select id from provisioning_jobs where id=$1::uuid and lease_token=$2::uuid and status='running' for update",[job.id,lease]);if(!live.length)return [];
    const domain=(await q("select d.id from domains d join tenants t on t.id=d.tenant_id where d.tenant_id=$1::uuid and d.domain=$2 and d.status='verified' and t.status='active'",[tenant,address.split('@')[1]]))[0];if(!domain)throw new Error('Tên miền hoặc khách hàng không còn hoạt động.');
    const box=(await q<Box>('select * from mailboxes where tenant_id=$1::uuid and address=$2 for update',[tenant,address]))[0];if(!box)throw new Error('Thiếu bản ghi hộp thư. Cần đối soát.');
    const password=openJobSecret(job.secret_ciphertext,`${tenant}:${address}`);
    await this.mailcow.provisionMailbox(address.split('@')[1],address.split('@')[0],Number(job.payload.quotaGb),password,true);
    const found=(await this.mailcow.getMailboxes(address.split('@')[1])).find(m=>m.address===address);
    if(!found||found.quotaBytes!==Number(job.payload.quotaGb)*GB||!found.active)throw new Error('Mailcow chưa khớp hộp thư yêu cầu; không tự thay cấu hình tài nguyên có sẵn.');
    await q("update mailboxes set provisioning_state='ready',observed_quota_bytes=$3,observed_active=$4,used_bytes=$5,synced_at=now() where id=$1::uuid and tenant_id=$2::uuid",[box.id,tenant,found.quotaBytes,found.active,found.usedBytes]);
    await q("update provisioning_jobs set status='succeeded',secret_ciphertext=null,lease_token=null,lease_expires_at=null,last_error=null,updated_at=now() where id=$1::uuid and tenant_id=$2::uuid and lease_token=$3::uuid",[job.id,tenant,lease]);
    await this.audit(q,tenant,job.payload.actorEmail||'system:worker','mailbox.provisioned',box.id);return [];
   });
  }catch{
   const exhausted=Number(job.attempts)>=5;await this.db.query("update provisioning_jobs set status=$4,next_attempt_at=now()+($5 * interval '1 second'),lease_token=null,lease_expires_at=null,last_error=$6,secret_ciphertext=case when $4='dead_letter' then null else secret_ciphertext end,updated_at=now() where id=$1::uuid and tenant_id=$2::uuid and lease_token=$3::uuid",[job.id,tenant,lease,exhausted?'dead_letter':'queued',Math.min(900,30*2**Number(job.attempts)),exhausted?'Cấp phát chưa thành công sau 5 lần. Hãy đối soát rồi thử lại.':'Kết nối hoặc xác nhận Mailcow chưa thành công. Hệ thống sẽ kiểm tra lại, không thay mật khẩu.']);
   if(exhausted)await this.db.query("update mailboxes set provisioning_state='failed' where tenant_id=$1::uuid and address=$2 and provisioning_state='pending'",[tenant,address]);
  }
  return true;
 }
 async update(tenant:string,id:string,body:{quotaGb?:number;status?:string}={},actor='system'){
  if(body.quotaGb!==undefined&&(!Number.isInteger(body.quotaGb)||body.quotaGb<1||body.quotaGb>1000))throw new BadRequestException('Dung lượng phải từ 1 đến 1000 GiB.');
  if(body.status!==undefined&&!['active','disabled'].includes(body.status))throw new BadRequestException('Trạng thái hộp thư không hợp lệ.');
  return (await this.transaction(async q=>{await this.lock(q,tenant);const box=(await q<Box>('select * from mailboxes where id=$1::uuid and tenant_id=$2::uuid for update',[id,tenant]))[0];if(!box)throw new NotFoundException('Không tìm thấy hộp thư.');if(box.provisioning_state==='pending')throw new BadRequestException('Hộp thư đang cấp phát, vui lòng chờ.');
   if(body.quotaGb!==undefined)this.validateCapacity(await this.limits(q,tenant,box.address.split('@')[1]),body.quotaGb,box.address);
   await this.mailcow.editMailbox(box.address,body.quotaGb,body.status as 'active'|'disabled'|undefined);
   const found=(await this.mailcow.getMailboxes(box.address.split('@')[1])).find(m=>m.address===box.address);if(!found)throw new Error('Chưa đọc lại được hộp thư. Hãy đối soát.');
   const changed=await q("update mailboxes set quota_gb=coalesce($3,quota_gb),status=coalesce($4,status),observed_quota_bytes=$5,observed_active=$6,used_bytes=$7,synced_at=now(),provisioning_state=case when (coalesce($3,quota_gb)::bigint*1073741824)=$5 and (coalesce($4,status)='active')=$6 then 'ready' else 'reconcile' end where id=$1::uuid and tenant_id=$2::uuid returning id::text,tenant_id::text as \"tenantId\",address,quota_gb as \"quotaGb\",status,provisioning_state as \"provisioningState\"",[id,tenant,body.quotaGb??null,body.status??null,found.quotaBytes,found.active,found.usedBytes]);
   if(body.status==='disabled')await q('delete from webmail_sessions where email=$1',[box.address]);await this.audit(q,tenant,actor,'mailbox.update',id);return changed;
  }))[0];
 }
 async resetPassword(tenant:string,id:string,actor='system'){
  return (await this.transaction(async q=>{await this.lock(q,tenant);const box=(await q<Box>("select * from mailboxes where id=$1::uuid and tenant_id=$2::uuid and provisioning_state<>'pending' for update",[id,tenant]))[0];if(!box)throw new NotFoundException('Không tìm thấy hộp thư đã cấp phát.');
   const temporaryPassword=randomBytes(18).toString('base64url')+'A1!';await this.mailcow.editMailbox(box.address,undefined,undefined,temporaryPassword);await q('delete from webmail_sessions where email=$1',[box.address]);await this.audit(q,tenant,actor,'mailbox.password_reset',id);return [{address:box.address,temporaryPassword}];
  }))[0];
 }
}

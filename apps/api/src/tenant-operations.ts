import {BadRequestException,NotFoundException} from '@nestjs/common';
import {readFile} from 'node:fs/promises';
import {DatabaseService} from './database.service';
import {MailcowService} from './mailcow.service';
const GIB=1024**3;
type Query=Parameters<Parameters<DatabaseService['transaction']>[0]>[0];
type Plan=Record<string,unknown>&{id:string;storage_gb:number;mailbox_limit:number;mailbox_max_gb:number};
const formatGiB=(bytes:number)=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:4}).format(bytes/GIB);

export class TenantOperations{
 constructor(private db:DatabaseService,private mailcow:MailcowService){}
 async plans(includeCustomerCounts=false){
  return await this.db.query(`
   select p.id::text,p.name,p.mailbox_limit as "mailboxLimit",p.storage_gb as "storageGb",
          p.mailbox_max_gb as "mailboxMaxGb",p.active,
          case when $1::boolean then (select count(*)::int from tenants t where t.plan_id=p.id) end as "customerCount"
   from service_plans p order by p.created_at
  `,[includeCustomerCounts])??[];
 }
 async createPlan(body:{name?:unknown;mailboxLimit?:unknown;storageGb?:unknown;mailboxMaxGb?:unknown}={}){
  const name=typeof body.name==='string'?body.name.trim():'';
  if(!name||name.length>120||![body.mailboxLimit,body.storageGb,body.mailboxMaxGb].every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=1)||Number(body.mailboxLimit)>100000||Number(body.storageGb)>100000||Number(body.mailboxMaxGb)>1000||Number(body.mailboxMaxGb)>Number(body.storageGb))throw new BadRequestException('Tên gói và hạn mức không hợp lệ. Dung lượng mỗi hộp thư không được lớn hơn tổng gói.');
  try{return (await this.db.query('insert into service_plans(name,mailbox_limit,storage_gb,mailbox_max_gb) values($1,$2,$3,$4) returning id::text,name',[name,body.mailboxLimit,body.storageGb,body.mailboxMaxGb]))?.[0];}catch{throw new BadRequestException('Không tạo được gói; kiểm tra tên gói đã tồn tại chưa.');}
 }
 private async assessPlan(query:Query,tenant:string,planId:unknown){
  if(typeof planId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(planId)){
   throw new BadRequestException('Chọn gói dịch vụ hợp lệ.');
  }
  const [plan]=await query<Plan>('select * from service_plans where id=$1::uuid and active=true',[planId]);
  if(!plan)throw new BadRequestException('Gói không tồn tại hoặc đã ngừng cung cấp.');
  const domains=await query<{domain:string}>('select domain from domains where tenant_id=$1::uuid',[tenant]);
  const names=new Set(domains.map(item=>item.domain));
  const remote=names.size?(await this.mailcow.getMailboxes()).filter(box=>names.has(box.address.split('@')[1])):[];
  const allocation=new Map(remote.map(box=>[box.address,box.quotaBytes]));
  const local=await query<{address:string;quota_gb:number}>('select address,quota_gb from mailboxes where tenant_id=$1::uuid',[tenant]);
  for(const box of local)allocation.set(box.address,Math.max(allocation.get(box.address)??0,box.quota_gb*GIB));
  const allocatedBytes=[...allocation.values()].reduce((sum,bytes)=>sum+bytes,0);
  const oversized=[...allocation].filter(([,bytes])=>bytes>plan.mailbox_max_gb*GIB);
  const issues:string[]=[];
  if(allocation.size>plan.mailbox_limit)issues.push(`Đã cấp ${allocation.size} hộp thư. Gói cho phép ${plan.mailbox_limit}.`);
  if(allocatedBytes>plan.storage_gb*GIB)issues.push(`Đã cấp ${formatGiB(allocatedBytes)} GiB. Tổng dung lượng của gói là ${plan.storage_gb} GiB.`);
  if(oversized.length){
   const examples=oversized.slice(0,3).map(([address,bytes])=>`${address} (${formatGiB(bytes)} GiB)`).join(', ');
   issues.push(`${oversized.length} hộp thư vượt mức ${plan.mailbox_max_gb} GiB mỗi hộp thư, gồm ${examples}${oversized.length>3?' và các hộp thư khác':''}.`);
  }
  return {plan,domains,preview:{eligible:issues.length===0,issues,mailboxCount:allocation.size,allocatedBytes}};
 }

 async previewPlan(tenant:string,planId:unknown){
  try{
   const rows=await this.db.transaction(async query=>[(await this.assessPlan(query,tenant,planId)).preview]);
   if(!rows?.[0])throw new BadRequestException('Chưa đọc được hạn mức của khách hàng.');
   return rows[0];
  }catch(error){
   if(error instanceof BadRequestException)throw error;
   throw new BadRequestException('Chưa kiểm tra được hạn mức. Hãy kiểm tra kết nối Mailcow rồi thử lại.');
  }
 }

 async assignPlan(tenant:string,planId:unknown,actor:string){
  try{return (await this.db.transaction(async q=>{
   await q('select pg_advisory_xact_lock(hashtextextended($1,0))',[`mailboxes:${tenant}`]);
   const {plan,domains,preview}=await this.assessPlan(q,tenant,planId);
   if(!preview.eligible)throw new BadRequestException(preview.issues.join(' '));
   for(const d of domains)if(await this.mailcow.getDomain(d.domain))await this.mailcow.setDomainLimits(d.domain,plan.storage_gb,plan.mailbox_limit,plan.mailbox_max_gb);
   const changed=await q('update tenants set plan_id=$2::uuid,updated_at=now() where id=$1::uuid returning id::text,plan_id::text as "planId"',[tenant,planId]);if(!changed.length)throw new NotFoundException('Khách hàng không tồn tại.');
   await q("insert into audit_logs(tenant_id,actor_email,action,resource_type,resource_id) values($1::uuid,$2,'tenant.plan_assign','tenant',$1)",[tenant,actor]);return changed;
  }))?.[0];}catch(e){if(e instanceof BadRequestException||e instanceof NotFoundException)throw e;throw new BadRequestException('Chưa xác nhận được gói trên tất cả tên miền. Hãy kiểm tra kết nối và áp dụng lại; gói trong 30NICE chưa thay đổi.');}
 }
 async contact(tenant:string,body:{name?:unknown;contactEmail?:unknown;contactPhone?:unknown},actor:string){
  const name=typeof body.name==='string'?body.name.trim():'';const email=typeof body.contactEmail==='string'?body.contactEmail.trim().toLowerCase():'';const phone=typeof body.contactPhone==='string'?body.contactPhone.trim():'';
  if(!name||name.length>120||email.length>320||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||phone.length>40)throw new BadRequestException('Thông tin liên hệ không hợp lệ.');
  const rows=await this.db.query('update tenants set name=$2,contact_email=$3,contact_phone=$4,updated_at=now() where id=$1::uuid returning id::text,name,contact_email as "contactEmail",contact_phone as "contactPhone"',[tenant,name,email||null,phone||null]);
  await this.db.query("insert into audit_logs(tenant_id,actor_email,action,resource_type,resource_id) values($1::uuid,$2,'tenant.contact_update','tenant',$1)",[tenant,actor]);return rows?.[0];
 }
 async operations(){
  const [jobs,workers,domains,failedJobs,backupStamp,monitorText]=await Promise.all([
   this.db.query("select status,count(*)::int as count,min(updated_at) as \"oldestUpdate\" from provisioning_jobs group by status"),
   this.db.query("select name,last_seen as \"lastSeen\",last_seen>now()-interval '60 seconds' as healthy from worker_heartbeats"),
   this.db.query(`
    select t.id::text as "tenantId",t.name,d.domain,d.status as "ownershipStatus",d.provisioning_status as "provisioningStatus",
      (select count(*)::int from mailboxes m where m.domain_id=d.id and m.provisioning_state in ('reconcile','failed')) as "mailboxIssues"
    from domains d join tenants t on t.id=d.tenant_id
    order by t.name,d.domain
   `),
   this.db.query(`
    select j.id::text,t.id::text as "tenantId",t.name,j.status,j.attempts,
      j.updated_at as "updatedAt",substring(j.idempotency_key from 9) as address
    from provisioning_jobs j join tenants t on t.id=j.tenant_id
    where j.job_type='mailbox.provision' and j.status in ('failed','dead_letter')
    order by j.updated_at desc,j.id limit 30
   `),
   readFile('/opt/30nice-mail-cloud-backups/scheduled/last-success','utf8').catch(()=>null),
   readFile('/var/lib/30nice-mailcloud-monitor/status.json','utf8').catch(()=>null),
  ]);
  const stamp=backupStamp?.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const backupDate=stamp?new Date(`${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}Z`):null;
  const backupAt=backupDate&&Number.isFinite(backupDate.getTime())?backupDate.toISOString():null;
  let monitor=null;
  try{if(monitorText)monitor=JSON.parse(monitorText);}catch{}
  return {jobs:jobs??[],workers:workers??[],domains:domains??[],failedJobs:failedJobs??[],backupAt,monitor,checkedAt:new Date().toISOString()};
 }
}

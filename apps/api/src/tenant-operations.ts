import {BadRequestException,NotFoundException} from '@nestjs/common';
import {readFile} from 'node:fs/promises';
import {DatabaseService} from './database.service';
import {MailcowService} from './mailcow.service';
export class TenantOperations{
 constructor(private db:DatabaseService,private mailcow:MailcowService){}
 async plans(){return await this.db.query('select id::text,name,mailbox_limit as "mailboxLimit",storage_gb as "storageGb",mailbox_max_gb as "mailboxMaxGb",active from service_plans order by created_at')??[];}
 async createPlan(body:{name?:unknown;mailboxLimit?:unknown;storageGb?:unknown;mailboxMaxGb?:unknown}={}){
  const name=typeof body.name==='string'?body.name.trim():'';
  if(!name||name.length>120||![body.mailboxLimit,body.storageGb,body.mailboxMaxGb].every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=1)||Number(body.mailboxLimit)>100000||Number(body.storageGb)>100000||Number(body.mailboxMaxGb)>1000||Number(body.mailboxMaxGb)>Number(body.storageGb))throw new BadRequestException('Tên gói và hạn mức không hợp lệ. Dung lượng mỗi hộp thư không được lớn hơn tổng gói.');
  try{return (await this.db.query('insert into service_plans(name,mailbox_limit,storage_gb,mailbox_max_gb) values($1,$2,$3,$4) returning id::text,name',[name,body.mailboxLimit,body.storageGb,body.mailboxMaxGb]))?.[0];}catch{throw new BadRequestException('Không tạo được gói; kiểm tra tên gói đã tồn tại chưa.');}
 }
 async assignPlan(tenant:string,planId:unknown,actor:string){if(typeof planId!=='string')throw new BadRequestException('Chọn gói dịch vụ.');
  try{return (await this.db.transaction(async q=>{
   await q('select pg_advisory_xact_lock(hashtextextended($1,0))',[`mailboxes:${tenant}`]);
   const plan=(await q<{id:string;storage_gb:number;mailbox_limit:number;mailbox_max_gb:number}>('select * from service_plans where id=$1::uuid and active=true',[planId]))[0];if(!plan)throw new BadRequestException('Gói không tồn tại hoặc đã ngừng cung cấp.');
   const domains=await q<{domain:string}>('select domain from domains where tenant_id=$1::uuid',[tenant]);const names=new Set(domains.map(d=>d.domain));
   const remote=(await this.mailcow.getMailboxes()).filter(b=>names.has(b.address.split('@')[1]));const amounts=new Map(remote.map(b=>[b.address,b.quotaBytes]));
   const local=await q<{address:string;quota_gb:number}>('select address,quota_gb from mailboxes where tenant_id=$1::uuid',[tenant]);for(const b of local)amounts.set(b.address,Math.max(amounts.get(b.address)||0,b.quota_gb*1024**3));
   if(amounts.size>plan.mailbox_limit||[...amounts.values()].reduce((a,b)=>a+b,0)>plan.storage_gb*1024**3||[...amounts.values()].some(n=>n>plan.mailbox_max_gb*1024**3))throw new BadRequestException('Gói thấp hơn tài nguyên đang cấp. Cần điều chỉnh hộp thư trước khi đổi gói.');
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
  const [jobs,workers,drift]=await Promise.all([this.db.query("select status,count(*)::int as count,min(updated_at) as \"oldestUpdate\" from provisioning_jobs group by status"),this.db.query("select name,last_seen as \"lastSeen\",last_seen>now()-interval '60 seconds' as healthy from worker_heartbeats"),this.db.query("select t.name,d.domain,d.provisioning_status as \"provisioningStatus\",d.provisioning_error as \"provisioningError\",(select count(*)::int from mailboxes m where m.domain_id=d.id and m.provisioning_state in ('reconcile','failed')) as \"mailboxIssues\" from domains d join tenants t on t.id=d.tenant_id order by t.name")]);
  let monitor=null;try{monitor=JSON.parse(await readFile('/var/lib/30nice-mailcloud-monitor/status.json','utf8'));}catch{}
  return {jobs:jobs??[],workers:workers??[],domains:drift??[],monitor,checkedAt:new Date().toISOString()};
 }
}

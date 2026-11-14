import {BadRequestException,NotFoundException} from '@nestjs/common';
import {readFile} from 'node:fs/promises';
import {DatabaseService} from './database.service';
import {MailcowService} from './mailcow.service';
const GIB=1024**3;
type Query=Parameters<Parameters<DatabaseService['transaction']>[0]>[0];
type Plan=Record<string,unknown>&{id:string;storage_gb:number;mailbox_limit:number;mailbox_max_gb:number;trial_days:number|null};
const formatGiB=(bytes:number)=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:4}).format(bytes/GIB);

export class TenantOperations{
 constructor(private db:DatabaseService,private mailcow:MailcowService){}
 async plans(includeCustomerCounts=false){
  return await this.db.query(`
   select p.id::text,p.name,p.mailbox_limit as "mailboxLimit",p.storage_gb as "storageGb",
          p.mailbox_max_gb as "mailboxMaxGb",p.active,p.price_vnd as "priceVnd",p.billing_period as "billingPeriod",p.trial_days as "trialDays",
          p.monthly_price_vnd as "monthlyPriceVnd",p.yearly_price_vnd as "yearlyPriceVnd",
          p.quarterly_price_vnd as "quarterlyPriceVnd",p.semiannual_price_vnd as "semiannualPriceVnd",
          case when $1::boolean then (select count(*)::int from tenants t where t.plan_id=p.id) end as "customerCount"
   from service_plans p order by p.created_at
  `,[includeCustomerCounts])??[];
 }
 async publicPlans(){
  return await this.db.query(`select name,mailbox_limit as "mailboxLimit",storage_gb as "storageGb",
   mailbox_max_gb as "mailboxMaxGb",trial_days as "trialDays",
   monthly_price_vnd as "monthlyPriceVnd",quarterly_price_vnd as "quarterlyPriceVnd",
   semiannual_price_vnd as "semiannualPriceVnd",yearly_price_vnd as "yearlyPriceVnd"
   from service_plans where active and
    (trial_days is not null or coalesce(monthly_price_vnd,quarterly_price_vnd,semiannual_price_vnd,yearly_price_vnd) is not null)
   order by case when trial_days is not null then 0 else 1 end,mailbox_limit,storage_gb,name`)??[];
 }
 async createPlan(body:{name?:unknown;mailboxLimit?:unknown;storageGb?:unknown;mailboxMaxGb?:unknown}={}){
  const name=typeof body.name==='string'?body.name.trim():'';
  if(!name||name.length>120||![body.mailboxLimit,body.storageGb,body.mailboxMaxGb].every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=1)||Number(body.mailboxLimit)>100000||Number(body.storageGb)>100000||Number(body.mailboxMaxGb)>1000||Number(body.mailboxMaxGb)>Number(body.storageGb))throw new BadRequestException('Tên gói và hạn mức không hợp lệ. Dung lượng mỗi hộp thư không được lớn hơn tổng gói.');
  try{return (await this.db.query('insert into service_plans(name,mailbox_limit,storage_gb,mailbox_max_gb) values($1,$2,$3,$4) returning id::text,name',[name,body.mailboxLimit,body.storageGb,body.mailboxMaxGb]))?.[0];}catch{throw new BadRequestException('Không tạo được gói; kiểm tra tên gói đã tồn tại chưa.');}
 }
 async updatePrice(id:string,body:{priceVnd?:unknown;billingPeriod?:unknown;monthlyPriceVnd?:unknown;yearlyPriceVnd?:unknown;quarterlyPriceVnd?:unknown;semiannualPriceVnd?:unknown}={}){
  const validPrice=(value:unknown)=>value===null||(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=2147483647);
  const hasQuarter='quarterlyPriceVnd' in body;
  const hasHalf='semiannualPriceVnd' in body;
  const dual='monthlyPriceVnd' in body||'yearlyPriceVnd' in body||hasQuarter||hasHalf;
  const {priceVnd,billingPeriod,monthlyPriceVnd,yearlyPriceVnd}=body;
  const valid=dual?validPrice(monthlyPriceVnd)&&validPrice(yearlyPriceVnd)&&
   (!hasQuarter||validPrice(body.quarterlyPriceVnd))&&(!hasHalf||validPrice(body.semiannualPriceVnd)):
   validPrice(priceVnd)&&(priceVnd===null||billingPeriod==='month'||billingPeriod==='year');
  if(!/^[0-9a-f-]{36}$/i.test(id)||!valid)throw new BadRequestException('Đơn giá hoặc kỳ tính phí không hợp lệ.');
  const monthly=dual?monthlyPriceVnd:billingPeriod==='month'?priceVnd:null;
  const yearly=dual?yearlyPriceVnd:billingPeriod==='year'?priceVnd:null;
  const rows=await this.db.query(`update service_plans
   set monthly_price_vnd=case when $4::boolean or $5::text='month' or $5 is null then $2::int else monthly_price_vnd end,
       yearly_price_vnd=case when $4::boolean or $5::text='year' or $5 is null then $3::int else yearly_price_vnd end,
       quarterly_price_vnd=case when $6::boolean then $7::int else quarterly_price_vnd end,
       semiannual_price_vnd=case when $8::boolean then $9::int else semiannual_price_vnd end,
       price_vnd=coalesce($2::int,$3::int),billing_period=case when $2::int is not null then 'month' when $3::int is not null then 'year' end
   where id::text=$1 and trial_days is null returning id::text`,[id,monthly,yearly,dual,dual||priceVnd===null?null:billingPeriod,hasQuarter,body.quarterlyPriceVnd??null,hasHalf,body.semiannualPriceVnd??null]);
  if(!rows?.length)throw new NotFoundException('Không tìm thấy gói trả phí.');
  return rows[0];
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
   if(!plan.trial_days){
    const suspended=await q<{domain:string;trial_restore_domain:boolean;trial_restore_mailboxes:string[]}>(
     'select domain,trial_restore_domain,trial_restore_mailboxes from domains where tenant_id=$1::uuid and trial_restore_domain is not null',[tenant]);
    for(const row of suspended){
     if(!await this.mailcow.getDomain(row.domain))continue;
     if(row.trial_restore_domain)await this.mailcow.setDomainActive(row.domain,true);
     const boxes=await this.mailcow.getMailboxes(row.domain);
     for(const box of boxes)if(!box.active&&row.trial_restore_mailboxes.includes(box.address))await this.mailcow.editMailbox(box.address,undefined,'active');
    }
    await q('update domains set trial_restore_domain=null,trial_restore_mailboxes=null where tenant_id=$1::uuid and trial_restore_domain is not null',[tenant]);
   }
   const changed=await q(`update tenants set plan_id=$2::uuid,
    trial_ends_at=case when $3::int is null then null
      when plan_id=$2::uuid then coalesce(trial_ends_at,now()+$3::int*interval '24 hours')
      else now()+$3::int*interval '24 hours' end,
    updated_at=now() where id=$1::uuid returning id::text,plan_id::text as "planId",trial_ends_at as "trialEndsAt"`,[tenant,planId,plan.trial_days]);if(!changed.length)throw new NotFoundException('Khách hàng không tồn tại.');
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

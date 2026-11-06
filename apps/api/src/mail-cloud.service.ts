import {BadRequestException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {MemberInvitations} from './member-invitations';
import {MailboxOperations} from './mailbox-operations';
import {DatabaseService} from './database.service';
import {MailcowService} from './mailcow.service';
import {promises as dns} from 'node:dns';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {checkWebmailTls,inspectDns,recordsFor,validDomain} from './dns-setup';
import {randomBytes,randomInt,scryptSync} from 'node:crypto';
type Tenant={id:string;name:string;slug:string;createdAt:string};
type Domain={id:string;tenantId:string;domain:string;status:'pending'|'verified';verification_token?:string};
type Mailbox={id:string;tenantId:string;address:string;quotaGb:number;status:'active'|'disabled'};

@Injectable()
export class MailCloudService {
  constructor(private readonly database: DatabaseService, private readonly mailcow: MailcowService) {}
  databaseAccess(){return this.database;}
  private readonly tenants: Tenant[]=[{id:'tenant-30nice',name:'30 NICE',slug:'30nice',createdAt:new Date().toISOString()},{id:'tenant-gofor',name:'GoForVietnam',slug:'goforvietnam',createdAt:new Date().toISOString()}];
  private readonly domains: Domain[]=[{id:'domain-30nice',tenantId:'tenant-30nice',domain:'30nice.vn',status:'pending'},{id:'domain-gofor',tenantId:'tenant-gofor',domain:'goforvietnam.com',status:'pending'}];
  private readonly mailboxes: Mailbox[]=[];
  private readonly audit:Array<Record<string,string>>=[];

  async listTenants(role?: string,tenantId?: string){if(role!=='super_admin'&&!(role==='tenant_admin'&&tenantId)) throw new ForbiddenException('Super Admin or scoped Tenant Admin role required'); await this.database.ensureSeed(); const rows=await this.database.query<{id:string;name:string;slug:string;created_at:string}>('select id::text,name,slug,created_at::text from tenants where ($1 = \'super_admin\' or id=$2::uuid) order by created_at', [role,tenantId??null]); return rows??(role==='super_admin'?this.tenants:this.tenants.filter(t=>t.id===tenantId));}
  async listAudit(role?: string){if(role!=='super_admin') throw new ForbiddenException('Super Admin role required'); const rows=await this.database.query('select id::text,tenant_id::text as "tenantId",actor_email as "actorEmail",action,resource_type as "resourceType",resource_id as "resourceId",request_id as "requestId",created_at as "createdAt" from audit_logs order by created_at desc limit 100'); return rows??this.audit;}
  async createTenant(body:{name?:string;slug?:string},actorEmail='system',requestId?:string){
    const name=typeof body?.name==='string'?body.name.trim():'';
    const slug=typeof body?.slug==='string'?body.slug.trim().toLowerCase():'';
    if(!name||name.length>120||!slug||slug.length>64||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      throw new BadRequestException('Tên khách hàng từ 1 đến 120 ký tự; mã từ 1 đến 64 ký tự, chỉ gồm chữ thường, số và dấu gạch ngang');
    if(this.mailcowModeIsProduction()&&!this.databaseReady()) throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng; không thể tạo khách hàng');
    if(!this.databaseReady()&&this.tenants.some(t=>t.slug===slug)) throw new BadRequestException('Mã khách hàng đã tồn tại');
    let rows:{id:string;name:string;slug:string;created_at:string}[]|null;
    try {
      rows=await this.database.query<{id:string;name:string;slug:string;created_at:string}>('insert into tenants(name,slug) values($1,$2) returning id::text,name,slug,created_at::text',[name,slug]);
    }catch(error){
      if((error as {code?:string})?.code==='23505') throw new BadRequestException('Mã khách hàng đã tồn tại');
      throw error;
    }
    const tenant=rows?.[0]??{id:`tenant-${randomBytes(12).toString('hex')}`,name,slug,createdAt:new Date().toISOString()};
    if(!rows) this.tenants.push(tenant as Tenant);
    await this.record('tenant.create',tenant.id,tenant.id,actorEmail,requestId);
    return tenant;
  }

  async assertTenant(tenantId:string,scope?:string){if(scope && scope!==tenantId) throw new ForbiddenException('Cross-tenant access denied'); const rows=await this.database.query<{id:string;status:string}>('select id::text,status from tenants where id=$1::uuid',[tenantId]); if(rows && !rows.length) throw new NotFoundException('Tenant not found'); if(rows?.[0]?.status!=='active') throw new ForbiddenException('Tenant đang tạm ngưng hoạt động'); if(!rows && !this.tenants.some(t=>t.id===tenantId)) throw new NotFoundException('Tenant not found'); return tenantId;}
  async listDomains(tenantId:string){const rows=await this.database.query('select id::text,tenant_id::text as "tenantId",domain,status,provisioning_status as "provisioningStatus",provisioning_error as "provisioningError" from domains where tenant_id=$1::uuid order by domain',[tenantId]); return rows??this.domains.filter(d=>d.tenantId===tenantId);}
  async createMember(tenantId:string,body:{email?:string;password?:string;role?:'tenant_admin'|'mailbox_user'},actorEmail='system'){return new MemberInvitations(this.database).createMember(tenantId,body,actorEmail);}
  async listMembers(tenantId:string){return await this.database.query('select id::text,email,role,status,created_at as "createdAt" from tenant_members where tenant_id=$1::uuid order by email',[tenantId])??[];}
  async updateMemberStatus(tenantId:string,memberId:string,status:'active'|'disabled',actorEmail:string){const rows=await this.database.transaction(async query=>{await query('select pg_advisory_xact_lock(hashtextextended($1,0))',[tenantId]);return query(`update tenant_members m set status=$3 where m.id=$1::uuid and m.tenant_id=$2::uuid and ($3='active' or lower(m.email)<>lower($4)) and ($3='active' or m.role<>'tenant_admin' or (select count(*) from tenant_members active where active.tenant_id=m.tenant_id and active.role='tenant_admin' and active.status='active')>1) returning m.id::text,email,role,status`,[memberId,tenantId,status,actorEmail]);});if(!rows?.[0])throw new BadRequestException('Không thể cập nhật thành viên. Hãy kiểm tra tenant, quyền quản trị và bảo đảm tenant còn ít nhất một quản trị viên hoạt động.');await this.record(status==='disabled'?'member.disable':'member.enable',memberId,tenantId,actorEmail);return rows[0];}
  private async domainConfig(tenantId:string,domainId:string){
    const rows=await this.database.query<{id:string;domain:string;status:string;verification_token:string|null}>('select id::text,domain,status,verification_token from domains where id=$1::uuid and tenant_id=$2::uuid',[domainId,tenantId]);
    const row=rows?.[0];if(!row||!validDomain(row.domain))throw new NotFoundException('Không tìm thấy tên miền');return row;
  }
  async prepareDns(tenantId:string,domainId:string,actorEmail='system'){
    const row=await this.domainConfig(tenantId,domainId);
    if(!row.verification_token&&row.status==='pending')await this.database.query("update domains set verification_token=$3 where id=$1::uuid and tenant_id=$2::uuid and coalesce(verification_token,'')=''",[domainId,tenantId,`30nice-${randomBytes(24).toString('base64url')}`]);
    if(row.status==='verified'){
      await this.connectDomain(tenantId,domainId,actorEmail);
      await this.database.transaction(async query=>{await query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`dkim:${row.domain}`]);await this.mailcow.ensureDkim(row.domain);return [];});
    }
    await this.record('domain.dns_prepare',domainId,tenantId,actorEmail);
    return this.dnsHealth(tenantId,domainId);
  }
  async dnsHealth(tenantId:string,domainId:string){
    const row=await this.domainConfig(tenantId,domainId);
    let dkim=null,dkimError='';try{dkim=await this.mailcow.getDkim(row.domain);}catch{dkimError='Không đọc được DKIM từ Mailcow. Hãy thử lại.';}
    const checks=await inspectDns(row.domain,row.verification_token,dkim);
    if(row.status==='verified')checks.ownership={...checks.ownership,ok:true,state:'ok',message:'Quyền sở hữu đã được xác minh'};
    if(dkimError)checks.dkim={...checks.dkim,ok:false,state:'error',message:dkimError};
    const host=`mail.${row.domain}`;
    let activation:{state:string;message:string;updatedAt?:string}={state:'not_started',message:'Chưa kích hoạt HTTPS cho webmail riêng.'};
    try{const data=JSON.parse(await readFile(`/var/lib/30nice-mailcloud-webmail/${host}.json`,'utf8'));if(['running','ready','failed'].includes(data.state))activation={state:data.state,message:String(data.message||''),updatedAt:data.updatedAt};}catch{}
    if(activation.state==='running'&&activation.updatedAt&&Date.now()-Date.parse(activation.updatedAt)>600000)activation={...activation,state:'failed',message:'Lượt kích hoạt trước đã hết thời gian. Vui lòng thử lại.'};
    const tlsReady=checks.webmail.ok&&await checkWebmailTls(host);
    const ready=tlsReady&&(host==='mail.30nice.vn'||activation.state==='ready');
    const serviceStatus=await this.database.query('select provisioning_status,provisioning_error from domains where id=$1::uuid and tenant_id=$2::uuid',[domainId,tenantId]);
    return {domain:row.domain,status:row.status,provisioningStatus:serviceStatus?.[0]?.provisioning_status||'pending',provisioningError:serviceStatus?.[0]?.provisioning_error,checks,records:recordsFor(row.domain,row.verification_token,dkim),webmail:{host,url:`https://${host}`,ready,activation},checkedAt:new Date().toISOString()};
  }
  async activateWebmail(tenantId:string,domainId:string,actorEmail='system'){
    const row=await this.domainConfig(tenantId,domainId);
    if(row.status!=='verified')throw new BadRequestException('Cần xác minh quyền sở hữu trước khi kích hoạt webmail.');
    if(row.domain==='30nice.vn')return {message:'Webmail 30NICE đã được cấu hình.',accepted:true};
    try{const previous=JSON.parse(await readFile(`/var/lib/30nice-mailcloud-webmail/mail.${row.domain}.json`,'utf8'));
      if(previous.state==='ready')return {accepted:true,message:'Webmail đã được kích hoạt. Bấm Kiểm tra để xem trạng thái mới nhất.'};
      if(Date.now()-Date.parse(previous.updatedAt)<120000)throw new BadRequestException('Yêu cầu trước đang được xử lý hoặc vừa thất bại. Vui lòng chờ hai phút rồi kiểm tra lại.');
    }catch(error){if(error instanceof BadRequestException)throw error;}
    const checks=await inspectDns(row.domain,null,null);
    if(!checks.webmail.ok)throw new BadRequestException(checks.webmail.message);
    try{await promisify(execFile)('/usr/bin/systemctl',['start','--no-block',`30nice-webmail@${row.domain}.service`],{timeout:10000,maxBuffer:4096});}
    catch{throw new BadRequestException('Chưa thể khởi chạy kích hoạt webmail. Hãy thử lại hoặc liên hệ quản trị.');}
    await this.record('domain.webmail_activate',domainId,tenantId,actorEmail);
    return {accepted:true,message:'Đã tiếp nhận. Hệ thống đang kiểm tra DNS và cấp HTTPS; bấm Kiểm tra sau ít phút.'};
  }
  async connectDomain(tenantId:string,domainId:string,actorEmail='system'){
    const row=await this.domainConfig(tenantId,domainId);if(row.status!=='verified')throw new BadRequestException('Cần xác minh quyền sở hữu tên miền trước.');
    try{
      await this.mailcow.ensureDomain(row.domain);
      const policy=await this.database.query<{storage_gb:number;mailbox_limit:number;mailbox_max_gb:number}>('select p.storage_gb,p.mailbox_limit,p.mailbox_max_gb from tenants t join service_plans p on p.id=t.plan_id where t.id=$1::uuid',[tenantId]);
      if(policy?.[0])await this.mailcow.setDomainLimits(row.domain,policy[0].storage_gb,policy[0].mailbox_limit,policy[0].mailbox_max_gb);
      if(this.mailcowModeIsProduction()){const found=await this.mailcow.getDomain(row.domain);if(!found||Number(found.active)!==1)throw new Error('Tên miền chưa hoạt động trong Mailcow.');}
      await this.database.query("update domains set provisioning_status='ready',provisioning_error=null,provisioned_at=now() where id=$1::uuid and tenant_id=$2::uuid",[domainId,tenantId]);
      await this.record('domain.connected',domainId,tenantId,actorEmail);return {connected:true};
    }catch{
      await this.database.query("update domains set provisioning_status='failed',provisioning_error='Chưa kết nối được dịch vụ email. Bấm kết nối lại hoặc liên hệ hỗ trợ.' where id=$1::uuid and tenant_id=$2::uuid",[domainId,tenantId]);
      throw new BadRequestException('Quyền sở hữu đã xác minh nhưng dịch vụ email chưa kết nối. Hãy thử Kết nối dịch vụ email.');
    }
  }
  async onboarding(tenantId:string){
    const tenant=(await this.database.query('select t.id::text,t.name,t.contact_email as "contactEmail",t.contact_phone as "contactPhone",t.plan_id::text as "planId",p.name as "planName" from tenants t left join service_plans p on p.id=t.plan_id where t.id=$1::uuid',[tenantId]))?.[0];
    if(!tenant)throw new NotFoundException('Không tìm thấy khách hàng.');
    const [domains,mailboxes,members,progress]=await Promise.all([this.listDomains(tenantId),this.listMailboxes(tenantId),this.listMembers(tenantId),this.database.query('select o.domain_id::text as "domainId",l.last_login_at as "webmailConfirmedAt" from onboarding_progress o left join domain_webmail_logins l on l.domain_id=o.domain_id where o.tenant_id=$1::uuid',[tenantId])]);
    let progressRow=progress?.[0]??null;
    if(!progressRow&&domains[0]){const log=await this.database.query('select last_login_at as "webmailConfirmedAt" from domain_webmail_logins where domain_id=$1::uuid',[domains[0].id]);progressRow={domainId:domains[0].id,webmailConfirmedAt:log?.[0]?.webmailConfirmedAt||null};}
    return {tenant,domains,mailboxes,members:members.map(m=>({id:m.id,role:m.role,status:m.status})),progress:progressRow};
  }
  async saveOnboarding(tenantId:string,domainId:unknown){
    if(typeof domainId!=='string')throw new BadRequestException('Chọn tên miền cần thiết lập.');await this.domainConfig(tenantId,domainId);
    return (await this.database.query('insert into onboarding_progress(tenant_id,domain_id) values($1::uuid,$2::uuid) on conflict(tenant_id) do update set domain_id=excluded.domain_id,webmail_confirmed_at=case when onboarding_progress.domain_id=excluded.domain_id then onboarding_progress.webmail_confirmed_at else null end,updated_at=now() returning domain_id::text as "domainId"',[tenantId,domainId]))?.[0];
  }
  async createDomain(tenantId:string,body:{domain?:string},actorEmail='system'){
    if(!body.domain||!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(body.domain)) throw new BadRequestException('Tên miền không hợp lệ');
    if(this.mailcowModeIsProduction()&&!this.databaseReady()) throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng; không thể thêm tên miền');
    const value=body.domain.toLowerCase();
    const existingRows=await this.database.query<{id:string;tenantId:string;domain:string;status:string;verification_token:string}>(
      'select id::text,tenant_id::text as "tenantId",domain,status,verification_token from domains where domain=$1',[value],
    );
    const existing=existingRows?.[0]??(!existingRows?this.domains.find(item=>item.domain===value):undefined);
    if(existing&&existing.tenantId!==tenantId) throw new BadRequestException('Tên miền này đã được một khách hàng khác đăng ký');
    if(existing){
      if(existing.status==='pending'&&!existing.verification_token){
        const repaired=await this.database.query<{verification_token:string}>("update domains set verification_token=$3 where id=$1::uuid and tenant_id=$2::uuid and coalesce(verification_token,'')='' returning verification_token",[existing.id,tenantId,`30nice-${randomBytes(24).toString('base64url')}`]);
        if(repaired?.[0])existing.verification_token=repaired[0].verification_token;
      }
      if(existing.status!=='verified')return existing;
      try { await this.connectDomain(tenantId,existing.id,actorEmail); }
      catch(error){ await this.record('domain.provision_retry_failed',existing.id,tenantId,actorEmail); throw new BadRequestException(error instanceof Error?error.message:'Mailcow domain provisioning failed'); }
      await this.record('domain.provision_retry',existing.id,tenantId,actorEmail);
      return existing;
    }
    const token=`30nice-${randomBytes(24).toString('base64url')}`;
    const rows=await this.database.query<{id:string;tenantId:string;domain:string;status:string;verification_token:string}>(
      'insert into domains(tenant_id,domain,verification_token) values($1::uuid,$2,$3) returning id::text,tenant_id::text as "tenantId",domain,status,verification_token',
      [tenantId,value,token],
    );
    const domain=rows?.[0]??{id:`domain-${Date.now()}`,tenantId,domain:value,status:'pending' as const,verification_token:token};
    if(!rows) this.domains.push(domain as Domain);
    // Register ownership first; provisioning is a separate step after TXT verification.
    await this.record('domain.create',domain.id,tenantId,actorEmail);
    return domain;
  }
  async verifyDomain(tenantId:string,domainId:string,token:string,actorEmail='system'){const candidates=await this.database.query<{domain:string;verification_token:string}>('select domain,verification_token from domains where id=$1::uuid and tenant_id=$2::uuid and status=\'pending\'',[domainId,tenantId]);const candidate=candidates?.[0];if(!candidate)throw new NotFoundException('Tên miền đang chờ xác minh không tồn tại');if(!token||token!==candidate.verification_token)throw new BadRequestException('Mã xác minh không hợp lệ');let records:string[][];try{records=await dns.resolveTxt(`_30nice-verification.${candidate.domain}`);}catch{throw new BadRequestException(`Chưa tìm thấy TXT tại _30nice-verification.${candidate.domain}`);}if(!records.some(record=>record.join('')===candidate.verification_token))throw new BadRequestException('Bản ghi TXT xác minh chưa khớp');const rows=await this.database.query('update domains set status=\'verified\' where id=$1::uuid and tenant_id=$2::uuid and status=\'pending\' returning id::text,tenant_id::text as "tenantId",domain,status',[domainId,tenantId]);if(!rows?.length)throw new BadRequestException('Tên miền đã được xác minh hoặc trạng thái đã thay đổi');await this.record('domain.verify',domainId,tenantId,actorEmail);return rows[0];}
  async listMailboxes(tenantId:string){const rows=await this.database.query('select id::text,tenant_id::text as "tenantId",address,quota_gb as "quotaGb",status,provisioning_state as "provisioningState",observed_quota_bytes::float8 as "observedQuotaBytes",observed_active as "observedActive",used_bytes::float8 as "usedBytes",synced_at as "syncedAt" from mailboxes where tenant_id=$1::uuid order by address',[tenantId]); return rows??this.mailboxes.filter(m=>m.tenantId===tenantId);}
  async listProvisioningJobs(tenantId:string){const rows=await this.database.query('select id::text,tenant_id::text as "tenantId",idempotency_key as "idempotencyKey",job_type as "jobType",status,attempts,last_error as "lastError",created_at as "createdAt",updated_at as "updatedAt" from provisioning_jobs where tenant_id=$1::uuid order by created_at desc limit 100',[tenantId]); return rows??[];}
  async mailboxCapacity(tenantId:string,domain:string){return new MailboxOperations(this.database,this.mailcow).capacity(tenantId,domain);}
  async retryMailboxProvisioning(tenantId:string,jobId:string,actorEmail='system'){return new MailboxOperations(this.database,this.mailcow).retry(tenantId,jobId,actorEmail);}
  async createMailbox(tenantId:string,body:{address?:string;quotaGb?:number;password?:string},actorEmail='system'){return new MailboxOperations(this.database,this.mailcow).create(tenantId,body,actorEmail);}
  async updateMailbox(tenantId:string,id:string,body:{quotaGb?:number;status?:'active'|'disabled'},actorEmail='system'){return new MailboxOperations(this.database,this.mailcow).update(tenantId,id,body,actorEmail);}
  async resetMailboxPassword(tenantId:string,id:string,actorEmail='system'){return new MailboxOperations(this.database,this.mailcow).resetPassword(tenantId,id,actorEmail);}
  private mailcowModeIsProduction(){return process.env.MAIL_ADAPTER_MODE==='production';}
  private databaseReady(){return Boolean(process.env.DATABASE_URL);}
  async listAliases(tenantId:string){
    return await this.database.query('select id::text,source,destination,active,created_at as "createdAt" from aliases where tenant_id=$1::uuid order by source',[tenantId])??[];
  }
  async createAlias(tenantId:string,body:{source?:unknown;destination?:unknown},actorEmail='system'){
    const source=typeof body?.source==='string'?body.source.trim().toLowerCase():'';
    const destination=typeof body?.destination==='string'?body.destination.trim().toLowerCase():'';
    const valid=(value:string)=>value.length<=254&&/^[-a-z0-9._+]+@(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(value);
    if(!valid(source)||!valid(destination)||source===destination)throw new BadRequestException('Cần bí danh và hộp thư nhận hợp lệ, khác nhau');
    let rows;
    try{
      rows=await this.database.transaction(async query=>{
        await query('select pg_advisory_xact_lock(hashtextextended($1,0))',['alias:'+source]);
        const domain=await query("select id from domains where tenant_id=$1::uuid and domain=$2 and status='verified'",[tenantId,source.split('@')[1]]);
        const target=await query("select id from mailboxes where tenant_id=$1::uuid and address=$2 and status='active'",[tenantId,destination]);
        if(!domain.length||!target.length)throw new BadRequestException('Tên miền phải được xác minh và hộp thư nhận phải thuộc khách hàng này, đang hoạt động');
        const collision=await query('select id from mailboxes where address=$1 union all select id from aliases where source=$1',[source]);
        if(collision.length)throw new BadRequestException('Địa chỉ bí danh đã được sử dụng');
        await this.mailcow.ensureAlias(source,destination);
        return query('insert into aliases(tenant_id,source,destination,active) values($1::uuid,$2,$3,true) returning id::text,source,destination,active',[tenantId,source,destination]);
      });
    }catch(error){
      if((error as {code?:string})?.code==='23505')throw new BadRequestException('Địa chỉ bí danh đã được sử dụng');
      if(error instanceof BadRequestException)throw error;
      throw new BadRequestException('Không thể đồng bộ bí danh. Hãy kiểm tra Mailcow rồi thử lại; hệ thống sẽ đối chiếu yêu cầu trước đó.');
    }
    if(!rows?.[0])throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng');
    await this.record('alias.create',String(rows[0].id),tenantId,actorEmail);
    return rows[0];
  }
  async updateAliasActive(tenantId:string,id:string,active:unknown,actorEmail='system'){
    if(typeof active!=='boolean')throw new BadRequestException('Trạng thái bí danh không hợp lệ');
    const rows=await this.database.transaction(async query=>{
      const aliases=await query<{id:string;source:string;destination:string}>('select id::text,source,destination from aliases where id=$1::uuid and tenant_id=$2::uuid for update',[id,tenantId]);
      const alias=aliases[0];if(!alias)throw new NotFoundException('Không tìm thấy bí danh của khách hàng');
      const target=await query("select id from mailboxes where tenant_id=$1::uuid and address=$2 and status='active'",[tenantId,alias.destination]);
      if(active&&!target.length)throw new BadRequestException('Hộp thư nhận không còn hoạt động');
      try{await this.mailcow.setAliasActive(alias.source,alias.destination,active);}catch{throw new BadRequestException('Không thể cập nhật trạng thái trên Mailcow; hãy thử lại');}
      return query('update aliases set active=$3 where id=$1::uuid and tenant_id=$2::uuid returning id::text,source,destination,active',[id,tenantId,active]);
    });
    if(!rows?.[0])throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng');
    await this.record(active?'alias.enable':'alias.disable',id,tenantId,actorEmail);
    return rows[0];
  }
  private async record(action:string,resourceId:string,tenantId?:string,actorEmail?:string,requestId?:string){this.audit.push({action,resourceId,tenantId:tenantId??'',actorEmail:actorEmail??'',requestId:requestId??'',createdAt:new Date().toISOString()}); await this.database.query('insert into audit_logs(tenant_id,actor_email,action,resource_type,resource_id,request_id) values($1::uuid,$2,$3,$4,$5,$6)',[tenantId??null,actorEmail??null,action,action.split('.')[0],resourceId,requestId??null]).catch(()=>undefined);}
  databaseStatus(){return this.database.status();}
}


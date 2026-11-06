import {BadRequestException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
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
  async listDomains(tenantId:string){const rows=await this.database.query('select id::text,tenant_id::text as "tenantId",domain,status from domains where tenant_id=$1::uuid order by domain',[tenantId]); return rows??this.domains.filter(d=>d.tenantId===tenantId);}
  async createMember(tenantId:string,body:{email?:string;password?:string;role?:'tenant_admin'|'mailbox_user'},actorEmail='system'){const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';if(body?.role!==undefined&&body.role!=='tenant_admin'&&body.role!=='mailbox_user')throw new BadRequestException('Vai trò thành viên không hợp lệ');if(!email||email.length>320||!/^\S+@\S+\.\S+$/.test(email)||typeof body?.password!=='string'||body.password.length<12||body.password.length>1024) throw new BadRequestException('Cần email hợp lệ và mật khẩu tối thiểu 12 ký tự');if(this.mailcowModeIsProduction()&&!this.databaseReady())throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng; không thể tạo thành viên');const role=body.role??'tenant_admin';const salt=randomBytes(16).toString('hex');const hash=`scrypt$${salt}$${scryptSync(body.password,salt,32).toString('hex')}`;const rows=await this.database.query('insert into tenant_members(tenant_id,email,password_hash,role) values($1::uuid,$2,$3,$4) returning id::text,tenant_id::text as "tenantId",email,role,status',[tenantId,email,hash,role]);if(rows){await this.record('member.create',String((rows[0] as {id:string}).id),tenantId,actorEmail);return rows[0];}return {tenantId,email,role,status:'active'};}
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
    return {domain:row.domain,status:row.status,checks,records:recordsFor(row.domain,row.verification_token,dkim),webmail:{host,url:`https://${host}`,ready,activation},checkedAt:new Date().toISOString()};
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
      try { await this.mailcow.ensureDomain(value); }
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
    try { await this.mailcow.ensureDomain(value); }
    catch(error){ await this.record('domain.provision_failed',domain.id,tenantId,actorEmail); throw new BadRequestException(error instanceof Error?error.message:'Mailcow domain provisioning failed'); }
    await this.record('domain.create',domain.id,tenantId,actorEmail);
    return domain;
  }
  async verifyDomain(tenantId:string,domainId:string,token:string,actorEmail='system'){const candidates=await this.database.query<{domain:string;verification_token:string}>('select domain,verification_token from domains where id=$1::uuid and tenant_id=$2::uuid and status=\'pending\'',[domainId,tenantId]);const candidate=candidates?.[0];if(!candidate)throw new NotFoundException('Tên miền đang chờ xác minh không tồn tại');if(!token||token!==candidate.verification_token)throw new BadRequestException('Mã xác minh không hợp lệ');let records:string[][];try{records=await dns.resolveTxt(`_30nice-verification.${candidate.domain}`);}catch{throw new BadRequestException(`Chưa tìm thấy TXT tại _30nice-verification.${candidate.domain}`);}if(!records.some(record=>record.join('')===candidate.verification_token))throw new BadRequestException('Bản ghi TXT xác minh chưa khớp');const rows=await this.database.query('update domains set status=\'verified\' where id=$1::uuid and tenant_id=$2::uuid and status=\'pending\' returning id::text,tenant_id::text as "tenantId",domain,status',[domainId,tenantId]);if(!rows?.length)throw new BadRequestException('Tên miền đã được xác minh hoặc trạng thái đã thay đổi');await this.record('domain.verify',domainId,tenantId,actorEmail);return rows[0];}
  async listMailboxes(tenantId:string){const rows=await this.database.query('select id::text,tenant_id::text as "tenantId",address,quota_gb as "quotaGb",status from mailboxes where tenant_id=$1::uuid order by address',[tenantId]); return rows??this.mailboxes.filter(m=>m.tenantId===tenantId);}
  async listProvisioningJobs(tenantId:string){const rows=await this.database.query('select id::text,tenant_id::text as "tenantId",idempotency_key as "idempotencyKey",job_type as "jobType",status,attempts,last_error as "lastError",created_at as "createdAt",updated_at as "updatedAt" from provisioning_jobs where tenant_id=$1::uuid order by created_at desc limit 100',[tenantId]); return rows??[];}
  async retryMailboxProvisioning(tenantId:string,jobId:string,actorEmail='system'){
    const claimed=await this.database.query<{id:string;idempotency_key:string;payload?:{quotaGb?:number}}>("update provisioning_jobs set status='running',updated_at=now() where id=$1::uuid and tenant_id=$2::uuid and job_type='mailbox.provision' and status in ('failed','dead_letter') returning id::text,idempotency_key,payload",[jobId,tenantId]);
    if(!claimed) throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng');
    const job=claimed[0];
    if(!job) throw new NotFoundException('Không tìm thấy tác vụ lỗi có thể thử lại');
    const address=job.idempotency_key.replace(/^mailbox:/,'').toLowerCase();
    const parts=address.split('@');
    const quota=Number(job.payload?.quotaGb??5);
    if(parts.length!==2||!Number.isInteger(quota)||quota<1||quota>1000){
      await this.database.query("update provisioning_jobs set status='failed',last_error='Invalid provisioning payload',updated_at=now() where id=$1::uuid and tenant_id=$2::uuid",[jobId,tenantId]);
      throw new BadRequestException('Dữ liệu cấp phát không hợp lệ; cần kiểm tra thủ công');
    }
    const domainRows=await this.database.query<{id:string;domain:string}>("select id::text,domain from domains where tenant_id=$1::uuid and domain=$2 and status='verified'",[tenantId,parts[1]]);
    if(!domainRows?.[0]){
      await this.database.query("update provisioning_jobs set status='failed',last_error='Verified domain not found',updated_at=now() where id=$1::uuid and tenant_id=$2::uuid",[jobId,tenantId]);
      throw new BadRequestException('Tên miền không còn được xác minh; chưa thể thử lại');
    }
    const password=`N${randomBytes(18).toString('base64url')}!A1`;
    let mailboxId:string|undefined;
    try {
      const inserted=await this.database.query<{id:string;tenantId:string;address:string;quotaGb:number;status:string}>('insert into mailboxes(tenant_id,domain_id,address,quota_gb) values($1::uuid,$2::uuid,$3,$4) returning id::text,tenant_id::text as "tenantId",address,quota_gb as "quotaGb",status',[tenantId,domainRows[0].id,address,quota]);
      if(!inserted?.[0]) throw new Error('Không thể ghi nhận hộp thư trong cơ sở dữ liệu');
      const mailbox=inserted[0]; mailboxId=mailbox.id;
      await this.mailcow.provisionMailbox(parts[1],parts[0],quota,password,true);
      await this.database.query("update provisioning_jobs set status='succeeded',attempts=attempts+1,last_error=null,updated_at=now() where id=$1::uuid and tenant_id=$2::uuid",[jobId,tenantId]);
      await this.record('mailbox.provision_retry',mailbox.id,tenantId,actorEmail);
      return {...mailbox,provisioningJobId:jobId,provisioningStatus:'succeeded',temporaryPassword:password};
    } catch(error) {
      if(mailboxId) await this.database.query('delete from mailboxes where id=$1::uuid and tenant_id=$2::uuid',[mailboxId,tenantId]).catch(()=>undefined);
      await this.database.query("update provisioning_jobs set status='failed',attempts=attempts+1,last_error=$3,updated_at=now() where id=$1::uuid and tenant_id=$2::uuid",[jobId,tenantId,error instanceof Error?error.message:'Mailbox retry failed']).catch(()=>undefined);
      throw new BadRequestException(error instanceof Error?error.message:'Không thể thử lại cấp phát hộp thư');
    }
  }
  async createMailbox(tenantId:string,body:{address?:string;quotaGb?:number;password?:string},actorEmail='system') {
    const quota=body.quotaGb??5;
    const address=body.address?.trim().toLowerCase()??'';
    const parts=address.split('@');
    if(parts.length!==2||!/^[-a-z0-9._+]+$/i.test(parts[0])||!/^[-a-z0-9.]+\.[a-z]{2,}$/i.test(parts[1])||!Number.isInteger(quota)||quota<1||quota>1000) throw new BadRequestException('Cần địa chỉ email hợp lệ và dung lượng nguyên từ 1 đến 1000 GB');
    const [localPart,domain]=parts;
    const rows=await this.database.query<{id:string;domain:string}>('select id::text,domain from domains where tenant_id=$1::uuid and domain=$2 and status=\'verified\'',[tenantId,domain]);
    if(this.mailcowModeIsProduction()&&!rows) throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng; không thể cấp hộp thư an toàn');
    if(rows&&!rows.length) throw new BadRequestException('Tên miền phải được xác minh trước');
    const password=body.password??`N${randomBytes(9).toString('base64url')}!${randomInt(1000,10000)}`;
    let mailbox: {id:string;tenantId:string;address:string;quotaGb:number;status:string};
    let jobId: string|null=null;
    if(rows) {
      const mailboxRows=await this.database.query<{id:string;tenantId:string;address:string;quotaGb:number;status:string}>(
        'insert into mailboxes(tenant_id,domain_id,address,quota_gb) values($1::uuid,$2::uuid,$3,$4) returning id::text,tenant_id::text as "tenantId",address,quota_gb as "quotaGb",status',
        [tenantId,rows[0].id,address,quota],
      );
      if(!mailboxRows?.[0]) throw new BadRequestException('Không thể ghi nhận hộp thư trong cơ sở dữ liệu');
      mailbox=mailboxRows[0];
      try {
        const jobs=await this.database.query<{id:string}>(
          "insert into provisioning_jobs(tenant_id,idempotency_key,job_type,payload) values($1::uuid,$2,'mailbox.provision',$3::jsonb) on conflict (idempotency_key) do update set status='queued',payload=excluded.payload,last_error=null,updated_at=now() where provisioning_jobs.status in ('failed','dead_letter') returning id::text",
          [tenantId,`mailbox:${address}`,JSON.stringify({quotaGb:quota})],
        );
        jobId=jobs?.[0]?.id??null;
      } catch(error) {
        await this.database.query('delete from mailboxes where id=$1::uuid and tenant_id=$2::uuid',[mailbox.id,tenantId]);
        throw error;
      }
    } else {
      mailbox={id:`mailbox-${Date.now()}`,tenantId,address,quotaGb:quota,status:'active'};
    }
    try {
      await this.mailcow.provisionMailbox(domain,localPart,quota,password);
    } catch(error) {
      if(rows) {
        await this.database.query('delete from mailboxes where id=$1::uuid and tenant_id=$2::uuid',[mailbox.id,tenantId]).catch(()=>undefined);
        if(jobId) await this.database.query('update provisioning_jobs set status=\'failed\',attempts=attempts+1,last_error=$3,updated_at=now() where id=$1::uuid and tenant_id=$2::uuid',[jobId,tenantId,error instanceof Error?error.message:'Mailcow mailbox provisioning failed']).catch(()=>undefined);
      } else {
        this.mailboxes.push(mailbox as Mailbox);
      }
      await this.record('mailbox.provision_failed',address,tenantId,actorEmail);
      throw new BadRequestException(error instanceof Error?error.message:'Mailcow mailbox provisioning failed');
    }
    if(!rows) this.mailboxes.push(mailbox as Mailbox);
    if(jobId) await this.database.query('update provisioning_jobs set status=\'succeeded\',attempts=attempts+1,last_error=null,updated_at=now() where id=$1::uuid and tenant_id=$2::uuid',[jobId,tenantId]).catch(()=>undefined);
    await this.record('mailbox.create',mailbox.id,tenantId,actorEmail);
    return {...mailbox,provisioningJobId:jobId,provisioningStatus:jobId?'succeeded':'local-only',temporaryPassword:body.password?undefined:password};
  }
  private mailcowModeIsProduction(){return process.env.MAIL_ADAPTER_MODE==='production';}
  private databaseReady(){return Boolean(process.env.DATABASE_URL);}
  async updateMailbox(tenantId:string,id:string,body:{quotaGb?:number;status?:'active'|'disabled'},actorEmail='system') {
    if(body.quotaGb!==undefined&&(!Number.isInteger(body.quotaGb)||body.quotaGb<1||body.quotaGb>1000)) throw new BadRequestException('Dung lượng phải là số nguyên từ 1 đến 1000 GB');
    const current=await this.database.query<{address:string;quotaGb:number;status:'active'|'disabled'}>('select address,quota_gb as "quotaGb",status from mailboxes where id=$1::uuid and tenant_id=$2::uuid',[id,tenantId]);
    const existing=current?.[0]??this.mailboxes.find(m=>m.id===id&&m.tenantId===tenantId);
    if(!existing) throw new NotFoundException('Mailbox not found');
    const next={quotaGb:body.quotaGb??existing.quotaGb,status:body.status??existing.status};
    const rows=await this.database.query('update mailboxes set quota_gb=$3,status=$4 where id=$1::uuid and tenant_id=$2::uuid returning id::text,tenant_id::text as "tenantId",address,quota_gb as "quotaGb",status',[id,tenantId,next.quotaGb,next.status]);
    if(this.mailcowModeIsProduction()&&!rows) throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng; không thể cập nhật hộp thư');
    if(rows&&!rows.length) throw new NotFoundException('Mailbox not found');
    try {
      await this.mailcow.editMailbox(existing.address,next.quotaGb,next.status);
    } catch(error) {
      if(rows) await this.database.query('update mailboxes set quota_gb=$3,status=$4 where id=$1::uuid and tenant_id=$2::uuid',[id,tenantId,existing.quotaGb,existing.status]).catch(()=>undefined);
      throw new BadRequestException(error instanceof Error?error.message:'Mailcow mailbox update failed');
    }
    const mailbox=rows?.[0]??Object.assign(existing,next);
    await this.record('mailbox.update',id,tenantId,actorEmail);
    return mailbox;
  }
  async resetMailboxPassword(tenantId:string,id:string,actorEmail='system') {
    const rows=await this.database.query<{address:string}>('select address from mailboxes where id=$1::uuid and tenant_id=$2::uuid',[id,tenantId]);
    if(this.mailcowModeIsProduction()&&!rows) throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng; không thể đặt lại mật khẩu');
    const existing=rows?.[0]??this.mailboxes.find(mailbox=>mailbox.id===id&&mailbox.tenantId===tenantId);
    if(!existing) throw new NotFoundException('Không tìm thấy hộp thư');
    const temporaryPassword=randomBytes(18).toString('base64url')+'A1!';
    try { await this.mailcow.editMailbox(existing.address,undefined,undefined,temporaryPassword); }
    catch(error) { throw new BadRequestException(error instanceof Error?error.message:'Không thể đặt lại mật khẩu hộp thư'); }
    await this.record('mailbox.password_reset',id,tenantId,actorEmail);
    return {address:existing.address,temporaryPassword};
  }

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


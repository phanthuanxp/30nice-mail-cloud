import {BadRequestException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {DatabaseService} from './database.service';
import {MailcowService} from './mailcow.service';
import {promises as dns} from 'node:dns';
import {randomBytes,randomInt,scryptSync} from 'node:crypto';
type Tenant={id:string;name:string;slug:string;createdAt:string};
type Domain={id:string;tenantId:string;domain:string;status:'pending'|'verified'};
type Mailbox={id:string;tenantId:string;address:string;quotaGb:number;status:'active'|'disabled'};

@Injectable()
export class MailCloudService {
  constructor(private readonly database: DatabaseService, private readonly mailcow: MailcowService) {}
  private readonly tenants: Tenant[]=[{id:'tenant-30nice',name:'30 NICE',slug:'30nice',createdAt:new Date().toISOString()},{id:'tenant-gofor',name:'GoForVietnam',slug:'goforvietnam',createdAt:new Date().toISOString()}];
  private readonly domains: Domain[]=[{id:'domain-30nice',tenantId:'tenant-30nice',domain:'30nice.vn',status:'pending'},{id:'domain-gofor',tenantId:'tenant-gofor',domain:'goforvietnam.com',status:'pending'}];
  private readonly mailboxes: Mailbox[]=[];
  private readonly audit:Array<Record<string,string>>=[];

  async listTenants(role?: string,tenantId?: string){if(role!=='super_admin'&&!(role==='tenant_admin'&&tenantId)) throw new ForbiddenException('Super Admin or scoped Tenant Admin role required'); await this.database.ensureSeed(); const rows=await this.database.query<{id:string;name:string;slug:string;created_at:string}>('select id::text,name,slug,created_at::text from tenants where ($1 = \'super_admin\' or id=$2::uuid) order by created_at', [role,tenantId??null]); return rows??(role==='super_admin'?this.tenants:this.tenants.filter(t=>t.id===tenantId));}
  async listAudit(role?: string){if(role!=='super_admin') throw new ForbiddenException('Super Admin role required'); const rows=await this.database.query('select id::text,tenant_id::text as "tenantId",action,resource_type as "resourceType",resource_id as "resourceId",request_id as "requestId",created_at as "createdAt" from audit_logs order by created_at desc limit 100'); return rows??this.audit;}
  async createTenant(body:{name?:string;slug?:string},requestId?:string){if(!body.name||!body.slug) throw new BadRequestException('name and slug are required'); if(this.tenants.some(t=>t.slug===body.slug)) throw new BadRequestException('slug already exists'); const rows=await this.database.query<{id:string;name:string;slug:string;created_at:string}>('insert into tenants(name,slug) values($1,$2) returning id::text,name,slug,created_at::text',[body.name,body.slug]); const tenant=rows?.[0]??{id:`tenant-${Date.now()}`,name:body.name,slug:body.slug,createdAt:new Date().toISOString()}; if(!rows) this.tenants.push(tenant as Tenant); this.record('tenant.create',tenant.id,requestId); return tenant;}
  async assertTenant(tenantId:string,scope?:string){if(scope && scope!==tenantId) throw new ForbiddenException('Cross-tenant access denied'); const rows=await this.database.query<{id:string;status:string}>('select id::text,status from tenants where id=$1::uuid',[tenantId]); if(rows && !rows.length) throw new NotFoundException('Tenant not found'); if(rows?.[0]?.status!=='active') throw new ForbiddenException('Tenant đang tạm ngưng hoạt động'); if(!rows && !this.tenants.some(t=>t.id===tenantId)) throw new NotFoundException('Tenant not found'); return tenantId;}
  async listDomains(tenantId:string){const rows=await this.database.query('select id::text,tenant_id::text as "tenantId",domain,status from domains where tenant_id=$1::uuid order by domain',[tenantId]); return rows??this.domains.filter(d=>d.tenantId===tenantId);}
  async createMember(tenantId:string,body:{email?:string;password?:string;role?:'tenant_admin'|'mailbox_user'}){const email=body.email?.trim().toLowerCase();if(!email||!/^\S+@\S+\.\S+$/.test(email)||!body.password||body.password.length<12) throw new BadRequestException('Cần email hợp lệ và mật khẩu tối thiểu 12 ký tự');if(this.mailcowModeIsProduction()&&!this.databaseReady())throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng; không thể tạo thành viên');const role=body.role??'tenant_admin';const salt=randomBytes(16).toString('hex');const hash=`scrypt$${salt}$${scryptSync(body.password,salt,32).toString('hex')}`;const rows=await this.database.query('insert into tenant_members(tenant_id,email,password_hash,role) values($1::uuid,$2,$3,$4) returning id::text,tenant_id::text as "tenantId",email,role,status',[tenantId,email,hash,role]);if(rows){this.record('member.create',String((rows[0] as {id:string}).id));return rows[0];}return {tenantId,email,role,status:'active'};}
  async listMembers(tenantId:string){return await this.database.query('select id::text,email,role,status,created_at as "createdAt" from tenant_members where tenant_id=$1::uuid order by email',[tenantId])??[];}
  async dnsHealth(tenantId:string,domainId:string){const domains=await this.listDomains(tenantId);const domain=domains.find((item:{id?:string;domain?:string})=>item.id===domainId);if(!domain) throw new NotFoundException('Domain not found');const name=domain.domain as string;const read=async(fn:()=>Promise<unknown>)=>{try{return {ok:true,value:await fn()};}catch{return {ok:false,value:null};}};const [mx,txt,cname]=await Promise.all([read(()=>dns.resolveMx(name)),read(()=>dns.resolveTxt(name)),read(()=>dns.resolveCname(`autoconfig.${name}`))]);const txtRows=(txt.value as string[][]|null)?.flat()??[];const dmarc=await read(()=>dns.resolveTxt(`_dmarc.${name}`));const dkim=await read(()=>dns.resolveTxt(`dkim._domainkey.${name}`));return {domain:name,checks:{mx:{ok:mx.ok&&((mx.value as Array<{exchange:string}>|null)?.some(item=>item.exchange.replace(/\.$/,'')==='mx.30nice.vn')??false),value:mx.value},spf:{ok:txtRows.some(value=>value.startsWith('v=spf1')),value:txtRows.filter(value=>value.startsWith('v=spf1'))},dmarc:{ok:dmarc.ok&&((dmarc.value as string[][]|null)?.flat().some(value=>value.startsWith('v=DMARC1'))??false),value:dmarc.value},dkim:{ok:dkim.ok&&((dkim.value as string[][]|null)?.flat().some(value=>value.startsWith('v=DKIM1'))??false),value:dkim.value},autoconfig:{ok:cname.ok,value:cname.value}},checkedAt:new Date().toISOString()};}
  async createDomain(tenantId:string,body:{domain?:string}){
    if(!body.domain||!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(body.domain)) throw new BadRequestException('Tên miền không hợp lệ');
    if(this.mailcowModeIsProduction()&&!this.databaseReady()) throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng; không thể thêm tên miền');
    const value=body.domain.toLowerCase();
    const existingRows=await this.database.query<{id:string;tenantId:string;domain:string;status:string;verification_token:string}>(
      'select id::text,tenant_id::text as "tenantId",domain,status,verification_token from domains where domain=$1',[value],
    );
    const existing=existingRows?.[0]??(!existingRows?this.domains.find(item=>item.domain===value):undefined);
    if(existing&&existing.tenantId!==tenantId) throw new BadRequestException('Tên miền này đã được một khách hàng khác đăng ký');
    if(existing){
      try { await this.mailcow.ensureDomain(value); }
      catch(error){ this.record('domain.provision_retry_failed',existing.id); throw new BadRequestException(error instanceof Error?error.message:'Mailcow domain provisioning failed'); }
      this.record('domain.provision_retry',existing.id);
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
    catch(error){ this.record('domain.provision_failed',domain.id); throw new BadRequestException(error instanceof Error?error.message:'Mailcow domain provisioning failed'); }
    this.record('domain.create',domain.id);
    return domain;
  }
  async verifyDomain(tenantId:string,domainId:string,token:string){const candidates=await this.database.query<{domain:string;verification_token:string}>('select domain,verification_token from domains where id=$1::uuid and tenant_id=$2::uuid and status=\'pending\'',[domainId,tenantId]);const candidate=candidates?.[0];if(!candidate)throw new NotFoundException('Tên miền đang chờ xác minh không tồn tại');if(!token||token!==candidate.verification_token)throw new BadRequestException('Mã xác minh không hợp lệ');let records:string[][];try{records=await dns.resolveTxt(`_30nice-verification.${candidate.domain}`);}catch{throw new BadRequestException(`Chưa tìm thấy TXT tại _30nice-verification.${candidate.domain}`);}if(!records.some(record=>record.join('')===candidate.verification_token))throw new BadRequestException('Bản ghi TXT xác minh chưa khớp');const rows=await this.database.query('update domains set status=\'verified\' where id=$1::uuid and tenant_id=$2::uuid and status=\'pending\' returning id::text,tenant_id::text as "tenantId",domain,status',[domainId,tenantId]);if(!rows?.length)throw new BadRequestException('Tên miền đã được xác minh hoặc trạng thái đã thay đổi');this.record('domain.verify',domainId);return rows[0];}
  async listMailboxes(tenantId:string){const rows=await this.database.query('select id::text,tenant_id::text as "tenantId",address,quota_gb as "quotaGb",status from mailboxes where tenant_id=$1::uuid order by address',[tenantId]); return rows??this.mailboxes.filter(m=>m.tenantId===tenantId);}
  async listProvisioningJobs(tenantId:string){const rows=await this.database.query('select id::text,tenant_id::text as "tenantId",idempotency_key as "idempotencyKey",job_type as "jobType",status,attempts,last_error as "lastError",created_at as "createdAt",updated_at as "updatedAt" from provisioning_jobs where tenant_id=$1::uuid order by created_at desc limit 100',[tenantId]); return rows??[];}
  async createMailbox(tenantId:string,body:{address?:string;quotaGb?:number;password?:string}) {
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
          'insert into provisioning_jobs(tenant_id,idempotency_key,job_type) values($1::uuid,$2,\'mailbox.provision\') on conflict (idempotency_key) do update set status=\'queued\',last_error=null,updated_at=now() where provisioning_jobs.status in (\'failed\',\'dead_letter\') returning id::text',
          [tenantId,`mailbox:${address}`],
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
      await this.mailcow.addMailbox(domain,localPart,quota,password);
    } catch(error) {
      if(rows) {
        await this.database.query('delete from mailboxes where id=$1::uuid and tenant_id=$2::uuid',[mailbox.id,tenantId]).catch(()=>undefined);
        if(jobId) await this.database.query('update provisioning_jobs set status=\'failed\',attempts=attempts+1,last_error=$3,updated_at=now() where id=$1::uuid and tenant_id=$2::uuid',[jobId,tenantId,error instanceof Error?error.message:'Mailcow mailbox provisioning failed']).catch(()=>undefined);
      } else {
        this.mailboxes.push(mailbox as Mailbox);
      }
      this.record('mailbox.provision_failed',address);
      throw new BadRequestException(error instanceof Error?error.message:'Mailcow mailbox provisioning failed');
    }
    if(!rows) this.mailboxes.push(mailbox as Mailbox);
    if(jobId) await this.database.query('update provisioning_jobs set status=\'succeeded\',attempts=attempts+1,last_error=null,updated_at=now() where id=$1::uuid and tenant_id=$2::uuid',[jobId,tenantId]).catch(()=>undefined);
    this.record('mailbox.create',mailbox.id);
    return {...mailbox,provisioningJobId:jobId,provisioningStatus:jobId?'succeeded':'local-only',temporaryPassword:body.password?undefined:password};
  }
  private mailcowModeIsProduction(){return process.env.MAIL_ADAPTER_MODE==='production';}
  private databaseReady(){return Boolean(process.env.DATABASE_URL);}
  async updateMailbox(tenantId:string,id:string,body:{quotaGb?:number;status?:'active'|'disabled'}) {
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
    this.record('mailbox.update',id);
    return mailbox;
  }
  async resetMailboxPassword(tenantId:string,id:string) {
    const rows=await this.database.query<{address:string}>('select address from mailboxes where id=$1::uuid and tenant_id=$2::uuid',[id,tenantId]);
    if(this.mailcowModeIsProduction()&&!rows) throw new BadRequestException('Cơ sở dữ liệu chưa sẵn sàng; không thể đặt lại mật khẩu');
    const existing=rows?.[0]??this.mailboxes.find(mailbox=>mailbox.id===id&&mailbox.tenantId===tenantId);
    if(!existing) throw new NotFoundException('Không tìm thấy hộp thư');
    const temporaryPassword=randomBytes(18).toString('base64url')+'A1!';
    try { await this.mailcow.editMailbox(existing.address,undefined,undefined,temporaryPassword); }
    catch(error) { throw new BadRequestException(error instanceof Error?error.message:'Không thể đặt lại mật khẩu hộp thư'); }
    this.record('mailbox.password_reset',id);
    return {address:existing.address,temporaryPassword};
  }
  private record(action:string,resourceId:string,requestId?:string){this.audit.push({action,resourceId,requestId:requestId??'system',createdAt:new Date().toISOString()}); void this.database.query('insert into audit_logs(action,resource_type,resource_id,request_id) values($1,$2,$3,$4)',[action,action.split('.')[0],resourceId,requestId??'system']).catch(()=>undefined);}
  databaseStatus(){return this.database.status();}
}


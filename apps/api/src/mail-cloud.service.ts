import {BadRequestException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {DatabaseService} from './database.service';
type Tenant={id:string;name:string;slug:string;createdAt:string};
type Domain={id:string;tenantId:string;domain:string;status:'pending'|'verified'};
type Mailbox={id:string;tenantId:string;address:string;quotaGb:number;status:'active'|'disabled'};

@Injectable()
export class MailCloudService {
  constructor(private readonly database: DatabaseService) {}
  private readonly tenants: Tenant[]=[{id:'tenant-30nice',name:'30 NICE',slug:'30nice',createdAt:new Date().toISOString()},{id:'tenant-gofor',name:'GoForVietnam',slug:'goforvietnam',createdAt:new Date().toISOString()}];
  private readonly domains: Domain[]=[{id:'domain-30nice',tenantId:'tenant-30nice',domain:'30nice.vn',status:'pending'},{id:'domain-gofor',tenantId:'tenant-gofor',domain:'goforvietnam.com',status:'pending'}];
  private readonly mailboxes: Mailbox[]=[];
  private readonly audit:Array<Record<string,string>>=[];

  listTenants(role?: string,tenantId?: string){if(role==='super_admin') return this.tenants; if(role==='tenant_admin'&&tenantId) return this.tenants.filter(t=>t.id===tenantId); throw new ForbiddenException('Super Admin or scoped Tenant Admin role required');}
  listAudit(role?: string){if(role!=='super_admin') throw new ForbiddenException('Super Admin role required'); return this.audit;}
  createTenant(body:{name?:string;slug?:string},requestId?:string){if(!body.name||!body.slug) throw new BadRequestException('name and slug are required'); if(this.tenants.some(t=>t.slug===body.slug)) throw new BadRequestException('slug already exists'); const tenant={id:`tenant-${Date.now()}`,name:body.name,slug:body.slug,createdAt:new Date().toISOString()}; this.tenants.push(tenant); this.record('tenant.create',tenant.id,requestId); return tenant;}
  assertTenant(tenantId:string,scope?:string){if(scope && scope!==tenantId) throw new ForbiddenException('Cross-tenant access denied'); if(!this.tenants.some(t=>t.id===tenantId)) throw new NotFoundException('Tenant not found'); return tenantId;}
  listDomains(tenantId:string){return this.domains.filter(d=>d.tenantId===tenantId);}
  createDomain(tenantId:string,body:{domain?:string}){if(!body.domain||!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(body.domain)) throw new BadRequestException('valid domain is required'); if(this.domains.some(d=>d.domain.toLowerCase()===body.domain!.toLowerCase())) throw new BadRequestException('domain already exists'); const domain={id:`domain-${Date.now()}`,tenantId,domain:body.domain.toLowerCase(),status:'pending' as const}; this.domains.push(domain); this.record('domain.create',domain.id); return domain;}
  listMailboxes(tenantId:string){return this.mailboxes.filter(m=>m.tenantId===tenantId);}
  createMailbox(tenantId:string,body:{address?:string;quotaGb?:number}){const quota=body.quotaGb??5; if(!body.address||!body.address.includes('@')||quota<=0||quota>1000) throw new BadRequestException('address and quotaGb (1-1000) are required'); if(this.mailboxes.some(m=>m.address.toLowerCase()===body.address!.toLowerCase())) throw new BadRequestException('mailbox already exists'); const mailbox={id:`mailbox-${Date.now()}`,tenantId,address:body.address.toLowerCase(),quotaGb:quota,status:'active' as const}; this.mailboxes.push(mailbox); this.record('mailbox.create',mailbox.id); return mailbox;}
  updateMailbox(tenantId:string,id:string,body:{quotaGb?:number;status?:'active'|'disabled'}){const mailbox=this.mailboxes.find(m=>m.id===id&&m.tenantId===tenantId); if(!mailbox) throw new NotFoundException('Mailbox not found'); if(body.quotaGb!==undefined&&(body.quotaGb<=0||body.quotaGb>1000)) throw new BadRequestException('quotaGb must be 1-1000'); Object.assign(mailbox,body); this.record('mailbox.update',id); return mailbox;}
  private record(action:string,resourceId:string,requestId?:string){this.audit.push({action,resourceId,requestId:requestId??'system',createdAt:new Date().toISOString()});}
  databaseStatus(){return this.database.status();}
}

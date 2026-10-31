import {Injectable} from '@nestjs/common';
export type AdapterMode='mock'|'dry-run'|'production';
@Injectable()
export class MailcowService {
  private readonly baseUrl=(process.env.MAILCOW_API_URL||'').replace(/\/$/,'');
  private readonly apiKey=process.env.MAILCOW_API_KEY||'';
  private readonly mode=(process.env.MAIL_ADAPTER_MODE||'mock') as AdapterMode;
  async health(){
    if(this.mode==='mock') return {mode:'mock' as const,healthy:true,configured:false};
    if(!this.baseUrl||!this.apiKey) return {mode:this.mode,healthy:false,configured:false};
    try { const response=await fetch(`${this.baseUrl}/api/v1/get/domain/all`,{headers:{'X-API-Key':this.apiKey},signal:AbortSignal.timeout(5000)}); return {mode:this.mode,healthy:response.ok,configured:true,httpStatus:response.status}; }
    catch { return {mode:this.mode,healthy:false,configured:true}; }
  }
  private async request(path:string,body:Record<string,unknown>){
    if(this.mode==='mock') return [{type:'success',msg:'mock'}];
    if(this.mode==='dry-run') return [{type:'success',msg:'dry-run'}];
    if(!this.baseUrl||!this.apiKey) throw new Error('Mailcow API is not configured');
    const response=await fetch(`${this.baseUrl}${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':this.apiKey},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const result=await response.json().catch(()=>[]);
    if(!response.ok) throw new Error(`Mailcow API HTTP ${response.status}`);
    const items=Array.isArray(result)?result:[result];
    if(items.some((item:{type?:string}|null)=>item?.type==='danger'||item?.type==='error')) throw new Error('Mailcow rejected the provisioning request');
    return result;
  }
  async addDomain(domain:string){return this.request('/api/v1/add/domain',{domain,description:'Managed by 30NICE Mail Cloud',aliases:0,mailboxes:0,quota:0,defquota:3072,maxquota:10240,relay_all_recipients:0,relay_unknown_only:0,backupmx:0,gal:0,active:1});}
  async ensureDomain(domain:string){
    if(this.mode==='mock'||this.mode==='dry-run') return this.addDomain(domain);
    if(!this.baseUrl||!this.apiKey) throw new Error('Mailcow API is not configured');
    const response=await fetch(`${this.baseUrl}/api/v1/get/domain/all`,{headers:{'X-API-Key':this.apiKey},signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error(`Mailcow API HTTP ${response.status}`);
    const result=await response.json().catch(()=>null);
    if(!Array.isArray(result)) throw new Error('Mailcow returned an invalid domain list');
    const exists=result.some((item:{domain_name?:string;domain?:string}|null)=>
      (item?.domain_name??item?.domain)?.toLowerCase()===domain.toLowerCase(),
    );
    return exists?[{type:'success',msg:'Domain already exists'}]:this.addDomain(domain);
  }
  async addMailbox(domain:string,localPart:string,quotaGb:number,password:string){return this.request('/api/v1/add/mailbox',{local_part:localPart,domain,password,password2:password,quota:quotaGb*1024,active:1});}
  async provisionMailbox(domain:string,localPart:string,quotaGb:number,password:string,reconcileExisting=false){
    if(this.mode!=='production') return this.addMailbox(domain,localPart,quotaGb,password);
    if(!this.baseUrl||!this.apiKey) throw new Error('Mailcow API is not configured');
    const address=`${localPart}@${domain}`;
    const list=async()=>{
      const response=await fetch(`${this.baseUrl}/api/v1/get/mailbox/all`,{headers:{'X-API-Key':this.apiKey},signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw new Error(`Mailcow API HTTP ${response.status}`);
      const result=await response.json().catch(()=>null);
      if(!Array.isArray(result)) throw new Error('Mailcow returned an invalid mailbox list');
      return result.some((item:{username?:string}|null)=>item?.username?.toLowerCase()===address.toLowerCase());
    };
    const exists=await list();
    if(exists){
      if(!reconcileExisting) throw new Error('Mailbox already exists in Mailcow; use retry to reconcile it');
      return this.editMailbox(address,quotaGb,'active',password);
    }
    try { return await this.addMailbox(domain,localPart,quotaGb,password); }
    catch(error){
      try { if(await list()) return this.editMailbox(address,quotaGb,'active',password); } catch {}
      throw error;
    }
  }
  async editMailbox(address:string,quotaGb?:number,status?:'active'|'disabled',password?:string){return this.request('/api/v1/edit/mailbox',{username:address,quota:quotaGb===undefined?undefined:quotaGb*1024,active:status===undefined?undefined:status==='disabled'?0:1,password,password2:password});}
}


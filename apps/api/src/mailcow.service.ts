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
    try { const response=await fetch(`${this.baseUrl}/api/v1/get/domain/all`,{headers:{'X-API-Key':this.apiKey}}); return {mode:this.mode,healthy:response.ok,configured:true,httpStatus:response.status}; }
    catch { return {mode:this.mode,healthy:false,configured:true}; }
  }
  private async request(path:string,body:Record<string,unknown>){
    if(this.mode==='dry-run') return [{type:'success',msg:'dry-run'}];
    if(!this.baseUrl||!this.apiKey) throw new Error('Mailcow API is not configured');
    const response=await fetch(`${this.baseUrl}${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':this.apiKey},body:JSON.stringify(body)});
    const result=await response.json().catch(()=>[]);
    if(!response.ok) throw new Error(`Mailcow API HTTP ${response.status}`);
    if(Array.isArray(result)&&result.some((item:{type?:string})=>item.type==='danger')) throw new Error('Mailcow rejected the provisioning request');
    return result;
  }
  async addDomain(domain:string){return this.request('/api/v1/add/domain',{domain,description:'Managed by 30NICE Mail Cloud',aliases:0,mailboxes:0,quota:0,defquota:3072,maxquota:10240,realy:1});}
  async addMailbox(domain:string,localPart:string,quotaGb:number,password:string){return this.request('/api/v1/add/mailbox',{local_part:localPart,domain,password,quota:quotaGb,active:1});}
}

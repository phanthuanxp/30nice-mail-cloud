import type {PostfixLine} from './smtp-deliveries';
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
  private async request(path:string,body:Record<string,unknown>|string[]){
    if(this.mode==='mock') return [{type:'success',msg:'mock'}];
    if(this.mode==='dry-run') return [{type:'success',msg:'dry-run'}];
    if(!this.baseUrl||!this.apiKey) throw new Error('Mailcow API is not configured');
    const response=await fetch(`${this.baseUrl}${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':this.apiKey},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const result=await response.json().catch(()=>[]);
    if(!response.ok) throw new Error(`Mailcow API HTTP ${response.status}`);
    const items=Array.isArray(result)?result:[result];
    if(!items.length||items.some((item:{type?:string}|null)=>!item||item.type!=='success')) throw new Error('Mailcow chưa xác nhận thao tác thành công. Cần kiểm tra lại trạng thái.');
    return result;
  }
  private postfixSnapshot?:{expiresAt:number;request:Promise<PostfixLine[]>};

  postfixLogs(){
    if(this.postfixSnapshot&&this.postfixSnapshot.expiresAt>Date.now())return this.postfixSnapshot.request;
    const request=this.fetchPostfixLogs().catch(error=>{
      if(this.postfixSnapshot?.request===request)this.postfixSnapshot=undefined;
      throw error;
    });
    this.postfixSnapshot={expiresAt:Date.now()+15000,request};
    return request;
  }

  private async fetchPostfixLogs():Promise<PostfixLine[]>{
    if(this.mode!=='production'||!this.baseUrl||!this.apiKey)throw new Error('Mailcow chưa sẵn sàng.');
    const response=await fetch(`${this.baseUrl}/api/v1/get/logs/postfix/5000`,{
      headers:{'X-API-Key':this.apiKey},signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)throw new Error('Không tải được nhật ký Postfix.');
    const data=await response.json();
    if(data&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).length===0)return [];
    if(!Array.isArray(data))throw new Error('Nhật ký Postfix không hợp lệ.');
    return data.slice(0,5000);
  }

  async smtpPasswords(address:string){
    if(this.mode!=='production'||!this.baseUrl||!this.apiKey)throw new Error('Mailcow chưa sẵn sàng.');
    const response=await fetch(`${this.baseUrl}/api/v1/get/app-passwd/all/${encodeURIComponent(address)}`,{
      headers:{'X-API-Key':this.apiKey},signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)throw new Error('Không đọc được mật khẩu SMTP.');
    const rows=await response.json();
    if(rows&&typeof rows==='object'&&!Array.isArray(rows)&&Object.keys(rows).length===0)return [];
    if(!Array.isArray(rows))throw new Error('Danh sách mật khẩu SMTP không hợp lệ.');
    return rows.flatMap(row=>{
      const name=typeof row?.name==='string'?row.name.match(/^30NICE SMTP [a-f0-9]{16} (.+)$/):null;
      if(!name||row.mailbox!==address||!/^\d+$/.test(String(row.id))||Number(row.smtp_access)!==1)return [];
      return [{id:String(row.id),name:name[1],active:Number(row.active)===1}];
    });
  }
  async addSmtpPassword(address:string,name:string,password:string){
    if(this.mode!=='production')throw new Error('Mailcow chưa sẵn sàng.');
    await this.request('/api/v1/add/app-passwd',{
      username:address,app_name:name,app_passwd:password,app_passwd2:password,active:1,protocols:['smtp_access'],
    });
  }
  async revokeSmtpPassword(id:string){
    await this.request('/api/v1/delete/app-passwd',[id]);
  }
  async getDkim(domain:string):Promise<{selector:string;value:string}|null>{
    if(this.mode!=='production')return null;
    if(!this.baseUrl||!this.apiKey)throw new Error('Chưa cấu hình kết nối Mailcow');
    const r=await fetch(`${this.baseUrl}/api/v1/get/dkim/${encodeURIComponent(domain)}`,{headers:{'X-API-Key':this.apiKey},signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error('Không đọc được khóa DKIM từ Mailcow');
    const data=await r.json();
    if(data===null||data===false||(typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).length===0))return null;
    if(typeof data?.dkim_selector!=='string'||!/^[a-zA-Z0-9_-]{1,63}$/.test(data.dkim_selector)||typeof data?.dkim_txt!=='string'||!/(?:^|;)\s*p=[A-Za-z0-9+/=]+/.test(data.dkim_txt))throw new Error('Mailcow chưa trả về khóa DKIM hợp lệ');
    return {selector:data.dkim_selector,value:data.dkim_txt};
  }
  async ensureDkim(domain:string){
    const current=await this.getDkim(domain);if(current)return current;
    if(this.mode!=='production')return null;
    await this.request('/api/v1/add/dkim',{domains:domain,dkim_selector:'dkim',key_size:2048});
    const created=await this.getDkim(domain);if(!created)throw new Error('Chưa tạo được khóa DKIM');return created;
  }
  async addDomain(domain:string){return this.request('/api/v1/add/domain',{domain,description:'Managed by 30NICE Mail Cloud',aliases:400,mailboxes:10,quota:10240,defquota:3072,maxquota:10240,relay_all_recipients:0,relay_unknown_only:0,backupmx:0,gal:0,active:1});}
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
  async setDomainLimits(domain:string,storageGb:number,mailboxes:number,maxMailboxGb:number){
    await this.request('/api/v1/edit/domain',{items:[domain],attr:{quota:storageGb*1024,mailboxes,maxquota:maxMailboxGb*1024,defquota:Math.min(3,maxMailboxGb,storageGb)*1024}});
    if(this.mode==='production'){const d=await this.getDomain(domain);if(!d||Number(d.max_quota_for_domain)!==storageGb*1024**3||Number(d.max_num_mboxes_for_domain)!==mailboxes||Number(d.max_quota_for_mbox)!==maxMailboxGb*1024**3)throw new Error('Chưa xác nhận được hạn mức tên miền.');}
  }
  async addMailbox(domain:string,localPart:string,quotaGb:number,password:string){return this.request('/api/v1/add/mailbox',{local_part:localPart,domain,password,password2:password,quota:quotaGb*1024,active:1});}
  async getDomains(){
    if(this.mode!=='production')return [];
    const r=await fetch(`${this.baseUrl}/api/v1/get/domain/all`,{headers:{'X-API-Key':this.apiKey},signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error('Không đọc được tên miền từ Mailcow');const data=await r.json();if(data&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).length===0)return [];if(!Array.isArray(data))throw new Error('Danh sách tên miền Mailcow không hợp lệ');return data;
  }
  async getDomain(domain:string){return (await this.getDomains()).find((d:{domain_name?:string})=>d.domain_name?.toLowerCase()===domain.toLowerCase())??null;}
  async getMailboxes(domain?:string){
    if(this.mode!=='production')return [];
    const r=await fetch(`${this.baseUrl}/api/v1/get/mailbox/all`,{headers:{'X-API-Key':this.apiKey},signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error('Không đọc được hộp thư từ Mailcow');const data=await r.json();if(data&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).length===0)return [];if(!Array.isArray(data))throw new Error('Danh sách hộp thư Mailcow không hợp lệ');
    return data.map((m:{username:string;quota:number;quota_used:number;active:number})=>{if(typeof m?.username!=='string'||!m.username.includes('@')||!Number.isFinite(Number(m.quota))||Number(m.quota)<0||![0,1].includes(Number(m.active)))throw new Error('Dữ liệu hạn mức Mailcow không hợp lệ.');return {address:m.username.toLowerCase(),quotaBytes:Number(m.quota),usedBytes:Number(m.quota_used)||0,active:Number(m.active)===1};}).filter(m=>!domain||m.address.endsWith('@'+domain.toLowerCase()));
  }
  async provisionMailbox(domain:string,localPart:string,quotaGb:number,password:string,reconcileExisting=false){
    if(this.mode!=='production')return this.addMailbox(domain,localPart,quotaGb,password);
    const address=`${localPart}@${domain}`;const exists=async()=> (await this.getMailboxes(domain)).find(m=>m.address===address.toLowerCase());
    if(await exists()){if(!reconcileExisting)throw new Error('Hộp thư đã có trong Mailcow. Hãy đối soát trước khi tạo.');return {reconciled:true};}
    try{await this.addMailbox(domain,localPart,quotaGb,password);}catch(error){if(await exists())return {reconciled:true};throw error;}
    const confirmed=await exists();if(!confirmed)throw new Error('Mailcow chưa hiển thị hộp thư vừa tạo.');
    return {reconciled:false};
  }
  async editMailbox(address:string,quotaGb?:number,status?:'active'|'disabled',password?:string){
    const result=await this.request('/api/v1/edit/mailbox',{items:[address],attr:{quota:quotaGb===undefined?undefined:quotaGb*1024,active:status===undefined?undefined:status==='disabled'?0:1,password,password2:password}});
    if(this.mode==='production'&&(quotaGb!==undefined||status!==undefined)){
      const found=(await this.getMailboxes(address.split('@')[1])).find(m=>m.address===address.toLowerCase());
      if(!found||(quotaGb!==undefined&&found.quotaBytes!==quotaGb*1024**3)||(status!==undefined&&found.active!==(status==='active')))throw new Error('Mailcow chưa khớp cấu hình yêu cầu; cần đối soát lại.');
    }
    return result;
  }
  private async findAlias(address:string,destination:string){
    if(this.mode!=='production') return null;
    if(!this.baseUrl||!this.apiKey) throw new Error('Mailcow API is not configured');
    const response=await fetch(`${this.baseUrl}/api/v1/get/alias/all`,{headers:{'X-API-Key':this.apiKey},signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error('Không đọc được danh sách bí danh từ Mailcow');
    const rows=await response.json();
    if(!Array.isArray(rows)) throw new Error('Mailcow trả danh sách bí danh không hợp lệ');
    const row=rows.find((item:{address?:string})=>item?.address?.toLowerCase()===address.toLowerCase());
    if(row&&String(row.goto).trim().toLowerCase()!==destination.toLowerCase())
      throw new Error('Bí danh đã có đích nhận khác trong Mailcow; cần kiểm tra thủ công');
    if(row&&!/^\d+$/.test(String(row.id))) throw new Error('ID bí danh Mailcow không hợp lệ');
    return row??null;
  }
  async ensureAlias(address:string,destination:string){
    const existing=await this.findAlias(address,destination);
    if(existing)return existing;
    try{return await this.request('/api/v1/add/alias',{address,goto:destination,active:1});}
    catch(error){const reconciled=await this.findAlias(address,destination);if(reconciled)return reconciled;throw error;}
  }
  async setAliasActive(address:string,destination:string,active:boolean){
    if(this.mode!=='production') return [{type:'success',msg:this.mode}];
    const row=await this.findAlias(address,destination);
    if(!row)throw new Error('Không tìm thấy bí danh trong Mailcow');
    return this.request('/api/v1/edit/alias',{items:[String(row.id)],attr:{active:active?1:0}});
  }

}


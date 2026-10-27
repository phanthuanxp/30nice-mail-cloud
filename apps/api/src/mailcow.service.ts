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
}

import {Resolver} from 'node:dns/promises';
import {connect} from 'node:tls';

export const MAIL_IP='5.189.185.36';
export const MAIL_HOST='mx.30nice.vn';
export const validDomain=(name:string)=>name.length<=253&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name);
export type Dkim={selector:string;value:string};
export type DnsRecord={id:string;type:string;host:string;value:string;group:'required'|'webmail'|'optional';help:string;priority?:number};
export type Check={ok:boolean;state:'ok'|'missing'|'review'|'error';message:string;actual:string[]};
export function tags(value:string){return Object.fromEntries(value.split(';').map(x=>x.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2).map(([k,v])=>[k.toLowerCase(),v.trim()]));}
function uniqueTags(value:string){const parts=value.split(';').map(x=>x.trim()).filter(Boolean);const names=parts.map(x=>x.split('=')[0].trim().toLowerCase());return parts.every(x=>/^[a-z][a-z0-9_]*\s*=/i.test(x))&&new Set(names).size===names.length;}
export function recordsFor(domain:string,token:string|null,dkim:Dkim|null):DnsRecord[]{
 return [
  ...(token?[{id:'ownership',type:'TXT',host:'_30nice-verification',value:token,group:'required' as const,help:'Xác minh quyền sở hữu tên miền. Giữ bản ghi này sau khi xác minh.'}]:[]),
  {id:'mx',type:'MX',host:'@',value:MAIL_HOST,priority:10,group:'required',help:'Nhận thư qua 30NICE. Chỉ thay MX khi đã sẵn sàng chuyển dịch vụ email.'},
  {id:'spf',type:'TXT',host:'@',value:`v=spf1 ip4:${MAIL_IP} -all`,group:'required',help:'Chỉ dùng một bản SPF. Nếu đang gửi qua dịch vụ khác, cần hợp nhất nguồn gửi trước khi sửa.'},
  {id:'dkim',type:'TXT',host:`${dkim?.selector||'dkim'}._domainkey`,value:dkim?.value||'',group:'required',help:'Chữ ký thư riêng của tên miền; lấy trực tiếp từ hệ thống, không dùng khóa của tên miền khác.'},
  {id:'dmarc',type:'TXT',host:'_dmarc',value:'v=DMARC1; p=none',group:'required',help:'Khởi đầu bằng chế độ theo dõi. Giữ chính sách quarantine/reject hiện có nếu đã cấu hình đúng.'},
  {id:'webmail',type:'CNAME',host:'mail',value:'mail.30nice.vn',group:'webmail',help:'Trang đăng nhập riêng. A trỏ đúng IP cũng được chấp nhận; không thêm CNAME nếu mail đã có A.'},
  ...['autoconfig','autodiscover'].map(host=>({id:host,type:'CNAME',host,value:MAIL_HOST,group:'optional' as const,help:'Hỗ trợ ứng dụng thư tự nhận cấu hình; không bắt buộc khi dùng webmail. HTTPS của hostname ứng dụng cần được kiểm tra riêng.'})),
 ];
}
export async function inspectDns(domain:string,token:string|null,dkim:Dkim|null,resolver=new Resolver({timeout:3000,tries:1})){
 const read=async<T>(fn:()=>Promise<T>)=>{try{return {value:await fn(),error:''};}catch(e){const code=(e as {code?:string}).code||'UNKNOWN';return {value:null,error:['ENODATA','ENOTFOUND'].includes(code)?'missing':'error'};}};
 const txt=async(name:string)=>{const r=await read(()=>resolver.resolveTxt(name));return {value:r.value?.map(x=>x.join(''))||[],error:r.error};};
 const [mx,spf,dm,dk,own,auto,discover,a,aaaa]=await Promise.all([
  read(()=>resolver.resolveMx(domain)),txt(domain),txt(`_dmarc.${domain}`),txt(`${dkim?.selector||'dkim'}._domainkey.${domain}`),txt(`_30nice-verification.${domain}`),
  read(()=>resolver.resolveCname(`autoconfig.${domain}`)),read(()=>resolver.resolveCname(`autodiscover.${domain}`)),read(()=>resolver.resolve4(`mail.${domain}`)),read(()=>resolver.resolve6(`mail.${domain}`)),
 ]);
 const checks:Record<string,Check>={};
 const result=(id:string,ok:boolean,actual:string[],error:string,message:string)=>checks[id]={ok,state:ok?'ok':error==='error'?'error':actual.length?'review':'missing',message:ok?'Đã đúng':error==='error'?'Không truy vấn được DNS. Hãy thử lại.':message,actual};
 const exchanges=mx.value?.map(x=>x.exchange.toLowerCase().replace(/\.$/,''))||[];
 const mxOk=exchanges.length>0&&exchanges.every(x=>x===MAIL_HOST);
 result('mx',mxOk,exchanges,mx.error,'Cần MX trỏ về mx.30nice.vn; kiểm tra MX dịch vụ cũ trước khi chuyển.');
 const spfs=spf.value.filter(x=>/^v=spf1(?:\s|$)/i.test(x));
 const parts=(spfs[0]||'').toLowerCase().split(/\s+/);
 const allowed=new Set(['v=spf1','mx','a',`ip4:${MAIL_IP}`,'-all','~all']);
 const spfOk=spfs.length===1&&parts.every(x=>allowed.has(x))&&['-all','~all'].includes(parts.at(-1)||'')&&(parts.includes(`ip4:${MAIL_IP}`)||(parts.includes('mx')&&mxOk));
 result('spf',spfOk,spfs,spf.error,spfs.length>1?'Có nhiều bản SPF; cần hợp nhất thành một bản.':'Cần kiểm tra nguồn gửi trong SPF. Không ghi đè nếu còn gửi qua dịch vụ khác.');
 const dms=dm.value.filter(x=>/^v=DMARC1\s*;/i.test(x));
 result('dmarc',dms.length===1&&uniqueTags(dms[0])&&['none','quarantine','reject'].includes(tags(dms[0]||'').p),dms,dm.error,'Cần một bản DMARC có chính sách p=none, quarantine hoặc reject.');
 const dks=dk.value.filter(x=>Boolean(tags(x).p));
 result('dkim',Boolean(dkim)&&dks.length===1&&uniqueTags(dks[0])&&(!tags(dks[0]).v||tags(dks[0]).v==='DKIM1')&&tags(dks[0]).p===tags(dkim!.value).p&&(tags(dks[0]).k||'rsa')==='rsa',dk.value,dk.error,dkim?'DKIM chưa khớp khóa đang dùng; sao chép đầy đủ giá trị bên dưới.':'Chưa đọc được khóa DKIM. Bấm Chuẩn bị DNS sau khi xác minh tên miền.');
 result('ownership',Boolean(token)&&own.value.includes(token!),own.value,own.error,'Thêm TXT xác minh đúng mã riêng của tên miền.');
 for(const [id,r] of [['autoconfig',auto],['autodiscover',discover]] as const)result(id,Boolean(r.value?.some(x=>x.toLowerCase().replace(/\.$/,'')===MAIL_HOST)),r.value||[],r.error,'Tùy chọn: thêm CNAME về mx.30nice.vn nếu dùng ứng dụng thư.');
 const ips=a.value||[];
 result('webmail',ips.length>0&&ips.every(x=>x===MAIL_IP)&&!aaaa.value?.length&&!([a.error,aaaa.error].includes('error')),ips.concat(aaaa.value||[]),a.error==='error'||aaaa.error==='error'?'error':'','Trỏ mail về mail.30nice.vn hoặc IP 5.189.185.36. Không để AAAA khi chưa hỗ trợ IPv6.');
 return checks;
}
export function checkWebmailTls(host:string):Promise<boolean>{
 return new Promise(resolve=>{let done=false;const finish=(ok:boolean)=>{if(done)return;done=true;socket.destroy();resolve(ok);};
  const socket=connect({host:MAIL_IP,port:443,servername:host,rejectUnauthorized:true},()=>finish(socket.authorized));
  socket.setTimeout(5000,()=>finish(false));socket.once('error',()=>finish(false));
 });
}

'use client';
import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,Info,RefreshCw,Download,ExternalLink} from 'lucide-react';
import DnsCopyButton from './DnsCopyButton';
import './dns-setup.css';
type Check={ok:boolean;state:string;message:string;actual:string[]};
type RecordRow={id:string;type:string;host:string;value:string;group:'required'|'webmail'|'optional';help:string;priority?:number};
type Setup={domain:string;status:string;checks:Record<string,Check>;records:RecordRow[];webmail:{host:string;url:string;ready:boolean;activation:{state:string;message:string;updatedAt?:string}};checkedAt:string};
export default function DnsSetupPanel({tenantId,domainId}:{tenantId:string;domainId:string}){
 const [data,setData]=useState<Setup|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [activationPending,setActivationPending]=useState(false);const activationStarted=useRef(0);
 const seq=useRef(0);const base=`/api/api/v1/tenants/${tenantId}/domains/${domainId}`;
 async function request(path:string,post=false,body?:unknown){const r=await fetch(base+path,{method:post?'POST':'GET',headers:post?{'Content-Type':'application/json'}:undefined,body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(typeof result.message==='string'?result.message:'Không hoàn tất yêu cầu. Vui lòng thử lại.');return result;}
 async function load(clearError=true){const id=++seq.current;setBusy(true);if(clearError)setError('');try{const result=await request('/dns-health');if(!Array.isArray(result.records)||!result.webmail)throw Error('Dữ liệu DNS chưa sẵn sàng. Hãy tải lại trang.');if(id===seq.current)setData(result);}catch(e){if(id===seq.current)setError(e instanceof Error?e.message:'Không đọc được DNS.');}finally{if(id===seq.current)setBusy(false);}}
 useEffect(()=>{setData(null);setMessage('');setActivationPending(false);void load();return()=>{seq.current++;};},[base]);
 useEffect(()=>{if(data?.webmail.ready||(data?.webmail.activation.state==='failed'&&Date.parse(data.webmail.activation.updatedAt||'')>=activationStarted.current)||Date.now()-activationStarted.current>600000){if(activationPending)setActivationPending(false);return;}if(!activationPending&&data?.webmail.activation.state!=='running')return;const timer=setTimeout(()=>void load(),5000);return()=>clearTimeout(timer);},[data,activationPending]);
 async function action(kind:'prepare'|'verify'|'activate'){
  const id=++seq.current;setBusy(true);setError('');setMessage('');
  try{
   if(kind==='verify'){
    const token=data?.records.find(r=>r.id==='ownership')?.value;if(!token)throw Error('Bấm Chuẩn bị DNS để lấy mã xác minh.');
    await request('/verify',true,{token});
    if(id===seq.current)setMessage('Đã xác minh quyền sở hữu. Bấm Chuẩn bị DNS để lấy khóa DKIM.');
   }else if(kind==='prepare'){await request('/dns-setup',true);if(id===seq.current)setMessage('Đã chuẩn bị bản ghi DNS riêng cho tên miền.');}
   else{const result=await request('/webmail-activate',true);if(id===seq.current){setMessage(result.message);activationStarted.current=Date.now();setActivationPending(true);}}
  }catch(e){if(id===seq.current)setError(e instanceof Error?e.message:'Không hoàn tất yêu cầu.');}
  finally{if(id===seq.current){setBusy(false);void load(false);}}
 }
 function download(){if(!data)return;const text=[`HƯỚNG DẪN DNS 30NICE — ${data.domain}`,'Nhập tên rút gọn nếu nhà cung cấp tự nối tên miền. TTL: 300 giây.','Không thay bản SPF hiện có nếu chưa hợp nhất các nguồn gửi. Không thêm CNAME mail trùng A.','',...data.records.map(r=>`${r.group==='optional'?'TÙY CHỌN':r.group==='webmail'?'WEBMAIL RIÊNG':'CẦN THIẾT'} | ${r.type} | ${r.host} | ${r.value||'Chưa có khóa; xác minh tên miền rồi bấm Chuẩn bị DNS.'}${r.priority===undefined?'':` | Ưu tiên: ${r.priority}`}\n${r.help}`),'',`Đăng nhập: ${data.webmail.url}`,'Cần kích hoạt HTTPS trên 30NICE sau khi DNS mail đã đúng.'].join('\n');const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`huong-dan-dns-${data.domain}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section className="dnsSetup" aria-label="Hướng dẫn DNS tên miền">
  <div className="dnsSetupTop"><div><h3>{data?.domain||'Cấu hình tên miền'}</h3><p>Thêm DNS một lần tại nhà cung cấp tên miền. 30NICE xử lý kết nối và HTTPS.</p></div><div className="dnsSetupActions"><button className="ghost" disabled={busy} onClick={()=>void load()}><RefreshCw size={16} className={busy?'spin':''}/> Kiểm tra DNS</button><button className="ghost" disabled={busy||!data} onClick={download}><Download size={16}/> Tải hướng dẫn</button><button className="primary" disabled={busy} onClick={()=>void action('prepare')}>Chuẩn bị DNS</button></div></div>
  {error&&<p className="dnsSetupError" role="alert">{error}</p>}{message&&<p className="dnsSetupNotice" role="status">{message}</p>}
  {!data&&<p role="status">{busy?'Đang đọc DNS công khai…':'Chưa có kết quả. Bấm Kiểm tra DNS để thử lại.'}</p>}
  {data&&<>
   <div className="dnsSetupNotice"><Info size={18}/><span>Nhập tên ngắn như <b>_dmarc</b>, không nhập thêm đuôi <b>.{data.domain}</b> nếu nhà cung cấp tự nối. TLSA và SRV không bắt buộc trong luồng cơ bản.</span></div>
   {(['required','webmail','optional'] as const).map(group=><section className="dnsSetupGroup" key={group}>
    <h4>{group==='required'?'1. Xác minh và xác thực email':group==='webmail'?'2. Trang đăng nhập riêng':'3. Ứng dụng thư — tùy chọn'}</h4>
    {group==='optional'&&<p>Không cần các bản ghi này nếu khách hàng chỉ đọc và gửi thư trên webmail.</p>}
    {data.records.filter(r=>r.group===group).map(r=>{const check=data.checks[r.id];return <div className="dnsSetupRow" key={r.id}>
     <div className="dnsSetupRecord"><span className="dnsType">{r.type}</span><div><b>{r.host}</b>{r.priority!==undefined&&<small>Ưu tiên: {r.priority}</small>}</div></div>
     <div className="dnsSetupValue"><code>{r.value||'Chưa có khóa DKIM. Xác minh tên miền rồi bấm Chuẩn bị DNS.'}</code><small>{r.help}</small>{check?.actual?.length>0&&!check.ok&&<small>Đang thấy: {check.actual.join(' | ')}</small>}</div>
     <div className={`dnsSetupState ${check?.ok?'isOk':group==='optional'?'isOptional':''}`}>{check?.ok?<CheckCircle2 size={17}/>:<Info size={17}/>}<span>{check?.ok?'Đã đúng':group==='optional'?'Tùy chọn chưa hoàn tất':'Cần hoàn thiện'}<small>{check?.ok?'':check?.message}</small></span></div>
     {r.value&&<DnsCopyButton value={r.value} label={`${r.type} ${r.host}`}/>}
    </div>;})}
   </section>)}
   <div className="dnsSetupWebmail"><div><h4>Webmail riêng: {data.webmail.host}</h4><p>{data.webmail.ready?'DNS và HTTPS đã sẵn sàng. Đăng nhập bằng email đầy đủ và mật khẩu hộp thư.':data.webmail.activation.message}</p></div><div className="dnsSetupActions">{data.status!=='verified'&&<button className="primary" disabled={busy} onClick={()=>void action('verify')}>Xác minh quyền sở hữu</button>}<button className="primary" disabled={busy||activationPending||data.status!=='verified'||!data.checks.webmail.ok||data.webmail.ready||data.webmail.activation.state==='running'} onClick={()=>void action('activate')}>{data.webmail.ready?'Đã kích hoạt':activationPending||data.webmail.activation.state==='running'?'Đang cấp HTTPS…':'Kích hoạt webmail riêng'}</button>{data.webmail.ready&&<a href={data.webmail.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> Mở webmail</a>}</div></div>
   <small className="dnsSetupUpdated">Kiểm tra lúc {new Date(data.checkedAt).toLocaleString('vi-VN')} · Nếu DNS vừa thay đổi, hãy chờ TTL rồi kiểm tra lại. {data.status==='verified'?'Quyền sở hữu đã xác minh.':''}</small>
  </>}
 </section>;
}

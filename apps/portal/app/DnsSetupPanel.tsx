'use client';
import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,Info,RefreshCw,Download,ExternalLink} from 'lucide-react';
import DnsCopyButton from './DnsCopyButton';
import {dnsProviders} from './dns-providers';
import './dns-setup.css';
type Check={ok:boolean;state:string;message:string;actual:string[]};
type RecordRow={id:string;type:string;host:string;value:string;group:'required'|'webmail'|'optional';help:string;priority?:number};
type Setup={domain:string;status:string;provisioningStatus?:string;provisioningError?:string;checks:Record<string,Check>;records:RecordRow[];webmail:{host:string;url:string;ready:boolean;activation:{state:string;message:string;updatedAt?:string}};checkedAt:string};
const mailIds=['spf','dkim','dmarc','mx'];
const complete=(d:Setup)=>mailIds.every(id=>d.checks[id]?.ok);
export default function DnsSetupPanel({tenantId,domainId,onChanged}:{tenantId:string;domainId:string;onChanged?:()=>void}){
 const [data,setData]=useState<Setup|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[step,setStep]=useState(1);
 const [provider,setProvider]=useState('other'),[fullHost,setFullHost]=useState(false),[custom,setCustom]=useState(false),[showMx,setShowMx]=useState(false),[watch,setWatch]=useState(false);
 const seq=useRef(0),initialized=useRef(false),watchUntil=useRef(0),activationStarted=useRef(0);
 const base=`/api/api/v1/tenants/${tenantId}/domains/${domainId}`;
 async function request(path:string,post=false,body?:unknown):Promise<any>{const r=await fetch(base+path,{method:post?'POST':'GET',headers:post?{'Content-Type':'application/json'}:undefined,body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(typeof result.message==='string'?result.message:'Không hoàn tất yêu cầu. Vui lòng thử lại.');return result;}
 function accept(result:Setup){if(!Array.isArray(result.records)||!result.webmail)throw Error('Dữ liệu DNS chưa sẵn sàng. Hãy thử lại.');setData(result);if(!initialized.current){initialized.current=true;setStep(result.status==='verified'?(complete(result)?3:2):1);setCustom(result.webmail.ready||result.webmail.activation.state==='running');}}
 async function load(){const id=++seq.current;setBusy(true);setError('');try{const result=await request('/dns-health');if(id===seq.current)accept(result);}catch(e){if(id===seq.current)setError(e instanceof Error?e.message:'Không đọc được DNS.');}finally{if(id===seq.current)setBusy(false);}}
 useEffect(()=>{initialized.current=false;setData(null);setMessage('');setStep(1);setProvider('other');setFullHost(false);setCustom(false);setShowMx(false);setWatch(false);activationStarted.current=0;void load();return()=>{seq.current++;};},[base]);
 useEffect(()=>{if(busy||!data)return;const running=data.webmail.activation.state==='running'||(activationStarted.current>0&&!data.webmail.ready&&Date.now()-activationStarted.current<600000&&!(data.webmail.activation.state==='failed'&&Date.parse(data.webmail.activation.updatedAt||'')>=activationStarted.current));if(!running&&(!watch||Date.now()>watchUntil.current))return;const timer=setTimeout(()=>void load(),running?5000:20000);return()=>clearTimeout(timer);},[data,busy,watch]);
 async function proceed(){
  const id=++seq.current;setBusy(true);setError('');setMessage('');
  try{let current:Setup=await request('/dns-health');
   if(current.status!=='verified'){const token=current.records.find(r=>r.id==='ownership')?.value;if(!token){await request('/dns-setup',true);current=await request('/dns-health');if(id===seq.current){accept(current);setMessage('Đã tạo mã xác minh. Thêm bản ghi ở bước 1 rồi kiểm tra lại.');}return;}if(!current.checks.ownership?.ok){if(id===seq.current){accept(current);setStep(1);setMessage('Chưa thấy mã xác minh đúng. Kiểm tra bản ghi bên dưới hoặc chờ DNS cập nhật.');}return;}await request('/verify',true,{token});if(id!==seq.current)return;current=await request('/dns-setup',true);if(id!==seq.current)return;onChanged?.();}
   else if(current.provisioningStatus!=='ready'||!current.records.find(r=>r.id==='dkim')?.value){current=await request('/dns-setup',true);if(id!==seq.current)return;onChanged?.();}
   if(id!==seq.current)return;accept(current);
   if(step===1){setStep(2);setMessage('Đã xác nhận tên miền. Tiếp tục với các bản ghi email còn thiếu.');return;}
   if(!complete(current)){setStep(2);setMessage('Hãy hoàn thiện các bản ghi còn hiển thị. Bản ghi đã đúng không cần thêm lại.');return;}
   setStep(3);
   if(step!==3){setMessage('DNS email đã đúng. Chọn trang đăng nhập để hoàn tất.');return;}
   if(!custom){setMessage('DNS email đã hoàn tất. Có thể dùng webmail chung khi hộp thư báo Sẵn sàng. Hãy kiểm thử gửi nhận trước khi bàn giao.');return;}
   if(current.webmail.ready){setMessage('DNS và HTTPS của webmail riêng đã sẵn sàng.');return;}
   if(!current.checks.webmail?.ok){setMessage('Thêm bản ghi trang đăng nhập riêng bên dưới rồi kiểm tra lại.');return;}
   if(current.webmail.activation.state==='running'){setMessage('Đang cấp HTTPS. Trang sẽ tự cập nhật trạng thái.');return;}
   const result=await request('/webmail-activate',true);if(id===seq.current){activationStarted.current=Date.now();setMessage(result.message);const refreshed=await request('/dns-health');if(id===seq.current)accept(refreshed);}
  }catch(e){if(id===seq.current)setError(e instanceof Error?e.message:'Không hoàn tất yêu cầu.');}finally{if(id===seq.current)setBusy(false);}
 }
 function host(r:RecordRow){return !fullHost?r.host:r.host==='@'?data!.domain:`${r.host}.${data!.domain}`;}
 function value(r:RecordRow){return data?.checks[r.id]?.ok&&['spf','dmarc'].includes(r.id)?data.checks[r.id].actual[0]||r.value:r.value;}
 const mxCheck = data?.checks.mx;
 const existingMx = mxCheck?.ok ? [] : (mxCheck?.actual ?? []).filter(Boolean);
 const hasExistingMx = existingMx.length > 0;
 const canShowMx = !hasExistingMx || showMx;
 function download(){if(!data)return;const selected=data.records.filter(r=>(r.id!=='mx'||canShowMx)&&(r.group==='required'||(custom&&r.group==='webmail')));const text=[`HƯỚNG DẪN KẾT NỐI EMAIL — ${data.domain}`,'TTL: 300 giây (5 phút). Chỉ thêm hoặc sửa bản ghi còn thiếu.','Nếu nhà cung cấp tự nối tên miền, dùng tên ngắn; nếu yêu cầu tên đầy đủ, dùng tên đầy đủ.','Giữ SPF/DMARC đang đúng. Hợp nhất nguồn gửi SPF nếu đang dùng dịch vụ khác.','Nếu chuyển dịch vụ: chuẩn bị hộp thư trước, chuyển MX cuối cùng.','',...selected.map(r=>`${data.checks[r.id]?.ok?'ĐÃ ĐÚNG — KHÔNG THÊM LẠI':'CẦN KIỂM TRA'} | ${r.type} | Tên: ${host(r)} | Nội dung: ${value(r)||'Xác minh tên miền để lấy khóa DKIM.'}${r.priority===undefined?'':` | Ưu tiên: ${r.priority}`}\n${r.help}`),'',`Đăng nhập: ${custom?data.webmail.url:'https://mail.30nice.vn'}`,custom?'30NICE sẽ cấp HTTPS sau khi bạn bấm Kiểm tra và tiếp tục.':'Không cần thêm DNS cho webmail chung.'].join('\n');const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`huong-dan-dns-${data.domain}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function row(record:RecordRow){
  const check=data!.checks[record.id];
  const title=({
   ownership:'Xác minh quyền sở hữu',
   mx:'Máy chủ nhận thư (MX)',
   spf:'Nguồn gửi được phép (SPF)',
   dkim:'Chữ ký email (DKIM)',
   dmarc:'Chống giả mạo email (DMARC)',
   webmail:'Địa chỉ webmail riêng',
   autoconfig:'Cấu hình tự động (Autoconfig)',
   autodiscover:'Cấu hình Outlook (Autodiscover)',
  } as Record<string,string>)[record.id]||record.id;
  const label=check?.ok?'Đã đúng':check?.state==='error'?'Chưa kiểm tra được':check?.state==='review'?'Cần kiểm tra giá trị':'Chưa tìm thấy';
  const recordValue=value(record);
  const heading=<><span className="dnsType" aria-label={`Loại ${record.type}`}>{record.type}</span><b>{title}</b></>;
  const fields=<div className="dnsSimpleFields">
   <div>
    <small>Tên (Host)</small>
    <code>{host(record)}</code>
    <DnsCopyButton key={host(record)} value={host(record)} label={`Tên ${record.host}`}/>
   </div>
   <div className="dnsSimpleContent">
    <small>Giá trị</small>
    <code>{recordValue||'Khóa sẽ có sau khi xác minh tên miền.'}</code>
    {recordValue&&<DnsCopyButton key={recordValue} value={recordValue} label={`Nội dung ${record.type} ${record.host}`}/>}
   </div>
   {record.priority!==undefined&&<div className="dnsSimplePriority"><small>Ưu tiên</small><code>{record.priority}</code></div>}
  </div>;
  if(check?.ok)return <details className="dnsVerifiedRecord" key={record.id}>
   <summary><span className="dnsRecordHeading">{heading}</span><code>{host(record)}</code></summary>
   {fields}
  </details>;
  return <article className="dnsSimpleRecord" key={record.id}>
   <div className="dnsRecordHeading">{heading}<span className="dnsSimplePending">{label}</span></div>
   {fields}
   <p>{record.help}</p>
   {(check?.message||!!check?.actual?.length)&&<p className="dnsSimpleDetail">{check.message}{!!check.actual?.length&&<span>DNS hiện tại: {check.actual.join(' | ')}</span>}</p>}
  </article>;
 }
 function records(ids:string[]){
  const rows=ids.flatMap(id=>data!.records.filter(record=>record.id===id));
  const done=rows.filter(record=>data!.checks[record.id]?.ok);
  const pending=rows.filter(record=>!data!.checks[record.id]?.ok);
  return <>
   {pending.map(row)}
   {!!done.length&&<details className="dnsSimpleDone">
    <summary><CheckCircle2 size={16}/> {done.length} bản ghi đã đúng</summary>
    <div className="dnsVerifiedList">{done.map(row)}</div>
   </details>}
  </>;
 }
 const selectedProvider = dnsProviders.find(option => option.id === provider);
 const owned=data?.status==='verified',mailReady=!!data&&complete(data),running=!!data&&(data.webmail.activation.state==='running'||activationStarted.current>0&&!data.webmail.ready&&Date.now()-activationStarted.current<600000&&!(data.webmail.activation.state==='failed'&&Date.parse(data.webmail.activation.updatedAt||'')>=activationStarted.current));
 return <section className="dnsSetup dnsSimple" aria-label="Hướng dẫn DNS tên miền"><div className="dnsSetupTop"><div><h3>Kết nối email cho {data?.domain||'tên miền'}</h3><p>Thêm các bản ghi được yêu cầu tại nơi quản lý tên miền, rồi bấm kiểm tra.</p></div><button className="ghost" disabled={busy||!data} onClick={download}><Download size={16}/> Tải hướng dẫn</button></div>
 <nav className="dnsSimpleSteps" aria-label="Các bước kết nối DNS">{['Xác nhận tên miền','Bật email doanh nghiệp','Chọn trang đăng nhập'].map((label,i)=><button type="button" key={label} disabled={busy||i>0&&!owned} aria-current={step===i+1?'step':undefined} onClick={()=>{setStep(i+1);setMessage('');}}><span>{(i===0&&owned)||(i===1&&mailReady)?'✓':i+1}</span>{label}</button>)}</nav>
 {error&&<p className="dnsSetupError" role="alert">{error}</p>}{message&&<p className="dnsSetupNotice" role="status">{message}</p>}
 {!data?<p role="status">{busy?'Đang đọc cấu hình tên miền…':'Chưa tải được cấu hình.'}</p>:<>
 <div className="dnsSimpleProvider">
  <label>Nơi quản lý DNS
   <select aria-label="Nơi quản lý DNS" value={provider} disabled={busy} onChange={event=>{setProvider(event.target.value);setFullHost(false);}}>
    <option value="other">Nhà cung cấp khác / Chưa rõ</option>
    <optgroup label="Việt Nam">
     {dnsProviders.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}
    </optgroup>
    <optgroup label="Quốc tế"><option value="cloudflare">Cloudflare</option></optgroup>
   </select>
  </label>
  <label className="dnsSimpleCheckbox"><input type="checkbox" checked={fullHost} onChange={event=>setFullHost(event.target.checked)}/> Hiển thị tên DNS đầy đủ</label>
  <p>Chọn nơi đang quản lý DNS của tên miền. Đây có thể là nơi khác với nhà đăng ký.</p>
  <p>
   {selectedProvider?.steps ?? (provider==='cloudflare'
    ? 'Mở tên miền trong Cloudflare → DNS → Records → Add record. Chọn DNS only cho các bản ghi CNAME bên dưới.'
    : 'Mở trang quản lý DNS của tên miền và chọn Thêm bản ghi.')}
   {' '}Chọn TTL 5 phút hoặc để mặc định. Dùng tên ngắn nếu trang DNS tự thêm đuôi tên miền.
   {selectedProvider&&<> <a href={selectedProvider.url} target="_blank" rel="noopener noreferrer">Xem trang chính thức của {selectedProvider.name}</a></>}
  </p>
 </div>
 {step===1&&<div className="dnsSetupGroup"><h4>1. Xác nhận bạn quản lý tên miền</h4><p>Thêm một bản TXT, sau đó bấm “Kiểm tra và tiếp tục”. 30NICE tự kết nối dịch vụ và lấy khóa ký thư.</p>{owned?<div className="dnsSetupNotice"><CheckCircle2 size={18}/> Tên miền đã xác minh. Không cần xác minh lại.</div>:records(['ownership'])}{!owned&&!data.records.some(r=>r.id==='ownership')&&<p>Bấm “Kiểm tra và tiếp tục” để tạo mã xác minh riêng.</p>}</div>}
 {step===2&&<div className="dnsSetupGroup"><h4>2. Bật gửi và nhận email doanh nghiệp</h4><p>Sao chép Tên và Giá trị sang trang DNS. Nếu đã có SPF, hãy cập nhật bản ghi hiện tại.</p>{data.provisioningStatus!=='ready'&&<p className="dnsSetupNotice">Bấm “Kiểm tra và tiếp tục” để hệ thống kết nối dịch vụ và chuẩn bị khóa DKIM.</p>}{hasExistingMx && <div className="dnsSetupNotice">
  <Info size={18}/>
  <div>
   <b>Đã phát hiện MX hiện tại</b>
   <p>{existingMx.join(', ')}</p>
   <p>Chuẩn bị hộp thư và sao lưu hoặc chuyển thư cũ trước. Giữ MX hiện tại cho đến thời điểm chuyển dịch vụ đã thống nhất. Nếu vẫn dùng nguồn gửi cũ, hãy hợp nhất SPF.</p>
   <label className="dnsSimpleCheckbox">
    <input type="checkbox" checked={showMx} onChange={event=>setShowMx(event.target.checked)}/>
    Đã chuẩn bị hộp thư và sẵn sàng xem hướng dẫn chuyển MX
   </label>
  </div>
 </div>}
 {records(canShowMx ? mailIds : mailIds.filter(id=>id!=='mx'))}{mailReady&&<p className="dnsSimpleOk">Các bản ghi gửi nhận đã đúng. Tiếp tục chọn trang đăng nhập.</p>}</div>}
 {step===3&&<div className="dnsSetupGroup"><h4>3. Chọn nơi khách hàng đăng nhập</h4><div className="dnsSimpleChoices"><label><input type="radio" name={`webmail-${domainId}`} checked={!custom} onChange={()=>setCustom(false)}/><span><b>Dùng webmail 30NICE</b><small>mail.30nice.vn · Không cần thêm DNS</small></span></label><label><input type="radio" name={`webmail-${domainId}`} checked={custom} onChange={()=>setCustom(true)}/><span><b>Dùng địa chỉ riêng</b><small>{data.webmail.host} · Thêm một bản ghi</small></span></label></div>{custom?<>{records(['webmail'])}<p>{data.webmail.ready?'DNS và HTTPS đã sẵn sàng.':running?'Đang cấp HTTPS. Trang sẽ tự cập nhật.':data.webmail.activation.state==='failed'?data.webmail.activation.message:'Sau khi bản ghi đúng, bấm “Kiểm tra và tiếp tục” để 30NICE cấp HTTPS.'}</p>{data.webmail.ready&&<a href={data.webmail.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> Mở webmail riêng</a>}</>:<div className="dnsSetupNotice"><CheckCircle2 size={18}/><span>Đăng nhập bằng email đầy đủ và mật khẩu hộp thư tại <a href="https://mail.30nice.vn" target="_blank" rel="noopener noreferrer">mail.30nice.vn</a>. Hộp thư cần báo Sẵn sàng trước khi đăng nhập.</span></div>}{!mailReady&&<p>DNS email chưa hoàn tất. Quay lại bước 2 để kiểm tra gửi nhận.</p>}</div>}
 <details className="dnsSimpleOptional"><summary>Kết nối Outlook và ứng dụng thư — tùy chọn</summary><p>Bỏ qua nếu khách hàng chỉ dùng webmail. Các bản ghi này không chặn hoàn tất cấu hình cơ bản. HTTPS của hostname ứng dụng cần được kiểm tra riêng.</p>{data.records.filter(r=>r.group==='optional').map(row)}</details>
 <label className="dnsSimpleCheckbox"><input type="checkbox" checked={watch} onChange={e=>{setWatch(e.target.checked);watchUntil.current=Date.now()+600000;}}/> Tự kiểm tra DNS mỗi 20 giây trong tối đa 10 phút</label><small className="dnsSetupUpdated">Kiểm tra lúc {new Date(data.checkedAt).toLocaleString('vi-VN')}. DNS có thể cần thời gian cập nhật theo TTL. Tự kiểm tra chỉ đọc trạng thái; không tự thay DNS.</small>
 </>}
 <div className="dnsSimpleFooter"><button className="ghost" disabled={busy||step===1} onClick={()=>setStep(s=>Math.max(1,s-1))}>Quay lại</button><button className="primary" disabled={busy||running} onClick={()=>void proceed()}><RefreshCw size={16} className={busy||running?'spin':''}/>{busy?'Đang kiểm tra…':running?'Đang cấp HTTPS…':'Kiểm tra và tiếp tục'}</button></div></section>;
}

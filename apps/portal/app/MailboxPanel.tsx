'use client';
import {useEffect,useRef,useState} from 'react';
import {useCustomer} from './CustomerContext';
import DnsCopyButton from './DnsCopyButton';
import './mailbox-panel.css';
type Tenant={id:string;name:string};type Domain={id:string;domain:string;status:string;provisioningStatus?:string};
type Box={id:string;address:string;quotaGb:number;status:string;provisioningState?:string;observedQuotaBytes?:number;usedBytes?:number};
type Job={id:string;idempotencyKey:string;status:string;attempts:number;lastError?:string};
type Capacity={remainingBytes:number;remainingMailboxes:number;maxMailboxBytes:number;domainLimitBytes:number;domainAllocatedBytes:number};
const size=(n:number)=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:3}).format(n/1024**3);
const mailboxState = (box:Box) => {
 if(box.provisioningState==='pending') return 'Đang cấp phát';
 if(box.provisioningState==='failed') return 'Cần xử lý';
 if(box.provisioningState==='reconcile') return 'Cần đối soát';
 return box.status==='active'?'Sẵn sàng':'Đã khóa';
};
const hasBytes = (value:unknown):value is number => typeof value==='number' && Number.isFinite(value) && value>=0;
async function request(path:string,body?:unknown,method=body===undefined?'GET':'POST'){const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(typeof result.message==='string'?result.message:'Không hoàn tất yêu cầu.');return result;}
export default function MailboxPanel({fixedTenantId,fixedDomainId}:{fixedTenantId?:string;fixedDomainId?:string}={}){
 const customer=useCustomer();
 const [tenants,setTenants]=useState<Tenant[]>([]),[tenant,setTenant]=useState(''),[domains,setDomains]=useState<Domain[]>([]),[domain,setDomain]=useState(''),[boxes,setBoxes]=useState<Box[]>([]),[jobs,setJobs]=useState<Job[]>([]);
 const [user,setUser]=useState(''),[quota,setQuota]=useState('3'),[password,setPassword]=useState(''),[revealed,setRevealed]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[capacity,setCapacity]=useState<Capacity|null>(null),[capacityError,setCapacityError]=useState(''),[drafts,setDrafts]=useState<Record<string,string>>({});
 const [query,setQuery]=useState(""),[domainFilter,setDomainFilter]=useState(""),[stateFilter,setStateFilter]=useState("");
 const [loadFailed,setLoadFailed]=useState(false);
 const sequence=useRef(0),capacitySequence=useRef(0),current=useRef(tenant);current.current=tenant;
 const selected=domains.find(d=>d.id===domain),base=`/api/api/v1/tenants/${tenant}`;
 useEffect(()=>{let live=true;void request('/api/api/v1/tenants').then(rows=>{if(!Array.isArray(rows))throw Error('Dữ liệu khách hàng không hợp lệ.');if(live){setTenants(rows);setTenant(fixedTenantId?(rows.find((t:Tenant)=>t.id===fixedTenantId)?.id||''):(rows.find((t:Tenant)=>t.id===customer.tenantId)?.id||rows[0]?.id||''));}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[fixedTenantId,customer.tenantId]);
 async function load(){if(!tenant)return;const target=tenant,id=++sequence.current;setLoading(true);try{const [ds,bs,js]=await Promise.all(['domains','mailboxes','provisioning-jobs'].map(p=>request(`${base}/${p}`)));if(![ds,bs,js].every(Array.isArray))throw Error('Dữ liệu hộp thư không hợp lệ.');if(id===sequence.current&&target===current.current){setDomains(ds);setBoxes(bs);setJobs(js);setLoadFailed(false);setDomain(old=>ds.some((d:Domain)=>d.id===old)?old:ds.find((d:Domain)=>d.id===fixedDomainId)?.id||ds.find((d:Domain)=>d.status==='verified'&&d.provisioningStatus==='ready')?.id||'');}}catch(e){if(id===sequence.current&&target===current.current){setLoadFailed(true);setError(e instanceof Error?e.message:'Không tải được hộp thư.');}}finally{if(id===sequence.current&&target===current.current)setLoading(false);}}
 async function limits(){const id=++capacitySequence.current;setCapacity(null);setCapacityError('');if(!tenant||!selected)return;try{const data=await request(`${base}/capacity?domain=${encodeURIComponent(selected.domain)}`);if(id===capacitySequence.current)setCapacity(data);}catch(e){if(id===capacitySequence.current)setCapacityError(e instanceof Error?e.message:'Chưa kiểm tra được hạn mức.');}}
 useEffect(()=>{setQuery('');setDomainFilter('');setStateFilter('');setDrafts({});setLoadFailed(false);setBoxes([]);setDomains([]);setJobs([]);setDomain('');setRevealed('');setPassword('');setUser('');setMessage('');setError('');setCapacity(null);void load();return()=>{sequence.current++;capacitySequence.current++;};},[tenant]);
 useEffect(()=>{setRevealed('');setPassword('');setUser('');void limits();return()=>{capacitySequence.current++;};},[tenant,domain]);
 const pending=jobs.some(j=>['queued','running'].includes(j.status));
 useEffect(()=>{if(!pending)return;const timer=setInterval(()=>{void load();void limits();},4000);return()=>clearInterval(timer);},[pending,tenant,domain]);
 async function act(path:string,body:unknown={},method='POST'){const target=tenant;setBusy(true);setError('');setMessage('');setRevealed('');try{const result=await request(`${base}/${path}`,body,method);if(target!==current.current)return;setRevealed(result.temporaryPassword||'');setMessage(result.message||(result.provisioningStatus==='queued'?'Đã tiếp nhận. Hộp thư chỉ sẵn sàng khi cấp phát được xác nhận.':'Đã xác nhận thao tác.'));setUser('');setPassword('');await load();await limits();}catch(e){if(target===current.current)setError(e instanceof Error?e.message:'Yêu cầu chưa hoàn tất.');}finally{if(target===current.current)setBusy(false);}}
 const canCreate=selected?.status==='verified'&&selected.provisioningStatus==='ready'&&capacity&&capacity.remainingMailboxes>0&&Number.isInteger(Number(quota))&&Number(quota)>=1&&Number(quota)*1024**3<=Math.min(capacity.remainingBytes,capacity.maxMailboxBytes);
 const listDomain = fixedDomainId ? domains.find(item=>item.id===fixedDomainId)?.domain : domainFilter;
 const shown = boxes.filter(box =>
  (!fixedDomainId || listDomain) &&
  (!listDomain || box.address.toLowerCase().endsWith('@'+listDomain.toLowerCase())) &&
  (!stateFilter || mailboxState(box)===stateFilter) &&
  box.address.toLowerCase().includes(query.trim().toLowerCase()),
 );
 return <div className="mailboxPanel">
  <div className="mailboxToolbar"><label>Khách hàng<select aria-label="Chọn khách hàng" value={tenant} disabled={busy||Boolean(fixedTenantId)} onChange={e=>{current.current=e.target.value;sequence.current++;capacitySequence.current++;setBoxes([]);setJobs([]);setRevealed('');setPassword('');customer.selectTenant(e.target.value);setTenant(e.target.value);}}><option value="">Chọn khách hàng</option>{tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Tên miền đã kết nối<select aria-label="Tên miền tạo hộp thư" value={domain} disabled={busy||Boolean(fixedDomainId)} onChange={e=>setDomain(e.target.value)}><option value="">Chọn tên miền</option>{domains.map(d=><option key={d.id} value={d.id} disabled={d.status!=='verified'||d.provisioningStatus!=='ready'}>{d.domain}{d.status!=='verified'?' · cần xác minh':d.provisioningStatus!=='ready'?' · cần kết nối dịch vụ':''}</option>)}</select></label><button className="ghost" disabled={busy||loading||!tenant} onClick={()=>{setError('');void load();void limits();}}>Làm mới</button></div>
  {capacity&&<div className="mailboxCapacity" role="status"><b>Còn {capacity.remainingMailboxes} hộp thư · {size(capacity.remainingBytes)} GiB có thể cấp</b><small>Đã cấp {size(capacity.domainAllocatedBytes)} / {size(capacity.domainLimitBytes)} GiB. Bao gồm tác vụ đang chờ.</small></div>}
  {capacityError&&<p className="mailboxMessage error" role="alert">{capacityError}</p>}
  <details className="mailboxSection" open={Boolean(fixedTenantId)}><summary>Tạo hộp thư mới</summary><form className="mailboxCreate" onSubmit={e=>{e.preventDefault();if(canCreate)void act('mailboxes',{address:`${user.trim()}@${selected!.domain}`,quotaGb:Number(quota),password:password||undefined});}}><label>Tên hộp thư<div className="mailboxAddress"><input aria-label="Tên hộp thư" required disabled={busy} value={user} onChange={e=>setUser(e.target.value.toLowerCase())} placeholder="ví dụ: info" pattern="[a-zA-Z0-9._+\-]+"/><span>@{selected?.domain||'tên-miền'}</span></div></label><label>Dung lượng (GiB)<input type="number" min="1" max={capacity?Math.floor(Math.min(capacity.remainingBytes,capacity.maxMailboxBytes)/1024**3):1000} step="1" required disabled={busy} value={quota} onChange={e=>setQuota(e.target.value)}/></label><label>Mật khẩu ban đầu<input type="password" autoComplete="new-password" minLength={12} maxLength={256} disabled={busy} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Để trống để tự tạo an toàn"/></label><button type="submit" className="primary" disabled={busy||!canCreate||!user.trim()}>{busy?'Đang tiếp nhận…':'Tạo hộp thư'}</button></form>
  {!canCreate&&capacity&&<p className="emptyText">Hạn mức hoặc dung lượng đang chọn chưa phù hợp. Điều chỉnh dung lượng hoặc liên hệ quản trị để nâng gói.</p>}</details>
  {error&&<p className="mailboxMessage error" role="alert">{error}</p>}{message&&<p className="mailboxMessage" role="status">{message}</p>}
  {revealed&&<div className="mailboxPasswordReveal"><div><b>Mật khẩu ban đầu · lưu vào nơi an toàn</b><code>{revealed}</code><small>Chờ cấp phát được xác nhận trước khi đăng nhập. Đối soát không đổi mật khẩu hộp thư đã có.</small></div><DnsCopyButton value={revealed} label="Mật khẩu hộp thư"/><button className="mailboxPasswordDismiss" aria-label="Ẩn mật khẩu" onClick={()=>setRevealed('')}>×</button></div>}
  <details className="provisioningHistory mailboxSection" open={pending||jobs.some(job=>["failed","dead_letter"].includes(job.status))}><summary>Tiến độ cấp phát ({jobs.length})</summary>{!jobs.length&&<p className="emptyText">Chưa có tác vụ cấp phát.</p>}{jobs.slice(0,12).map(j=><div className="provisioningJobRow" key={j.id}><span className={`provisioningJobStatus ${j.status}`}>{({queued:'Đang chờ',running:'Đang xử lý',succeeded:'Đã xác nhận',failed:'Cần kiểm tra',dead_letter:'Cần đối soát'} as Record<string,string>)[j.status]||j.status}</span><div className="provisioningJobInfo"><b>{j.idempotencyKey.replace(/^mailbox:/,'')}</b>{j.lastError&&<small>{j.lastError}</small>}</div><small>{j.attempts} lần xử lý</small>{['failed','dead_letter'].includes(j.status)&&<button className="ghost" disabled={busy} onClick={()=>void act(`provisioning-jobs/${j.id}/retry`)}>Đối soát / thử lại</button>}</div>)}</details>
  <section className="mailboxDirectory" aria-labelledby="mailbox-directory-title" aria-busy={loading}>
   <div className="mailboxDirectoryHead">
    <h3 id="mailbox-directory-title">Danh sách hộp thư</h3>
    {!loadFailed&&<span>{shown.length} hộp thư</span>}
   </div>
   <div className="mailboxFilters">
    <label>Địa chỉ email<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Tìm địa chỉ email"/></label>
    {!fixedDomainId&&<label>Tên miền<select aria-label="Lọc hộp thư theo tên miền" value={domainFilter} onChange={event=>setDomainFilter(event.target.value)}>
     <option value="">Tất cả tên miền</option>
     {domains.map(item=><option key={item.id} value={item.domain}>{item.domain}</option>)}
    </select></label>}
    <label>Trạng thái<select aria-label="Lọc hộp thư theo trạng thái" value={stateFilter} onChange={event=>setStateFilter(event.target.value)}>
     <option value="">Tất cả trạng thái</option>
     {['Sẵn sàng','Đang cấp phát','Cần xử lý','Cần đối soát','Đã khóa'].map(state=><option key={state}>{state}</option>)}
    </select></label>
   </div>
   {loading&&!boxes.length?<p role="status">Đang tải hộp thư…</p>:loadFailed?<p>Chưa tải được danh sách. Bấm Làm mới để thử lại.</p>:!shown.length?
    <p className="emptyText">{!tenant?'Chọn khách hàng để bắt đầu.':boxes.length?'Không có hộp thư phù hợp.':'Khách hàng chưa có hộp thư.'}</p>:
    <div className="mailboxCards">{shown.map(box=>{
     const state=mailboxState(box);
     const limit=hasBytes(box.observedQuotaBytes)?box.observedQuotaBytes:null;
     const used=hasBytes(box.usedBytes)?box.usedBytes:null;
     const draft=drafts[box.id]??String(box.quotaGb);
     const quotaValue=Number(draft);
     const blocked=busy||box.provisioningState==='pending';
     return <article className="mailboxCard" key={box.id}>
      <div className="mailboxDirectoryHead"><b>{box.address}</b><span className="mailboxState" data-state={state}>{state}</span></div>
      <div className="mailboxUsage">
       <span>Đã dùng <b>{used===null?'Chưa có dữ liệu':size(used)+' GiB'}</b></span>
       <span>Hạn mức yêu cầu <b>{box.quotaGb} GiB</b></span>
       <span>Hạn mức thực <b>{limit===null?'Chưa xác nhận':size(limit)+' GiB'}</b></span>
       {used!==null&&limit!==null&&limit>0&&<progress aria-label={`Dung lượng đã dùng của ${box.address}`} value={Math.min(used,limit)} max={limit}/>}
      </div>
      {state==='Sẵn sàng'&&<details className="mailboxManage mailboxSmtp">
       <summary>Kết nối SMTP với website</summary>
       <dl className="mailboxSmtpFields">
        <div><dt>Máy chủ SMTP</dt><dd><code>mx.30nice.vn</code><DnsCopyButton value="mx.30nice.vn" label="Máy chủ SMTP"/></dd></div>
        <div><dt>Cổng và mã hóa</dt><dd><b>587 · STARTTLS</b><small>Hoặc 465 nếu website dùng SSL/TLS.</small></dd></div>
        <div><dt>Tên đăng nhập và địa chỉ gửi</dt><dd><code>{box.address}</code><DnsCopyButton value={box.address} label="Địa chỉ SMTP"/></dd></div>
        <div><dt>Xác thực SMTP</dt><dd><b>Bật</b><small>Dùng mật khẩu của hộp thư này.</small></dd></div>
       </dl>
      </details>}
      <details className="mailboxManage">
       <summary>Quản lý hộp thư</summary>
       <div className="mailboxManageActions">
        <label className="mailboxQuota">Hạn mức yêu cầu (GiB)<input type="number" min="1" max="1000" value={draft} disabled={blocked} onChange={event=>setDrafts(current=>({...current,[box.id]:event.target.value}))}/></label>
        <button className="mailboxAction" disabled={blocked||!Number.isInteger(quotaValue)||quotaValue<1||quotaValue>1000||(quotaValue===box.quotaGb&&limit===quotaValue*1024**3)} onClick={()=>void act(`mailboxes/${box.id}`,{quotaGb:quotaValue},'PUT')}>Áp dụng dung lượng</button>
        <button className="mailboxAction" disabled={blocked} onClick={()=>void act(`mailboxes/${box.id}`,{status:box.status==='active'?'disabled':'active'},'PUT')}>{box.status==='active'?'Tạm khóa':'Mở lại'}</button>
        <button className="mailboxAction" disabled={blocked} onClick={()=>{if(confirm(`Đặt lại mật khẩu ${box.address}? Các phiên webmail sẽ bị thu hồi.`))void act(`mailboxes/${box.id}/reset-password`);}}>Đặt lại mật khẩu</button>
       </div>
      </details>
     </article>;
    })}</div>}
  </section>
 </div>;
}

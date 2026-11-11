'use client';
import {useEffect,useState} from 'react';import {useCustomer} from './CustomerContext';import './product-panels.css';
type Tenant={id:string;name:string};type Plan={id:string;name:string;storageGb:number;mailboxLimit:number;mailboxMaxGb:number;active:boolean;customerCount?:number|null};
type PlanPreview={eligible:boolean;issues:string[];mailboxCount:number;allocatedBytes:number};
const planNumber=new Intl.NumberFormat("vi-VN",{maximumFractionDigits:3});
async function api(path:string,body?:unknown,method=body?'POST':'GET'){const r=await fetch('/api/api/v1'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(typeof d.message==='string'?d.message:'Không hoàn tất yêu cầu.');return d;}
export function CustomerWorkspace({fixedTenantId,onContactSaved}: {fixedTenantId?:string;onContactSaved?:(name:string)=>void} = {}){
 const customer=useCustomer();
 const [preview,setPreview]=useState<{tenantId:string;planId:string;result:PlanPreview}|null>(null);
 const [tenants,setTenants]=useState<Tenant[]>([]),[tenant,setTenant]=useState(''),[name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[plan,setPlan]=useState(''),[plans,setPlans]=useState<Plan[]>([]),[currentPlan,setCurrentPlan]=useState(''),[isSuper,setIsSuper]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{let live=true;void Promise.all([api('/tenants'),api('/plans'),api('/auth/me')]).then(([ts,ps,me])=>{if(live){setTenants(ts);setPlans(ps);setIsSuper(me.role==='super_admin');setTenant(ts.find((t:Tenant)=>t.id===(fixedTenantId??customer.tenantId))?.id||(fixedTenantId?'':ts[0]?.id||''));}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[customer.tenantId,fixedTenantId]);
 useEffect(()=>{let live=true;setName('');setEmail('');setPhone('');setCurrentPlan('');setPlan('');setPreview(null);setMessage('');setError('');if(!tenant)return;setBusy(true);void api(`/tenants/${tenant}/onboarding`).then(d=>{if(live){setName(d.tenant.name);setEmail(d.tenant.contactEmail||'');setPhone(d.tenant.contactPhone||'');setCurrentPlan(d.tenant.planName||'Theo hạn mức Mailcow hiện tại');setPlan(d.tenant.planId||'');}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[tenant]);
 const currentPreview=preview?.tenantId===tenant&&preview.planId===plan?preview.result:null;
 async function checkPlan(){
  setBusy(true);
  setError('');
  setMessage('');
  setPreview(null);
  try{
   const result:PlanPreview=await api(`/tenants/${tenant}/plan-preview?planId=${encodeURIComponent(plan)}`);
   setPreview({tenantId:tenant,planId:plan,result});
  }catch(reason){
   setError(reason instanceof Error?reason.message:'Chưa kiểm tra được gói.');
  }finally{setBusy(false);}
 }
 async function save(kind:'contact'|'plan'){setBusy(true);setError('');setMessage('');try{await api(`/tenants/${tenant}/${kind}`,kind==='contact'?{name,contactEmail:email,contactPhone:phone}:{planId:plan},'PUT');setMessage(kind==='contact'?'Đã lưu hồ sơ doanh nghiệp.':'Đã xác nhận gói và hạn mức Mailcow.');if(kind==='plan'){setCurrentPlan(plans.find(p=>p.id===plan)?.name||'');setPreview(null);}else onContactSaved?.(name.trim());}catch(e){if(kind==='plan')setPreview(null);setError(e instanceof Error?e.message:'Chưa lưu được dữ liệu.');}finally{setBusy(false);}}
 return <section className="productPanel"><h3>Hồ sơ và gói dịch vụ khách hàng</h3>{!fixedTenantId&&<div className="productSelectors"><label>Khách hàng<select value={tenant} disabled={busy} onChange={e=>{customer.selectTenant(e.target.value);setTenant(e.target.value);}}><option value="">Chọn khách hàng</option>{tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>}{error&&<p className="productError" role="alert">{error}</p>}{message&&<p className="productSuccess" role="status">{message}</p>}{tenant&&<><form className="productForm" onSubmit={e=>{e.preventDefault();void save('contact');}}><label>Tên doanh nghiệp<input value={name} onChange={e=>setName(e.target.value)} required maxLength={120} disabled={busy}/></label><label>Email liên hệ<input type="email" value={email} onChange={e=>setEmail(e.target.value)} maxLength={320} disabled={busy}/></label><label>Điện thoại<input value={phone} onChange={e=>setPhone(e.target.value)} maxLength={40} disabled={busy}/></label><button className="primary" disabled={busy}>Lưu hồ sơ</button></form><div className="productNotice">Gói hiện tại: <b>{currentPlan}</b>. Dung lượng cấp phát và dung lượng thư đã dùng là hai chỉ số khác nhau.</div>{isSuper&&<form className="productForm" onSubmit={event=>{event.preventDefault();if(!busy&&currentPreview?.eligible)void save('plan');}}>
  <label>Gói muốn áp dụng<select aria-label="Gói muốn áp dụng" value={plan} onChange={event=>{setPlan(event.target.value);setPreview(null);setError('');setMessage('');}} disabled={busy} required>
   <option value="">Chọn gói đã tạo</option>{plans.filter(item=>item.active).map(item=><option key={item.id} value={item.id}>{item.name} · {item.mailboxLimit} hộp thư · {item.storageGb} GiB</option>)}
  </select></label>
  <button type="button" className="ghost" disabled={busy||!plan} onClick={()=>void checkPlan()}>Kiểm tra hạn mức</button>
  <button className="primary" disabled={busy||!currentPreview?.eligible}>Áp dụng và đồng bộ hạn mức</button>
  {currentPreview&&<div className={currentPreview.eligible?'productSuccess planPreview':'productError planPreview'} role="status">
   <b>{currentPreview.eligible?'Gói đáp ứng hạn mức hiện tại':'Gói chưa đáp ứng hạn mức'}</b>
   <p>Đã cấp {planNumber.format(currentPreview.mailboxCount)} hộp thư và {planNumber.format(currentPreview.allocatedBytes/1024**3)} GiB.</p>
   {!!currentPreview.issues.length&&<ul>{currentPreview.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
  </div>}
 </form>}</>}</section>;
}
export function ServicePlans(){const [rows,setRows]=useState<Plan[]|null>(null),[name,setName]=useState(''),[count,setCount]=useState('10'),[storage,setStorage]=useState('10'),[max,setMax]=useState('5'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;void api('/plans').then(d=>{if(live)setRows(d);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 async function create(){setBusy(true);setError('');try{await api('/plans',{name,mailboxLimit:Number(count),storageGb:Number(storage),mailboxMaxGb:Number(max)});setRows(await api('/plans'));setName('');}catch(e){setError(e instanceof Error?e.message:'Không tạo được gói.');}finally{setBusy(false);}}
 return <section className="productPanel"><h2>Gói dịch vụ</h2><p>Tạo mẫu hạn mức, sau đó áp dụng ở hồ sơ khách hàng. Tạo mẫu không thay đổi dịch vụ đang chạy.</p>{error&&<p className="productError" role="alert">{error}</p>}<form className="productForm" onSubmit={e=>{e.preventDefault();void create();}}><label>Tên gói<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label><label>Số hộp thư<input required type="number" min="1" max="100000" value={count} onChange={e=>setCount(e.target.value)} disabled={busy}/></label><label>Tổng dung lượng (GiB)<input required type="number" min="1" max="100000" value={storage} onChange={e=>setStorage(e.target.value)} disabled={busy}/></label><label>Tối đa mỗi hộp thư (GiB)<input required type="number" min="1" max={Math.min(1000,Number(storage))} value={max} onChange={e=>setMax(e.target.value)} disabled={busy}/></label><button className="primary" disabled={busy}>{busy?'Đang tạo…':'Tạo mẫu gói'}</button></form>{!rows&&!error&&<p role="status">Đang tải danh sách gói…</p>}
 {rows?.length===0&&<p>Chưa có mẫu gói. Anh có thể tạo gói ở trên.</p>}
 {!!rows?.length&&<div className="productTableScroll" tabIndex={0} role="region" aria-label="So sánh gói dịch vụ">
  <table className="planComparison">
   <thead><tr><th scope="col">Gói</th><th scope="col">Số hộp thư</th><th scope="col">Tổng dung lượng</th><th scope="col">Tối đa mỗi hộp thư</th><th scope="col">Doanh nghiệp dùng gói</th><th scope="col">Trạng thái</th></tr></thead>
   <tbody>{rows.map(item=><tr key={item.id}>
    <th scope="row">{item.name}</th><td>{planNumber.format(item.mailboxLimit)}</td><td>{planNumber.format(item.storageGb)} GiB</td>
    <td>{planNumber.format(item.mailboxMaxGb)} GiB</td><td>{item.customerCount==null?'—':planNumber.format(item.customerCount)}</td>
    <td>{item.active?'Đang cung cấp':'Ngừng cung cấp'}</td>
   </tr>)}</tbody>
  </table>
 </div>}</section>;
}
export function OperationsPanel(){const [data,setData]=useState<{jobs:{status:string;count:number}[];workers:{name:string;healthy:boolean;lastSeen:string}[];domains:{name:string;domain:string;provisioningStatus:string;mailboxIssues:number}[];monitor:{healthy:boolean;checkedAt:string}|null}|null>(null),[audit,setAudit]=useState<{id:string;actorEmail:string;action:string;createdAt:string}[]>([]),[error,setError]=useState('');
 useEffect(()=>{let live=true;const load=()=>void Promise.all([api('/operations'),api('/audit')]).then(([d,a])=>{if(live){setData(d);setAudit(a);setError('');}}).catch(e=>{if(live)setError(e.message);});load();const timer=setInterval(load,15000);return()=>{live=false;clearInterval(timer);};},[]);
 return <section className="productPanel"><h2>Vận hành và đối soát</h2><p>Tự cập nhật mỗi 15 giây. Trạng thái hạ tầng và trạng thái từng khách hàng được hiển thị riêng.</p>{error&&<p className="productError" role="alert">{error}</p>}{data&&<><div className="productCards"><div className="productCard"><b>Worker cấp phát</b><span>{data.workers.some(w=>w.healthy)?'Đang hoạt động':'Chưa có heartbeat mới'}</span></div><div className="productCard"><b>Giám sát VPS</b><span>{data.monitor?data.monitor.healthy?'Các kiểm tra đạt':'Có kiểm tra chưa đạt':'Chưa đọc được báo cáo'}</span><small>{data.monitor?.checkedAt?new Date(data.monitor.checkedAt).toLocaleString('vi-VN'):''}</small></div>{data.jobs.map(j=><div className="productCard" key={j.status}><b>{({queued:'Đang chờ',running:'Đang xử lý',succeeded:'Đã xác nhận',failed:'Cần kiểm tra',dead_letter:'Cần đối soát'} as Record<string,string>)[j.status]||j.status}</b><span>{j.count} tác vụ</span></div>)}</div><h3>Tên miền khách hàng</h3>{data.domains.map(d=><div className="productRow" key={d.domain}><div><b>{d.domain}</b><small> · {d.name}</small></div><span>{d.provisioningStatus==='ready'?'Mailcow đã kết nối':'Cần kết nối Mailcow'} · {d.mailboxIssues} hộp thư cần đối soát</span></div>)}<h3>Nhật ký quản trị gần đây</h3><div className="productTableScroll"><table><thead><tr><th>Thời gian</th><th>Tài khoản</th><th>Thao tác</th></tr></thead><tbody>{audit.slice(0,50).map(a=><tr key={a.id}><td>{new Date(a.createdAt).toLocaleString('vi-VN')}</td><td>{a.actorEmail||'Hệ thống'}</td><td>{a.action}</td></tr>)}</tbody></table></div></>}</section>;
}
export function SecurityPanel(){const [data,setData]=useState<{email:string;role:string;enabled:boolean;recoveryCodesRemaining:number}|null>(null),[error,setError]=useState('');useEffect(()=>{let live=true;void Promise.all([api('/auth/me'),api('/auth/mfa/status')]).then(([me,mfa])=>{if(live)setData({...me,...mfa});}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 async function revoke(){if(!confirm('Đăng xuất tất cả phiên quản trị của tài khoản này?'))return;try{await api('/auth/logout-all',{});try{localStorage.removeItem('30nice_session');}catch{}location.reload();}catch(e){setError(e instanceof Error?e.message:'Không thu hồi được phiên.');}}
 return <section className="productPanel"><h2>Bảo mật tài khoản</h2>{error&&<p className="productError" role="alert">{error}</p>}{data&&<><div className="productCards"><div className="productCard"><b>{data.email}</b><span>{data.role==='super_admin'?'Quản trị hệ thống':'Quản trị doanh nghiệp'}</span></div><div className="productCard"><b>Xác thực hai bước</b><span>{data.enabled?'Đang bật':'Chưa xác nhận'}</span><small>Còn {data.recoveryCodesRemaining} mã khôi phục</small></div></div><p>Đổi thông tin quản trị hệ thống sẽ làm mất hiệu lực phiên cũ. Khóa hộp thư hoặc đặt lại mật khẩu sẽ thu hồi phiên webmail tương ứng.</p><button className="ghost" onClick={()=>void revoke()}>Đăng xuất tất cả phiên quản trị</button><a href="mailto:admin@30nice.vn">Liên hệ hỗ trợ phục hồi tài khoản</a></>}</section>;
}

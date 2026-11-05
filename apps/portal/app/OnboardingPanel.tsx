'use client';
import { useEffect, useRef, useState } from 'react';
import TenantCreateForm from './TenantCreateForm';
import DomainWizard from './DomainWizard';
import MemberPanel from './MemberPanel';
import MailboxPanel from './MailboxPanel';
type Tenant={id:string;name:string};
const steps=['Khách hàng','Quản trị viên','Tên miền và DNS','Hộp thư','Đăng nhập webmail'];
export default function OnboardingPanel(){
 const [tenants,setTenants]=useState<Tenant[]>([]),[tenant,setTenant]=useState(''),[step,setStep]=useState(0);
 const [done,setDone]=useState<boolean[]>([false,false,false,false,false]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const seq=useRef(0);
 useEffect(()=>{let live=true;fetch('/api/api/v1/tenants').then(async r=>{if(!r.ok)throw Error('Không tải được khách hàng');return r.json();}).then(items=>{if(!Array.isArray(items))throw Error('Dữ liệu khách hàng không hợp lệ');if(!live)return;setTenants(items);setTenant(current=>items.some((t:Tenant)=>t.id===current)?current:items.find((t:Tenant)=>t.id===localStorage.getItem('30nice_onboarding_tenant'))?.id||items[0]?.id||'');}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[revision]);
 useEffect(()=>{
   const request=++seq.current;setDone([Boolean(tenant),false,false,false,false]);
   if(!tenant)return;localStorage.setItem('30nice_onboarding_tenant',tenant);setBusy(true);setError('');
   Promise.all(['members','domains','mailboxes'].map(async resource=>{const r=await fetch('/api/api/v1/tenants/'+tenant+'/'+resource);if(!r.ok)throw Error('Không đọc được tiến độ. Hãy thử lại.');const data=await r.json();if(!Array.isArray(data))throw Error('Dữ liệu tiến độ không hợp lệ');return data;})).then(([m,d,b])=>{if(request===seq.current)setDone([true,m.some((x:{role:string;status:string})=>x.role==='tenant_admin'&&x.status==='active'),d.some((x:{status:string})=>x.status==='verified'),b.some((x:{status:string})=>x.status==='active'),false]);}).catch(e=>{if(request===seq.current)setError(e.message);}).finally(()=>{if(request===seq.current)setBusy(false);});
   return()=>{seq.current++;};
 },[tenant,revision]);
 return <div style={{display:'grid',gap:20}}>
  <div><h2>Thiết lập email cho khách hàng</h2><p>Hoàn thành từng bước. Tiến độ được đọc từ dữ liệu đã lưu; có thể quay lại làm tiếp.</p></div>
  <label>Khách hàng<select aria-label="Khách hàng đang thiết lập" value={tenant} onChange={e=>{setTenant(e.target.value);setStep(0);}} style={{display:'block',width:'100%',padding:10,marginTop:8}}><option value="">Tạo hoặc chọn khách hàng</option>{tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
  <nav aria-label="Các bước thiết lập" style={{display:'flex',gap:8,flexWrap:'wrap'}}>{steps.map((label,index)=><button key={label} className={step===index?'primary':'ghost'} aria-current={step===index?'step':undefined} onClick={()=>setStep(index)} disabled={index>0&&!tenant}>{done[index]?'✓ ':index+1+'. '}{label}</button>)}</nav>
  {error&&<p role="alert" style={{color:'#b42318'}}>{error}</p>}
  {step===0?<TenantCreateForm onCreated={()=>setRevision(v=>v+1)}/>:step===1?<MemberPanel key={tenant} fixedTenantId={tenant}/>:step===2?<DomainWizard key={tenant} fixedTenantId={tenant}/>:step===3?<MailboxPanel key={tenant} fixedTenantId={tenant}/>:<div><h3>Mở hộp thư của khách hàng</h3><p>Đăng nhập bằng địa chỉ hộp thư đầy đủ và mật khẩu hộp thư, khác với tài khoản quản trị.</p><a className="primary" href="https://mail.30nice.vn" target="_blank" rel="noopener noreferrer">Mở webmail 30NICE</a><p>Webmail theo tên miền riêng cần cấu hình DNS và HTTPS trước khi dùng. Bước này chỉ được nghiệm thu khi khách hàng đăng nhập thành công.</p></div>}
  <div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button className="ghost" disabled={busy||!tenant} onClick={()=>setRevision(v=>v+1)}>{busy?'Đang kiểm tra…':'Kiểm tra tiến độ'}</button><button className="primary" disabled={!tenant||step>=4} onClick={()=>{setRevision(v=>v+1);setStep(v=>Math.min(4,v+1));}}>Bước tiếp theo</button></div>
 </div>;
}

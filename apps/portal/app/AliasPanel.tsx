'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import './alias-panel.css';
import {useCustomer} from './CustomerContext';
type Tenant={id:string;name:string};
type Domain={id:string;domain:string;status:string};
type Mailbox={id:string;address:string;status:string};
type Alias={id:string;source:string;destination:string;active:boolean};
async function json(path:string,init?:RequestInit){
  const response=await fetch(path,init);
  const result=await response.json();
  if(!response.ok)throw new Error(Array.isArray(result.message)?result.message.join(', '):result.message||'Yêu cầu không thành công');
  return result;
}
export default function AliasPanel(){
  const customer=useCustomer();
  const [tenants,setTenants]=useState<Tenant[]>([]);
  const [tenant,setTenant]=useState('');
  const [domains,setDomains]=useState<Domain[]>([]);
  const [mailboxes,setMailboxes]=useState<Mailbox[]>([]);
  const [items,setItems]=useState<Alias[]>([]);
  const [local,setLocal]=useState('');
  const [domain,setDomain]=useState('');
  const [destination,setDestination]=useState('');
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const sequence=useRef(0);
  const inFlight=useRef(false);
  useEffect(()=>{let active=true;json('/api/api/v1/tenants').then(data=>{if(!Array.isArray(data))throw Error('Danh sách khách hàng không hợp lệ');if(active){setTenants(data);setTenant(data.find((t:Tenant)=>t.id===customer.tenantId)?.id||data[0]?.id||'');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[customer.tenantId]);
  const load=useCallback(async()=>{
    const request=++sequence.current;
    if(!tenant)return;
    setLoading(true);setError('');
    try{
      const base='/api/api/v1/tenants/'+tenant;
      const [d,m,a]=await Promise.all([json(base+'/domains'),json(base+'/mailboxes'),json(base+'/aliases')]);
      if(![d,m,a].every(Array.isArray))throw Error('Dữ liệu bí danh không hợp lệ');
      if(request!==sequence.current)return;
      const verified=d.filter((value:Domain)=>value.status==='verified');
      const active=m.filter((value:Mailbox)=>value.status==='active');
      setDomains(verified);setMailboxes(active);setItems(a);setDomain(verified[0]?.domain||'');setDestination(active[0]?.address||'');
    }catch(e){if(request===sequence.current)setError(e instanceof Error?e.message:'Không tải được bí danh');}
    finally{if(request===sequence.current)setLoading(false);}
  },[tenant]);
  useEffect(()=>{setItems([]);setDomains([]);setMailboxes([]);setNotice('');void load();return()=>{sequence.current++;};},[load]);
  async function write(path:string,body:unknown,method='POST'){
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{await json(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});setNotice('Đã đồng bộ bí danh với máy chủ thư.');setLocal('');await load();}
    catch(e){setError(e instanceof Error?e.message:'Không thể cập nhật bí danh');}
    finally{inFlight.current=false;setBusy(false);}
  }
  function create(event:FormEvent){event.preventDefault();if(!tenant||!domain||!destination||busy||loading)return;void write('/api/api/v1/tenants/'+tenant+'/aliases',{source:local.trim().toLowerCase()+'@'+domain,destination});}
  return <div className="alias-panel">
    <div className="alias-heading"><div><h2>Bí danh email</h2><p>Nhiều địa chỉ cùng nhận vào một hộp thư, không cần mật khẩu riêng.</p></div><button className="ghost" disabled={!tenant||loading||busy} onClick={()=>void load()}>Làm mới</button></div>
    <label className="alias-field">Khách hàng<select value={tenant} disabled={busy} onChange={e=>{sequence.current++;setItems([]);customer.selectTenant(e.target.value);setTenant(e.target.value);}}><option value="">Chọn khách hàng</option>{tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    {error&&<p className="alias-error" role="alert">{error}</p>}{notice&&<p className="alias-notice" role="status">{notice}</p>}
    <form className="alias-create" onSubmit={create}><label className="alias-field">Tên bí danh<input required maxLength={64} pattern="[-a-zA-Z0-9._+]+" value={local} disabled={busy||loading} onChange={e=>setLocal(e.target.value)} placeholder="sales hoặc support"/></label><label className="alias-field">Tên miền đã xác minh<select value={domain} disabled={busy||loading} onChange={e=>setDomain(e.target.value)} required><option value="">Chọn tên miền</option>{domains.map(d=><option key={d.id} value={d.domain}>@{d.domain}</option>)}</select></label><label className="alias-field">Hộp thư nhận<select value={destination} disabled={busy||loading} onChange={e=>setDestination(e.target.value)} required><option value="">Chọn hộp thư</option>{mailboxes.map(m=><option key={m.id} value={m.address}>{m.address}</option>)}</select></label><button type="submit" className="primary" disabled={busy||loading||!domain||!destination}>{busy?'Đang đồng bộ…':'Tạo bí danh'}</button></form>
    <p className="alias-hint">Bí danh chỉ nhận vào hộp thư đang hoạt động của khách hàng này. Muốn đăng nhập webmail, dùng địa chỉ hộp thư nhận.</p>
    {loading?<p role="status">Đang tải dữ liệu…</p>:!error&&!items.length?<p>Chưa có bí danh. Thêm tên miền đã xác minh và hộp thư trước khi tạo.</p>:null}
    <div className="alias-list">{items.map(item=><div className="alias-row" key={item.id}><div><b>{item.source}</b><span>Nhận tại: {item.destination}</span></div><span>{item.active?'Đang hoạt động':'Đã tắt'}</span><button className="ghost" disabled={busy||loading} onClick={()=>void write('/api/api/v1/tenants/'+tenant+'/aliases/'+item.id,{active:!item.active},'PUT')}>{item.active?'Tắt bí danh':'Bật bí danh'}</button></div>)}</div>
  </div>;
}

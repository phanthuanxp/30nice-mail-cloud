'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import './alias-panel.css';
import {ArrowRight} from 'lucide-react';
import {useCustomer} from './CustomerContext';
type Tenant={id:string;name:string};
type Domain={id:string;domain:string;status:string;provisioningStatus?:string};
type Mailbox={id:string;address:string;status:string;provisioningState?:string};
type Alias={id:string;source:string;destination:string;active:boolean};
const canReceive = (mailbox:Mailbox) => mailbox.status==='active' && (!mailbox.provisioningState || mailbox.provisioningState==='ready');
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
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('all');
  const [loadFailed,setLoadFailed]=useState(false);
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
      const verified:Domain[]=d.filter((value:Domain)=>value.status==='verified'&&(!value.provisioningStatus||value.provisioningStatus==='ready'));
      const active:Mailbox[]=m.filter(canReceive);
      setDomains(verified);setMailboxes(active);setItems(a);setLoadFailed(false);
      setDomain(previous=>verified.some(item=>item.domain===previous)?previous:verified[0]?.domain||'');
      setDestination(previous=>active.some(item=>item.address===previous)?previous:active[0]?.address||'');
    }catch(e){if(request===sequence.current){setLoadFailed(true);setError(e instanceof Error?e.message:'Không tải được bí danh');}}
    finally{if(request===sequence.current)setLoading(false);}
  },[tenant]);
  useEffect(()=>{setItems([]);setDomains([]);setMailboxes([]);setNotice('');setLocal('');setDomain('');setDestination('');setQuery('');setFilter('all');setLoadFailed(false);void load();return()=>{sequence.current++;};},[load]);
  async function write(path:string,body:unknown,method='POST'){
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{await json(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});setNotice('Đã đồng bộ bí danh với máy chủ thư.');if(method==='POST')setLocal('');await load();}
    catch(e){setError(e instanceof Error?e.message:'Không thể cập nhật bí danh');}
    finally{inFlight.current=false;setBusy(false);}
  }
  function create(event:FormEvent){event.preventDefault();if(!tenant||!domain||!destination||!local.trim()||collision||busy||loading||loadFailed)return;void write('/api/api/v1/tenants/'+tenant+'/aliases',{source:local.trim().toLowerCase()+'@'+domain,destination});}
  const keyword=query.trim().toLowerCase();
  const readyAddresses=new Set(mailboxes.map(box=>box.address.toLowerCase()));
  const shown=items.filter(item=>{
    const destinationReady=readyAddresses.has(item.destination.toLowerCase());
    return (filter==='all'||(filter==='active'&&item.active&&destinationReady)||
      (filter==='disabled'&&!item.active)||(filter==='attention'&&!destinationReady)) &&
      [item.source,item.destination].some(address=>address.toLowerCase().includes(keyword));
  });
  const source=local.trim().toLowerCase()+'@'+domain;
  const collision=local.trim()&&domain&&(items.some(item=>item.source.toLowerCase()===source)||source===destination.toLowerCase());
  return <div className="alias-panel">
    <div className="alias-heading">
      <div><h3>Chuyển thư bằng bí danh</h3><p>Thư gửi đến bí danh sẽ về hộp thư nhận. Dùng địa chỉ hộp thư nhận để đăng nhập webmail.</p></div>
      <button className="ghost" disabled={!tenant||loading||busy} onClick={()=>void load()}>Làm mới</button>
    </div>
    <label className="alias-field">Khách hàng<select aria-label="Khách hàng của bí danh" value={tenant} disabled={busy} onChange={event=>{
      sequence.current++;setItems([]);customer.selectTenant(event.target.value);setTenant(event.target.value);
    }}><option value="">Chọn khách hàng</option>{tenants.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {error&&<p className="alias-error" role="alert">{error}</p>}
    {notice&&<p className="alias-notice" role="status">{notice}</p>}
    <details className="alias-section">
      <summary>Tạo bí danh mới</summary>
      <form className="alias-create" onSubmit={create}>
        <label className="alias-field">Tên bí danh<input required maxLength={64} pattern="[a-zA-Z0-9._+\-]+" value={local} disabled={busy||loading} onChange={event=>setLocal(event.target.value)} placeholder="Ví dụ: sales"/></label>
        <label className="alias-field">Tên miền đã kết nối<select aria-label="Tên miền của bí danh" value={domain} disabled={busy||loading} onChange={event=>setDomain(event.target.value)} required><option value="">Chọn tên miền</option>{domains.map(item=><option key={item.id} value={item.domain}>@{item.domain}</option>)}</select></label>
        <label className="alias-field">Hộp thư nhận<select aria-label="Hộp thư nhận" value={destination} disabled={busy||loading} onChange={event=>setDestination(event.target.value)} required><option value="">Chọn hộp thư</option>{mailboxes.map(item=><option key={item.id} value={item.address}>{item.address}</option>)}</select></label>
        <button type="submit" className="primary" disabled={busy||loading||loadFailed||!local.trim()||!domain||!destination||Boolean(collision)}>{busy?'Đang đồng bộ…':'Tạo bí danh'}</button>
      </form>
      {!loading&&!loadFailed&&tenant&&(!domains.length||!mailboxes.length)&&<p className="alias-hint">Kết nối tên miền và chuẩn bị ít nhất một hộp thư sẵn sàng để tạo bí danh.</p>}
      {collision&&<p className="alias-error">Địa chỉ bí danh đã được dùng hoặc trùng với hộp thư nhận.</p>}
      {local.trim()&&domain&&destination&&!collision&&<p className="alias-preview"><b>{source}</b><ArrowRight size={16}/><b>{destination}</b></p>}
    </details>
    <section className="alias-section" aria-label="Danh sách bí danh" aria-busy={loading}>
      <div className="alias-list-heading"><h3>Danh sách bí danh</h3>{!loading&&!loadFailed&&<span>{shown.length}/{items.length} bí danh</span>}</div>
      <div className="alias-filters">
        <label className="alias-field">Tìm theo địa chỉ<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Bí danh hoặc hộp thư nhận"/></label>
        <label className="alias-field">Trạng thái<select aria-label="Lọc trạng thái bí danh" value={filter} onChange={event=>setFilter(event.target.value)}>
          <option value="all">Tất cả trạng thái</option><option value="active">Đang bật</option><option value="disabled">Đã tắt</option><option value="attention">Hộp thư nhận cần kiểm tra</option>
        </select></label>
      </div>
      {loading?<p role="status">Đang tải bí danh…</p>:loadFailed?<p>Chưa tải được danh sách. Bấm Làm mới để thử lại.</p>:!shown.length?<p>{items.length?'Không tìm thấy bí danh phù hợp.':'Chưa có bí danh.'}</p>:
       <div className="alias-list">{shown.map(item=>{
        const destinationReady=readyAddresses.has(item.destination.toLowerCase());
        return <article className="alias-row" key={item.id}>
          <div className="alias-route"><span>Bí danh <b>{item.source}</b></span><ArrowRight size={16}/><span>Hộp thư nhận <b>{item.destination}</b></span></div>
          <span className="alias-state" data-active={item.active}>{item.active?'Đang bật':'Đã tắt'}</span>
          {!destinationReady&&<span className="alias-warning">Hộp thư nhận cần kiểm tra</span>}
          <button className="ghost" disabled={busy||loading||(!item.active&&!destinationReady)} onClick={()=>void write('/api/api/v1/tenants/'+tenant+'/aliases/'+item.id,{active:!item.active},'PUT')}>{item.active?'Tắt bí danh':'Bật bí danh'}</button>
        </article>;
       })}</div>}
    </section>
  </div>;
}

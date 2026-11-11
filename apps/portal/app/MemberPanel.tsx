'use client';
import {useEffect,useRef,useState} from 'react';
import {UserPlus,RefreshCw,ShieldCheck,ShieldOff} from 'lucide-react';
import './member-panel.css';
import MemberInvites from './MemberInvites';
import {useCustomer} from './CustomerContext';
type Tenant={id:string;name:string};
type Member={id:string;email:string;role:string;status:string};
export default function MemberPanel({ fixedTenantId,onChanged }: { fixedTenantId?: string;onChanged?:()=>void } = {}){
  const customer=useCustomer();
  const [tenants,setTenants]=useState<Tenant[]>([]);
  const [tenant,setTenant]=useState('');
  const [members,setMembers]=useState<Member[]>([]);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [actorEmail,setActorEmail]=useState('');
  const [query,setQuery]=useState('');
  const [roleFilter,setRoleFilter]=useState('');
  const [statusFilter,setStatusFilter]=useState('');
  const [message,setMessage]=useState('');
  const [error,setError]=useState(false);
  const [loading,setLoading]=useState(false);
  const [changing,setChanging]=useState('');
  const [membersLoading,setMembersLoading]=useState(false);
  const [memberLoadError,setMemberLoadError]=useState(false);
  const memberRequest=useRef(0);
  const currentTenant=useRef(tenant);
  currentTenant.current=tenant;
  useEffect(()=>{
    let active=true;
    fetch('/api/api/v1/auth/me').then(response=>response.ok?response.json():null).then(account=>{
      if(active&&typeof account?.email==='string')setActorEmail(account.email.toLowerCase());
    }).catch(()=>{});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    let active=true;
    fetch('/api/api/v1/tenants').then(async response=>{
      if(!response.ok)throw Error('Không tải được danh sách khách hàng.');
      const items=await response.json();
      if(!Array.isArray(items))throw Error('Danh sách khách hàng không hợp lệ.');
      if(!active)return;
      setTenants(items);
      const selected=items.find((item:Tenant)=>item.id===(fixedTenantId??customer.tenantId));
      setTenant(selected?.id||(fixedTenantId?'':items[0]?.id||''));
    }).catch(reason=>{
      if(active){setError(true);setMessage(reason.message);}
    });
    return()=>{active=false;};
  },[fixedTenantId,customer.tenantId]);
  const load=async()=>{
    const target=tenant;
    if(!target||currentTenant.current!==target)return;
    const sequence=++memberRequest.current;
    setMembersLoading(true);setMemberLoadError(false);
    try{
      const r=await fetch(`/api/api/v1/tenants/${target}/members`);
      if(!r.ok)throw new Error('Không tải được danh sách thành viên');
      const items=await r.json();
      if(!Array.isArray(items))throw new Error('Dữ liệu thành viên không hợp lệ');
      if(sequence===memberRequest.current&&currentTenant.current===target)setMembers(items);
    }catch(e){
      if(sequence===memberRequest.current&&currentTenant.current===target){setMemberLoadError(true);setError(true);setMessage(e instanceof Error?e.message:'Không tải được danh sách thành viên');}
    }finally{if(sequence===memberRequest.current&&currentTenant.current===target)setMembersLoading(false);}
  };
  useEffect(()=>{setMembersLoading(false);setMemberLoadError(false);setMembers([]);setMessage('');setEmail('');setPassword('');setQuery('');setRoleFilter('');setStatusFilter('');void load();return()=>{memberRequest.current++;};},[tenant]);

  const create=async()=>{setLoading(true);setError(false);setMessage('');try{const response=await fetch(`/api/api/v1/tenants/${tenant}/members`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,role:"tenant_admin"})});const result=await response.json();if(!response.ok)throw new Error(result.message||'Không thể tạo thành viên');setMessage('Đã tạo tài khoản thành viên thành công.');setEmail('');setPassword('');await load();onChanged?.();}catch(e){setError(true);setMessage(e instanceof Error?e.message:'Không thể tạo thành viên');}finally{setLoading(false);}};
  const changeStatus=async(member:Member)=>{const status=member.status==='active'?'disabled':'active';
    if(status==='disabled'&&(lockReason(member)||!window.confirm(`Khóa tài khoản ${member.email}? Quyền truy cập quản trị sẽ bị chặn ngay.`)))return;
    setChanging(member.id);setError(false);setMessage('');try{const response=await fetch(`/api/api/v1/tenants/${tenant}/members/${member.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});const result=await response.json();if(!response.ok)throw new Error(result.message||'Không thể cập nhật trạng thái');setMessage(status==='disabled'?'Đã khóa tài khoản. Các phiên đăng nhập hiện có cũng bị chặn ngay.':'Đã mở khóa tài khoản.');await load();}catch(e){setError(true);setMessage(e instanceof Error?e.message:'Không thể cập nhật trạng thái');}finally{setChanging('');}};
  const activeAdmins=members.filter(member=>member.role==='tenant_admin'&&member.status==='active').length;
  function lockReason(member:Member) {
    if(member.status!=='active')return '';
    if(actorEmail===member.email.toLowerCase())return 'Bạn đang đăng nhập bằng tài khoản này.';
    if(member.role==='tenant_admin'&&activeAdmins<=1)return 'Doanh nghiệp cần ít nhất một quản trị viên đang hoạt động.';
    return '';
  }

  const shown=members.filter(member=>
    member.email.toLowerCase().includes(query.trim().toLowerCase()) &&
    (!roleFilter||member.role===roleFilter) &&
    (!statusFilter||member.status===statusFilter)
  );

  return <div className="memberPanel">
    <div className="memberToolbar">
      <label>Khách hàng<select aria-label="Khách hàng của thành viên" value={tenant} disabled={loading||Boolean(changing)||Boolean(fixedTenantId)} onChange={event=>{
        memberRequest.current++;
        setMembers([]);
        setMessage('');
        customer.selectTenant(event.target.value);
        setTenant(event.target.value);
      }}><option value="">Chọn khách hàng</option>{tenants.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="ghost" onClick={async()=>{setMessage('');await load();}} disabled={!tenant||loading||membersLoading||Boolean(changing)}><RefreshCw size={14}/> Làm mới thành viên</button>
    </div>

    <MemberInvites key={tenant} tenantId={tenant} onAccepted={()=>{void load();onChanged?.();}}/>
    <details className="memberSection">
      <summary>Tạo trực tiếp bằng mật khẩu ban đầu</summary>
      <form className="memberCreate" onSubmit={event=>{event.preventDefault();if(!loading&&tenant&&!changing)void create();}}>
        <label>Email đăng nhập<input type="email" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="admin@congty.vn"/></label>
        <label>Mật khẩu ban đầu<input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} placeholder="Tối thiểu 12 ký tự"/></label>
        <button type="submit" className="primary" disabled={loading||Boolean(changing)||!tenant||!email||password.length<12}><UserPlus size={16}/> Tạo quản trị viên</button>
      </form>
    </details>
    {message&&<p role={error?'alert':'status'} className={`memberMessage ${error?'memberError':''}`}>{message}</p>}

    <section className="memberSection" aria-label="Danh sách thành viên" aria-busy={membersLoading}>
      <div className="memberListHeading"><h3>Danh sách thành viên</h3>{!membersLoading&&!memberLoadError&&<span>{shown.length}/{members.length} thành viên</span>}</div>
      <div className="memberFilters">
        <label>Email<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Tìm email thành viên"/></label>
        <label>Vai trò<select aria-label="Lọc thành viên theo vai trò" value={roleFilter} onChange={event=>setRoleFilter(event.target.value)}>
          <option value="">Tất cả vai trò</option><option value="tenant_admin">Quản trị doanh nghiệp</option><option value="mailbox_user">Người dùng hộp thư</option>
        </select></label>
        <label>Trạng thái<select aria-label="Lọc thành viên theo trạng thái" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}>
          <option value="">Tất cả trạng thái</option><option value="active">Đang hoạt động</option><option value="disabled">Đã khóa</option>
        </select></label>
      </div>
      {membersLoading?<p className="emptyText" role="status">Đang tải thành viên…</p>:memberLoadError?<p className="emptyText">Chọn Làm mới thành viên để thử lại.</p>:!shown.length?
        <p className="emptyText">{!tenant?'Chọn khách hàng để xem thành viên.':members.length?'Không tìm thấy thành viên phù hợp.':'Chưa có thành viên.'}</p>:
        <div className="memberList">{shown.map(member=>{
          const admin=member.role==='tenant_admin';
          const active=member.status==='active';
          const reason=lockReason(member);
          return <article className="memberRow" key={member.id}>
            <div className="memberIdentity">
              <b>{member.email}</b>
              <span>{admin?'Quản trị doanh nghiệp':'Người dùng hộp thư'}</span>
              <small>{admin?'Quản lý dịch vụ email và thành viên của doanh nghiệp.':'Truy cập webmail theo quyền tài khoản.'}</small>
            </div>
            <em className={active?'':'memberDisabled'}>{active?'Đang hoạt động':'Đã khóa'}</em>
            <div className="memberActionGroup">
              <button className={active?'memberAction memberActionDisable':'memberAction'} disabled={Boolean(changing)||loading||Boolean(reason)} onClick={()=>void changeStatus(member)}>
                {changing===member.id?<RefreshCw className="spin" size={14}/>:active?<ShieldOff size={14}/>:<ShieldCheck size={14}/>} {active?'Khóa':'Mở khóa'}
              </button>
              {reason&&<small>{reason}</small>}
            </div>
          </article>;
        })}</div>}
    </section>
  </div>;
}

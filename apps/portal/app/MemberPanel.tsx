'use client';
import {useEffect,useState} from 'react';
import {UserPlus,RefreshCw,ShieldCheck,ShieldOff} from 'lucide-react';
import './member-panel.css';
type Tenant={id:string;name:string};
type Member={id:string;email:string;role:string;status:string};
export default function MemberPanel(){
  const [tenants,setTenants]=useState<Tenant[]>([]);
  const [tenant,setTenant]=useState('');
  const [members,setMembers]=useState<Member[]>([]);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [role,setRole]=useState('tenant_admin');
  const [message,setMessage]=useState('');
  const [error,setError]=useState(false);
  const [loading,setLoading]=useState(false);
  const [changing,setChanging]=useState('');
  useEffect(()=>{fetch('/api/api/v1/tenants').then(r=>r.ok?r.json():Promise.reject()).then(items=>{setTenants(items);if(items[0])setTenant(items[0].id);}).catch(()=>{setError(true);setMessage('Không tải được danh sách khách hàng. Hãy đăng nhập lại rồi thử lại.');});},[]);
  const load=async()=>{if(!tenant)return;try{const r=await fetch(`/api/api/v1/tenants/${tenant}/members`);if(!r.ok)throw new Error('Không tải được danh sách thành viên');setMembers(await r.json());}catch(e){setError(true);setMessage(e instanceof Error?e.message:'Không tải được danh sách thành viên');}};
  useEffect(()=>{load();},[tenant]);
  const create=async()=>{setLoading(true);setError(false);setMessage('');try{const response=await fetch(`/api/api/v1/tenants/${tenant}/members`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,role})});const result=await response.json();if(!response.ok)throw new Error(result.message||'Không thể tạo thành viên');setMessage('Đã tạo tài khoản thành viên thành công.');setEmail('');setPassword('');await load();}catch(e){setError(true);setMessage(e instanceof Error?e.message:'Không thể tạo thành viên');}finally{setLoading(false);}};
  const changeStatus=async(member:Member)=>{const status=member.status==='active'?'disabled':'active';setChanging(member.id);setError(false);setMessage('');try{const response=await fetch(`/api/api/v1/tenants/${tenant}/members/${member.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});const result=await response.json();if(!response.ok)throw new Error(result.message||'Không thể cập nhật trạng thái');setMessage(status==='disabled'?'Đã khóa tài khoản. Các phiên đăng nhập hiện có cũng bị chặn ngay.':'Đã mở khóa tài khoản.');await load();}catch(e){setError(true);setMessage(e instanceof Error?e.message:'Không thể cập nhật trạng thái');}finally{setChanging('');}};
  return <div className="memberPanel">
    <div className="memberToolbar"><label>Khách hàng<select value={tenant} onChange={e=>setTenant(e.target.value)}><option value="">Chọn khách hàng</option>{tenants.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="ghost" onClick={load} disabled={!tenant}><RefreshCw size={14}/> Làm mới</button></div>
    <div className="memberCreate"><label>Email đăng nhập<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@congty.vn"/></label><label>Mật khẩu ban đầu<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Tối thiểu 12 ký tự"/></label><label>Vai trò<select value={role} onChange={e=>setRole(e.target.value)}><option value="tenant_admin">Quản trị doanh nghiệp</option><option value="mailbox_user">Người dùng hộp thư</option></select></label><button className="primary" disabled={loading||!tenant||!email||password.length<12} onClick={create}>{loading?<RefreshCw className="spin" size={16}/>:<UserPlus size={16}/>} Tạo tài khoản</button></div>
    <p className="memberHint">Đây là tài khoản đăng nhập cổng quản trị 30NICE. Khóa tài khoản sẽ kết thúc quyền truy cập ngay; hộp thư và dữ liệu email không bị xóa.</p>
    {message&&<p className={`memberMessage ${error?'memberError':''}`}>{message}</p>}
    <div className="memberList">{members.map(item=><div className="memberRow" key={item.id}><b>{item.email}</b><span>{item.role==='tenant_admin'?'Quản trị doanh nghiệp':'Người dùng hộp thư'}</span><em className={item.status==='active'?'':'memberDisabled'}>{item.status==='active'?'Đang hoạt động':'Đã khóa'}</em><button className={item.status==='active'?'memberAction memberActionDisable':'memberAction'} disabled={changing===item.id} onClick={()=>changeStatus(item)}>{changing===item.id?<RefreshCw className="spin" size={14}/>:item.status==='active'?<ShieldOff size={14}/>:<ShieldCheck size={14}/>} {item.status==='active'?'Khóa':'Mở khóa'}</button></div>)}{!members.length&&<p className="emptyText">Chưa có thành viên trong khách hàng này.</p>}</div>
  </div>;
}

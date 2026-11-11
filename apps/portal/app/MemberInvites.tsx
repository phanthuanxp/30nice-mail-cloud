'use client';
import {useEffect,useRef,useState} from 'react';
import DnsCopyButton from './DnsCopyButton';
import './product-panels.css';
const invitationLabels:Record<string,string> = {
 pending:'Chờ chấp nhận',accepted:'Đã chấp nhận',expired:'Đã hết hạn',revoked:'Đã thu hồi',
};
type Invitation={id:string;email:string;status:string;expiresAt:string};
export default function MemberInvites({tenantId,onAccepted}:{tenantId:string;onAccepted?:()=>void}){
 const [email,setEmail]=useState(''),[link,setLink]=useState<{id:string;url:string}|null>(null),[rows,setRows]=useState<Invitation[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [filter,setFilter]=useState('');
 const [loaded,setLoaded]=useState(false);
 const sequence=useRef(0),accepted=useRef(''),callback=useRef(onAccepted);callback.current=onAccepted;
 async function request(path='',body?:unknown){const r=await fetch(`/api/api/v1/tenants/${tenantId}/invitations${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.message||'Không hoàn tất lời mời.');return d;}
 async function load(){const id=++sequence.current;if(!tenantId)return;try{const data=await request();if(!Array.isArray(data))throw Error('Dữ liệu lời mời không hợp lệ.');if(id===sequence.current){setRows(data);setLink(current=>current&&data.some((invite:Invitation)=>invite.id===current.id&&invite.status==='pending')?current:null);setLoaded(true);setError('');const next=data.filter((i:Invitation)=>i.status==='accepted').map((i:Invitation)=>i.id).sort().join(',')||'-';if(accepted.current&&next!==accepted.current)callback.current?.();accepted.current=next||'-';}}catch(e){if(id===sequence.current)setError(e instanceof Error?e.message:'Không tải được lời mời.');}}
 useEffect(()=>{setLink(null);setEmail('');setRows([]);setFilter('');setLoaded(false);setError('');accepted.current='';void load();return()=>{sequence.current++;};},[tenantId]);
 const pending=rows.some(r=>r.status==='pending');useEffect(()=>{if(!pending||busy)return;const timer=setInterval(()=>void load(),10000);return()=>clearInterval(timer);},[pending,tenantId,busy]);
 async function action(id?:string){const version=++sequence.current;setBusy(true);setError('');if(!id)setLink(null);try{const result=await request(id?`/${id}/revoke`:'',id?{}:{email});if(version!==sequence.current)return;if(!id){setLink({id:result.id,url:result.activationUrl});setEmail('');}else setLink(current=>current?.id===id?null:current);await load();}catch(e){if(version===sequence.current)setError(e instanceof Error?e.message:'Không hoàn tất lời mời.');}finally{setBusy(false);}}
 const shown=rows.filter(invite=>!filter||invite.status===filter);
 return <section className="productPanel memberSection">
  <h3>Mời quản trị doanh nghiệp</h3>
  <p>Người được mời tự đặt mật khẩu và bật xác thực hai bước. Liên kết dùng một lần và hết hạn sau 48 giờ.</p>
  <form className="productForm" onSubmit={event=>{event.preventDefault();if(!busy&&tenantId)void action();}}>
   <label>Email nhận lời mời<input type="email" required maxLength={320} value={email} disabled={busy||!tenantId} onChange={event=>setEmail(event.target.value)} placeholder="nguoi-quan-tri@doanhnghiep.vn"/></label>
   <button className="primary" disabled={busy||!tenantId}>{busy?'Đang xử lý…':'Tạo liên kết mời'}</button>
  </form>
  {error&&<p className="productError" role="alert">{error}</p>}
  {link&&<div className="productNotice">
   <div><b>Liên kết mời quản trị</b><p>Sao chép và gửi riêng cho người được mời. Tạo lời mời mới cho cùng email sẽ thu hồi liên kết cũ.</p><code style={{overflowWrap:'anywhere'}}>{link.url}</code></div>
   <DnsCopyButton value={link.url} label="Liên kết mời quản trị"/>
  </div>}
  {tenantId&&<div className="memberListHeading">
   <h4>Lời mời {loaded&&`(${rows.length})`}</h4>
   <label>Trạng thái <select aria-label="Lọc trạng thái lời mời" value={filter} onChange={event=>setFilter(event.target.value)}>
    <option value="">Tất cả trạng thái</option>
    {Object.entries(invitationLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
   </select></label>
   <button className="ghost" type="button" disabled={busy} onClick={()=>void load()}>Làm mới lời mời</button>
  </div>}
  {tenantId&&!loaded&&!error&&<p role="status">Đang tải lời mời…</p>}
  {loaded&&!shown.length&&<p>{rows.length?'Không có lời mời phù hợp.':'Chưa có lời mời.'}</p>}
  {shown.map(invite=><div className="productRow" key={invite.id}>
   <b>{invite.email}</b><span className="memberInviteStatus" data-status={invite.status}>{invitationLabels[invite.status]||invite.status}</span>
   <small>Hạn dùng {new Date(invite.expiresAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</small>
   {invite.status==='pending'&&<button className="ghost" disabled={busy} onClick={()=>void action(invite.id)}>Thu hồi lời mời</button>}
  </div>)}
 </section>;
}

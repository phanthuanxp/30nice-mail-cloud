'use client';

import {useEffect,useState} from 'react';
import DnsCopyButton from './DnsCopyButton';

type Password={id:string;name:string;active:boolean};

export default function SmtpPasswords({endpoint,canCreate}:{endpoint:string;canCreate:boolean}){
 const [items,setItems]=useState<Password[]|null>(null);
 const [name,setName]=useState('');
 const [password,setPassword]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0);

 useEffect(()=>{
  const controller=new AbortController();
  setItems(null);
  fetch(endpoint,{cache:'no-store',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('Chưa tải được danh sách mật khẩu SMTP.');
   const rows=await response.json();
   if(!Array.isArray(rows))throw Error('Danh sách mật khẩu SMTP không hợp lệ.');
   if(!controller.signal.aborted)setItems(rows);
  }).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);});
  return()=>controller.abort();
 },[endpoint,revision]);

 async function change(id?:string){
  setBusy(true);
  setError('');
  if(!id)setPassword('');
  try{
   const response=await fetch(id?`${endpoint}/${id}/revoke`:endpoint,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(id?{}:{name}),
   });
   const result=await response.json();
   if(!response.ok)throw Error(result.message||'Thao tác chưa hoàn tất.');
   if(id)setPassword('');
   else{setPassword(result.password);setName('');}
  }catch(reason){setError(reason instanceof Error?reason.message:'Thao tác chưa hoàn tất.');}
  finally{setBusy(false);setRevision(value=>value+1);}
 }

 return <section className="smtpCredentials" aria-label="Mật khẩu ứng dụng SMTP">
  <h4>Mật khẩu ứng dụng SMTP</h4>
  <p>Tạo một mật khẩu cho mỗi website. Dùng địa chỉ hộp thư làm tên đăng nhập. Sau khi thu hồi, kết nối mới có thể mất đến 5 phút để bị chặn.</p>
  {canCreate&&<form onSubmit={event=>{event.preventDefault();if(!busy&&items&&name.trim())void change();}}>
   <label>Tên website<input value={name} maxLength={48} required onChange={event=>setName(event.target.value)} placeholder="Ví dụ WordPress bán hàng"/></label>
   <button className="primary" disabled={busy||!items||!name.trim()}>Tạo mật khẩu SMTP</button>
  </form>}
  {password&&<div className="mailboxPasswordReveal">
   <div><b>Sao chép mật khẩu ngay</b><code>{password}</code><small>Mật khẩu chỉ hiển thị sau khi tạo.</small></div>
   <DnsCopyButton value={password} label="Mật khẩu ứng dụng SMTP"/>
   <button type="button" className="ghost" onClick={()=>setPassword('')}>Ẩn mật khẩu</button>
  </div>}
  {error&&<p role="alert" className="mailboxMessage error">{error}</p>}
  {!items&&<button type="button" className="ghost" disabled={busy} onClick={()=>{setError('');setRevision(value=>value+1);}}>Tải lại danh sách</button>}
  {items?.length===0&&<p>Chưa có mật khẩu SMTP.</p>}
  {items?.map(item=><div className="smtpCredentialRow" key={item.id}>
   <b>{item.name}</b><span>{item.active?'Đang bật':'Đã tắt'}</span>
   <button type="button" className="ghost" disabled={busy} onClick={()=>{if(window.confirm(`Thu hồi mật khẩu SMTP của ${item.name}?`))void change(item.id);}}>Thu hồi</button>
  </div>)}
 </section>;
}

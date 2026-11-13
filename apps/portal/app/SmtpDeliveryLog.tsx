'use client';

import {useEffect,useState} from 'react';
import './smtp-delivery-log.css';

type Delivery={
 queueId:string;mailbox:string;recipient:string;status:'sent'|'deferred'|'bounced';
 submittedAt:string;updatedAt:string;dsn:string|null;reason:string;
};
const labels={sent:'Máy chủ nhận đã chấp nhận',deferred:'Chờ gửi lại',bounced:'Gửi thất bại'};
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'});
const time=new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'});

export default function SmtpDeliveryLog({tenantId}:{tenantId:string}){
 const [rows,setRows]=useState<Delivery[]|null>(null);
 const [error,setError]=useState(false);
 const [revision,setRevision]=useState(0);
 const [mailbox,setMailbox]=useState('');
 const [recipient,setRecipient]=useState('');
 const [status,setStatus]=useState('');
 const [from,setFrom]=useState('');
 const [until,setUntil]=useState('');
 const [page,setPage]=useState(0);

 useEffect(()=>{
  const controller=new AbortController();
  setRows(null);
  setError(false);
  fetch(`/api/api/v1/tenants/${tenantId}/smtp-deliveries`,{signal:controller.signal,cache:'no-store'}).then(async response=>{
   if(!response.ok)throw Error('Không tải được nhật ký SMTP');
   const result=await response.json();
   if(!Array.isArray(result))throw Error('Dữ liệu nhật ký SMTP không hợp lệ');
   if(!controller.signal.aborted)setRows(result);
  }).catch(()=>{if(!controller.signal.aborted)setError(true);});
  return()=>controller.abort();
 },[tenantId,revision]);

 const invalid=Boolean(from&&until&&from>until);
 const filtered=invalid?[]:(rows??[]).filter(row=>{
  const day=date.format(new Date(row.updatedAt));
  return (!mailbox||row.mailbox===mailbox) &&
   row.recipient.toLowerCase().includes(recipient.trim().toLowerCase()) &&
   (!from||day>=from) && (!until||day<=until);
 });
 const counts=new Map<string,{total:number;deferred:number;bounced:number}>();
 for(const row of filtered){
  const count=counts.get(row.mailbox)??{total:0,deferred:0,bounced:0};
  count.total++;
  if(row.status==='deferred')count.deferred++;
  if(row.status==='bounced')count.bounced++;
  counts.set(row.mailbox,count);
 }
 const shown=filtered.filter(row=>!status||row.status===status);
 const pageCount=Math.ceil(shown.length/25);
 const current=Math.min(page,Math.max(0,pageCount-1));

 return <section className="smtpLog" aria-label="Nhật ký SMTP">
  <div className="smtpLogHeader">
   <h3>Nhật ký SMTP</h3>
   <button className="ghost" type="button" disabled={!rows&&!error} onClick={()=>setRevision(value=>value+1)}>Làm mới nhật ký</button>
  </div>
  <p>Tra cứu thư gửi qua SMTP có xác thực trong tối đa 5.000 dòng Postfix gần nhất. Thời gian hiển thị theo giờ Việt Nam.</p>
  {error?<p className="mailboxMessage error" role="alert">Chưa tải được nhật ký SMTP. Bấm Làm mới nhật ký để thử lại.</p>:!rows?<p role="status">Đang tải nhật ký…</p>:<>
   <div className="smtpLogFilters">
    <label>Hộp thư gửi<select aria-label="Hộp thư gửi" value={mailbox} onChange={event=>{setMailbox(event.target.value);setPage(0);}}>
     <option value="">Tất cả hộp thư</option>{[...new Set(rows.map(row=>row.mailbox))].sort().map(address=><option key={address}>{address}</option>)}
    </select></label>
    <label>Người nhận<input type="search" value={recipient} onChange={event=>{setRecipient(event.target.value);setPage(0);}} placeholder="Tìm địa chỉ nhận"/></label>
    <label>Trạng thái<select aria-label="Trạng thái gửi" value={status} onChange={event=>{setStatus(event.target.value);setPage(0);}}>
     <option value="">Tất cả trạng thái</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </select></label>
    <label>Từ ngày<input type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(0);}}/></label>
    <label>Đến ngày<input type="date" value={until} onChange={event=>{setUntil(event.target.value);setPage(0);}}/></label>
   </div>
   {invalid?<p role="alert">Ngày kết thúc cần bằng hoặc sau ngày bắt đầu.</p>:<>
    {!!counts.size&&<details className="smtpLogSummary">
     <summary>Tổng hợp theo hộp thư · {counts.size} hộp thư</summary>
     <p>Số lượt theo người nhận. Tổng hợp áp dụng bộ lọc hộp thư, người nhận và ngày.</p>
     {[...counts].map(([address,count])=><div key={address}><b>{address}</b><span>{count.total} lượt · {count.deferred} chờ gửi lại · {count.bounced} thất bại</span></div>)}
    </details>}
    <p role="status">{shown.length} kết quả</p>
    {!shown.length?<p>Chưa có kết quả gửi phù hợp trong nhật ký hiện có.</p>:
     <div className="smtpLogTable" role="region" tabIndex={0} aria-label="Kết quả gửi SMTP">
      <table><thead><tr><th scope="col">Cập nhật</th><th scope="col">Hộp thư gửi</th><th scope="col">Người nhận</th><th scope="col">Kết quả</th></tr></thead>
       <tbody>{shown.slice(current*25,(current+1)*25).map((row,index)=><tr key={row.queueId+row.recipient+row.submittedAt+index}>
        <td>{time.format(new Date(row.updatedAt))}</td><td>{row.mailbox}</td><td>{row.recipient}</td>
        <td><b className="smtpLogState" data-state={row.status}>{labels[row.status]}</b>
         <small>Mã thư {row.queueId}{row.dsn&&` · DSN ${row.dsn}`}</small>
         {row.reason&&<details><summary>Phản hồi máy chủ</summary><p>{row.reason}</p></details>}
        </td>
       </tr>)}</tbody>
      </table>
     </div>}
    {pageCount>1&&<div className="smtpLogHeader">
     <button className="ghost" type="button" disabled={current===0} onClick={()=>setPage(current-1)}>Trang trước</button>
     <span>Trang {current+1}/{pageCount}</span>
     <button className="ghost" type="button" disabled={current+1===pageCount} onClick={()=>setPage(current+1)}>Trang sau</button>
    </div>}
   </>}
  </>}
 </section>;
}

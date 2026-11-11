'use client';

import {useEffect,useState} from 'react';
import {Activity,ArrowUpRight,Database,HardDrive,RefreshCw,Server,Workflow} from 'lucide-react';
import './operations-panel.css';

type DomainIssue={tenantId:string;name:string;domain:string;ownershipStatus:string;provisioningStatus:string;mailboxIssues:number};
type FailedJob={id:string;tenantId:string;name:string;address:string;status:string;attempts:number;updatedAt:string};
type Snapshot={
 workers:{name:string;healthy:boolean;lastSeen:string}[];
 domains:DomainIssue[];
 failedJobs:FailedJob[];
 jobs:{status:string;count:number}[];
 backupAt:string|null;
 monitor:{healthy:boolean;checkedAt:string}|null;
 checkedAt:string;
};
type AuditEntry={id:string;actorEmail:string;action:string;resourceType:string;createdAt:string};
type Props={
 apiOnline?:boolean;
 databaseOnline?:boolean;
 mailOnline?:boolean;
 onRefreshHealth:()=>void;
 onNavigate:(page:'Tên miền'|'Hộp thư',tenantId:string)=>void;
};
const zone='Asia/Ho_Chi_Minh';
const time=new Intl.DateTimeFormat('vi-VN',{timeZone:zone,dateStyle:'short',timeStyle:'short'});
const dateKey=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
const jobLabels:Record<string,string>={queued:'Đang chờ',running:'Đang xử lý',succeeded:'Đã xác nhận',failed:'Thất bại',dead_letter:'Cần đối soát'};
const showTime=(value?:string|null)=>value&&Number.isFinite(Date.parse(value))?time.format(new Date(value)):'Chưa có dữ liệu';
const statusText=(online?:boolean)=>online===true?'Đang hoạt động':online===false?'Cần kiểm tra':'Chưa xác nhận';

async function read<T>(url:string,signal:AbortSignal):Promise<T>{
 const response=await fetch(url,{signal,cache:'no-store'});
 if(!response.ok)throw Error('Không tải được dữ liệu.');
 return response.json();
}

export default function OperationsPanel({apiOnline,databaseOnline,mailOnline,onRefreshHealth,onNavigate}:Props){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [audit,setAudit]=useState<AuditEntry[]|null>(null);
 const [error,setError]=useState(false);
 const [auditError,setAuditError]=useState(false);
 const [busy,setBusy]=useState(true);
 const [revision,setRevision]=useState(0);
 const [actor,setActor]=useState('');
 const [action,setAction]=useState('');
 const [from,setFrom]=useState('');
 const [until,setUntil]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>;
  async function refresh(){
   setBusy(true);
   const [ops,entries]=await Promise.allSettled([
    read<Snapshot>('/api/api/v1/operations',controller.signal),
    read<AuditEntry[]>('/api/api/v1/audit',controller.signal),
   ]);
   if(controller.signal.aborted)return;
   setError(ops.status==='rejected');
   if(ops.status==='fulfilled')setSnapshot(ops.value);
   setAuditError(entries.status==='rejected');
   if(entries.status==='fulfilled')setAudit(entries.value);
   setBusy(false);
   timer=setTimeout(()=>void refresh(),30000);
  }
  void refresh();
  return()=>{controller.abort();clearTimeout(timer);};
 },[revision]);

 const workers=snapshot?.workers;
 const workerOnline=workers?.length?workers.every(worker=>worker.healthy):undefined;
 const lastWorker=workers?.reduce((latest,worker)=>worker.lastSeen>latest?worker.lastSeen:latest,'');
 const backupAt=snapshot?.backupAt;
 const cards=[
  {name:'API quản trị',icon:Activity,online:apiOnline},
  {name:'PostgreSQL',icon:Database,online:databaseOnline},
  {name:'Mailcow',icon:Server,online:mailOnline},
  {name:'Tiến trình cấp phát',icon:Workflow,online:workerOnline,detail:showTime(lastWorker)},
 ];
 const domainIssues=snapshot?.domains.filter(domain=>domain.provisioningStatus!=='ready'||domain.mailboxIssues>0)??[];
 const invalidRange=Boolean(from&&until&&from>until);
 const shown=(audit??[]).filter(entry=>{
  const day=Number.isFinite(Date.parse(entry.createdAt))?dateKey.format(new Date(entry.createdAt)):'';
  return (entry.actorEmail??'Hệ thống').toLowerCase().includes(actor.trim().toLowerCase()) &&
   (!action||entry.action===action) && (!from||(day&&day>=from)) && (!until||(day&&day<=until));
 });
 const actions=[...new Set((audit??[]).map(entry=>entry.action))].sort();

 return <div className="opsConsole">
  <div className="opsHeading">
   <div><h3>Tình trạng dịch vụ</h3><p>{snapshot?`Cập nhật lúc ${showTime(snapshot.checkedAt)} · Giờ Việt Nam`:'Đang đọc trạng thái hệ thống'}</p></div>
   <button type="button" className="ghost" disabled={busy} onClick={()=>{onRefreshHealth();setRevision(value=>value+1);}}><RefreshCw size={15}/> Làm mới</button>
  </div>
  {error&&<p className="productError" role="alert">Chưa tải được trạng thái vận hành. Các số liệu còn hiển thị thuộc lần cập nhật trước.</p>}
  <div className="opsCards">
   {cards.map(({name,icon:Icon,online,detail})=><article className="opsCard" key={name}>
    <Icon size={19}/><b>{name}</b><span className="opsBadge" data-state={online===true?'good':online===false?'warn':'unknown'}>{statusText(online)}</span>
    {detail&&<small>Tín hiệu gần nhất · {detail}</small>}
   </article>)}
   <article className="opsCard"><HardDrive size={19}/><b>Sao lưu gần nhất</b><span>{showTime(backupAt)}</span>
    {backupAt&&<small>Đã tải lên và kiểm tra bản sao</small>}
   </article>
   <article className="opsCard"><Activity size={19}/><b>Giám sát VPS</b><span>{snapshot?.monitor?statusText(snapshot.monitor.healthy):'Chưa có báo cáo'}</span>
    {snapshot?.monitor&&<small>{showTime(snapshot.monitor.checkedAt)}</small>}
   </article>
  </div>

  <section className="opsSection" aria-label="Sự cố cần xử lý">
   <h3>Sự cố cần xử lý</h3>
   {snapshot&&<div className="opsJobs">{snapshot.jobs.map(job=><span className="opsBadge" key={job.status}>{jobLabels[job.status]||job.status} · {job.count}</span>)}</div>}
   {!snapshot&&!error&&<p role="status">Đang tải tác vụ và tên miền…</p>}
   {snapshot&&!domainIssues.length&&!snapshot.failedJobs.length&&<p>Chưa ghi nhận sự cố cấp phát hoặc tên miền cần đối soát.</p>}
   {snapshot?.failedJobs.map(job=><article className="opsIssue" key={job.id}>
    <div><b>{job.address}</b><small>{job.name} · {jobLabels[job.status]||job.status} · {job.attempts} lần xử lý · {showTime(job.updatedAt)}</small></div>
    <button type="button" className="ghost" onClick={()=>onNavigate('Hộp thư',job.tenantId)}>Xem cấp phát <ArrowUpRight size={14}/></button>
   </article>)}
   {domainIssues.map(domain=><article className="opsIssue" key={domain.domain}>
    <div><b>{domain.domain}</b><small>{domain.name}{domain.provisioningStatus!=='ready'?(domain.ownershipStatus==='verified'?' · Cần kiểm tra kết nối':' · Chờ xác minh'):''}{domain.mailboxIssues>0?` · ${domain.mailboxIssues} hộp thư cần đối soát`:''}</small></div>
    {domain.provisioningStatus!=='ready'&&<button type="button" className="ghost" onClick={()=>onNavigate('Tên miền',domain.tenantId)}>Tên miền <ArrowUpRight size={14}/></button>}
    {domain.mailboxIssues>0&&<button type="button" className="ghost" onClick={()=>onNavigate('Hộp thư',domain.tenantId)}>Hộp thư <ArrowUpRight size={14}/></button>}
   </article>)}
  </section>

  <section className="opsSection" aria-label="Nhật ký quản trị">
   <h3>Nhật ký quản trị</h3>
   <p>Lọc trong tối đa 100 bản ghi gần nhất theo giờ Việt Nam.</p>
   <div className="opsFilters">
    <label>Tài khoản<input type="search" value={actor} onChange={event=>setActor(event.target.value)} placeholder="Tìm email"/></label>
    <label>Thao tác<select aria-label="Lọc thao tác nhật ký" value={action} onChange={event=>setAction(event.target.value)}>
     <option value="">Tất cả thao tác</option>{actions.map(item=><option key={item}>{item}</option>)}
    </select></label>
    <label>Từ ngày<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label>
    <label>Đến ngày<input type="date" value={until} onChange={event=>setUntil(event.target.value)}/></label>
   </div>
   {auditError&&<p className="productError" role="alert">Chưa tải được nhật ký. Bấm Làm mới để thử lại.</p>}
   {invalidRange?<p role="alert">Ngày kết thúc cần bằng hoặc sau ngày bắt đầu.</p>:audit?
    <><p role="status">{shown.length}/{audit.length} bản ghi</p>
    {shown.length>0?<div className="productTableScroll" role="region" aria-label="Kết quả nhật ký" tabIndex={0}>
     <table className="opsAudit"><thead><tr><th scope="col">Thời gian</th><th scope="col">Tài khoản</th><th scope="col">Thao tác</th><th scope="col">Tài nguyên</th></tr></thead>
      <tbody>{shown.map(entry=><tr key={entry.id}><td>{showTime(entry.createdAt)}</td><td>{entry.actorEmail||'Hệ thống'}</td><td>{entry.action}</td><td>{entry.resourceType||'—'}</td></tr>)}</tbody>
     </table>
    </div>:<p>Không có bản ghi phù hợp.</p>}</>:!auditError&&<p role="status">Đang tải nhật ký…</p>}
  </section>
 </div>;
}

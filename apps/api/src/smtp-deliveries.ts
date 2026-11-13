export type PostfixLine = {message:string;program:string;time:string|number};
type DeliveryStatus = 'sent'|'deferred'|'bounced';
export type Delivery = {
  queueId:string; mailbox:string; recipient:string; status:DeliveryStatus;
  submittedAt:string; updatedAt:string; dsn:string|null; reason:string;
};

export function smtpDeliveries(lines:PostfixLine[], allowedMailboxes:Set<string>):Delivery[]{
  const queues=new Map<string,{mailbox:string;submittedAt:string;deliveries:Map<string,Delivery>}>();
  const rows:Delivery[]=[];
  // Mailcow returns newest entries first. Reverse a copy to preserve order within a second.
  for(const line of [...lines].reverse()){
    if(typeof line?.message!=='string'||typeof line.program!=='string')continue;
    const timestamp=Number(line.time)*1000;
    if(!Number.isFinite(timestamp)||timestamp<=0||timestamp>8.64e15)continue;
    const at=new Date(timestamp).toISOString();
    const match=line.message.match(/^([A-Za-z0-9]{5,30}): (.*)$/);
    if(!match)continue;
    const [,queueId,message]=match;
    if(/\/smtpd$/.test(line.program)&&message.startsWith('client=')){
      const mailbox=message.match(/, sasl_method=[A-Za-z0-9_-]+, sasl_username=([^,\s]+)$/)?.[1].toLowerCase();
      queues.delete(queueId);
      if(mailbox&&allowedMailboxes.has(mailbox)){
        queues.set(queueId,{mailbox,submittedAt:at,deliveries:new Map()});
      }
      continue;
    }
    const queue=queues.get(queueId);
    if(!queue)continue;
    if(/\/qmgr$/.test(line.program)&&message==='removed'){
      queues.delete(queueId);
      continue;
    }
    if(!/\/(smtp|lmtp|local|virtual|error)$/.test(line.program))continue;
    const recipient=message.match(/^to=<([^<>\s]{1,320})>/)?.[1];
    const outcome=message.match(/, dsn=(\d\.\d{1,3}\.\d{1,3}), status=(sent|deferred|bounced) \((.*)\)$/);
    if(!recipient||!outcome)continue;
    const [,dsn,status,reason]=outcome;
    const key=recipient.toLowerCase();
    const previous=queue.deliveries.get(key);
    if(previous){
      Object.assign(previous,{status,updatedAt:at,dsn,reason:reason.slice(0,500)});
    }else{
      const delivery:Delivery={queueId,mailbox:queue.mailbox,recipient,status:status as DeliveryStatus,submittedAt:queue.submittedAt,updatedAt:at,dsn,reason:reason.slice(0,500)};
      queue.deliveries.set(key,delivery);
      rows.push(delivery);
    }
  }
  return rows.sort((left,right)=>right.updatedAt.localeCompare(left.updatedAt));
}

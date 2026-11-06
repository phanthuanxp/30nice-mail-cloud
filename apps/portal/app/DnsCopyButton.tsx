'use client';
import {useEffect,useState} from 'react';
import {CheckCircle2,Copy,LoaderCircle} from 'lucide-react';
import './domain-wizard.css';
export default function DnsCopyButton({value,label}:{value:string;label:string}){
  const [state,setState]=useState<'idle'|'copying'|'copied'|'error'>('idle');
  useEffect(()=>{if(state!=='copied'&&state!=='error')return;const timer=setTimeout(()=>setState('idle'),2500);return()=>clearTimeout(timer);},[state]);
  const status=state==='copied'?'Đã sao chép':state==='error'?'Không thể sao chép. Hãy thử lại.':state==='copying'?'Đang sao chép':'Sao chép';
  async function copy(){
    setState('copying');
    try{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(value);setState('copied');}
    catch{setState('error');}
  }
  return <span className="dnsCopyWrap"><button type="button" className={`copy dnsCopyButton ${state==='copied'?'isCopied':''}`} onClick={()=>void copy()} disabled={state==='copying'} title={status} aria-label={`${status}: ${label}`}>{state==='copied'?<CheckCircle2 size={18}/>:state==='copying'?<LoaderCircle className="spin" size={18}/>:<Copy size={18}/>}</button><span className={`dnsCopyFeedback ${state==='error'?'isError':''}`} role="status" aria-live="polite">{state==='copied'||state==='error'?status:''}</span></span>;
}

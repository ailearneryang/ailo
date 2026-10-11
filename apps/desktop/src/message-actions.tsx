import React,{useEffect,useState} from 'react';
import type {Message} from './types';
import {Icon} from './icon';

export function MessageActions({message,createdAt,onEdit,disabled}:{message:Message;createdAt?:string;onEdit?:()=>void;disabled:boolean}){
 const [copied,setCopied]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),2000);return()=>clearTimeout(timer);},[copied]);
 const date=createdAt?new Date(createdAt):null;
 const valid=date&&Number.isFinite(date.getTime());
 const parts=valid?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date):[];
 const part=(type:string)=>parts.find(p=>p.type===type)?.value;
 const content=message.content||message.materials?.map(m=>m.name).join('\n')||'';
 async function copy(){try{await navigator.clipboard.writeText(content);setError('');setCopied(true);}catch{setCopied(false);setError('复制失败，请选中文字后复制');}}
 return <div className="message-actions" data-copy-error={!!error}>
  {valid?<time className="message-date" dateTime={date.toISOString()} title={date.toLocaleString('zh-CN')}>{part('month')}月{part('day')}日 {part('hour')}:{part('minute')}</time>:<span className="message-date" title="此历史消息未记录发送时间">时间未记录</span>}
  <button type="button" title={copied?'已复制':'复制消息'} aria-label={copied?'已复制':'复制消息'} disabled={!content} onClick={()=>void copy()}><Icon name={copied?'check':'copy'}/></button>
  {onEdit&&<button type="button" title="编辑消息" aria-label="编辑消息" disabled={disabled} onClick={onEdit}><Icon name="edit"/></button>}
  {error&&<span className="message-copy-error" role="status">{error}</span>}
 </div>;
}

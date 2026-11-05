import React,{useEffect,useState,useRef} from 'react';
import type {Message} from './types';
import {Icon} from './icon';

export function MessageActions({message,createdAt,onEdit,onBranch,onRegenerate,onFeedback,disabled}:{message:Message;createdAt?:string;onEdit?:()=>void;onBranch?:()=>void;onRegenerate?:()=>void;onFeedback?:(rating:'up'|'down'|null)=>Promise<void>;disabled:boolean}){
 const [copied,setCopied]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),2000);return()=>clearTimeout(timer);},[copied]);
 const feedbackLock=useRef(false);const [savingFeedback,setSavingFeedback]=useState(false);
 async function rate(rating:'up'|'down'){if(!onFeedback||feedbackLock.current)return;feedbackLock.current=true;setSavingFeedback(true);try{await onFeedback(message.feedback?.rating===rating?null:rating);setError('');}catch{setError('评价保存失败，请重试');}finally{feedbackLock.current=false;setSavingFeedback(false);}}
 const usage=message.replyDetails?.usage;
 const actualModels=usage?.models||[];
 const primary=[...actualModels].reverse().find(m=>m.lane==='primary')||actualModels.at(-1);
 const modelNames=[...new Set(actualModels.map(m=>m.name||m.model||'模型未记录'))];
 const modelName=primary?.name||primary?.model||message.modelName||'模型未记录';
 const usageTitle=usage?`输入 ${usage.inputTokens.toLocaleString()} · 输出 ${usage.outputTokens.toLocaleString()} Tokens${usage.reasoningTokens?`（含推理 ${usage.reasoningTokens.toLocaleString()}）`:''}；${usage.reportedRequests}/${usage.requestCount} 次请求返回完整用量`: '服务未返回用量，或历史回答未记录用量';
 const date=createdAt?new Date(createdAt):null;
 const valid=date&&Number.isFinite(date.getTime());
 const parts=valid?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date):[];
 const part=(type:string)=>parts.find(p=>p.type===type)?.value;
 const content=message.content||message.materials?.map(m=>m.name).join('\n')||'';
 async function copy(){try{await navigator.clipboard.writeText(content);setError('');setCopied(true);}catch{setCopied(false);setError('复制失败，请选中文字后复制');}}
 return <div className="message-actions" data-copy-error={!!error}>
  {valid?<time className="message-date" dateTime={date.toISOString()} title={date.toLocaleString('zh-CN')}>{part('month')}月{part('day')}日 {part('hour')}:{part('minute')}</time>:<span className="message-date" title="此历史消息未记录发送时间">时间未记录</span>}
  <button type="button" title={copied?'已复制':'复制消息'} aria-label={copied?'已复制':'复制消息'} disabled={!content} onClick={()=>void copy()}><Icon name={copied?'check':'copy'}/></button>
  {onFeedback&&(['up','down'] as const).map(rating=><button key={rating} type="button" title={rating==='up'?'有帮助':'没有帮助'} aria-label={rating==='up'?'有帮助':'没有帮助'} aria-pressed={message.feedback?.rating===rating} disabled={savingFeedback} onClick={()=>void rate(rating)}><Icon name={rating==='up'?'thumbs-up':'thumbs-down'}/></button>)}
  {onEdit&&<button type="button" title="编辑消息" aria-label="编辑消息" disabled={disabled} onClick={onEdit}><Icon name="edit"/></button>}
  {onBranch&&<button type="button" title="从此处创建新分支" aria-label="从此处创建新分支" disabled={disabled} onClick={onBranch}><Icon name="branch"/></button>}
  {onRegenerate&&<button type="button" title="重新生成，保留原回答为独立分支" aria-label="重新生成（新分支）" disabled={disabled} onClick={onRegenerate}><Icon name="refresh"/></button>}
  {message.role==='assistant'&&<span className="reply-metadata"><span title={usageTitle}>{usage?.reportedRequests?`${usage.reportedRequests===usage.requestCount?'共消耗':'已报告'} ${usage.totalTokens.toLocaleString()} Tokens${usage.reportedRequests<usage.requestCount?'（部分）':''}`:'Token 用量未提供'}</span><span className="reply-model" title={actualModels.length?actualModels.map(m=>`${m.name||m.model||'模型未记录'}${m.model&&m.name!==m.model?' · '+m.model:''}（${m.lane||'primary'}）`).join('\n'):modelName}><Icon name="sparkles"/>{modelName}{modelNames.length>1?` +${modelNames.length-1}`:''}</span></span>}
  {error&&<span className="message-copy-error" role="status">{error}</span>}
 </div>;
}

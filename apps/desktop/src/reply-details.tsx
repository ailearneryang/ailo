import {useRef,type ReactNode} from 'react';
import type {Message} from './types';
import {replyProcessStatus} from './execution-process';
import {ExecutionStatuses} from './execution-statuses';
import {ExecutionEvents} from './task-progress';
import {ExecutionStory} from './execution-story';
import {ExecutionIcon} from './execution-icon';

export function formatReplyDuration(ms:number):string {
  const seconds=Math.max(1,Math.floor(ms/1000));
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
  return [hours?`${hours}小时`:'',minutes?`${minutes}分钟`:'',rest?`${rest}秒`:''].filter(Boolean).join(' ');
}
export function ReplyDetails({message,children}:{message:Message;children?:ReactNode}) {
  const content=useRef<HTMLDivElement>(null);
  const details=message.replyDetails;
  if(!details||!Number.isFinite(details.durationMs)||details.durationMs<0)return null;
  return <details className="reply-details" onToggle={e=>{if(e.currentTarget.open&&content.current)content.current.scrollTop=0;}}>
    <summary title="本轮执行流程状态；具体结果与核验情况见正文">{replyProcessStatus(details.status)} {formatReplyDuration(details.durationMs)} <span className="reply-details-chevron" aria-hidden="true">›</span></summary>
    <div ref={content} className="reply-details-content" tabIndex={0} aria-label="本轮执行过程">
      {!!details.loadedExtensions?.length&&<div className="execution-process-skills" aria-label="本轮加载的技能与专家">{details.loadedExtensions.map(item=><span key={item.id} title={item.reason}><ExecutionIcon kind={item.kind}/><span>{item.source==='auto'?'自动加载':'加载'}{item.kind==='skill'?'技能':'专家'} · {item.name}</span></span>)}</div>}
      <ExecutionStory events={details.events||[]}/>
      <details className="process-diagnostics"><summary>详细执行记录</summary>
      {['waiting_permission','waiting_user'].includes(details.status||'')?<p className="muted">等待完成授权、选择或补充关键资料，提交后继续执行。</p>:<p className="muted">本轮执行流程已完成，实际结果与核验情况见正文。</p>}
      {message.modelName&&<p>模型：{message.modelName}</p>}
      <p>开始：{new Date(details.startedAt).toLocaleString('zh-CN')}</p>
      <p>结束：{new Date(details.completedAt).toLocaleString('zh-CN')}</p>
      <p className="muted">用时包含准备、排队、模型响应和工具执行。</p>
      {details.goal&&<p>{details.goal}</p>}
      {details.modelRoutes?.map((route,i)=><p key={'route-'+i}>{route.message} · {new Date(route.at).toLocaleTimeString('zh-CN')}</p>)}
      {!!details.visualReviews?.length&&<p>视觉分析：{[...new Set(details.visualReviews.map(r=>r.modelName))].join('、')} · 观察结果仍须按任务要求核验</p>}
      {details.eventsTruncated&&<p className="muted">仅展示最近 {details.events?.length} 条过程记录，共 {details.eventCount} 条。</p>}
      <ExecutionStatuses statuses={details.statuses}/><ExecutionEvents events={details.events||[]}/>
      {children}
      </details>
    </div>
  </details>;
}

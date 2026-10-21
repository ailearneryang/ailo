import type {Message} from './types';
import {ExecutionEvents} from './task-progress';

export function formatReplyDuration(ms:number):string {
  const seconds=Math.max(1,Math.floor(ms/1000));
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
  return [hours?`${hours}小时`:'',minutes?`${minutes}分钟`:'',rest?`${rest}秒`:''].filter(Boolean).join(' ');
}
export function ReplyDetails({message}:{message:Message}) {
  const details=message.replyDetails;
  if(!details||!Number.isFinite(details.durationMs)||details.durationMs<0)return null;
  return <details className="reply-details">
    <summary>用时 {formatReplyDuration(details.durationMs)} <span className="reply-details-chevron" aria-hidden="true">&gt;</span></summary>
    <div className="reply-details-content">
      {message.modelName&&<p>模型：{message.modelName}</p>}
      <p>开始：{new Date(details.startedAt).toLocaleString('zh-CN')}</p>
      <p>结束：{new Date(details.completedAt).toLocaleString('zh-CN')}</p>
      <p className="muted">用时包含准备、排队、模型响应和工具执行。</p>
      {details.goal&&<p>{details.goal}</p>}
      {!!details.events?.length&&<ExecutionEvents events={details.events}/>}
    </div>
  </details>;
}

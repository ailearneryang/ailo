export function queuedDispatch(input:{requested?:boolean;ready:boolean;composerBusy:boolean;sending:boolean;paused:boolean;editing:boolean;taskId?:string;pendingTaskId?:string|null;requestId?:string|null;phase?:string;blocked?:boolean}):'steer'|'start'|'wait'{
  if(!input.ready||input.composerBusy||input.sending||input.paused||input.editing||!input.taskId)return 'wait';
  // Submitted commands remain visible as individual queue rows while a task
  // runs. Only that row's Run button may send it into the current execution.
  if(input.pendingTaskId)return input.requested===true&&input.pendingTaskId===input.taskId&&!!input.requestId&&input.phase==='running'?'steer':'wait';
  return input.requestId||input.blocked?'wait':'start';
}
export type QueueTask={id:string;archived?:boolean;assistantPaused?:boolean;lastError?:string;messages?:{id:string;role:string;clarification?:unknown}[];agentRun?:{status?:string;currentOutcome?:string;taskContinuation?:{taskOpen?:boolean;question?:string}}};
export function queueBlockReason(task:QueueTask,paused=false):string|undefined{
 if(paused||task.assistantPaused||['paused','cancelled'].includes(task.agentRun?.status||''))return '已暂停，点击发送处理后继续队列';
 if(task.archived)return '对话已归档';
 if(task.agentRun?.status==='waiting_permission')return '等待授权，授权后继续队列';
 if(task.messages?.at(-1)?.clarification||task.agentRun?.status==='waiting_user')return '等待补充信息，回答后继续队列';
 if(task.lastError||['blocked','failed'].includes(task.agentRun?.status||''))return task.agentRun?.taskContinuation?.question||task.lastError||'任务受阻，处理后继续队列';
}
export function nextQueued<T extends {id:string;taskId:string;error?:string}>(items:T[],tasks:QueueTask[],runningIds:string[],pausedIds:string[],editingId?:string):T|undefined{
 const seen=new Set<string>();
 for(const item of items){
  if(seen.has(item.taskId))continue;seen.add(item.taskId);
  const task=tasks.find(t=>t.id===item.taskId);
  if(!task||item.error||item.id===editingId||runningIds.includes(item.taskId)||queueBlockReason(task,pausedIds.includes(item.taskId)))continue;
  return item;
 }
}
// Stable message IDs are the handoff receipt. A saved but unfinished message
// resumes its existing task; a settled reply is never submitted a second time.
export async function deliverQueued<T extends QueueTask>(item:{id:string},readTask:()=>Promise<T|undefined>,runTask:(task:T,append:boolean)=>Promise<void>):Promise<void>{
 const task=await readTask();if(!task)throw Error('原任务不存在，消息保留在队列中。');
 const messages=task.messages||[],index=messages.findIndex(m=>m.id===item.id);
 if(index<0||!messages.slice(index+1).some(m=>m.role==='assistant'))await runTask(task,index<0);
 const saved=await readTask();
 if(!saved?.messages?.some(m=>m.id===item.id))throw Error('消息尚未保存，已保留在等待队列中。');
}
// The composer shows only messages without a durable conversation receipt.
// Keep the internal queue until settlement so restart/recovery cannot lose work.
export function queuedAwaitingReceipt<T extends {id:string;taskId:string}>(items:T[],tasks:QueueTask[]):T[]{
 return items.filter(item=>!tasks.find(task=>task.id===item.taskId)?.messages?.some(m=>m.id===item.id&&m.role==='user'));
}

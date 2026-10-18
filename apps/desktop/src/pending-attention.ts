import type { Task } from './types';
export type PendingAttention = {task: Task; kind: 'permission' | 'reply' | 'failed' | 'blocked'; label: string; action: string; description: string};
const rank = {permission: 0, reply: 1, failed: 2, blocked: 3};
function updated(task: Task) {
  const value=Date.parse(task.scheduledAt || task.agentRun?.updatedAt || task.messages?.at(-1)?.createdAt || task.created);
  return Number.isFinite(value)?value:0;
}
export function pendingAttention(tasks: Task[], runningIds: string[]): PendingAttention[] {
  const latest=new Map<string,Task>();
  for(const task of tasks)if(task.scheduledTaskId){const old=latest.get(task.scheduledTaskId);if(!old||updated(task)>updated(old))latest.set(task.scheduledTaskId,task);}
  return tasks.flatMap((task):PendingAttention[]=>{
    if(task.id==='my-ailo-assistant'||runningIds.includes(task.id)||task.assistantPaused)return [];
    if(task.scheduledTaskId&&latest.get(task.scheduledTaskId)!==task)return [];
    const status=task.agentRun?.status,last=task.messages?.at(-1);
    if(status==='paused'||status==='cancelled')return [];
    if(status==='waiting_permission')return [{task,kind:'permission',label:'等待授权',action:'查看授权',description:'打开任务查看所需权限与授权方式。'}];
    if(last?.role==='assistant'&&last.clarification)return [{task,kind:'reply',label:'等待回答',action:'去回答',description:last.clarification.title||'补充信息后，Ailo 才能继续。'}];
    if(task.lastError||status==='failed')return [{task,kind:'failed',label:'执行失败',action:'查看原因',description:task.lastError||'本次执行未完成，打开任务查看原因并决定是否重试。'}];
    if(status==='waiting_user'&&last?.role!=='user')return [{task,kind:'reply',label:'等待回答',action:'去回答',description:'任务需要你补充信息或确认下一步。'}];
    if(status==='blocked')return [{task,kind:'blocked',label:'任务受阻',action:'查看原因',description:'有条件尚未满足，打开任务查看阻塞原因。'}];
    return [];
  }).sort((a,b)=>rank[a.kind]-rank[b.kind]||updated(b.task)-updated(a.task)||a.task.id.localeCompare(b.task.id));
}

import type { Task } from './types';
export type PetState = 'idle' | 'thinking' | 'running' | 'completed' | 'attention';
export const petStateLabels: Record<PetState, string> = { idle: 'Ailo 在这里', thinking: 'Ailo 正在思考', running: 'Ailo 正在执行任务', completed: '任务已完成', attention: '有任务需要你处理' };
export function taskPetState(task: Task | undefined, liveStatus?: string): PetState {
  if (!task) return liveStatus === undefined ? 'idle' : 'thinking';
  const status = task.agentRun?.status;
  if (task.lastError || task.assistantPaused || ['failed', 'blocked', 'waiting_permission', 'waiting_user', 'paused'].includes(status || '') || (liveStatus === undefined && (task.messages?.at(-1)?.clarification || task.messages?.at(-1)?.role === 'user'))) return 'attention';
  if (liveStatus !== undefined) return liveStatus.startsWith('等待执行') || !task.agentRun?.inFlight ? 'thinking' : 'running';
  if (status === 'completed') return 'completed';
  return 'idle';
}
export function attentionTasks(tasks: Task[], runningIds: string[]): Task[] {
  return tasks.filter(task => !runningIds.includes(task.id) && taskPetState(task) === 'attention');
}
export function petResultToken(task: Task): string | undefined {
  const last = task.messages?.at(-1);
  if (taskPetState(task) === 'attention' || (task.agentRun?.status !== 'completed' && last?.role !== 'assistant' && !task.answer)) return undefined;
  const value = JSON.stringify([task.agentRun?.executionId, task.agentRun?.updatedAt, last?.id, last?.content, task.answer]);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `result-${(hash >>> 0).toString(16)}`;
}
// Viewing acknowledges a notification without resolving the underlying task.
export function petNotificationToken(task: Task): string | undefined {
  if (taskPetState(task) !== 'attention') return petResultToken(task);
  const last=task.messages?.at(-1);
  const value=JSON.stringify([task.agentRun?.executionId,task.agentRun?.status,task.agentRun?.updatedAt,task.lastError,task.assistantPaused,last?.id,last?.content,last?.clarification]);
  let hash=2166136261;
  for(let index=0;index<value.length;index++)hash=Math.imul(hash^value.charCodeAt(index),16777619);
  return `attention-${(hash>>>0).toString(16)}`;
}
export function hasUnreadPetNotification(task:Task):boolean {
  const token=petNotificationToken(task);
  return !!token && task.petReadToken!==token;
}
export function unreadAttentionTasks(tasks:Task[],runningIds:string[]):Task[] {
  return attentionTasks(tasks,runningIds).filter(hasUnreadPetNotification);
}
export function workspacePetState(tasks: Task[], sessions: Record<string, { status: string }>): PetState {
  const running = Object.keys(sessions);
  if (unreadAttentionTasks(tasks, running).length) return 'attention';
  if (tasks.some(task => !running.includes(task.id) && taskPetState(task)!=='attention' && hasUnreadPetNotification(task))) return 'completed';
  if (running.length) return running.some(id => taskPetState(tasks.find(task => task.id === id), sessions[id].status) === 'running') ? 'running' : 'thinking';
  return 'idle';
}

import type {Task,AgentRun} from './types';
export function verificationFailure(task:Task,run:AgentRun):string|undefined {
  if(!['failed','blocked','paused'].includes(run.status))return;
  const blocker=run.executionState?.blocker;
  if(blocker&&typeof blocker==='object'&&'action' in blocker&&blocker.action==='verify'&&'message' in blocker&&typeof blocker.message==='string')return blocker.message;
  const error=task.lastError;
  if(error&&/验收未通过|未匹配到原文|验收范围|验收要求/.test(error))return error;
}

import type {Task,AgentRun} from './types';
export type LiveSession={id:string;taskId?:string;status:string;content:string;attached?:boolean;inputId?:string;startedAt?:string;phase?:'preparing'|'queued'|'running'|'settling';run?:AgentRun};
const labels:Record<string,string>={preparing:'正在准备回复',queued:'排队中',running:'执行中',replying:'正在回复',settling:'正在保存回复',understanding:'正在理解需求',waiting_permission:'等待授权',waiting_user:'等待回答',paused:'已暂停',blocked:'任务受阻',failed:'执行中断',completed:'已完成',idle:'回复已完成',archived:'已完成'};
export function taskPresentation(task:Task,session?:LiveSession){
 const saved=task.agentRun,live=session?.run,lastInput=[...(task.messages||[])].reverse().find(m=>m.role==='user')?.id;
 let state:string,activityRun:AgentRun|undefined,activityStatus:string;
 if(session){
  if(session.phase==='queued'||session.status.startsWith('等待执行'))state='queued';
  else if(live?.currentOutcome==='clarify')state='waiting_user';
  else if(live?.currentOutcome==='blocked'||live?.currentOutcome==='pause')state=live.currentOutcome==='pause'?'paused':'blocked';
  else if(session.phase==='settling')state=live?.currentIntent==='task'?live.status:'settling';
  else if(!live||!live.currentIntent)state=session.content?'replying':'preparing';
  else if(live.currentIntent==='chat')state='replying';
  else state=live.status==='understanding'?'understanding':live.status;
  if(live&&(live.currentIntent==='task'||['waiting_user','blocked','paused'].includes(state))&&state!=='queued'&&state!=='preparing')activityRun=live;
  activityStatus=state==='replying'?(session.content?'正在回复':session.status.startsWith('正在决定下一步')?'正在准备回复':session.status||'正在回复'):state==='queued'?'等待执行':labels[state]||session.status;
 }else{
  state=task.lastError?'failed':saved?.currentIntent==='chat'&&saved.currentInputId===lastInput&&(saved.currentOutcome==='reply'||saved.status==='idle')?'idle':saved?.status|| (task.messages?.at(-1)?.clarification?'waiting_user':task.messages?.at(-1)?.role==='assistant'?'idle':'idle');
  if(['running','understanding'].includes(state))state='paused';
  activityRun=saved;activityStatus=labels[state]||state;
 }
 const run=saved;const historical=!!run&&(!!session&&(!live||!live.currentIntent)||run.currentIntent==='chat'||(!!lastInput&&!!run.progressInputId&&run.progressInputId!==lastInput))&&!(live?.currentIntent==='task'&&live.progressInputId===lastInput);
 return {state,label:labels[state]||state,active:!!session,activityRun,activityStatus,historical,progressStatus:historical?run?.status:state};
}
// Finished IDs are tombstones: a delayed polling snapshot must not revive them.
export function mergeSessionSnapshot(current:Record<string,LiveSession>,snapshot:LiveSession[],finished:Set<string>){
 const next={...current},active=new Set(snapshot.filter(s=>!finished.has(s.id)).map(s=>s.id));
 for(const [taskId,session] of Object.entries(next))if(finished.has(session.id)||(session.attached&&!active.has(session.id)))delete next[taskId];
 for(const session of snapshot)if(session.taskId&&!finished.has(session.id)){const existing=next[session.taskId];if(existing&&existing.id!==session.id&&!existing.attached)continue;next[session.taskId]={...existing,...session,attached:true};}
 return next;
}
export function activityForSession(run:AgentRun|undefined,session?:LiveSession){
 if(!run||!session?.startedAt)return run;
 const start=Date.parse(session.startedAt);if(!Number.isFinite(start))return run;
 return {...run,events:run.events.filter(e=>Date.parse(e.at)>=start),inFlight:run.inFlight&&Date.parse(run.inFlight.at)>=start?run.inFlight:undefined};
}

import {taskPresentation,activityForSession,type LiveSession} from './task-presentation';
import React,{useEffect,useState} from 'react';
import { Pet } from './pet';
import { taskPetState } from './pet-state';
import {activityPresentation,formatProgressAge} from './activity-presentation';
import {formatReplyDuration} from './reply-details';
import {ExecutionEvents,executionEventText} from './task-progress';
import type {Task} from './types';
export function TaskActivity({task,status,session}:{task:Task;status:string;session?:LiveSession}) {
  const current=taskPresentation(task,session);
  const run=session?activityForSession(current.activityRun,session):task.agentRun;
  const presentation=activityPresentation(run,session?current.activityStatus:status);
  const events=run?.events||[];
  const latest=events.at(-1);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
  const at=presentation.progressAt?Date.parse(presentation.progressAt):NaN;
  const elapsed=Number.isFinite(at)?Math.max(0,Math.floor((now-at)/1000)):undefined;
  const startedAt=session?.startedAt?Date.parse(session.startedAt):NaN;
  const duration=Number.isFinite(startedAt)?formatReplyDuration(Math.max(0,now-startedAt)):undefined;
  const primary=session?current.label:presentation.label;
  const detail=session&&current.state==='running'&&presentation.label!==primary?[presentation.label,presentation.detail].filter(Boolean).join(' · '):presentation.detail;
  const latestText=run?.inFlight?detail:latest?executionEventText(latest):detail;
  const label=latestText?`${primary} · ${latestText}`:primary;
  return <div className="task-activity task-activity-inline" aria-label="当前任务活动">
    <details className="task-activity-details" key={`${task.id}-${run?.executionId||run?.progressInputId||'current'}`}><summary className="task-activity-current"><Pet size="mini" state={taskPetState(session?{...task,lastError:undefined,agentRun:current.activityRun}:task,status)} /><span role="status" title={label}>{duration?`已处理 ${duration} · ${label}`:label}</span><span className="task-activity-chevron" aria-hidden="true">&gt;</span></summary>
    {elapsed!==undefined&&<p className="task-activity-explanation">{formatProgressAge(elapsed)}</p>}
    {presentation.expanded&&presentation.detail&&<div className="task-activity-explanation">{presentation.detail}</div>}
    {events.length>0?<ExecutionEvents events={events}/>:<p className="task-activity-explanation">尚无执行记录，收到新进展后会显示在这里。</p>}
    </details>
  </div>;
}

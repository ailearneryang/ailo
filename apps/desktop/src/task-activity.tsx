import {taskPresentation,activityForSession,type LiveSession} from './task-presentation';
import React,{useEffect,useState} from 'react';
import { Pet } from './pet';
import { taskPetState } from './pet-state';
import {compactActivityPresentation,formatProgressAge} from './activity-presentation';
import {formatReplyDuration} from './reply-details';
import {ActivityIndicator} from './activity-indicator';
import {ExecutionEvents} from './task-progress';
import type {Task} from './types';
export function TaskActivity({task,status,session}:{task:Task;status:string;session?:LiveSession}) {
  const current=taskPresentation(task,session);
  const run=session?activityForSession(current.activityRun,session):task.agentRun;
  const events=run?.events||[];
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
  const startedAt=session?.startedAt?Date.parse(session.startedAt):NaN;
  const duration=Number.isFinite(startedAt)?formatReplyDuration(Math.max(0,now-startedAt)):undefined;
  const presentation=compactActivityPresentation(run?{...run,status:current.state}:undefined,session?current.activityStatus:status);
  const progressAt=Date.parse(presentation.progressAt||'');
  const age=Number.isFinite(progressAt)?Math.max(0,Math.floor((now-progressAt)/1000)):undefined;
  const primary=session?current.label:presentation.label;
  const label=run&&['running','understanding','waiting_permission','waiting_user','blocked','failed','paused'].includes(current.state)?presentation.label:primary;
  const active=!!session&&['running','understanding'].includes(current.state);
  return <div className="task-activity task-activity-inline" aria-label="当前任务活动">
    <details className={`task-activity-details task-activity-${presentation.tone}`} key={`${task.id}-${run?.executionId||run?.progressInputId||'current'}`}><summary className="task-activity-current"><Pet size="mini" state={taskPetState(session?{...task,lastError:undefined,agentRun:current.activityRun}:task,status)} /><span className="task-activity-title" role="status" title={label}>{active&&run?.inFlight&&<ActivityIndicator/>}{label}</span><span className="task-activity-duration">{duration?`已用时 ${duration}`:null}</span><span className="task-activity-chevron" aria-hidden="true">&gt;</span></summary>
    {age!==undefined&&<p className="task-activity-explanation">{formatProgressAge(age)}</p>}
    {events.length>0||run?.inFlight?<ExecutionEvents events={events} inFlight={run?.inFlight} live={active}/>:<p className="task-activity-explanation">尚无执行记录，收到新进展后会显示在这里。</p>}
    </details>
  </div>;
}

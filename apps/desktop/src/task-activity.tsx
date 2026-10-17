import React,{useEffect,useState} from 'react';
import { Pet } from './pet';
import { taskPetState } from './pet-state';
import {activityPresentation,formatProgressAge} from './activity-presentation';
import type {Task} from './types';
export function TaskActivity({task,status}:{task:Task;status:string}) {
  const presentation=activityPresentation(task.agentRun,status);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
  const at=presentation.progressAt?Date.parse(presentation.progressAt):NaN;
  const elapsed=Number.isFinite(at)?Math.max(0,Math.floor((now-at)/1000)):undefined;
  const label=!presentation.expanded&&presentation.detail?`${presentation.label} · ${presentation.detail}`:presentation.label;
  return <div className="task-activity task-activity-inline" aria-label="当前任务活动">
    <div className="task-activity-current"><Pet size="mini" state={taskPetState(task,status)} /><span role="status" title={label}>{label}</span>{elapsed!==undefined&&<small className="task-activity-age" title="距上次有效进展更新的时间">{formatProgressAge(elapsed)}</small>}</div>
    {presentation.expanded&&presentation.detail&&<div className="task-activity-explanation">{presentation.detail}</div>}
  </div>;
}

import React from 'react';
import type {AgentRun} from './types';
import {activityTimeline,userActivityText,userOperationTitle} from './activity-presentation';
import {ExecutionEvents,executionEventState} from './task-progress';
import {ActivityIndicator} from './activity-indicator';
import {Icon} from './icon';
import {ExecutionIcon} from './execution-icon';

// A presentation of actual operations, never generated reasoning or evidence.
export function storyTimeline(events:AgentRun['events'],inFlight?:AgentRun['inFlight']) {
 const timeline=activityTimeline(events);
 if(inFlight&&!events.some(e=>inFlight.actionId&&(e.detail.actionId===inFlight.actionId||e.id===inFlight.actionId))){
  timeline.push({kind:'operation',event:{id:inFlight.actionId||'in-flight',type:inFlight.action,at:inFlight.at,detail:{...inFlight,actionId:inFlight.actionId||'in-flight'}}});
 }
 return timeline;
}
export const ExecutionStory=React.memo(function ExecutionStory({events,inFlight,live=false}:{events:AgentRun['events'];inFlight?:AgentRun['inFlight'];live?:boolean}){
 const timeline=storyTimeline(events,inFlight);
 if(!timeline.length)return null;
 return <div className="execution-story" aria-label="执行过程">{timeline.map(entry=>{
  if(entry.kind==='recovery'){
   const last=entry.events.at(-1)!,index=events.findIndex(e=>e.id===last.id);
   const protocol=entry.events.some(e=>e.type==='protocol_error');
   const resumed=index>=0&&events.slice(index+1).some(e=>protocol&&['intent','plan'].includes(e.type)||e.type!=='tool_error'&&activityTimeline([e]).some(v=>v.kind==='operation'));
   const label=protocol?'修正工具参数':entry.events.some(e=>e.type==='output_limit')?'调整输出长度':'调整执行方式';
   return <details className="story-operation story-recovery" key={entry.id}><summary><Icon name="refresh"/><span>{label}{resumed?' · 已继续':''}</span><span className="story-chevron" aria-hidden="true">›</span></summary><p className="story-result">{protocol?'上一步参数未通过检查，未执行该操作。':'系统恢复记录，实际操作结果见后续步骤。'}</p><ExecutionEvents events={entry.events}/></details>;
  }
  const event=entry.event,pending=!!inFlight&&(event.id===(inFlight.actionId||'in-flight'));
  const state=pending?(live?'running':'unknown'):executionEventState(event);
  const label=state==='running'?'执行中':state==='failed'?'未成功':state==='unknown'?'结果待确认':state==='done'?'已执行':'';
  const count=event.type==='web_search'&&!pending&&state!=='failed'&&state!=='unknown'?event.detail.sourceCount:undefined;
  const purpose=userActivityText(event.detail.purpose,360);
  const title=(event.type==='run_command'?userActivityText(event.detail.purpose,52):'')||userOperationTitle({...event,detail:{...event.detail,purpose:undefined}});
  return <div className={`story-step story-step-${state}`} key={event.id}>
   {event.type!=='run_command'&&purpose&&purpose!==title&&<p className="story-explanation">{purpose}</p>}
   <details className="story-operation"><summary><ExecutionIcon action={event.type} state={state}/><span className="story-operation-title">{title}</span>{label&&<span className="story-operation-state">{state==='running'&&<ActivityIndicator/>}{label}</span>}<span className="story-chevron" aria-hidden="true">›</span></summary>
    <ExecutionEvents events={pending?[]:[event]} inFlight={pending?inFlight:undefined} live={pending&&live}/>
   </details>
   {!pending&&!!event.detail.feedback?.length&&<p className="story-result">{event.detail.feedback.join('；')}</p>}
   {count!==undefined&&<p className="story-result">{count===0?'本次搜索未返回来源':`返回 ${count} 条来源`}{count>0&&!!event.detail.sources?.length&&<span> · {[...new Set(event.detail.sources.map(s=>s.domain))].slice(0,3).join('、')}</span>}</p>}
  </div>;
 })}</div>;
});

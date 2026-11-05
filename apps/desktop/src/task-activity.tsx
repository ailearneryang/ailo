import {taskPresentation,activityForSession,type LiveSession} from './task-presentation';
import {useEffect,useState,type ReactNode} from 'react';
import {Pet} from './pet';
import {taskPetState} from './pet-state';
import {compactActivityPresentation,isActivityOperation} from './activity-presentation';
import {formatReplyDuration} from './reply-details';
import {ExecutionStatuses} from './execution-statuses';
import {ExecutionEvents} from './task-progress';
import {ExecutionStory} from './execution-story';
import {AssistantText} from './assistant-text';
import {ExecutionIcon} from './execution-icon';
import {visibleReply} from '../clarification.mjs';
import type {Task} from './types';
export function TaskActivity({task,status,session,children}:{task:Task;status:string;session?:LiveSession;children?:ReactNode}) {
 const current=taskPresentation(task,session);
 const run=session?activityForSession(current.activityRun,session):task.agentRun;
 const trace=session?.activity,events=trace?.events||run?.events||[],inFlight=trace?.inFlight||run?.inFlight;
 const skills=trace?.loadedExtensions||run?.loadedExtensions||[],statuses=trace?.statuses||[];
 const [preference,setPreference]=useState<{id?:string;open:boolean}|null>(null),[now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
 const startedAt=session?.startedAt?Date.parse(session.startedAt):NaN;
 const duration=Number.isFinite(startedAt)?formatReplyDuration(Math.max(0,now-startedAt)):undefined;
 const active=!!session&&['preparing','replying','running','understanding'].includes(current.state);
 const waiting=['waiting_permission','waiting_user'].includes(current.state);
 const presentation=compactActivityPresentation(run?{...run,status:current.state}:undefined,session?current.activityStatus:status);
 const body=visibleReply(session?.content||'');
 const open=waiting||((preference?.id===session?.id?preference?.open:undefined)??(!body||!!inFlight));
 const actualStatus=session?.status||status||'正在准备请求…';
 const latestSearch=[...events].reverse().find(isActivityOperation);
 const searchProgress=latestSearch?.type==='web_search'&&!latestSearch.detail.timedOut&&(latestSearch.detail.exitCode===undefined||latestSearch.detail.exitCode===0)&&latestSearch.detail.sourceCount!==undefined?(latestSearch.detail.sourceCount===0?'本次搜索未返回来源，正在分析下一步…':`搜索已返回 ${latestSearch.detail.sourceCount} 条来源，正在分析资料…`):'';
 const phase=waiting||inFlight?presentation.label:body?'正在生成回复…':run?.mode==='task'?presentation.label:/正在决定下一步|模型仍在思考|模型正在思考/.test(actualStatus)?(searchProgress||'正在思考下一步…'):/正在推进任务|正在理解需求/.test(actualStatus)?'正在分析任务…':actualStatus;
 const usage=trace?.usage,model=[...(usage?.models||[])].reverse().find(m=>m.lane==='primary');
 return <div className="reply live-reply task-activity task-activity-inline" aria-label="当前任务活动">
  <div className="byline"><Pet size="mini" motion="ambient" state={taskPetState(session?{...task,lastError:undefined,agentRun:current.activityRun}:task,status)}/>Ailo{model&&<small>{model.name||model.model}</small>}</div>
  <details open={open} className={`task-activity-details task-activity-${presentation.tone}`}>
   <summary className="task-activity-current" title={phase} onClick={e=>{e.preventDefault();setPreference({id:session?.id,open:!open});}}><span className="task-activity-duration">{waiting?'待输入':current.state==='queued'?'排队中':'已处理'}{duration?` ${duration}`:''}</span><span className="task-activity-chevron" aria-hidden="true">›</span></summary>
   {!!skills.length&&<div className="execution-process-skills" aria-label="本轮加载的技能与专家">{skills.map(item=><span key={item.id} title={item.reason}><ExecutionIcon kind={item.kind}/><span>{item.source==='auto'?'自动加载':'加载'}{item.kind==='skill'?'技能':'专家'} · {item.name}</span></span>)}</div>}
   <ExecutionStory events={events} inFlight={inFlight} live={active}/>
   {(statuses.length>0||events.length>0||children)&&<details className="process-diagnostics"><summary>详细执行记录</summary><ExecutionStatuses statuses={statuses}/><ExecutionEvents events={events}/>{children}</details>}
  </details>
  {body&&<div className="assistant-text live-reply-text"><AssistantText content={body}/></div>}
  <div className={`live-reply-status${waiting?' live-reply-waiting':''}`} role="status"><span>{phase}</span>{usage&&usage.reportedRequests>0&&<details className="live-usage"><summary>用量 {usage.totalTokens>=10000?`${(usage.totalTokens/10000).toFixed(1)} 万`:usage.totalTokens.toLocaleString()} Tokens{usage.reportedRequests<usage.requestCount?'（部分）':''}</summary><span>已报告 {usage.totalTokens.toLocaleString()} Tokens{usage.reportedRequests<usage.requestCount?'（部分）':''} · 输入 {Number.isFinite(usage.inputTokens)?usage.inputTokens.toLocaleString():'未报告'} / 输出 {Number.isFinite(usage.outputTokens)?usage.outputTokens.toLocaleString():'未报告'} · 已报告 {usage.reportedRequests}/{usage.requestCount} 次请求。当前请求尚未返回的用量不估算。</span></details>}</div>
 </div>;
}

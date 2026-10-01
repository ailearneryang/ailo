import React from 'react';
import {visiblePlanItems} from './progress-placement';
import type {Task,AgentRun} from './types';
const statuses:Record<string,string>={understanding:'理解需求',running:'执行中',waiting_user:'等待回答',paused:'已暂停',blocked:'需要处理阻塞',failed:'执行中断',completed:'已完成',idle:'对话'};
const steps:Record<string,string>={pending:'待执行',running:'进行中',done:'已完成',blocked:'阻塞'};
function StatusBadge({status,label}:{status:string;label:string}) {
  const tone = status==='done'||status==='completed'||status==='archived' ? 'done' : status==='running'||status==='understanding' ? 'running' : status==='blocked'||status==='failed' ? 'blocked' : 'pending';
  return <span className={`task-status task-status-${tone}`}>
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {tone==='done' ? <><circle cx="8" cy="8" r="6"/><path d="m5 8 2 2 4-4"/></> : tone==='blocked' ? <><path d="M8 2 15 14H1Z"/><path d="M8 6v3m0 2.3v.2"/></> : tone==='running' ? <><circle cx="8" cy="8" r="6" opacity=".3"/><path d="M8 2a6 6 0 0 1 6 6"/><path d="M8 5v3l2 1"/></> : <circle cx="8" cy="8" r="5.5"/>}
    </svg><span>{label}</span>
  </span>;
}
export function TaskProgress({task,busy,onContinue,showRecovery=true,onOpenArtifacts}:{onOpenArtifacts:()=>void;task:Task;busy:boolean;onContinue:()=>void;showRecovery?:boolean}) {
  const run=task.agentRun!;
  const decisions=visiblePlanItems(run.decisions),acceptance=visiblePlanItems(run.acceptance);
  const recoverable=['paused','failed','blocked'].includes(run.status);
  if (!showRecovery && recoverable && !run.steps.length && !run.artifacts.length) return null;
  if(run.mode==='chat' && !recoverable)return null;
  const finishing=run.status==='running' && !!run.steps.length && run.steps.every(s=>s.status==='done');
  if(run.status==='completed')return <details className="completed-execution"><summary>✓ {run.goal || '本轮任务'} · 已完成</summary><TaskProgress task={{...task,agentRun:{...run,status:'archived'}}} busy={busy} onContinue={onContinue} showRecovery={false} onOpenArtifacts={onOpenArtifacts}/></details>;
  return <section className="task-progress" aria-label="任务计划与成果">
    <div className="task-progress-heading"><strong>任务进度</strong><StatusBadge status={run.status} label={finishing?'正在核对交付':run.status==='archived'?'已完成':statuses[run.status]||run.status}/></div>
    {run.goal && <details className="task-goal" key={task.id}><summary><span className="task-goal-text">{run.goal}</span><span className="task-goal-toggle" aria-hidden="true" /></summary></details>}
    {!!run.steps.length && <ol>{run.steps.map(s=><li key={s.id}><span>{s.title}</span><div className="task-step-status"><StatusBadge status={s.status} label={steps[s.status]||s.status}/></div></li>)}</ol>}
    {recoverable && !run.steps.length && <p className="muted">尚未形成执行计划。需求与材料已保存在当前项目，无需重新创建或打开文件夹。</p>}
    {!!decisions.length && <details><summary>已确认要求与决策</summary><ul>{decisions.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
    {!!acceptance.length && <details><summary>验收要求</summary><ul>{acceptance.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
    {!!run.artifacts.length && <button className="artifact-shortcut" onClick={onOpenArtifacts}>查看产物（{run.artifacts.length}） →</button>}
    {!!run.events.length && <details><summary>最近执行记录</summary>{run.events.map(e=><div key={e.id}><p>{new Date(e.at).toLocaleTimeString()} · {e.detail.message || e.detail.purpose || (e.detail.name ? `${e.type} · ${e.detail.name}${e.detail.entry ? ` / ${e.detail.entry}` : ""}${e.detail.offset !== undefined ? ` · 位置 ${e.detail.offset}` : ""}` : e.detail.path || e.type)}{e.detail.exitCode!==undefined ? ` · 退出码 ${e.detail.exitCode}`:''}</p>{e.detail.output&&<pre>{e.detail.output}</pre>}</div>)}</details>}
    {recoverable && showRecovery && <div className="task-progress-actions"><button className="primary" disabled={busy} onClick={onContinue}>{run.status==='failed'?'重试当前步骤':'继续任务'}</button></div>}
  </section>;
}

export function ExecutionHistory({task,run,onOpenArtifacts}:{task:Task;run:AgentRun;onOpenArtifacts:()=>void}) {
  return <TaskProgress task={{...task,agentRun:run}} busy={false} onContinue={()=>{}} showRecovery={false} onOpenArtifacts={onOpenArtifacts}/>;
}

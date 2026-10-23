import {verificationFailure} from './verification-state';
import React, {useId,useState} from 'react';
import {progressSummary,progressHeadline,confirmationNotice,readableProgressText} from './progress-summary';
import {visiblePlanItems} from './progress-placement';
import type {Task,AgentRun} from './types';
const statuses:Record<string,string>={understanding:'理解需求',running:'执行中',waiting_permission:'等待授权',waiting_user:'等待回答',paused:'已暂停',blocked:'需要处理阻塞',failed:'执行中断',completed:'已完成',idle:'回复已完成',preparing:'正在准备回复',queued:'排队中',replying:'正在回复',settling:'正在保存回复'};
const steps:Record<string,string>={pending:'待执行',waiting_sync:'等待同步',running:'进行中',done:'已完成',blocked:'阻塞'};
const eventLabels:Record<string,string>={intent:'分析任务与确定方向',checkpoint:'保存任务进展',plan:'更新执行计划',plan_update:'更新执行计划',route:'确定处理方式',batch_read:'批量读取资料',attached_progress:'更新进度与记忆',loop_recovery:'自动调整执行方式',no_action_recovery:'收敛无效思考',view_image:'回看图片',browser:'检查网页运行结果',read_file:'读取文件',write_file:'写入文件',edit_file:'修改文件',run_command:'执行命令',tool_error:'操作未成功',steering:'接收补充要求',finish:'完成任务',acceptance_check:'检查验收结果'};
export function executionEventText(e:AgentRun['events'][number]):string {
  if(e.type==='android_device'&&!e.detail.message&&!e.detail.purpose)return ({start:'准备项目模拟器',install:'安装当前 APK',launch:'启动应用',logs:'读取运行日志',screenshot:'获取运行截图',check:'完成设备运行核对',status:'检查设备状态',stop:'停止项目模拟器'} as Record<string,string>)[e.detail.operation||'']||'设备操作';
  if(e.type==='build_android'&&!e.detail.message&&!e.detail.purpose)return '执行标准 Android 构建';
  return e.detail.message || e.detail.purpose || (e.detail.name ? `${eventLabels[e.type]||'执行操作'} · ${e.detail.name}${e.detail.entry ? ` / ${e.detail.entry}` : ''}${e.detail.offset !== undefined ? ` · 位置 ${e.detail.offset}` : ''}` : e.detail.path || eventLabels[e.type] || '更新任务状态');
}
export function ExecutionEvents({events}:{events:AgentRun['events']}) {
  return <div className="execution-event-list">{events.map(e=><div key={e.id}><p>{new Date(e.at).toLocaleTimeString()} · {executionEventText(e)}{e.detail.exitCode!==undefined ? ` · 退出码 ${e.detail.exitCode}`:''}</p>{e.detail.output&&<pre>{e.detail.output}</pre>}</div>)}</div>;
}
function StepDescription({text,paused=false}:{text:string;paused?:boolean}) {
  return <div className="progress-description"><div className="progress-preview-lines">{progressSummary(text).map(part=><p className="progress-summary-line" key={part.label}><span>{paused&&part.label==='正在处理'?'暂停前进展':part.label}：</span><span>{readableProgressText(part.text)}</span></p>)}</div><details className="progress-step-expand"><summary><span className="progress-detail-show">查看本步详情</span><span className="progress-detail-hide">收起本步详情</span></summary><p className="progress-step-detail">{text}</p></details></div>;
}
function StatusBadge({status,label}:{status:string;label:string}) {
  const tone = status==='done'||status==='completed'||status==='archived' ? 'done' : status==='running'||status==='understanding' ? 'running' : status==='blocked'||status==='failed' ? 'blocked' : 'pending';
  return <span className={`task-status task-status-${tone}`}>
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {status==='paused' ? <><circle cx="8" cy="8" r="6"/><path d="M6 5.5v5M10 5.5v5"/></> : tone==='done' ? <><circle cx="8" cy="8" r="6"/><path d="m5 8 2 2 4-4"/></> : tone==='blocked' ? <><path d="M8 2 15 14H1Z"/><path d="M8 6v3m0 2.3v.2"/></> : tone==='running' ? <><circle cx="8" cy="8" r="6" opacity=".3"/><path d="M8 2a6 6 0 0 1 6 6"/><path d="M8 5v3l2 1"/></> : <circle cx="8" cy="8" r="5.5"/>}
    </svg><span>{label}</span>
  </span>;
}
export function TaskProgress({task,busy,onContinue,showRecovery=true,onOpenArtifacts,historical=false,currentStatus}:{historical?:boolean;currentStatus?:string;onOpenArtifacts:()=>void;task:Task;busy:boolean;onContinue:()=>void;showRecovery?:boolean}) {
  const original=task.agentRun!;
  const run=currentStatus&&!historical?{...original,status:currentStatus}:original;
  const listId=useId();
  const [expanded,setExpanded]=useState<{scope:string;id:string}|null>(null);
  const scope=`${task.id}-${run.executionId||run.progressInputId||'current'}`;
  const [collapsedTasks,setCollapsedTasks]=useState<Record<string,boolean>>({});
  const preferenceKey=`ailo.progress.completed.${task.id}`;
  let savedCollapsed=false;
  try { savedCollapsed=localStorage.getItem(preferenceKey)==='true'; } catch {}
  const collapsed=collapsedTasks[task.id]??savedCollapsed;
  const toggleCompleted=()=>{
    const next=!collapsed;
    setCollapsedTasks(previous=>({...previous,[task.id]:next}));
    try { localStorage.setItem(preferenceKey,String(next)); } catch {}
  };
  const decisions=visiblePlanItems(run.decisions),acceptance=visiblePlanItems(run.acceptance);
  const loaded=!!run.loadedExtensions?.length && <div className="execution-extensions" role="status" aria-label="本轮已加载的技能与专家"><span>本轮已加载</span>{run.loadedExtensions.map(e=><span className="execution-extension" key={e.id}>{e.kind==='skill'?'技能':'专家'} · {e.name}</span>)}</div>;
  const recoverable=['paused','failed','blocked','waiting_permission'].includes(run.status);
  if (!showRecovery && recoverable && !run.steps.length && !run.artifacts.length) return loaded || null;
  if(run.mode==='chat' && !recoverable)return loaded || null;
  const deliveryLabel=run.delivery?.visualReviewPending?'已完成 · 视觉效果待人工确认':run.delivery?.outcome==='limited'?'已交付（有明确限制）':'已完成';
  const paused=run.status==='paused';
  const ambiguousRunning=run.steps.filter(s=>s.status==='running').length>1;
  const completedSteps=run.steps.filter(step=>step.status==='done');
  const verificationError=verificationFailure(task,run);
  const stepsComplete=!!run.steps.length&&completedSteps.length===run.steps.length;
  const stepRow=(step:AgentRun['steps'][number])=>{
    // Split legacy descriptive titles only at explicit boundaries; preserve every word.
    const boundary=step.title.search(/[：:（(]/);
    const split=!step.detail&&boundary>=4&&boundary<=24;
    const title=readableProgressText(split?step.title.slice(0,boundary):step.title);
    const detail=step.detail||(split?step.title.slice(boundary).replace(/^[：:]\s*/,''):'');
    const active=(!ambiguousRunning&&step.status==='running')||step.status==='blocked';
    const needsConfirmation=step.requiresConfirmation===true||/作者.*确认后|用户.*确认后|需(?:要)?你确认/.test(step.title);
    const number=run.steps.indexOf(step)+1;
    const open=expanded?.scope===scope&&expanded.id===step.id;
    const status=ambiguousRunning&&step.status==='running'?'pending':active&&paused?'paused':step.status;
    const confirmation=confirmationNotice(needsConfirmation,step.status,run.status,run.steps.findIndex(s=>s.status!=='done')===number-1);
    const label=ambiguousRunning&&step.status==='running'?'进度待核对':active&&paused?'已暂停':confirmation==='需你确认'?confirmation:steps[step.status]||step.status;
    const headline=active?((step.summary?`${paused?'暂停前进展：':''}${step.summary}`:'')|| (detail?progressHeadline(detail,paused):'')):'';
    const panelId=`${listId}-${number}`;
    return <li key={step.id} value={number} className={`compact-step compact-step-${status}`}>
      <button type="button" className="compact-step-toggle" aria-expanded={open} aria-controls={panelId} onClick={()=>setExpanded(open?null:{scope,id:step.id})}>
        <StatusBadge status={status} label={label}/><span className="compact-step-number" aria-hidden="true">{number}.</span><span className="compact-step-heading"><span className="compact-step-title" title={title}>{title}</span>{confirmation&&<span className="compact-confirmation">{confirmation}</span>}{(step.status==='waiting_sync'||(ambiguousRunning&&step.status==='running'))&&<span className="compact-confirmation">{label}</span>}</span>
      </button>
      {headline&&!open&&<p className="compact-step-update" title={headline}>{readableProgressText(headline)}</p>}
      {open&&<div id={panelId} className="compact-step-panel"><strong>{label}</strong>{detail?(active?<StepDescription text={detail} paused={paused}/>:<p className="progress-step-detail">{detail}</p>):<p className="progress-step-detail">{step.title}</p>}</div>}
    </li>;
  };
  const finishing=run.status==='running' && !!run.steps.length && run.steps.every(s=>s.status==='done');
  if(run.status==='completed')return <>{loaded}<details className="completed-execution"><summary>✓ {run.goal || '本轮任务'} · {deliveryLabel} {completedSteps.length}/{run.steps.length}</summary><TaskProgress task={{...task,agentRun:{...run,status:'archived',loadedExtensions:[]}}} busy={busy} onContinue={onContinue} showRecovery={false} onOpenArtifacts={onOpenArtifacts}/></details></>;
  return <>{loaded}<section className="task-progress task-progress-compact" aria-label="任务计划与成果">
    <div className="task-progress-heading"><div className="compact-progress-heading"><strong>{historical?'此前任务进度':'任务进度'}</strong>{!!run.steps.length&&<span>步骤已完成 {completedSteps.length}/{run.steps.length}</span>}</div><div className="task-progress-controls"><StatusBadge status={run.status} label={verificationError?'验收未通过':finishing?'正在核对交付':run.status==='archived'?deliveryLabel:statuses[run.status]||run.status}/>{recoverable && showRecovery && <button className="primary" disabled={busy} onClick={onContinue}>{verificationError?'继续验收':run.status==='failed'?'重试当前步骤':'继续任务'}</button>}</div></div>
    {verificationError&&<p className="error" role="alert">{stepsComplete?'计划步骤已完成，最终验收未通过。':'最终验收未通过。'}{verificationError}</p>}
    {!!run.designRegionIssues?.length&&<div className="error" role="alert"><p>设计核对尚有 {run.designRegionIssues.length} 处区域待处理，视觉验收未通过。色块接近不代表组件和布局一致。</p><ul>{run.designRegionIssues.map(issue=><li key={issue.regionId}>{issue.region}：{issue.reason}</li>)}</ul></div>}
    {historical&&busy&&<p className="compact-state-note">此处为此前保存的计划；本轮回复结束后可继续。</p>}
    {!!run.steps.length && <div className="progress-overview">
      {!!run.acceptanceCriteria?.length&&<p className="compact-state-note">验收 {run.acceptanceCriteria.filter(c=>c.status==='passed').length}/{run.acceptanceCriteria.length} 项{run.acceptanceCriteria.some(c=>c.type==='visual')?` · 视觉 ${run.acceptanceCriteria.filter(c=>c.type==='visual'&&c.status==='passed').length}/${run.acceptanceCriteria.filter(c=>c.type==='visual').length} 项`:''}。步骤完成不代表验收通过。</p>}
      {ambiguousRunning&&<p className="compact-state-note">有多个步骤标记为进行中，实际执行状态待核对。</p>}
      {!!completedSteps.length&&<button type="button" className="compact-completed-toggle" aria-expanded={!collapsed} aria-controls={`${listId}-steps`} onClick={toggleCompleted}>{collapsed?'展开已完成':'收起已完成'}（{completedSteps.length}）</button>}
      <ol id={`${listId}-steps`} className="compact-plan-list" aria-label="任务步骤">{run.steps.filter(step=>!collapsed||step.status!=='done').map(stepRow)}</ol>
      {finishing && <p className="progress-finishing" role="status">计划步骤已完成，正在核对交付结果。</p>}
    </div>}
    {recoverable && !run.steps.length && <p className="muted">尚未形成执行计划。需求与材料已保存在当前项目，无需重新创建或打开文件夹。</p>}
    <details className="progress-more"><summary>任务详情与执行记录</summary>
    {run.goal && <div className="progress-goal-detail"><strong>任务目标</strong><p>{run.goal}</p></div>}
    {!!decisions.length && <details><summary>已确认要求与决策</summary><ul>{decisions.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
    {run.performance&&<details><summary>执行效率</summary><p>任务累计（含继续）{(run.performance.wallMs/60000).toFixed(1)} 分钟：模型请求 {run.performance.modelRequests} 次，等待 {(run.performance.modelMs/60000).toFixed(1)} 分钟；实际工具执行 {(run.performance.toolMs/1000).toFixed(1)} 秒。</p><p>其中：无动作请求 {run.performance.noActionRequests} 次，耗时 {(run.performance.noActionMs/60000).toFixed(1)} 分钟；计划、摘要、路由与交付等流程请求 {run.performance.processModelRequests} 次，耗时 {(run.performance.processModelMs/60000).toFixed(1)} 分钟。以上均包含在模型总耗时中。</p><p>批量读取 {run.performance.batchItems} 项；附带进度更新 {run.performance.attachedUpdates} 次。服务商完整报告用量 {run.performance.reportedUsageRequests}/{run.performance.modelRequests} 次，已报告输入 {run.performance.inputTokens}、输出 {run.performance.outputTokens} tokens。</p></details>}
    {!!run.issues?.length&&<details><summary>已发现的问题与限制</summary><ul>{run.issues.map(issue=><li key={issue.id}>{issue.status==='resolved'?'已修复':issue.status==='limitation'?'已披露限制':'待处理'} · {issue.description}{issue.reason&&<p>{issue.reason}</p>}</li>)}</ul></details>}
    {run.performance&&<p className="muted">模型请求失败 {run.performance.failedModelRequests} 次。{run.performance.runtimeCountersSince?`自 ${new Date(run.performance.runtimeCountersSince).toLocaleString()} 起新增统计：工具成功 ${run.performance.successfulTools??0} 次 · 动作错误 ${run.performance.toolErrors??0} 次 · 其中验收失败 ${run.performance.validationFailures??0} 次；工具成功不代表验收通过。`:''}{run.performance.timedActionRequests?`已记录首次动作时间的 ${run.performance.timedActionRequests} 次请求中，动作输出前等待 ${((run.performance.beforeActionMs||0)/60000).toFixed(1)} 分钟（包含在模型请求耗时中，不等于纯推理时间）。`:''}</p>}
    {run.completionReview&&<details><summary>交付复核</summary><p>{run.completionReview.summary}</p>{!!run.completionReview.unverified.length&&<><strong>尚未核验</strong><ul>{run.completionReview.unverified.map(item=><li key={item}>{run.acceptanceCriteria?.find(c=>c.id===item)?.text||item}</li>)}</ul></>}</details>}
    {!!acceptance.length && <details><summary>验收要求</summary><ul>{acceptance.map((s,i)=><li key={i}>{s}{run.acceptanceCriteria&&<small> · {run.acceptanceCriteria.find(c=>c.text===s)?.status==='passed'?(run.acceptanceCriteria.find(c=>c.text===s)?.basis==='model_assessment'?'模型已评估':'已核验'):run.acceptanceCriteria.find(c=>c.text===s)?.status==='recorded'?'已记录证据，交付前检查有效性':'待核验'}</small>}</li>)}</ul></details>}

    {run.recoverySummary&&!!(run.recoverySummary.retried+run.recoverySummary.recovered+run.recoverySummary.unknown)&&<p className="muted">自动重试 {run.recoverySummary.retried} 项 · 已核对恢复 {run.recoverySummary.recovered} 项{run.recoverySummary.unknown?` · ${run.recoverySummary.unknown} 项操作结果待核对`:''}</p>}
    {!!run.events.length && (!busy || historical) && <details><summary>最近执行记录</summary><ExecutionEvents events={run.events}/></details>}
    </details>
    {!!run.artifacts.length && <button className="artifact-shortcut" onClick={onOpenArtifacts}>查看产物（{run.artifacts.length}） →</button>}
  </section></>;
}

export function ExecutionHistory({task,run,onOpenArtifacts}:{task:Task;run:AgentRun;onOpenArtifacts:()=>void}) {
  return <TaskProgress task={{...task,agentRun:run}} busy={false} onContinue={()=>{}} showRecovery={false} onOpenArtifacts={onOpenArtifacts}/>;
}

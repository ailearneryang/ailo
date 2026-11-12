import {Icon} from './icon';
import {ExecutionIcon} from './execution-icon';
import {TaskProblems,taskProblems} from './task-problems';
import {ActivityIndicator} from './activity-indicator';
import {networkRecovery} from '../network-recovery.cjs';
import {userActivityPresentation,activityTimeline,isActivityOperation,userActivityText,userOperationTitle} from './activity-presentation';
import {verificationFailure} from './verification-state';
import React, {useEffect,useRef,useId,useState} from 'react';
import {progressSummary,progressHeadline,confirmationNotice,readableProgressText} from './progress-summary';
import {visiblePlanItems} from './progress-placement';
import {deliveryStatus} from './delivery-status';
import type {Task,AgentRun,InputCoverageEntry} from './types';
const statuses:Record<string,string>={understanding:'理解需求',running:'执行中',waiting_permission:'等待授权',waiting_user:'等待回答',paused:'已暂停',blocked:'需要处理阻塞',failed:'执行中断',partial:'已交付部分成果',completed:'已完成',idle:'回复已完成',preparing:'正在准备回复',queued:'排队中',replying:'正在回复',settling:'正在保存回复'};
const steps:Record<string,string>={pending:'待执行',waiting_sync:'等待同步',running:'进行中',done:'已完成',blocked:'阻塞'};
const eventLabels:Record<string,string>={request_directory:'申请目录授权',request_network:'申请联网授权',permission_requested:'等待目录授权',permission_required:'授权需要处理',intent:'分析任务与确定方向',checkpoint:'保存任务进展',plan:'更新执行计划',plan_update:'更新执行计划',route:'确定处理方式',batch_read:'批量读取资料',subagent:'汇总子 Agent 调查',subagent_status:'子 Agent 进度',attached_progress:'更新进度与记忆',loop_recovery:'自动调整执行方式',no_action_recovery:'收敛无效思考',view_image:'回看图片',browser:'检查网页运行结果',read_file:'读取文件',write_file:'写入文件',edit_file:'修改文件',run_command:'执行命令',tool_error:'操作未成功',steering:'接收补充要求',finish:'完成任务',command_interrupted:'执行已中断，结果待核对',list_files:'检查项目文件',read_source:'读取原始材料',read_material:'读取材料',artifact:'登记成果',acceptance_check:'检查验收结果'};
const optionalCriterion=(c:NonNullable<AgentRun['acceptanceCriteria']>[number])=>c.level==='optional'||c.quality?.level==='optional';
export function progressCoverage(run:AgentRun){
  const criteria=(run.acceptanceCriteria||[]).map(c=>!run.problemLedger&&c.type==='visual'&&taskProblems(run).some(p=>p.status!=='resolved')?{...c,status:'pending' as const}:c);
  const must=criteria.filter(c=>!optionalCriterion(c)),optional=criteria.filter(optionalCriterion),part=(items:typeof criteria)=>({total:items.length,passed:items.filter(c=>c.status==='passed').length});
  return {criteria,must:run.qualityCoverage?.must||part(must),optional:run.qualityCoverage?.optional||part(optional),mustCriteria:must,optionalCriteria:optional};
}
export function inputCoverageForMessage(run:AgentRun|undefined,messageId:string):InputCoverageEntry|undefined{
  const pending=run?[run]:[],seen=new Set<AgentRun>();let examined=0;
  while(pending.length&&examined++<200){const current=pending.shift()!;if(seen.has(current))continue;seen.add(current);const rows=Array.isArray(current.inputCoverage)?current.inputCoverage:current.inputCoverage?.entries,entry=rows?.find(e=>e.inputId===messageId);if(entry)return entry;pending.unshift(...(current.history||[]).slice().reverse());}
}
export function InputCoverageStatus({run,messageId}:{run?:AgentRun;messageId:string}){
  const entry=inputCoverageForMessage(run,messageId);if(!entry)return null;
  const labels={received:'已接收 · 待处理',planned:'已纳入计划',verified:'相关要求已核验',answered:'已回答',superseded:'已撤回',continuation:'继续指令'};
  const hints={received:'消息与附件已接收，尚未纳入执行计划；不代表已落实。',planned:'此条输入已关联执行要求，完成情况仍需核验。',verified:'此条输入关联的必须要求已有有效核验证据，不代表其他输入或整个任务完成。',answered:'此条讨论输入已有回答。',superseded:'已依据后续用户明确指令撤回。',continuation:'沿原任务与证据继续，没有新增要求。'};
  if(!Object.hasOwn(labels,entry.status))return null;
  const icons:Record<InputCoverageEntry['status'],React.ComponentProps<typeof Icon>['name']>={received:'clock',planned:'queue',verified:'check',answered:'chat',superseded:'close',continuation:'refresh'};
  const description=`${labels[entry.status]}：${hints[entry.status]}`;
  return <span className={`input-coverage-status input-coverage-${entry.status}`} data-input-status={entry.status} title={description} role="img" aria-label={`此条输入：${description}`}><Icon name={icons[entry.status]}/></span>;
}
export function executionEventText(e:AgentRun['events'][number]):string {
  if(e.type==='android_device'&&!e.detail.message&&!e.detail.purpose)return ({start:'准备项目模拟器',install:'安装当前 APK',launch:'启动应用',logs:'读取运行日志',screenshot:'获取运行截图',check:'完成设备运行核对',status:'检查设备状态',stop:'停止项目模拟器'} as Record<string,string>)[e.detail.operation||'']||'设备操作';
  if(e.type==='build_android'&&!e.detail.message&&!e.detail.purpose)return '执行标准 Android 构建';
  return e.detail.purpose || e.detail.message || (e.detail.name ? `${eventLabels[e.type]||'执行操作'} · ${e.detail.name}${e.detail.entry ? ` / ${e.detail.entry}` : ''}${e.detail.offset !== undefined ? ` · 位置 ${e.detail.offset}` : ''}` : e.detail.path || eventLabels[e.type] || '更新任务状态');
}
export function executionEventState(e:AgentRun['events'][number]):'failed'|'unknown'|'done'|'recorded' {
  if(e.type==='command_interrupted'||e.detail.timedOut)return 'unknown';
  if(e.type==='tool_error'||(e.detail.exitCode!==undefined&&e.detail.exitCode!==0))return 'failed';
  if(e.detail.exitCode===0)return 'done';
  return 'recorded';
}
function ExecutionLog({command,output,truncated,outputLimit=24000,running=false,description,meta}:{outputLimit?:number;command?:string;output?:string;truncated?:boolean;running?:boolean;description?:string;meta?:string}) {
  const outputRef=useRef<HTMLPreElement>(null),follow=useRef(true);
  useEffect(()=>{const el=outputRef.current;if(el&&follow.current)el.scrollTop=el.scrollHeight;},[output]);
  return <details className="execution-log" onToggle={event=>{const el=outputRef.current;if(event.currentTarget.open&&el&&follow.current)el.scrollTop=el.scrollHeight;}}><summary>{command?'查看命令与输出':'查看操作详情与输出'}</summary>
    {description&&<p className="execution-log-label">{description}</p>}{meta&&<p className="execution-log-label">{meta}</p>}
    {command&&<><p className="execution-log-label">实际命令</p><pre className="execution-command"><code>{command}</code></pre></>}
    <p className="execution-log-label">{running?'实时输出':'执行输出'}{truncated?` · 仅保留末尾 ${outputLimit.toLocaleString('en-US')} 字符`:''}</p>
    <pre ref={outputRef} onScroll={event=>{const el=event.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<24;}} className="execution-output" tabIndex={0} aria-label={running?'命令实时输出':'命令执行输出'}>{output|| (running?'等待命令输出…':'此次操作没有文本输出。')}</pre>
  </details>;
}
export function ExecutionEvents({events,inFlight,live=false}:{events:AgentRun['events'];inFlight?:AgentRun['inFlight'];live?:boolean}) {
  const shown=events.filter(isActivityOperation),timeline=activityTimeline(events);
  const liveId=inFlight?.actionId||'in-flight';
  if(inFlight){const event={id:liveId,type:inFlight.action,at:inFlight.at,detail:{query:inFlight.query,operation:inFlight.operation,purpose:inFlight.purpose,command:inFlight.command,output:inFlight.output,outputTruncated:inFlight.outputTruncated,actionId:liveId}};shown.push(event);timeline.push({kind:'operation',event});}
  const groupedIds=new Set(timeline.flatMap(entry=>entry.kind==='recovery'?entry.events.map(e=>e.id):[]));
  const internal=events.filter(e=>!isActivityOperation(e)&&!groupedIds.has(e.id));
  return <div className="execution-event-list">
    {!!timeline.length&&<ol className="execution-timeline" aria-label="最近操作时间线">
      {timeline.map(entry=>{
        if(entry.kind==='recovery')return <li key={entry.id} className="execution-event execution-recovery-row"><span className="execution-event-mark" aria-hidden="true"><Icon name="refresh"/></span><details className="execution-recovery"><summary>自动调整执行方式<span className="execution-recovery-count">（{entry.events.length} 条记录）</span></summary>{entry.events.map(e=><p className="execution-diagnostic-record" key={e.id}>{new Date(e.at).toLocaleTimeString()} · {executionEventText(e)}</p>)}</details><p className="execution-event-meta"><time dateTime={entry.events.at(-1)!.at}>{new Date(entry.events.at(-1)!.at).toLocaleTimeString()}</time> · 自动重试记录</p></li>;
        const e=entry.event;const pending=!!inFlight&&e.id===liveId;const state=pending?(live?'running':'unknown'):executionEventState(e);const label=state==='running'?'执行中':state==='failed'?'未成功':state==='unknown'?'结果待确认':state==='done'?'已执行':'已处理';
        return <li key={e.detail.actionId||e.id} className={`execution-event execution-event-${state}`}>
          <span className="execution-event-mark" aria-label={label}><ExecutionIcon action={e.type} state={state}/></span>
          <div className="execution-event-title">{userOperationTitle(e)}</div>
          {!!e.detail.sources?.length&&<ul className="execution-search-sources">{e.detail.sources.map((source,i)=><li key={i}>{source.title} · {source.domain}</li>)}</ul>}
          {e.type==='tool_error'&&userActivityText(e.detail.message)&&<p className="execution-event-error">{userActivityText(e.detail.message)}</p>}
          <p className="execution-event-meta"><time dateTime={e.at}>{new Date(e.at).toLocaleTimeString()}</time> · {pending&&live&&<ActivityIndicator/>}{label}</p>
          {(e.detail.command||e.detail.output!==undefined||e.detail.message||e.detail.purpose||e.detail.path||e.detail.name||e.detail.exitCode!==undefined||pending&&e.type==='build_android')&&<ExecutionLog description={[e.detail.purpose||e.detail.message,e.detail.path,e.detail.name].filter(Boolean).join(' · ')} meta={[e.detail.exitCode!==undefined?`退出码 ${e.detail.exitCode}`:'',e.detail.durationMs!==undefined?`耗时 ${(e.detail.durationMs/1000).toFixed(1)} 秒`:'',e.detail.timedOut?'已超时':''].filter(Boolean).join(' · ')} running={pending&&live} command={e.detail.command} output={e.detail.output} truncated={e.detail.outputTruncated} outputLimit={e.detail.outputLimit}/>}
        </li>;
      })}
    </ol>}
    {!timeline.length&&!internal.length&&<p className="execution-event-meta">最近没有新的操作结果。</p>}
    {(!!internal.length||!!shown.length)&&<details className="execution-internal"><summary>查看运行详情</summary>
      <p className="execution-event-meta">仅展示最近操作；命令成功不代表任务已完成或验收通过。</p>
      {internal.map(e=><div className="execution-diagnostic-record" key={e.id}><p>{new Date(e.at).toLocaleTimeString()} · {executionEventText(e)}</p>{e.detail.output&&<pre>{e.detail.output}</pre>}</div>)}
    </details>}

  </div>;
}
function StepDescription({text,paused=false}:{text:string;paused?:boolean}) {
  return <div className="progress-description"><div className="progress-preview-lines">{progressSummary(text).map(part=><p className="progress-summary-line" key={part.label}><span>{paused&&part.label==='正在处理'?'暂停前进展':part.label}：</span><span>{readableProgressText(part.text)}</span></p>)}</div><details className="progress-step-expand"><summary><span className="progress-detail-show">查看本步详情</span><span className="progress-detail-hide">收起本步详情</span></summary><p className="progress-step-detail">{text}</p></details></div>;
}
function StatusBadge({status,label,animated=false}:{status:string;label:string;animated?:boolean}) {
  const tone = status==='done'||status==='completed'||status==='archived' ? 'done' : status==='running'||status==='understanding' ? 'running' : status==='blocked'||status==='failed' ? 'blocked' : 'pending';
  return <span className={`task-status task-status-${tone}`}>
    <svg className={animated&&tone==='running'?'progress-status-spinning':undefined} aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {status==='paused' ? <><circle cx="8" cy="8" r="6"/><path d="M6 5.5v5M10 5.5v5"/></> : tone==='done' ? <><circle cx="8" cy="8" r="6"/><path d="m5 8 2 2 4-4"/></> : tone==='blocked' ? <><path d="M8 2 15 14H1Z"/><path d="M8 6v3m0 2.3v.2"/></> : tone==='running' ? <><circle cx="8" cy="8" r="6" opacity=".3"/><path d="M8 2a6 6 0 0 1 6 6"/>{!animated&&<path d="M8 5v3l2 1"/>}</> : <circle cx="8" cy="8" r="5.5"/>}
    </svg><span>{label}</span>
  </span>;
}
export function TaskProgress({task,busy,onContinue,showRecovery=true,showLoaded=true,onOpenArtifacts,historical=false,currentStatus,expandedHistory=false}:{expandedHistory?:boolean;historical?:boolean;currentStatus?:string;onOpenArtifacts:()=>void;task:Task;busy:boolean;onContinue:()=>void;showRecovery?:boolean;showLoaded?:boolean}) {
  const original=task.agentRun!;
  const run=currentStatus&&!historical?{...original,status:currentStatus}:original;
  const quality=progressCoverage(run);
  const optionalItems=quality.optionalCriteria.length?quality.optionalCriteria:(run.qualityCoverage?.optionalPending||[]).map(c=>({...c,status:'pending' as const}));
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
  const loaded=showLoaded&&!!run.loadedExtensions?.length && <div className="execution-extensions" role="status" aria-label="本轮已加载的技能与专家"><span>本轮已加载</span>{run.loadedExtensions.map(e=><span className="execution-extension" key={e.id}><ExecutionIcon kind={e.kind}/><span>{e.kind==='skill'?'技能':'专家'} · {e.name}</span></span>)}</div>;
  const recoverable=['paused','failed','blocked','waiting_permission','partial'].includes(run.status);
  const continuation=recoverable&&run.taskContinuation?.taskOpen?run.taskContinuation:undefined;
  const network=networkRecovery(run);
  if (!showRecovery && recoverable && !run.steps.length && !run.artifacts.length) return loaded || null;
  if(run.mode==='chat' && !recoverable)return loaded || null;
  const deliveryLabel=run.delivery?.status==='settled'&&run.status!=='completed'?deliveryStatus(run).label:run.delivery?.visualReviewPending?'已完成 · 视觉效果待人工确认':run.delivery?.outcome==='limited'?'已交付（有明确限制）':'已完成';
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
    const optional=!!step.requirementIds?.length&&step.requirementIds.every(id=>quality.optionalCriteria.some(c=>c.id===id));
    return <li key={step.id} value={number} className={`compact-step compact-step-${status}`}>
      <button type="button" className="compact-step-toggle" aria-expanded={open} aria-controls={panelId} onClick={()=>setExpanded(open?null:{scope,id:step.id})}>
        <StatusBadge status={status} label={label} animated={busy&&!historical}/><span className="compact-step-number" aria-hidden="true">{number}.</span><span className="compact-step-heading"><span className="compact-step-title" title={title}>{title}</span>{optional&&<span className="compact-step-optional">可选</span>}{confirmation&&<span className="compact-confirmation">{confirmation}</span>}{(step.status==='waiting_sync'||(ambiguousRunning&&step.status==='running'))&&<span className="compact-confirmation">{label}</span>}</span>
      </button>
      {headline&&!open&&<p className="compact-step-update" title={headline}>{readableProgressText(headline)}</p>}
      {open&&<div id={panelId} className="compact-step-panel"><strong>{label}</strong>{detail?(active?<StepDescription text={detail} paused={paused}/>:<p className="progress-step-detail">{detail}</p>):<p className="progress-step-detail">{step.title}</p>}</div>}
    </li>;
  };
  const finishing=run.status==='running' && !!run.steps.length && run.steps.every(s=>s.status==='done');
  const liveProgress=!historical&&busy&&!run.steps.length&&['running','understanding'].includes(run.status);
  const activity=liveProgress?userActivityPresentation(run,statuses[run.status]||run.status):undefined;
  const latestOperation=run.events.filter(isActivityOperation).at(-1);
  const goal=readableProgressText(run.goal||task.title||'');
  const acceptanceCount=quality.must.total?`必须验收 ${quality.must.passed}/${quality.must.total} 项`:'';

  if(historical&&!expandedHistory)return <ExecutionHistory task={task} run={run} onOpenArtifacts={onOpenArtifacts}/>;
  if(run.status==='completed')return <>{loaded}<details className="completed-execution"><summary>✓ {run.goal || '本轮任务'} · {deliveryLabel}{acceptanceCount?` · ${acceptanceCount}`:''}</summary><TaskProgress task={{...task,agentRun:{...run,status:'archived',loadedExtensions:[]}}} busy={busy} onContinue={onContinue} showRecovery={false} onOpenArtifacts={onOpenArtifacts}/></details></>;
  return <>{loaded}<section className="task-progress task-progress-compact" aria-label="任务计划与成果">
    <div className="task-progress-heading"><div className="compact-progress-heading"><strong>{historical?'此前任务进度':'任务进度'}</strong>{acceptanceCount?<span>{acceptanceCount}</span>:!!run.steps.length&&<span>步骤已完成 {completedSteps.length}/{run.steps.length}</span>}</div><div className="task-progress-controls"><StatusBadge status={run.status} animated={busy&&!historical} label={network?'连接待重试':continuation?'等待处理 · 任务保留':verificationError?'验收未通过':finishing?'正在核对交付':run.status==='archived'||run.delivery?.status==='settled'?deliveryLabel:statuses[run.status]||run.status}/>{recoverable && showRecovery && run.delivery?.retryAvailable!==false && <button className="primary" disabled={busy} onClick={onContinue}>{network?'重试当前步骤':continuation?'补充信息后继续':verificationError?'继续验收':run.status==='failed'?'重试当前步骤':'继续任务'}</button>}</div></div>
    {liveProgress&&goal&&<p className="progress-visible-goal">{goal}</p>}
    {activity&&<div className="progress-focus" role="status"><span className="progress-focus-label"><ActivityIndicator/>思考中</span><div><strong>{userActivityText(activity.label,180)||'正在分析任务要求'}</strong>{activity.detail&&<p>{userActivityText(activity.detail,240)}</p>}{!run.steps.length&&!run.inFlight&&!latestOperation&&<p>正在梳理需求与已有材料，执行计划尚未生成。</p>}</div></div>}
    {liveProgress&&latestOperation&&<div className="progress-context">
      {latestOperation&&<p><span>最近进展</span><span>{userOperationTitle(latestOperation)} · {executionEventState(latestOperation)==='failed'?'未成功':executionEventState(latestOperation)==='unknown'?'结果待确认':'已有操作记录'}</span></p>}
    </div>}
    {continuation&&<div className="compact-state-note" role="status"><strong>任务尚未完成，已保留原状态与成果。</strong><p>{network?.question||continuation.question}</p><p>{network?'上次请求记录：':'当前缺口：'}{continuation.gap}</p><p>原要求 {continuation.retained.requirements} 项 · 已登记成果 {continuation.retained.artifacts.length} 项。{network?'点击后重新检查连接并沿原任务继续；':'补充信息后从原任务继续；'}此状态不计成功交付。</p></div>}
    {verificationError&&<p className="error" role="alert">{stepsComplete?'计划步骤已完成，最终验收未通过。':'最终验收未通过。'}{verificationError}</p>}
    {historical&&busy&&<p className="compact-state-note">此处为此前保存的计划；本轮回复结束后可继续。</p>}
    {!!run.steps.length && <div className="progress-overview">
      {!!quality.criteria.length&&<p className="compact-state-note">{quality.mustCriteria.some(c=>c.type==='visual')?`必须项视觉 ${quality.mustCriteria.filter(c=>c.type==='visual'&&c.status==='passed').length}/${quality.mustCriteria.filter(c=>c.type==='visual').length} 项。`:''}步骤完成不代表验收通过。</p>}
      {ambiguousRunning&&<p className="compact-state-note">有多个步骤标记为进行中，实际执行状态待核对。</p>}
      {!!completedSteps.length&&<button type="button" className="compact-completed-toggle" aria-expanded={!collapsed} aria-controls={`${listId}-steps`} onClick={toggleCompleted}>{collapsed?'展开已完成':'收起已完成'}（{completedSteps.length}）</button>}
      <ol id={`${listId}-steps`} className="compact-plan-list" aria-label="任务步骤">{run.steps.filter(step=>!collapsed||step.status!=='done').map(stepRow)}</ol>
      {finishing && <p className="progress-finishing" role="status">计划步骤已完成，正在核对交付结果。</p>}
    </div>}
    {quality.optional.total>0&&<details className="progress-optional"><summary>可选优化 {quality.optional.passed}/{quality.optional.total} 项已核验<span> · 未验不阻塞必须项交付</span></summary>{!!optionalItems.length&&<ul>{optionalItems.map(c=><li key={c.id}>{c.text}<small> · {c.status==='passed'?'已核验':'待完成或核验'}</small></li>)}</ul>}</details>}
    {recoverable && !run.steps.length && <p className="muted">尚未形成执行计划。需求与材料已保存在当前项目，无需重新创建或打开文件夹。</p>}
    {run.materialInput&&<details className="compact-state-note"><summary>本次附件：{run.materialInput.status==='adopted'?'已纳入计划 · 效果仍需验收':run.materialInput.status==='inspected'?'已读取关键内容 · 待确认用途':'已收到 · 正在读取'}</summary>{run.materialInput.materials.map(m=><p key={m.id}>{m.name} · {m.error?'部分内容未读取成功':m.reads.some(r=>r.kind==='image_pending')?'图片待观察':'已提供有界内容'}{run.materialInput?.uses?.find(u=>u.id===m.id)&&' · '+({design:'设计依据',reference:'参考',data:'数据',irrelevant:'本次不适用'}[run.materialInput.uses.find(u=>u.id===m.id)!.role]||'已登记用途')}。{m.error}</p>)}</details>}
    <details className="progress-more"><summary>任务详情与执行记录</summary>
    <TaskProblems run={run}/>
    {run.goal && <div className="progress-goal-detail"><strong>任务目标</strong><p>{run.goal}</p></div>}
    {!!decisions.length && <details><summary>已确认要求与决策</summary><ul>{decisions.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
    {run.performance&&<details><summary>执行效率</summary>{run.runtimeIdentity&&<p>运行版本 {run.runtimeIdentity.appVersion} · 记录标识 {run.runtimeIdentity.runtimeFingerprint.slice(0,12)}。自动接续 {run.performance.automaticContinuations??0} 次；复用已验证结果 {run.performance.reusedTools??0} 次；避免重复写入 {run.performance.noOpWrites??0} 次。</p>}<p>任务累计（含继续）{(run.performance.wallMs/60000).toFixed(1)} 分钟：模型请求 {run.performance.modelRequests} 次，等待 {(run.performance.modelMs/60000).toFixed(1)} 分钟；实际工具执行 {(run.performance.toolMs/1000).toFixed(1)} 秒。</p><p>其中：无动作请求 {run.performance.noActionRequests} 次，耗时 {(run.performance.noActionMs/60000).toFixed(1)} 分钟；计划、摘要、路由与交付等流程请求 {run.performance.processModelRequests} 次，耗时 {(run.performance.processModelMs/60000).toFixed(1)} 分钟。以上均包含在模型总耗时中。</p><p>批量读取 {run.performance.batchItems} 项；附带进度更新 {run.performance.attachedUpdates} 次。服务商完整报告用量 {run.performance.reportedUsageRequests}/{run.performance.modelRequests} 次，已报告输入 {run.performance.inputTokens}、输出 {run.performance.outputTokens} tokens。</p></details>}
    {!run.problemLedger&&!!run.issues?.length&&<details><summary>已发现的问题与限制</summary><ul>{run.issues.map(issue=><li key={issue.id}>{issue.status==='resolved'?'已修复':issue.status==='limitation'?'已披露限制':'待处理'} · {issue.description}{issue.reason&&<p>{issue.reason}</p>}</li>)}</ul></details>}
    {run.performance&&<p className="muted">模型请求失败 {run.performance.failedModelRequests} 次。{run.performance.runtimeCountersSince?`自 ${new Date(run.performance.runtimeCountersSince).toLocaleString()} 起新增统计：工具成功 ${run.performance.successfulTools??0} 次 · 动作错误 ${run.performance.toolErrors??0} 次 · 其中验收失败 ${run.performance.validationFailures??0} 次；工具成功不代表验收通过。`:''}{run.performance.timedActionRequests?`已记录首次动作时间的 ${run.performance.timedActionRequests} 次请求中，动作输出前等待 ${((run.performance.beforeActionMs||0)/60000).toFixed(1)} 分钟（包含在模型请求耗时中，不等于纯推理时间）。`:''}</p>}
    {run.completionReview&&<details><summary>交付复核</summary><p>{run.completionReview.summary}</p>{!!run.completionReview.unverified.length&&<><strong>尚未核验</strong><ul>{run.completionReview.unverified.map(item=><li key={item}>{run.acceptanceCriteria?.find(c=>c.id===item)?.text||item}</li>)}</ul></>}</details>}
    {!!acceptance.length && <details><summary>必须验收要求</summary><ul>{acceptance.filter(s=>!optionalItems.some(c=>c.text===s)).map((s,i)=><li key={i}>{s}{run.acceptanceCriteria&&<small> · {quality.criteria.find(c=>c.text===s)?.status==='passed'?(quality.criteria.find(c=>c.text===s)?.basis==='model_assessment'?'模型已评估':'已核验'):quality.criteria.find(c=>c.text===s)?.status==='recorded'?'已记录证据，交付前检查有效性':'待核验'}</small>}</li>)}</ul></details>}

    {run.recoverySummary&&!!(run.recoverySummary.retried+run.recoverySummary.recovered+run.recoverySummary.unknown)&&<p className="muted">自动重试 {run.recoverySummary.retried} 项 · 已核对恢复 {run.recoverySummary.recovered} 项{run.recoverySummary.unknown?` · ${run.recoverySummary.unknown} 项操作结果待核对`:''}</p>}
    {!!run.events.length && (!busy || historical) && <details><summary>最近执行记录</summary><ExecutionEvents events={run.events}/></details>}
    </details>
    {!!run.artifacts.length && <button className="artifact-shortcut" onClick={onOpenArtifacts}>查看产物（{run.artifacts.length}） →</button>}
  </section></>;
}

export function ExecutionHistory({task,run,onOpenArtifacts}:{task:Task;run:AgentRun;onOpenArtifacts:()=>void}) {
  const [open,setOpen]=useState(false),quality=progressCoverage(run);
  const label=run.delivery?.status==='settled'||run.status==='completed'?deliveryStatus(run).label:statuses[run.status]||run.status;
  return <details className="execution-history-summary" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>此前执行 · {label}{quality.must.total?` · 必须验收 ${quality.must.passed}/${quality.must.total}`:''}{quality.optional.total?` · 可选 ${quality.optional.passed}/${quality.optional.total}`:''}<span>查看详情</span></summary>{open&&<TaskProgress task={{...task,agentRun:run}} historical expandedHistory busy={false} onContinue={()=>{}} showRecovery={false} onOpenArtifacts={onOpenArtifacts}/>}</details>;
}

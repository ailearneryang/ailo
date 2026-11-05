import React from 'react';
import type {AgentRun,TaskProblem,ProblemVersion} from './types';
const labels:Record<TaskProblem['status'],string>={open:'待处理',pending_check:'待复验',resolved:'已验证解决',regressed:'再次出现',uncertain:'待确认',limitation:'已披露限制',dismissed:'已核对不适用'};
export function taskProblems(run:AgentRun):TaskProblem[]{
 if(run.problemLedger)return run.problemLedger;
 // Historical snapshots may lack the new ledger. Never pretend that their
 // old defect list is a fresh assessment of the current version.
 return [...(run.designRegionIssues||[]).map(p=>({id:p.regionId,description:p.region+'：'+p.reason,source:'region',status:'pending_check' as const,reason:'历史问题记录，当前状态待复核'})),...(run.issues||[]).map(p=>({id:'issue_'+p.id,description:p.description,status:p.status==='resolved'?'pending_check' as const:p.status==='limitation'?'limitation' as const:'open' as const,reason:p.reason}))];
}
function Version({version:v,label}:{version?:ProblemVersion;label:string}){if(!v)return null;return <div className="task-problem-version"><strong>{label}</strong>{v.at&&<p>{new Date(v.at).toLocaleString()}</p>}{v.image&&<p>图片：{v.image.path} · {v.image.sha256.slice(0,12)}</p>}{v.apk?<p>APK：{v.apk.path} · {v.apk.sha256.slice(0,12)}</p>:<p>此记录未关联 APK，不能作为安装版本证明。</p>}{v.sourceSetHash&&<p>来源依赖指纹：{v.sourceSetHash.slice(0,12)} · {v.sourceCount} 项</p>}</div>;}
function Row({problem:p}:{problem:TaskProblem}){return <li className={`task-problem task-problem-${p.status}`}>
 <div className="task-problem-line"><span className="task-problem-status">{labels[p.status]}</span><span>{p.description}</span></div>
 <details className="task-problem-evidence"><summary>查看状态依据</summary>
  {p.reason&&<p>{p.reason}</p>}
  {p.detectedRevision!==undefined&&<p>发现于工程版本 r{p.detectedRevision}</p>}
  {p.verifiedRevision!==undefined&&<p>最近通过复验：工程版本 r{p.verifiedRevision}{p.verifiedAt?' · '+new Date(p.verifiedAt).toLocaleString():''}</p>}
  {p.status==='pending_check'&&<p>{p.previouslyResolved?'此前版本已验证解决；当前版本需要复验，尚未认定问题再次出现。':'后续修改或旧检查不足以证明问题已解决，仍需当前版本复验。'}</p>}
  {p.regressions? <p>此前解决后再次发现 {p.regressions} 次，历史记录仍保留。</p>:null}
  <Version version={p.findingVersion} label="发现时的证据"/><Version version={p.verifiedVersion} label="最近通过复验的证据"/>
  {p.evidenceId&&<p className="task-problem-reference">核对记录：{p.evidenceId}</p>}
 </details>
 </li>;}
export function TaskProblems({run}:{run:AgentRun}){
 const problems=taskProblems(run),investigations=problems.filter(p=>!['resolved','dismissed'].includes(p.status)&&p.blocking===false),active=problems.filter(p=>!['resolved','dismissed'].includes(p.status)&&p.blocking!==false),resolved=problems.filter(p=>p.status==='resolved'),dismissed=problems.filter(p=>p.status==='dismissed');
 if(!problems.length)return null;
 return <details className="task-problems" aria-label="问题处理进展">
  <summary className="task-problems-heading"><strong>问题处理</strong><span>{active.length?active.length+' 项待处理或核验':investigations.length?investigations.length+' 项待调查，无已确认阻塞':'当前记录已完成核验'}</span><span className="task-problems-toggle"><span className="task-problems-show">查看详情</span><span className="task-problems-hide">收起详情</span></span></summary>
  <div className="task-problems-body">
  {active.length>0&&<p className="task-problems-notice">{active.some(p=>p.source==='visual'||p.source==='region')?'相关问题尚未完成复验，视觉验收未通过。':'相关问题尚待处理或核验，任务验收尚未全部通过。'}</p>}
  <div className="task-problems-counts">{(['open','pending_check','regressed','uncertain','limitation','resolved','dismissed'] as const).map(status=>{const count=problems.filter(p=>p.status===status).length;return count?<span key={status}>{labels[status]} {count}</span>:null;})}</div>
  {!!active.length&&<><ul className="task-problem-list">{active.slice(0,4).map(p=><Row key={p.id} problem={p}/>)}</ul>{active.length>4&&<details className="task-problems-more"><summary>展开其余 {active.length-4} 项</summary><ul className="task-problem-list">{active.slice(4).map(p=><Row key={p.id} problem={p}/>)}</ul></details>}</>}
  {!!investigations.length&&<details className="task-problems-more"><summary>待调查（{investigations.length}，不自动阻塞本轮）</summary><p>模型提出的怀疑需要来源或交互验证；原要求的独立验收仍须完成。</p><ul className="task-problem-list">{investigations.map(p=><Row key={p.id} problem={p}/>)}</ul></details>}
  {!!dismissed.length&&<details className="task-problems-resolved"><summary>已核对不适用（{dismissed.length}，不计修复）</summary><ul className="task-problem-list">{dismissed.map(p=><Row key={p.id} problem={p}/>)}</ul></details>}
  {!!resolved.length&&<details className="task-problems-resolved"><summary>已验证解决（{resolved.length}）</summary><ul className="task-problem-list">{resolved.map(p=><Row key={p.id} problem={p}/>)}</ul></details>}
  </div>
 </details>;
}

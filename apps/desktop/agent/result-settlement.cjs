const acceptance=require('./acceptance.cjs');
// Compatibility entrypoint for saved tasks; live and restored failures share one policy.
function internal(error){return typeof error?.code==='string'&&!!error.code&&require('./exit-policy.cjs').classify(error,{})==='internal';}
function unknown(run){return require('./recovery-control.cjs').unknown(run);}
function begin(run,error){
 if(unknown(run))return false;
 require('./recovery-state.cjs').bind(run);
 const maxTurns=require('./recovery-control.cjs').limits.remainingIdleDecisions;
 if(!run.resultRecovery||run.resultRecovery.executionId!==run.executionId)run.resultRecovery={version:1,executionId:run.executionId,stage:'remaining',turns:0,maxTurns,failures:[]};
 const state=run.resultRecovery;
 if(!Number.isSafeInteger(state.maxTurns)||state.maxTurns<1||state.maxTurns>maxTurns)state.maxTurns=maxTurns;
 if(state.stage==='resuming')state.idleTurns=0;
 state.stage='remaining';
 state.failures.push({code:error.code||'TOOL_FAILURE',message:String(error.message||error).slice(0,1200)});
 state.failures=state.failures.slice(-8);
 return state;
}
function context(run){
 const state=run.resultRecovery;
 if(!state||state.stage!=='remaining')return;
 return {...state,instruction:'部分问题的恢复已耗尽。不要重复同一失败方法，继续完成不受影响的要求、修复可修复的问题、登记真实成果并核验。原要求、未通过检查与已知缺陷全部保留；不得改为可选或伪造通过。能满足全部要求则正常finish；已无其他可行工作时用blocked结束，运行时将整理已有成果与具体缺口。只有真正需要用户决定、必要信息或权限才clarify。'};
}
async function inventory(workspace,{signal}={}){
 signal?.throwIfAborted();
 const run=workspace.run;
 await require('./result-preview.cjs').refresh(workspace,{hydrate:true});
 await require('./problem-state.cjs').refresh(workspace);
 const {files,unavailable}=await require('./result-sources.cjs').files(workspace,{signal});
 const criteria=acceptance.criteria(run),passed=[],pending=[],optionalPassed=[],optionalPending=[],freshIds=[];
 for(const criterion of criteria){
  let fresh=false;
  if(criterion.check?.status==='passed')try{await require('./evidence.cjs').assertFresh(workspace,criterion.check);fresh=true;}catch{}
  if(fresh)freshIds.push(criterion.id);
  const optional=require('./quality-contract.cjs').optional(criterion);
  (optional?(fresh?optionalPassed:optionalPending):(fresh?passed:pending)).push({id:criterion.id,text:criterion.text,type:criterion.type});
 }
 run.freshAcceptanceIds=freshIds;const qualityCoverage=acceptance.qualitySummary(run);run.qualityCoverage=qualityCoverage;
 return {files,unavailable,passed,pending,total:passed.length+pending.length,optionalPassed,optionalPending,qualityCoverage};
}
async function settle(workspace,error,{signal,summarize}={}){
 signal?.throwIfAborted();
 const run=workspace.run;
 if(unknown(run))return null;
 const found=await inventory(workspace,{signal}),at=new Date().toISOString();
 await require('./candidate-versions.cjs').capture(workspace,{reason:'settled_verified_work',signal});
 signal?.throwIfAborted();
 let selectedCandidate;
 try{const selected=await require('./candidate-recovery.cjs').selectDelivery(workspace,{signal});if(selected.status==='selected')selectedCandidate=selected;}catch(error){signal?.throwIfAborted();if(error.code==='ERR_ASSERTION')throw error;await workspace.event('candidate_selection_unavailable',{code:error.code||'CANDIDATE_SELECTION_FAILED',message:String(error.message||error).slice(0,600)});}
 const sources=await require('./result-sources.cjs').findings(workspace,{signal});
 const turn=require('./input-turn.cjs').changes(run,found.files);
 const followup=run.inputTurn?.followup;
 const repairReport=await require('./repair-report.cjs').inspect(workspace,found.files);
 const androidRepair=!!repairReport.apk&&require('./problem-state.cjs').rows(run).length>0;
 const currentProgress=turn.changedArtifacts.length||sources.length;
 let analysis=[];
 if(summarize&&sources.length&&!androidRepair){
  try{const value=await summarize({goal:run.inputTurn?.requiresPlan===false?run.goal:run.currentRequest||run.goal,originalGoal:run.goal,inputId:run.inputKey,changes:turn,sources,pending:found.pending},signal);
   if(Array.isArray(value?.findings))analysis=value.findings.filter(f=>typeof f.text==='string'&&f.text.trim()&&f.text.length<=2000&&Array.isArray(f.sourceIds)&&f.sourceIds.length&&f.sourceIds.every(id=>sources.some(s=>s.id===id))).slice(0,8);
  }catch(error){signal?.throwIfAborted();if(error.code==='ERR_ASSERTION')throw error;}
 }
 if(!analysis.length&&!androidRepair)analysis=sources.map(s=>({text:s.text.slice(0,800),sourceIds:[s.id],excerpt:true}));
 signal?.throwIfAborted();
 const state=run.resultRecovery||{version:1,executionId:run.executionId,turns:0,failures:[]};
 run.resultRecovery={...state,stage:'settled',at};
 // This is explicitly NOT the finish path. Never mark steps/checks complete,
 // resolve issues, or turn missing implementations into accepted limitations.
 run.status=(followup?currentProgress:found.files.length||analysis.length)?'partial':'blocked';run.currentOutcome='settled';
 run.delivery={...(selectedCandidate?{selectedCandidate}:{}),outcome:run.status==='partial'?'partial':'blocked',status:'settled',at,inputId:run.inputKey,changes:turn,repairReport,
  availableArtifacts:androidRepair?[...found.files.filter(f=>/\.apk$/i.test(f.path)),...found.files.filter(f=>! /\.apk$/i.test(f.path))]:found.files,findings:analysis,unverified:found.pending.map(c=>c.id),unavailableArtifacts:found.unavailable,
  qualityCoverage:found.qualityCoverage,optionalUnverified:found.optionalPending.map(c=>c.id),coverage:{passed:found.passed.length,total:found.total},reasonCode:error.code||'RECOVERY_EXHAUSTED'};
 run.completionReview={summary:'已结束本轮尝试并整理当前成果；未满足或未核验的要求继续保留，不计完整完成。',issues:(run.issues||[]).filter(i=>i.status!=='resolved').map(i=>i.id),unverified:found.pending.map(c=>c.id),optionalUnverified:found.optionalPending.map(c=>c.id),revision:run.revision,at};
 run.taskContinuation={...run.taskContinuation,version:1,state:'settled',taskOpen:false,at,code:error.code||'RECOVERY_EXHAUSTED',question:'',gap:String(error.message||error).slice(0,1200),retained:{requirements:found.total,pendingIds:found.pending.map(c=>c.id),steps:run.steps.length,artifacts:run.artifacts.map(({path,label})=>({path,label})),unknownActions:0,revision:run.revision}};
 const lines=[androidRepair?`本轮已验证解决 ${repairReport.resolvedProblemIds.length} 项问题；仍有 ${repairReport.pendingProblemIds.length} 项待处理或核验。`:followup&&!currentProgress?'本轮尚未取得落实本次要求的有效进展；历史成果已保留，不能视为本轮完成。':followup?`本轮更新 ${turn.changedArtifacts.length} 项成果文件；本次要求尚未全部完成。`:found.files.length?'本轮已有文件可查看；原任务尚未全部完成。':analysis.length?'已整理已有材料中的阶段性结果；原任务尚未全部完成。':'本轮尝试已结束，尚未形成可交付成果。'];
 if(androidRepair){const apk=repairReport.apk;lines.push(`本轮文件变化：${turn.changedArtifacts.length} 项（不等于解决的问题数）。`,...repairReport.resolvedDescriptions.slice(0,3).map(s=>'- 已验证解决：'+s));if(repairReport.dismissedProblemIds.length)lines.push(`依据原稿核对，撤销 ${repairReport.dismissedProblemIds.length} 项不适用记录（不计修复）。`);lines.push(`APK ${apk.sha256.slice(0,12)}：${apk.changed?'文件已更新':'沿用已有文件'}；${apk.buildCurrent?'构建证据与当前源码一致':'缺少覆盖当前源码的有效构建证据，不能认定后续修改已进入此APK'}。`,`${apk.installEvidenceId?'有该APK的安装回执':'缺少该APK的安装回执'}；${apk.screenshotEvidenceId?'有该APK的运行截图':'缺少该APK的运行截图'}；${apk.hasVisualReview?'已有图像观察，仍以问题与原要求复验为准':'没有该APK的结构化图像核对记录，不能认定画面问题已解决'}。`);}
 const materialInput=require('./material-input.cjs').context(run);if(materialInput?.required)lines.push('\n本次附件：'+materialInput.materials.map(m=>m.name).join('、')+'；'+(materialInput.status==='adopted'?'已纳入计划，实际实现与效果以本轮验收为准。':'尚未纳入当前设计与要求，不能把旧成果视为本次附件的处理结果。'));
 if(analysis.length&&(!analysis.every(f=>f.excerpt)||!found.files.length))lines.push('\n'+(analysis.every(f=>f.excerpt)?'已取得的材料与操作结果摘录（不代表最终结论）：':'阶段性分析（尚未完成全部核验）：'),...analysis.slice(0,found.files.length?2:3).map(f=>'- '+f.text.slice(0,300)+'〔来源：'+f.sourceIds.map(id=>{const s=sources.find(s=>s.id===id);return s?.path||s?.label||'本轮操作记录';}).join('、')+'〕'));
 if(found.files.length)lines.push('\n'+require('../artifact-presentation.cjs').summaryLines(found.files,{request:run.currentRequest||run.goal,changedPaths:followup?turn.changedArtifacts:undefined,max:3}).join('\n'));
 if(selectedCandidate)lines.push('另有已保留的较好历史成果可在成果区查看；历史核验不代表当前文件已通过，也不替代本次未完成要求。');
 if(found.total)lines.push(`\n原要求检查：${found.passed.length}/${found.total} 项有当前有效的通过证据。`);
 if(found.optionalPending.length)lines.push(require('./quality-acceptance.cjs').notice(found.qualityCoverage));
 if(found.pending.length)lines.push('尚未完成或未核验：',...found.pending.slice(0,3).map(c=>'- '+c.text));
 const problems=require('./problem-state.cjs').rows(run),open=problems.filter(p=>!p.optional&&!['resolved','dismissed'].includes(p.status)),resolved=problems.filter(p=>p.status==='resolved');
 const problemLabels={open:'待处理',pending_check:'待复验',regressed:'再次出现',uncertain:'待确认',limitation:'已披露限制'};
 if(open.length)lines.push(`\n仍有 ${open.length} 项问题待处理或核验，重点如下：`,...open.slice(0,2).map(i=>'- ['+problemLabels[i.status]+'] '+i.description));
 if(found.pending.length>3||open.length>2)lines.push('完整要求、问题状态与证据可在任务详情中展开查看。');
 if(resolved.length)lines.push(`\n已验证解决 ${resolved.length} 项（历史记录保留，可在任务进度中展开查看）。`);
 if(found.unavailable.length)lines.push('\n以下文件缺失、为空或无法核对，未作为本次可交付成果：',...found.unavailable.map(p=>'- '+p));
 lines.push('\n本轮未能解决的问题：'+String(error.message||error).slice(0,1200));
 lines.push('已有要求、文件和证据已保留。需要时可在原任务继续。');
 const waiting=require('./input-coverage.cjs').pending(run);
 let inputPlanFailure=false;
 if(followup&&(waiting.length||require('./material-input.cjs').pending(run))&&!turn.changedArtifacts.length&&!repairReport.resolvedProblemIds.length&&['INPUT_ADOPTION_EXHAUSTED','INPUT_CONTRACT_REPAIR_EXHAUSTED','AGENT_REPAIR_EXHAUSTED','PLAN_VALIDATION','INPUT_COVERAGE_PENDING','INPUT_REQUIREMENTS_PENDING','MATERIAL_INPUT_PENDING'].includes(error.code)){
  const failedPlan=run.events.findLast(e=>e.type==='tool_error'&&e.detail?.action==='plan');
  inputPlanFailure=true;
  run.delivery.failureDetail={code:error.code,message:String(failedPlan?.detail?.message||error.message||error).slice(0,1000)};
  lines.splice(0,lines.length,'本次补充要求尚未执行完成，任务没有取得新的可交付结果。','','原因：Ailo 未能把你的补充要求正确接入原任务计划，内部校验反复失败，后续执行未能继续。这是 Ailo 的执行流程问题，不能据此判断外部服务或认证是否正常。','','本轮已停止，任务尚未完成。原要求和已有执行记录已保留；详细错误可在执行详情中查看。',...(materialInput?.materials?.length?['附件已保留，尚未完成采用。']:[]));
 }
 const preview=require('./result-preview.cjs').publicPreview(run);
 const outputs=require('../artifact-presentation.cjs').groupArtifacts(found.files,{request:run.currentRequest||run.goal,changedPaths:turn.changedArtifacts});
 run.delivery.hasNewDeliverable=outputs.current.some(f=>f.path!==preview?.path||preview?.changedSinceInput);
 run.delivery.stopReason=error.code==='REPAIR_VALUE_EXHAUSTED'?'本轮调整尚未形成通过复验的结果，已停止当前尝试。':error.code==='EXECUTION_BUDGET'?'本轮执行时间已到，已有结果已保留，任务尚未完成。':error.code==='MATERIAL_INPUT_PENDING'?'设计依据尚未核对完整，当前效果仍待确认。':'本轮未能完成全部要求，已有结果与未完成项已保留。';
 run.delivery.retryAvailable=!['REPAIR_VALUE_EXHAUSTED','AGENT_REPAIR_EXHAUSTED'].includes(error.code);
 run.delivery.nextAction=!run.delivery.retryAvailable?'当前结果已保留；可先查看效果，并在对话中补充仍需调整的地方。':preview?'从已有版本继续核验未完成要求，无需重新开始。':'检查当前阻塞后从已有任务继续，避免重复执行已完成操作。';
 if(inputPlanFailure){
  run.delivery.stopReason='Ailo 未能将补充要求接入原任务计划，后续执行未能继续。';
  run.delivery.nextAction='需要修复内部计划衔接问题后，从原任务继续；无需重新描述相同要求。';
 }
 if(androidRepair&&!inputPlanFailure){
  const headline=preview?.available?(preview.changedSinceInput?'已更新运行截图；本次要求仍待最终核验。':preview.capturedThisInput?'已取得本轮运行截图，与此前预览一致；本次要求仍待最终核验。':'本轮未产生新的运行效果；可查看已有版本，任务尚未完成。'):run.delivery.hasNewDeliverable?'已有阶段文件可查看；当前效果尚未完成核验。':'本轮未产生新的可用版本；已有文件已保留，任务尚未完成。';
  lines.unshift(headline,run.delivery.stopReason,run.delivery.nextAction,'');
 }
 run.delivery.summary=lines.join('\n');
 await workspace.event('result_settled',{code:error.code||'RECOVERY_EXHAUSTED',availableArtifacts:found.files.map(f=>f.path),unverified:found.pending.map(c=>c.id),coverage:run.delivery.coverage});
 return {content:lines.join('\n')};
}
module.exports={internal,unknown,begin,context,inventory,settle};

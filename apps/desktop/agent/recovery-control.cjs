// One arbiter selects the response to recovery facts. Detectors retain their
// existing receipts; none of them may independently renew another budget.
const exitPolicy=require('./exit-policy.cjs');
const limits={remainingIdleDecisions:12,inputAdoptionDecisions:12,restorationVerificationDecisions:12};
const inputContractRepairId='input-plan-delta-v1';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function unknown(run){return require('./action-journal.cjs').unknown(run);}
function repairState(run,seed){
 require('./recovery-state.cjs').bind(run);
 const previous=run.repairValue,executionId=run.executionId??null;
 let execution=previous?.executionId;
 if(!execution&&typeof previous?.scope==='string')try{execution=JSON.parse(previous.scope)?.[0];}catch{}
 if(previous&&execution===executionId){previous.executionId=executionId;previous.scope=JSON.stringify([executionId]);return previous;}
 return run.repairValue={scope:JSON.stringify([executionId]),executionId,...seed};
}
function advanceRemaining(run){
 require('./recovery-state.cjs').bind(run);
 const state=run.resultRecovery;if(state?.stage!=='remaining')return;
 state.turns=(state.turns||0)+1;state.idleTurns=(state.idleTurns||0)+1;
}
function verification(run){const state=require('./recovery-state.cjs').bind(run),window=state.verification;return window&&run.candidateRecovery?.requiresReverification&&window.transactionId===run.candidateRecovery.transactionId&&window.executionId===run.executionId?window:undefined;}
function grantRestoration(run,receipt){
 const state=require('./recovery-state.cjs').bind(run);
 if(!['committed','rolled_back'].includes(receipt?.status)||!receipt.actualChanges?.length||run.candidateRecovery?.transactionId!==receipt.transactionId||!run.candidateRecovery?.requiresReverification||(state.verificationGrants||[]).includes(receipt.transactionId))return false;
 state.verificationGrants=[...(state.verificationGrants||[]),receipt.transactionId].slice(-32);state.verification={transactionId:receipt.transactionId,executionId:run.executionId,decisionsUsed:0,maxDecisions:limits.restorationVerificationDecisions,at:new Date().toISOString()};return true;
}
function inputContractRepair(run){
 const repair=run.executionRecovery?.inputContractRepair;
 return repair&&repair.repairId===inputContractRepairId&&repair.executionId===run.executionId&&repair.inputId===run.inputKey?repair:undefined;
}
function grantInputContractRepair(run,{requestOrigin,continuationReason,priorRuntime,evidence}={}){
 if(requestOrigin!=='user'||continuationReason!=='user'||priorRuntime?.appVersion!=='0.1.93'||run.inFlight||unknown(run))return false;
 const pending=run.pendingTaskChange;
 if(!pending||pending.executionId!==run.executionId||pending.inputId!==run.inputKey||(pending.adoptionDecisions||0)<limits.inputAdoptionDecisions)return false;
 const state=require('./recovery-state.cjs').bind(run);
 // A changed continue-message ID or process restart is not another migration.
 if((state.inputContractRepairGrants||[]).some(g=>g.executionId===run.executionId&&g.repairId===inputContractRepairId))return false;
 const event=evidence?.event,observation=evidence?.observation,message=event?.detail?.message;
 const match=typeof message==='string'&&/^已有质量契约不可在执行中改变，尤其不能事后增加容差：([a-zA-Z0-9_-]{1,40})$/.exec(message);
 if(!match||!uuid(event?.id)||event.type!=='tool_error'||event.detail.action!=='plan'||!uuid(observation?.id)||observation.executionId!==run.executionId||observation.action?.action!=='plan'||observation.response?.error!==message)return false;
 if(!(run.observationIndex||[]).some(o=>o.id===observation.id&&o.action==='plan'&&o.error===message))return false;
 const prior=require('./requirements.cjs').current(run).find(r=>r.id===match[1]),proposed=observation.action.requirements?.find(r=>r.id===match[1]),q=proposed?.quality;
 const baseline=prior?.quality||{level:'must',origin:'user'};
 const boundary=({level,origin,polishOf,tolerance})=>({level,origin,polishOf,tolerance});
 if(!prior||!q||Object.keys(q).some(k=>!['level','origin','polishOf','tolerance','sourceQuote'].includes(k))||q.level!=='must'||q.origin!=='user'||!require('./evidence-binding.cjs').equal(boundary(q),boundary(baseline))||q.sourceQuote===baseline.sourceQuote||typeof q.sourceQuote!=='string'||!q.sourceQuote.trim()||q.sourceQuote.length>800)return false;
 const inputs=run.inputCoverage?.entries||[];
 if(!inputs.some(i=>i.status==='received'&&String(i.text||'').includes(q.sourceQuote))||!observation.action.inputUse?.some(i=>i.inputId===pending.inputId&&i.disposition==='requirements'))return false;
 try{require('./quality-contract.cjs').prepare(run,proposed,prior,require('./requirements.cjs').current(run));}catch{return false;}
 const key=JSON.stringify([run.executionId,pending.inputId,inputContractRepairId]);
 const repair={key,repairId:inputContractRepairId,executionId:run.executionId,inputId:pending.inputId,status:'active',decisionsUsed:0,maxDecisions:3,originalAdoptionDecisions:pending.adoptionDecisions,evidence:{eventId:event.id,observationId:observation.id,requirementId:prior.id},sourceRuntime:priorRuntime.appVersion,at:new Date().toISOString()};
 state.inputContractRepair=repair;state.inputContractRepairGrants=[...(state.inputContractRepairGrants||[]),{key,repairId:repair.repairId,executionId:repair.executionId,inputId:repair.inputId,at:repair.at}].slice(-16);
 return structuredClone(repair);
}
function advance(run,{pendingInput=false}={}){
 const window=verification(run);if(window)window.decisionsUsed++;
 if(pendingInput&&run.pendingTaskChange){
  const repair=inputContractRepair(run);
  if(repair){
   if(repair.status!=='active'||repair.decisionsUsed>=repair.maxDecisions)return;
   repair.decisionsUsed++;
   // The last seat is persisted as consumed before its model decision. Only
   // this returned in-memory permit can authorize it; restart cannot reuse it.
   if(repair.decisionsUsed===repair.maxDecisions)repair.status='exhausted';
   return {key:repair.key,ordinal:repair.decisionsUsed};
  }
  run.pendingTaskChange.adoptionDecisions=(run.pendingTaskChange.adoptionDecisions||0)+1;
 }
 else advanceRemaining(run);
}
function adopt(run,receipt){
 if(!receipt||!run.taskChangeAdoptions?.includes(receipt)||receipt.recoveryWindowApplied||receipt.executionId!==run.executionId||receipt.inputId!==run.inputKey)return false;
 receipt.recoveryWindowApplied=true;
 const contractRepair=inputContractRepair(run);if(contractRepair){contractRepair.status='adopted';contractRepair.closedAt=new Date().toISOString();}
 if(!receipt.opensRepairWindow)return false;
 const state=require('./recovery-state.cjs').bind(run);if(state.verification){state.verificationHistory=[...(state.verificationHistory||[]),{...state.verification,closedByInputId:receipt.inputId}].slice(-8);delete state.verification;}
 require('./recovery-state.cjs').clear(run,'repairValue','resultRecovery');return true;
}
function progress(run,{fresh=false,readOnly=false}={}){
 if(fresh&&!readOnly&&run.resultRecovery?.stage==='remaining')run.resultRecovery.idleTurns=0;
}
function beforeDecision(run,{repair,signal,pendingInput=false,inputContractPermit}={}){
 if(signal?.aborted)return {action:'cancel',reason:'user_cancelled'};
 if(unknown(run))return {action:'reconcile',reason:'unknown_result'};
 // Adoption consumes the normal decision/time limits. Old work may not settle
 // a new request before it has had an opportunity to be understood.
 if(pendingInput){
  const contractRepair=inputContractRepair(run);
  if(contractRepair){
   const permitted=inputContractPermit?.key===contractRepair.key&&inputContractPermit?.ordinal===contractRepair.decisionsUsed&&inputContractPermit.ordinal>0&&inputContractPermit.ordinal<=contractRepair.maxDecisions;
   if(contractRepair.status==='active'&&contractRepair.decisionsUsed<contractRepair.maxDecisions||contractRepair.status==='exhausted'&&permitted)return {action:'adopt_input',reason:'input_contract_repair',repairId:contractRepair.repairId};
   return {action:'settle',code:'INPUT_CONTRACT_REPAIR_EXHAUSTED',reason:'input_contract_repair_exhausted',message:'本次输入的内部计划契约纠正仍未成功，有限修复机会已用完；没有按新要求修改成果。原任务、输入、证据和失败记录保留，普通继续不会重复发起同一无效修复。'};
  }
  if((run.pendingTaskChange?.adoptionDecisions||0)>limits.inputAdoptionDecisions)return {action:'settle',code:'INPUT_ADOPTION_EXHAUSTED',reason:'input_adoption_exhausted',message:'本次补充内容已保存，但在有限处理窗口内仍未纳入有效计划，尚不能认定已按新要求修改成果；原任务、预算与附件均保留。'};
  return {action:'adopt_input',reason:'current_input_not_adopted'};
 }
 const window=verification(run);if(window){if(window.decisionsUsed<=window.maxDecisions)return {action:'verify_restoration',reason:'transaction_reverification',transactionId:window.transactionId};return {action:'settle',code:'CANDIDATE_REVERIFICATION_EXHAUSTED',reason:'restoration_verification_exhausted',message:'保留版本已恢复，但有限的当前版本复验仍未完成；已保存成果与具体未验项，不沿用历史通过。'};}
 if(run.resultRecovery?.stage==='remaining'&&(run.resultRecovery.idleTurns||0)>run.resultRecovery.maxTurns)return {action:'settle',code:'AGENT_REPAIR_EXHAUSTED',reason:'remaining_work_exhausted',message:'本轮针对剩余工作的处理预算已结束。'};
 if(repair?.exhausted)return {action:'settle',code:'REPAIR_VALUE_EXHAUSTED',reason:'repair_value_exhausted',message:'当前修复在有限的决策与构建运行复验窗口内仍未形成新的有效核验结果，已停止该修复路径；文件修改不代表问题已解决。'};
 if(repair?.redirect)return {action:'refocus',reason:'repair_value_stagnant'};
 return {action:'continue',reason:'within_budget'};
}
function afterFailure(run,episode,{invalid=0,error,signal,canStartRemaining=false}={}){
 const classification=exitPolicy.classify(error||{},run,{signal});
 if(['cancelled','unknown_result','permission','service'].includes(classification))return {action:'external',reason:classification};
 if(classification==='component'&&canStartRemaining&&run.resultRecovery?.stage!=='remaining')return {action:'remaining',reason:'independent_work_available'};
 if(verification(run)&&verification(run).decisionsUsed<=verification(run).maxDecisions)return {action:'continue',reason:'transaction_reverification'};
 if(run.unresolvedFailureStreak>=12)return {action:'exhausted',reason:'failure_streak_exhausted'};
 const credits=2+(episode.resumeCredits||0);
 if(episode.failures<3){
  if(invalid>=3&&episode.recoveries<2)return {action:'recover',reason:'multiple_invalid_attempts',recoveries:episode.recoveries+1};
  return {action:'continue',reason:'episode_within_budget'};
 }
 return episode.recoveries<credits?{action:'recover',reason:'episode_recovery',recoveries:episode.recoveries+1}:{action:'exhausted',reason:'episode_exhausted'};
}
function loopDecision(episode){return episode.attempt>=5+(episode.resumeCredits||0)?'exhausted':'continue';}
function segmentDecision(result,{segmentsRemaining=true,timeRemaining=true}={}){
 if(result?.clarification||['waiting_user','waiting_permission'].includes(result?.agentRun?.status))return 'human_required';
 if(result?.agentRun?.recoverySummary?.unknown>0||result?.agentRun?.taskContinuation?.retained?.unknownActions>0)return 'unknown_result';
 if(result?.agentRun?.status==='completed')return 'completed';
 if(result?.continuation?.safe!==true||result.agentRun?.mode!=='task'||result.agentRun?.status!=='paused'){const reason=result?.agentRun?.segmentState?.stopReason;if(reason==='total_budget')return !segmentsRemaining?'segment_count_limit':!timeRemaining?'total_time_limit':'total_budget';return reason||'not_continuable';}
 if(!segmentsRemaining)return 'segment_count_limit';if(!timeRemaining)return 'total_time_limit';
 if(result.continuation.progress!==undefined&&(!Number.isFinite(result.continuation.progress)||result.continuation.progress<=0))return 'no_verified_progress';
 return 'continue';
}
module.exports={verification,grantRestoration,inputContractRepair,grantInputContractRepair,inputContractRepairId,limits,unknown,repairState,advanceRemaining,advance,adopt,progress,beforeDecision,afterFailure,loopDecision,segmentDecision};

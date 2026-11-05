// A request/worker may stop to protect the budget. The user's task remains open,
// with its requirements, files, receipts and concrete next condition intact.
function deferred(error){return error?.requestAttempted===false||error?.code==='MODEL_HTTP_TRANSIENT'&&String(error.message||'').includes('此模型在本次执行中已不可用；自动备用切换已用尽');}
function update(run){
 if(run.delivery?.status==='settled'&&run.currentOutcome==='settled')return run.taskContinuation;
 if(run.status==='completed'&&run.taskContinuation){run.taskContinuation={...run.taskContinuation,state:'completed',taskOpen:false};return run.taskContinuation;}
 if(!['blocked','failed','waiting_permission'].includes(run.status))return;
 const raw=require('../network-recovery.cjs').blocker(run),networkErrors=require('../network-error.cjs');
 const networkCause=!raw.code||['EXECUTION_DIAGNOSIS_REQUIRED','MODEL_NETWORK'].includes(raw.code)||networkErrors.findNetworkCode({code:raw.code})===raw.code;
 const blocker=networkCause?networkErrors.networkError(raw):raw,code=String(blocker.code||'').slice(0,100);
 const unknown=(run.actionJournal||[]).filter(e=>e.status==='unknown');
 const internal=require('./result-settlement.cjs').internal({code});
 const locallyDeferred=deferred(blocker);
 const service=!internal&&/^MODEL_/.test(code),permission=run.status==='waiting_permission';
 const state=unknown.length?'waiting_result_check':permission?'waiting_permission':internal||locallyDeferred?'waiting_retry':service?'waiting_service':'waiting_diagnosis';
 const network=require('../network-recovery.cjs').networkRecovery({...run,taskContinuation:{...run.taskContinuation,taskOpen:true,state}});
 const serviceQuestion=network?.question||{authentication:'模型服务授权被拒绝。请在模型设置中恢复该服务的有效授权，再在本任务回复“授权已恢复”。',quota:'模型服务报告用量不足。请恢复该服务的可用额度，再在本任务回复“额度已恢复”。',configuration:'模型服务拒绝当前配置。请检查所选模型ID及接口设置，修正后在本任务说明变化。'}[blocker.providerCategory]||'模型服务当前未提供有效响应。请检查该服务的连接、授权及用量，恢复后在本任务回复“服务已恢复”；原要求、文件和证据已保留。';
 const terminalServiceFailure=run.autonomousTasks&&service&&!unknown.length&&!permission&&!['authentication','quota','configuration'].includes(blocker.providerCategory);
 const question=locallyDeferred&&!unknown.length&&!permission?'本轮未发起新的模型请求：此前失败触发了有限恢复保护。原任务和证据已保留，可稍后重试当前步骤；这不代表服务当前故障，也不要求重新配置授权或用量。':unknown.length?'Ailo 尚未确认上次操作的实际结果，需要先完成结果核查。':permission?'请处理当前明确列出的授权请求；无需新建任务，授权后从原任务继续。':service?serviceQuestion:internal?'执行方式未能恢复，可直接点击继续原任务，系统将沿已有成果重新处理。':'当前方法未解决缺口。请补充与下述缺口直接相关的信息或诊断结果；后续沿原任务继续，不会把未完成标为成功。';
 const prior=run.taskContinuation,key=JSON.stringify([state,code,blocker.message,run.events?.at(-1)?.id,run.revision]);
 if(prior?.key===key&&prior.question===question)return prior;
 const criteria=require('./acceptance.cjs').criteria(run);
 run.taskContinuation={version:1,state,taskOpen:true,key,at:new Date().toISOString(),code,question,...(blocker.networkCode?{networkCode:blocker.networkCode}:{}),
  gap:String(blocker.message||run.executionState?.gaps?.[0]||run.events?.at(-1)?.detail?.message||run.events?.at(-1)?.detail?.text||'原任务尚未满足验收，需进一步诊断。').slice(0,1200),
  retained:{requirements:criteria.length,pendingIds:criteria.filter(c=>c.check?.status!=='passed'||Array.isArray(run.freshAcceptanceIds)&&!run.freshAcceptanceIds.includes(c.id)).map(c=>c.id),steps:run.steps?.length||0,artifacts:(run.artifacts||[]).map(({path,label})=>({path,label})).slice(0,24),unknownActions:unknown.length,revision:run.revision},
  policy:'preserve_task_and_evidence_no_unknown_replay_no_budget_reset_no_false_completion'};
 if(terminalServiceFailure){run.status='failed';run.taskContinuation.state='failed';run.taskContinuation.taskOpen=false;run.taskContinuation.question='';}
 const repaired=require('../legacy-protocol-recovery.cjs').legacyFeishuRecovery(run);
 if(repaired){run.taskContinuation.state='waiting_retry';run.taskContinuation.question=repaired.question;}
 return run.taskContinuation;
}
function message(run){const pending=require('../task-outcome.cjs').pendingOutcomeMessage(run);if(pending)return pending;if(run.delivery?.status==='settled')return run.delivery.summary||'本轮尝试已结束，原要求及已有成果已保留。';const c=update(run);if(c?.state==='failed')return '模型服务在自动恢复后仍未返回可用结果，本次执行失败。\n原任务、已有结果与执行记录已保留。';return c?`任务保留，等待处理后继续。${c.question}\n当前缺口：${c.gap}\n已保留${c.retained.requirements}项原要求、${c.retained.steps}项步骤和${c.retained.artifacts.length}项已登记成果；尚未完成。`:'任务尚未完成，原状态与文件已保留。';}
function canResume(run,task){
 const latest=task.messages?.findLast(m=>m.role==='user');
 // Preserve the single-use legacy migration contract; an empty repeated form
 // cannot renew its already-consumed compatibility repair.
 if(run.delivery?.status==='settled'&&run.delivery.reasonCode==='AGENT_PROTOCOL'&&run.runtimeRepairs?.includes('feishu-request-contract-v1')&&!latest?.materials?.length&&/^(?:继续|重试|继续任务|继续原任务。已处理的条件或补充信息：)[。\s]*$/.test(String(latest?.content||'')))return false;
 if(!run.taskContinuation?.taskOpen||!['blocked','failed','waiting_permission'].includes(run.status))return true;
 // The entry gate must observe a just-reconciled local write. Its original
 // expected hash was checked before this decision; no tool is replayed.
 if(run.taskContinuation.state==='waiting_result_check'&&!require('./result-settlement.cjs').unknown(run)){
  const receipt=run.events?.at(-1),entry=run.actionJournal?.find(e=>e.id===receipt?.detail?.actionId);
  if(receipt?.type==='action_recovered'&&entry?.action==='write_file'&&entry.status==='succeeded'&&entry.recovered&&entry.expectedHash&&entry.path===receipt.detail.path&&latest?.id&&latest.id!==run.inputKey)return true;
 }
 if(deferred(require('../network-recovery.cjs').blocker(run))&&!require('./result-settlement.cjs').unknown(run))return latest?.id!==run.inputKey;
 if(require('./result-settlement.cjs').internal({code:run.taskContinuation.code})&&!require('./result-settlement.cjs').unknown(run))return task.messages?.findLast(m=>m.role==='user')?.id!==run.inputKey;
 if(require('../scheduled-message.cjs').reminderResume(task,run))return true;
 if(require('../network-recovery.cjs').networkRecovery(run)||require('../legacy-protocol-recovery.cjs').legacyFeishuRecovery(run))return true;
 const input=task.messages?.findLast(m=>m.role==='user');
 if(input?.materials?.length)return true;
 if(input?.id&&input.id===run.inputKey)return false;
 const text=String(input?.content||'').trim().replace(/[\s。！!？?，,；;：:]/g,'');
 return !['继续','重试','再试一次','继续任务','继续执行','继续验收','继续原任务','继续原任务已处理的条件或补充信息','请从已保存的任务状态继续先检查已有成果不重复执行已完成步骤'].includes(text);
}
module.exports={update,message,canResume};

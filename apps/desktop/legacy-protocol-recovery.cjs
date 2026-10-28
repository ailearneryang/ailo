// One user-triggered retry for a known, locally rejected pre-fix Feishu request.
// This never retries a remote write and never grants a general blind retry.
const repairId='feishu-request-contract-v1';
function legacyFeishuRecovery(run){
 if(!run?.taskContinuation?.taskOpen||!['blocked','failed'].includes(run.status)||(run.runtimeRepairs||[]).includes(repairId))return;
 if(run.inFlight||run.taskContinuation.state==='waiting_result_check'||run.taskContinuation.retained?.unknownActions>0||(run.actionJournal||[]).some(e=>['unknown','running','pending'].includes(e.status)))return;
 const blocker=run.waitingError||run.executionState?.blocker||{code:run.taskContinuation.code,message:run.taskContinuation.gap};
 if(blocker.code&&!['AGENT_REPAIR_EXHAUSTED','EXECUTION_DIAGNOSIS_REQUIRED'].includes(blocker.code))return;
 if(!/^(?:同一问题的有限恢复仍未成功，已保留任务状态：[ ]*)?飞书操作无效[。]?$/.test(String(blocker.message||'')))return;
 return {id:repairId,question:'已修复旧版飞书工具参数协议。可点击“继续任务”，沿原要求和已有结果进行一次有限续跑，无需补充业务信息。'};
}
module.exports={legacyFeishuRecovery};

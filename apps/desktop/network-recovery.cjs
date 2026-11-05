// Shared by the saved-task gate and UI. This permits a user-triggered, bounded
// model request retry; it never starts work in the background or replays tools.
const {findNetworkCode,userRetryNetworkCode}=require('./network-error.cjs');
function blocker(run){
 const saved=run?.taskContinuation;
 return run?.waitingError||run?.executionState?.blocker||{code:saved?.code,networkCode:saved?.networkCode,message:saved?.gap};
}
function networkRecovery(run){
 if(!run?.taskContinuation?.taskOpen||!['blocked','failed'].includes(run.status)||run.taskContinuation.state==='waiting_result_check'||run.taskContinuation.retained?.unknownActions>0||(run.actionJournal||[]).some(e=>e.status==='unknown'))return;
 const error=blocker(run),code=findNetworkCode(error);
 if(error.code&&error.code!=='MODEL_NETWORK'&&error.code!=='EXECUTION_DIAGNOSIS_REQUIRED'&&error.code!==code)return;
 if(!userRetryNetworkCode(code)&&!(error.code==='MODEL_NETWORK'&&!code))return;
 return {networkCode:code||'MODEL_NETWORK',question:code==='ERR_NETWORK_IO_SUSPENDED'?'网络I/O被暂停。设备唤醒且网络恢复后，点击“重试当前步骤”；已有要求、文件和证据会沿用。':'上次请求出现网络连接错误，该记录不代表当前仍断网。可直接点击“重试当前步骤”发起一次有界尝试，无需回复固定口令；已有要求、文件和证据会沿用。'};
}
module.exports={blocker,networkRecovery};

// Shared by the saved-task gate and UI. This permits a user-triggered, bounded
// model request retry; it never starts work in the background or replays tools.
const {findNetworkCode,transientNetworkCode}=require('./network-error.cjs');
function blocker(run){
 const saved=run?.taskContinuation;
 return run?.waitingError||run?.executionState?.blocker||{code:saved?.code,networkCode:saved?.networkCode,message:saved?.gap};
}
function networkRecovery(run){
 if(!run?.taskContinuation?.taskOpen||!['blocked','failed'].includes(run.status)||run.taskContinuation.state==='waiting_result_check'||run.taskContinuation.retained?.unknownActions>0||(run.actionJournal||[]).some(e=>e.status==='unknown'))return;
 const error=blocker(run),code=findNetworkCode(error);
 if(error.code&&error.code!=='MODEL_NETWORK'&&error.code!=='EXECUTION_DIAGNOSIS_REQUIRED'&&error.code!==code)return;
 if(!transientNetworkCode(code))return;
 return {networkCode:code,question:code==='ERR_NETWORK_IO_SUSPENDED'?'网络I/O被暂停。设备唤醒且网络恢复后，点击“重试当前步骤”；已有要求、文件和证据会沿用。':'网络请求暂时中断。网络恢复后，点击“重试当前步骤”；本次重试有次数上限，已有要求、文件和证据会沿用。'};
}
module.exports={blocker,networkRecovery};

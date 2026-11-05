// Orchestration is separate from the transaction: files and proof become stale
// before a restore, then a small nonrenewable window can obtain new proof.
const versions=require('./candidate-recovery.cjs');
const evidence=require('./evidence.cjs');
const recovery=require('./recovery-control.cjs');
async function hashes(workspace,paths){const result={};for(const p of paths)try{result[p]=await evidence.hashFile(await require('./workspace.cjs').resolveFile(workspace.files,p));}catch(error){if(error.code!=='ENOENT')throw error;}return result;}
async function restore(workspace,{resume=false,signal}={}){
 const run=workspace.run;
 if(signal?.aborted||require('./request-scope.cjs').pending(run)||require('./result-settlement.cjs').unknown(run))return {status:'declined',code:'CANDIDATE_UNSAFE_BOUNDARY'};
 const pending=await versions.pending(workspace);let prepared=pending[0];
 if(!prepared){if(resume)return {status:'none'};prepared=await versions.prepare(workspace,{signal});}
 if(!['prepared','committing','needs_recovery'].includes(prepared.status))return prepared;
 const before=await hashes(workspace,prepared.changedPaths),invalidate=receipt=>require('./evidence-invalidation.cjs').invalidate(workspace,receipt.changedPaths,receipt);
 let receipt;
 if(prepared.status==='prepared')receipt=await versions.commit(workspace,{transactionId:prepared.transactionId,signal,beforeWrite:invalidate});
 else {await invalidate(prepared);receipt=await versions.recover(workspace,{transactionId:prepared.transactionId});}
 const after=await hashes(workspace,prepared.changedPaths),actualChanges=prepared.changedPaths.filter(p=>before[p]!==after[p]).map(path=>({path,before:before[path],after:after[path]}));
 if(actualChanges.length){
  run.revision=(run.revision||0)+1;run.fileReadMemory=(run.fileReadMemory||[]).filter(c=>!actualChanges.some(f=>f.path===c.path));run.sourceFragments=(run.sourceFragments||[]).filter(c=>!actualChanges.some(f=>f.path===c.path));
  const step=run.steps?.find(s=>s.status!=='done')||run.steps?.at(-1);if(step){step.status='running';step.detail='已恢复保留版本，须重新登记受影响成果并验证当前文件；历史通过不代表本轮通过。';}
 }
 if(run.candidateRecovery?.transactionId===receipt.transactionId)run.candidateRecovery.lastReceipt={...receipt,actualChanges,revisionAfter:run.revision};
 const granted=recovery.grantRestoration(run,{...receipt,actualChanges});
 await workspace.event('candidate_restore',{...receipt,actualChanges,revision:run.revision,verificationWindowGranted:granted,message:actualChanges.length?'已恢复同要求下核验覆盖更好的版本，正在重新核验当前成果':'恢复事务已核对；没有新的文件改善，不增加进展或重置原预算'});
 await workspace.save();return {...receipt,actualChanges,verificationWindowGranted:granted};
}
function context(run){const marker=run.candidateRecovery;if(!marker?.requiresReverification)return;return {transactionId:marker.transactionId,changedPaths:marker.changedPaths,pendingRequirementIds:marker.pendingRequirementIds||marker.affectedRequirementIds,window:recovery.verification(run),instruction:'恢复文件不是完成。重新登记变化成果，对受影响要求取得新的实际观察/构建/运行或当前文件检查，然后verify。旧事件不可重新提交为新证据；保持原任务、失败计数与未知副作用保护。'};}
module.exports={restore,context,hashes};

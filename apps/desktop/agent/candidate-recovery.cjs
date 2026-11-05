// Restore only task-owned bytes after a verified regression. A restoration is
// an audited source change, never acceptance, progress credit or tool replay.
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const candidate = require('./candidate-versions.cjs');
const proof = require('./evidence.cjs');
const {resolveFile, normalizeProjectPath} = require('./workspace.cjs');
const limits = {bytes:256*1024*1024, files:128, transactions:4, records:32, manifestBytes:1024*1024, attemptsPerScope:1};
const ids = /^[a-f0-9-]{36}$/;
const queues = new Map();
function failure(code,message){return Object.assign(Error(message),{code});}
function declined(code,message,extra={}){return {status:'declined',code,message,...extra};}
function boundary(run){
 if(require('./result-settlement.cjs').unknown(run)||run.inFlight)throw failure('CANDIDATE_UNKNOWN_EFFECT','存在结果未知或仍在执行的操作，不能自动覆盖文件');
 if(require('./material-input.cjs').pending(run)||run.inputTurn?.requiresPlan&&run.acceptanceInputKey!==run.inputKey)throw failure('CANDIDATE_INPUT_PENDING','最新要求或附件尚未采纳，不能恢复旧版');
}
// A partial order deliberately leaves competing improvements incomparable.
// Counts, model confidence and subjective quality scores never choose a winner.
function dominates(better,current){
 if(better.scopeHash!==current.scopeHash||better.materialHash!==current.materialHash)return false;
 const currentMust=current.passedIds.filter(id=>!(current.optionalIds||[]).includes(id)),betterMust=better.passedIds.filter(id=>!(better.optionalIds||[]).includes(id));
 if(!currentMust.every(id=>betterMust.includes(id))||!current.resolvedIds.every(id=>better.resolvedIds.includes(id)))return false;
 if((better.blockingProblemIds||[]).some(id=>!(current.blockingProblemIds||[]).includes(id)))return false;
 if(betterMust.length>currentMust.length||better.resolvedIds.length>current.resolvedIds.length)return true;
 return current.passedIds.every(id=>better.passedIds.includes(id))&&(better.passedIds.length>current.passedIds.length||(better.blockingProblemIds||[]).length<(current.blockingProblemIds||[]).length);
}
async function root(workspace,{create=false}={}){
 if(!workspace.run?.taskId||typeof workspace.project!=='string')throw failure('CANDIDATE_RECOVERY_OWNER','缺少候选恢复所属任务');
 const base=path.join(workspace.project,'candidate-recovery',proof.hash(workspace.run.taskId).slice(0,24));
 let current=workspace.project;
 for(const name of ['',...path.relative(workspace.project,base).split(path.sep)]){
  if(name)current=path.join(current,name);
  if(create&&name)try{await fs.mkdir(current,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await fs.lstat(current);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw failure('CANDIDATE_RECOVERY_UNSAFE','候选恢复目录不安全');
 }
 return base;
}
async function writeJson(file,value){
 const text=JSON.stringify(value);if(Buffer.byteLength(text)>limits.manifestBytes)throw failure('CANDIDATE_RECOVERY_LIMIT','恢复事务记录超出上限');
 const temp=file+'.'+randomUUID()+'.tmp';
 try{await fs.writeFile(temp,text,{flag:'wx',mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
}
async function readJson(file){
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>limits.manifestBytes)throw failure('CANDIDATE_RECOVERY_CORRUPT','恢复事务记录无效');
 return JSON.parse(await fs.readFile(file,'utf8'));
}
async function fileState(workspace,relative){
 const tree=await fs.lstat(workspace.files);if(!tree.isDirectory()||tree.isSymbolicLink())throw failure('CANDIDATE_RECOVERY_UNSAFE','项目文件根目录不安全');
 const file=await resolveFile(workspace.files,relative),stat=await fs.lstat(file);
 if(!stat.isFile()||stat.nlink!==1||stat.size>candidate.limits.artifactBytes)throw failure('CANDIDATE_RECOVERY_UNSAFE','恢复目标不是安全的普通文件：'+relative);
 return {file,sha256:await proof.hashFile(file),size:stat.size,mode:stat.mode&0o777};
}
async function records(workspace){
 const items=await require('./result-sources.cjs').records(workspace,new Set(['write_file','edit_file','edit_spreadsheet','run_command','build_android']));
 return items.filter(r=>!r.executionId||r.executionId===workspace.run.executionId).sort((a,b)=>String(a.at||'').localeCompare(String(b.at||'')));
}
function ownerReceipt(all,file,manifest,currentHash){
 let latest;
 for(const r of all){
  const result=r.response?.result;
  // A completed command may fail its check after editing a file. Its exact
  // before/after inventory still proves ownership; timeout/unknown results do
  // not. Recovery restores bytes, and never treats that failed check as a pass.
  if(!result||r.response?.error||result.notExecuted||result.reused||result.timedOut||result.changed===false)continue;
  // Older event windows are never guessed to belong to this repair attempt.
  const revision=r.action?.revision??result.revision;
  if(!r.at||r.at<manifest.at||Number.isFinite(revision)&&revision<=manifest.revision||!Number.isFinite(revision)&&!r.executionId)continue;
  const action=r.action?.action;
  if(['write_file','edit_file','edit_spreadsheet'].includes(action)&&result.path===file&&result.sha256)latest={id:r.response?.eventId||r.id,sha256:result.sha256};
  if(['run_command','build_android'].includes(action)){
   const change=(result.fileChanges||[]).find(c=>c.path===file&&c.after);
   if(change)latest={id:r.response?.eventId||r.id,sha256:change.after};
   // A build artifact is produced by this task's exact build receipt, not an
   // artifact registration or an observation of a user's pre-existing file.
   const built=(result.buildArtifacts||[]).find(c=>c.path===file&&c.sha256);
   if(built)latest={id:r.response?.eventId||r.id,sha256:built.sha256};
  }
 }
 return latest?.sha256===currentHash?latest:undefined;
}
async function compatible(workspace,manifest){
 boundary(workspace.run);
 const current=await candidate.coverage(workspace);
 if(manifest.executionId!==workspace.run.executionId||manifest.scopeHash!==current.scopeHash||manifest.materialHash!==current.materialHash)throw failure('CANDIDATE_SCOPE_CHANGED','候选的任务、要求或采用材料版本与当前不一致');
 return current;
}
async function selectDelivery(workspace,{candidateId,signal}={}){
 try{
  boundary(workspace.run);signal?.throwIfAborted();
  const current=await candidate.coverage(workspace),entries=await candidate.inventory(workspace),choices=[];
  for(const entry of entries){
   signal?.throwIfAborted();if(candidateId&&entry.id!==candidateId)continue;
   const {manifest}=await candidate.load(workspace,{candidateId:entry.id});
   if(manifest.executionId!==workspace.run.executionId||!manifest.resourceCoverage?.complete||!manifest.files.some(f=>f.artifact)||!dominates(manifest,current))continue;
   choices.push(manifest);
  }
  // If two improvements trade off, selecting either would silently sacrifice
  // validated work. Preserve both and report the conflict instead.
  let best=choices[0];for(const next of choices.slice(1)){if(dominates(next,best))best=next;else if(!dominates(best,next))return declined('CANDIDATE_INCOMPARABLE','保留版本各有已验证改进，不能自动牺牲其中一项');}
  if(!best)return declined('CANDIDATE_NO_NET_GAIN','没有同要求、同材料且严格保留当前有效通过项的更优候选');
  return {status:'selected',candidateId:best.id,at:best.at,scopeHash:best.scopeHash,materialHash:best.materialHash,artifacts:best.files.filter(f=>f.artifact).map(({path,label,sha256,size})=>({path,label,sha256,size})),passedIdsAtSnapshot:best.passedIds,resolvedIdsAtSnapshot:best.resolvedIds,missingIds:current.mustIds.filter(id=>!best.passedIds.includes(id)),optionalUnverifiedIds:current.optionalIds.filter(id=>!best.passedIds.includes(id)),optionalRegressions:current.optionalIds.filter(id=>current.passedIds.includes(id)&&!best.passedIds.includes(id)),blockingProblemIds:best.blockingProblemIds||[],historical:true,canComplete:false,requiresReverification:true,reason:'strict_validated_dominance',message:'已选用保留的较好成果；其核验属于历史版本，恢复后必须要求须按当前文件重新核验，未实现要求与可选未验项仍保留。'};
 }catch(error){signal?.throwIfAborted();if(error.code==='ERR_ASSERTION')throw error;return declined(error.code||'CANDIDATE_SELECTION_UNAVAILABLE',error.message);}
}
async function transaction(workspace,transactionId){
 if(!ids.test(transactionId||''))throw failure('CANDIDATE_RECOVERY_REFERENCE','恢复事务ID无效');
 const base=await root(workspace),directory=await resolveFile(base,transactionId),stat=await fs.lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw failure('CANDIDATE_RECOVERY_UNSAFE','恢复事务目录不安全');
 const record=await readJson(await resolveFile(base,transactionId+'/transaction.json'));
 if(record.version!==1||record.id!==transactionId||record.taskId!==workspace.run.taskId||record.projectId!==workspace.run.projectId||!Array.isArray(record.files)||record.files.length>limits.files||record.files.some(f=>normalizeProjectPath(f.path)!==f.path||!/^[a-f0-9]{64}$/.test(f.before)||!/^[a-f0-9]{64}$/.test(f.after)))throw failure('CANDIDATE_RECOVERY_OWNER','恢复事务不属于当前任务或格式无效');
 return {record,directory,base};
}
function receipt(record){return {status:record.status,transactionId:record.id,candidateId:record.candidateId,scopeHash:record.scopeHash,at:record.updatedAt,changedPaths:record.files.filter(f=>f.before!==f.after).map(f=>f.path),files:record.files.map(({path,before,after,receiptId})=>({path,before,after,receiptId})),requiresReverification:true,grantsAcceptance:false,reason:record.reason,error:record.error};}
async function persist(directory,record){record.updatedAt=new Date().toISOString();await writeJson(path.join(directory,'transaction.json'),record);}
async function markReverification(workspace,record){
 if(typeof workspace.save!=='function')throw failure('CANDIDATE_INVALIDATION_UNAVAILABLE','缺少任务状态持久化能力，不能先恢复文件再失效验收');
 const prior=workspace.run.candidateRecovery,previous=prior?.transactionId===record.id?prior:undefined;
 workspace.run.candidateRecovery={...previous,version:1,transactionId:record.id,candidateId:record.candidateId,executionId:record.executionId,scopeHash:record.scopeHash,requiresReverification:true,changedPaths:[...new Set([...(previous?.requiresReverification?previous.changedPaths||[]:[]),...record.files.map(f=>f.path)])],files:receipt(record).files,requiredAfter:new Date().toISOString(),revisionBefore:workspace.run.revision};
 await workspace.save();
}
async function prepareNow(workspace,{candidateId,signal}={}){
 let temp;
 try{
  boundary(workspace.run);const selected=await selectDelivery(workspace,{candidateId,signal});if(selected.status!=='selected')return selected;
  const {manifest,root:filesRoot,manifestSha256}=await candidate.load(workspace,{candidateId:selected.candidateId});await compatible(workspace,manifest);
  const base=await root(workspace,{create:true});let retainedBytes=0,retainedTransactions=0,retainedRecords=0;
  for(const name of await fs.readdir(base)){
   // No workspace write can precede publishing transaction.json. An abandoned
   // preparation tree is therefore disposable, unlike a committed backup.
   if(/^\.[a-f0-9-]{36}\.tmp$/.test(name)){await fs.rm(path.join(base,name),{recursive:true,force:true});continue;}
   if(!ids.test(name))continue;const existing=await transaction(workspace,name);
   retainedRecords++;
   if(['prepared','committing','needs_recovery'].includes(existing.record.status))return declined('CANDIDATE_TRANSACTION_PENDING','已有恢复事务尚未结束，须先恢复该事务',{transactionId:name});
   if(existing.record.scopeHash===manifest.scopeHash)return declined('CANDIDATE_RECOVERY_ALREADY_ATTEMPTED','同一要求范围已自动恢复过一次，不能在版本之间反复回退');
   if(existing.record.status!=='finalized'){retainedBytes+=existing.record.bytes||0;retainedTransactions++;}
  }
  if(retainedTransactions>=limits.transactions||retainedRecords>=limits.records)return declined('CANDIDATE_RECOVERY_STORE_FULL','恢复备份或审计记录已达保留上限；不会自动删除尚未重新核验的备份');
  const all=await records(workspace),files=[];let bytes=0;
  for(const saved of manifest.files){
   signal?.throwIfAborted();
   if(saved.evidenceImage||saved.path.split('/').some(s=>s.startsWith('.')||s==='node_modules'))continue;
   const current=await fileState(workspace,saved.path);if(current.sha256===saved.sha256)continue;
   const owner=ownerReceipt(all,saved.path,manifest,current.sha256);
   if(!owner)throw failure('CANDIDATE_NOT_TASK_OWNED','文件变化缺少本任务快照后的精确写入回执，可能含用户修改，不能自动覆盖：'+saved.path);
   bytes+=current.size+saved.size;if(retainedBytes+bytes>limits.bytes||files.length>=limits.files)throw failure('CANDIDATE_RECOVERY_LIMIT','恢复备份与替换文件合计超过256MiB或128文件上限');
   files.push({path:saved.path,before:current.sha256,after:saved.sha256,beforeSize:current.size,afterSize:saved.size,mode:current.mode,receiptId:owner.id});
  }
  if(!files.length)return declined('CANDIDATE_NO_SOURCE_CHANGE','较好版本没有可安全恢复的源码或产物差异；历史证据不能直接重用',{selection:selected});
  const id=randomUUID();temp=path.join(base,'.'+id+'.tmp');await fs.mkdir(temp,{mode:0o700});
  const record={version:1,id,taskId:workspace.run.taskId,projectId:workspace.run.projectId,executionId:workspace.run.executionId,candidateId:manifest.id,candidateManifestSha256:manifestSha256,scopeHash:manifest.scopeHash,materialHash:manifest.materialHash,revision:workspace.run.revision,status:'prepared',createdAt:new Date().toISOString(),bytes,files,selection:selected};
  // Both directions are copied and verified before the first workspace write.
  // Commit therefore does not depend on candidate retention during a crash.
  for(const f of files){for(const side of ['before','after']){
   signal?.throwIfAborted();const from=side==='before'?(await fileState(workspace,f.path)).file:await resolveFile(filesRoot,f.path),to=path.join(temp,side,f.path);
   await fs.mkdir(path.dirname(to),{recursive:true,mode:0o700});await fs.copyFile(from,to,require('node:fs').constants.COPYFILE_EXCL);
   if(await proof.hashFile(to)!==f[side])throw failure('CANDIDATE_SOURCE_CHANGED','准备恢复时文件发生变化：'+f.path);await fs.chmod(to,0o400);
  }}
  await persist(temp,record);await fs.rename(temp,path.join(base,id));temp=undefined;
  return {...receipt(record),selection:selected,bytes};
 }catch(error){signal?.throwIfAborted();if(error.code==='ERR_ASSERTION')throw error;return declined(error.code||'CANDIDATE_RECOVERY_PREPARE_FAILED',error.message);}
 finally{if(temp)await fs.rm(temp,{recursive:true,force:true});}
}
async function replace(workspace,directory,item,side,expected){
 const saved=await resolveFile(directory,side+'/'+item.path),stat=await fs.lstat(saved);
 if(!stat.isFile()||stat.nlink!==1||stat.size!==item[side+'Size']||await proof.hashFile(saved)!==item[side])throw failure('CANDIDATE_RECOVERY_CORRUPT','恢复备份已变化：'+item.path);
 const target=await resolveFile(workspace.files,item.path),temp=target+'.ailo-recovery-'+randomUUID()+'.tmp';
 try{await fs.copyFile(saved,temp,require('node:fs').constants.COPYFILE_EXCL);await fs.chmod(temp,item.mode&0o777);if(await proof.hashFile(temp)!==item[side])throw failure('CANDIDATE_RECOVERY_CORRUPT','替换文件校验失败');if(expected&&(await fileState(workspace,item.path)).sha256!==expected)throw failure('CANDIDATE_SOURCE_CHANGED','原子替换前文件已变化，保留用户修改：'+item.path);await fs.rename(temp,target);}finally{await fs.rm(temp,{force:true});}
}
async function rollback(workspace,directory,record){
 const conflicts=[];
 for(const item of [...record.files].reverse()){
  const current=await fileState(workspace,item.path);
  if(current.sha256===item.before)continue;
  if(current.sha256!==item.after){conflicts.push(item.path);continue;}
  await replace(workspace,directory,item,'before',item.after);
 }
 record.status=conflicts.length?'needs_recovery':'rolled_back';record.conflicts=conflicts;await persist(directory,record);
 return {...receipt(record),conflicts};
}
async function commitNow(workspace,{transactionId,signal,beforeWrite}={}){
 const {record,directory}=await transaction(workspace,transactionId);
 if(record.status==='committed')return receipt(record);
 if(record.status!=='prepared')return declined('CANDIDATE_TRANSACTION_STATE','恢复事务不处于可提交状态，请先执行recover',{transactionId,transactionStatus:record.status});
 try{
  boundary(workspace.run);signal?.throwIfAborted();
  const current=await candidate.coverage(workspace);
  if(record.executionId!==workspace.run.executionId||current.scopeHash!==record.scopeHash||current.materialHash!==record.materialHash||workspace.run.revision!==record.revision)throw failure('CANDIDATE_SOURCE_CHANGED','准备恢复后任务、材料或源码版本发生变化');
  const loaded=await candidate.load(workspace,{candidateId:record.candidateId});
  if(loaded.manifestSha256!==record.candidateManifestSha256||!dominates(loaded.manifest,current))throw failure('CANDIDATE_NO_NET_GAIN','提交前较好候选已不再严格保留当前有效成果');
  for(const item of record.files)if((await fileState(workspace,item.path)).sha256!==item.before)throw failure('CANDIDATE_SOURCE_CHANGED','提交前文件已变化，保留用户当前修改：'+item.path);
  record.status='committing';await persist(directory,record);
  await markReverification(workspace,record);
  // The runner persists invalidation before any bytes change. That closes the
  // crash gap in which an old hash-based pass could otherwise become valid
  // again when exactly those earlier bytes are restored.
  if(beforeWrite)await beforeWrite(receipt(record));
  for(const item of record.files){
   signal?.throwIfAborted();if((await fileState(workspace,item.path)).sha256!==item.before)throw failure('CANDIDATE_SOURCE_CHANGED','恢复期间文件变化，保留用户修改：'+item.path);
   await replace(workspace,directory,item,'after',item.before);record.applied=(record.applied||[]).concat(item.path);await persist(directory,record);
  }
  record.status='committed';record.reason='verified_regression_reverted';await persist(directory,record);
  return receipt(record);
 }catch(error){
  record.error={code:error.code||'CANDIDATE_RECOVERY_COMMIT_FAILED',message:String(error.message).slice(0,500)};
  if(record.status==='committing'){
   try{await rollback(workspace,directory,record);}catch(rollbackError){record.status='needs_recovery';record.error.rollback=String(rollbackError.message).slice(0,300);await persist(directory,record);}
  }else{record.status='cancelled';await persist(directory,record);}
  if(error.code==='ERR_ASSERTION')throw error;
  return receipt(record);
 }
}
async function recoverNow(workspace,{transactionId}={}){
 boundary(workspace.run);const {record,directory}=await transaction(workspace,transactionId);
 if(!['committing','needs_recovery'].includes(record.status))return receipt(record);
 const current=await candidate.coverage(workspace);
 if(record.executionId!==workspace.run.executionId||record.scopeHash!==current.scopeHash||record.materialHash!==current.materialHash)return declined('CANDIDATE_SCOPE_CHANGED','恢复中断后要求或采用材料已变，保留事务与当前文件，不能自动回滚',{transactionId});
 await markReverification(workspace,record);
 // An interrupted transaction is rolled back, never assumed completed and
 // never replayed alongside an unknown side effect or a new external edit.
 return rollback(workspace,directory,record);
}
async function finalizeNow(workspace,{transactionId,signal}={}){
 boundary(workspace.run);signal?.throwIfAborted();const {record,directory}=await transaction(workspace,transactionId);
 if(record.status==='finalized')return receipt(record);
 if(!['committed','rolled_back','cancelled'].includes(record.status))return declined('CANDIDATE_TRANSACTION_STATE','恢复事务仍未结束，不能释放备份',{transactionId});
 const current=await candidate.coverage(workspace);
 if(current.scopeHash!==record.scopeHash||current.materialHash!==record.materialHash||current.blockingProblemIds.length||!current.requirementIds.length||current.mustIds.some(id=>!current.passedIds.includes(id)))return declined('CANDIDATE_REVERIFICATION_PENDING','原必须要求尚未按当前版本全部重新核验，保留恢复前备份',{transactionId});
 // Only complete fresh proof releases backup payloads. The small audit record
 // remains, so an explicit continuation cannot renew the same restore budget.
 record.backupRelease={at:new Date().toISOString(),scopeHash:current.scopeHash,passedIds:current.passedIds,mustIds:current.mustIds,optionalUnverifiedIds:current.optionalIds.filter(id=>!current.passedIds.includes(id)),revision:workspace.run.revision};
 await persist(directory,record);
 await fs.rm(path.join(directory,'before'),{recursive:true,force:true});await fs.rm(path.join(directory,'after'),{recursive:true,force:true});
 record.status='finalized';record.bytes=0;await persist(directory,record);
 return receipt(record);
}
function serial(workspace,execute){const key=workspace.project+'\0'+workspace.run.taskId,previous=queues.get(key)||Promise.resolve(),next=previous.catch(()=>{}).then(execute);queues.set(key,next);return next.finally(()=>{if(queues.get(key)===next)queues.delete(key);});}
async function pending(workspace){try{const base=await root(workspace),items=[];for(const name of await fs.readdir(base))if(ids.test(name)){const {record}=await transaction(workspace,name);if(['prepared','committing','needs_recovery'].includes(record.status))items.push(receipt(record));}return items;}catch(error){if(error.code==='ENOENT')return [];throw error;}}
async function history(workspace){try{const base=await root(workspace),items=[];for(const name of await fs.readdir(base))if(ids.test(name)){const {record}=await transaction(workspace,name);items.push(receipt(record));}return items;}catch(error){if(error.code==='ENOENT')return [];throw error;}}
module.exports={prepare:(workspace,options)=>serial(workspace,()=>prepareNow(workspace,options)),commit:(workspace,options)=>serial(workspace,()=>commitNow(workspace,options)),recover:(workspace,options)=>serial(workspace,()=>recoverNow(workspace,options)),finalize:(workspace,options)=>serial(workspace,()=>finalizeNow(workspace,options)),pending,history,selectDelivery,dominates,limits};

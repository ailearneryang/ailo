const fs=require('node:fs/promises');
const {randomUUID,createHash}=require('node:crypto');
const {resolveFile}=require('./workspace.cjs');
const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]))):value;
const fingerprint=action=>createHash('sha256').update(JSON.stringify(stable({...action,purpose:undefined,stepId:undefined}))).digest('hex');
const reads=new Set(['read_file','list_files','read_material','read_source','inspect_source','search_materials','read_execution','read_history']);
function begin(run,action){
 run.actionJournal ||= [];
 const hash=fingerprint(action);
 if(run.actionJournal.some(e=>e.fingerprint===hash&&e.status==='unknown'))throw Object.assign(Error('此前相同操作的结果尚未核对，禁止自动重放。请先检查文件、日志或远端状态；无法确认时说明阻塞。'),{code:'ACTION_RESULT_UNKNOWN'});
 const entry={id:randomUUID(),fingerprint:hash,action:action.action,path:action.path,stepId:action.stepId||run.steps.find(s=>s.status==='running')?.id,status:'running',readOnly:reads.has(action.action),startedAt:new Date().toISOString(),revision:run.revision,retries:0};
 if(action.action==='write_file')entry.expectedHash=createHash('sha256').update(action.content||'').digest('hex');
 run.actionJournal.push(entry);return entry;
}
async function reconcile(workspace){
 for(const entry of workspace.run.actionJournal||[]){
  if(entry.status!=='running'&&entry.status!=='unknown')continue;
  if(entry.action==='write_file'&&entry.expectedHash){
   try{const data=await fs.readFile(await resolveFile(workspace.files,entry.path));if(createHash('sha256').update(data).digest('hex')===entry.expectedHash){entry.status='succeeded';entry.recovered=true;entry.finishedAt=new Date().toISOString();await workspace.event('action_recovered',{actionId:entry.id,path:entry.path,message:'已核对中断写入的文件内容，无需重做。'});continue;}}catch{}
  }
  entry.status=entry.readOnly?'interrupted':'unknown';
 }
 await workspace.save();
}
function classify(error,entry){
 if(error.code==='ACTION_RESULT_UNKNOWN'||String(error.code||'').startsWith('MCP_'))return 'needs_reconciliation';
 if(!entry?.readOnly&&['ETIMEDOUT','ECONNRESET','EPIPE'].includes(error.code))return 'needs_reconciliation';
 if(entry?.readOnly&&['EINTR','EAGAIN','EBUSY','ETIMEDOUT','ECONNRESET'].includes(error.code))return 'retryable_read';
 if(/DECLINED|PERMISSION|DIRECTORY|AUTH/.test(error.code||''))return 'needs_user';
 return 'repair_required';
}
async function executeWithRecovery(workspace,entry,action,signal,execute){
 for(let attempt=0;;attempt++){
  signal.throwIfAborted();
  try{
   const result=await execute();
   entry.status=result?.timedOut?'unknown':result?.exitCode!==undefined&&result.exitCode!==0?'failed':'succeeded';
   entry.finishedAt=new Date().toISOString();entry.exitCode=result?.exitCode;await workspace.save();return result;
  }catch(error){
   entry.errorCode=error.code||'TOOL_ERROR';entry.recovery=classify(error,entry);
   if(!signal.aborted&&entry.recovery==='retryable_read'&&attempt<2){entry.retries++;await workspace.event('action_retry',{actionId:entry.id,action:action.action,attempt:entry.retries,message:'只读操作暂时失败，正在自动重试。'});await workspace.save();continue;}
   entry.status=signal.aborted?(entry.readOnly?'interrupted':'unknown'):entry.recovery==='needs_reconciliation'?'unknown':'failed';
   entry.finishedAt=new Date().toISOString();await workspace.save();throw error;
  }
 }
}
module.exports={begin,reconcile,executeWithRecovery,classify};

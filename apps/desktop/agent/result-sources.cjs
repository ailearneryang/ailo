const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {resolveFile}=require('./workspace.cjs');
const writes=new Set(['write_file','edit_file','edit_spreadsheet','run_command','build_android','artifact']);
const readable=new Set(['read_file','read_material','read_source','inspect_source','search_materials','web_search','knowledge','run_command']);
const usablePath=p=>typeof p==='string'&&!p.split('/').some(s=>s.startsWith('.')||s==='node_modules');
async function records(workspace,actions){
 const rows=[],seen=new Set();
 // The durable index survives the bounded recent-event window. No tool is replayed.
 for(const receipt of workspace.run.observationIndex||[]){
  if(!actions.has(receipt.action))continue;
  try{const record=await workspace.observationRecord(receipt.id,{archiveOnly:true});if(record.executionId&&record.executionId!==workspace.run.executionId)continue;rows.push(record);seen.add(record.response?.eventId);}catch{}
 }
 for(const event of workspace.run.events||[])if(actions.has(event.type)&&!seen.has(event.id))rows.push({id:event.id,action:{action:event.type,...event.detail},response:{result:event.detail?.result}});
 return rows;
}
async function files(workspace,{signal}={}){
 const run=workspace.run,candidates=new Map((run.artifacts||[]).map(f=>[f.path,{...f}])),unavailable=[],found=[],refreshed=[];
 for(const record of await records(workspace,writes)){
  const result=record.response?.result;
  if(record.response?.error||record.response?.notExecuted||!result||result.notExecuted||result.timedOut||result.exitCode!==undefined&&result.exitCode!==0||result.buildInputsChanged||result.buildEnvironmentChanged)continue;
  const items=[...(result.path&&result.sha256?[{path:result.path,sha256:result.sha256}]:[]),...(result.artifact?[result.artifact]:[]),...(result.buildArtifacts||[]),...(result.fileChanges||[]).filter(f=>f.after).map(f=>({path:f.path,sha256:f.after}))];
  for(const item of items)if(usablePath(item.path)&&/^[a-f0-9]{64}$/.test(item.sha256||''))candidates.set(item.path,{...candidates.get(item.path),...item,origin:'execution_receipt',receiptId:record.id,quality:'unverified'});
 }
 for(const candidate of candidates.values()){
  signal?.throwIfAborted();
  try{
   const file=await resolveFile(workspace.files,candidate.path),stat=await fs.stat(file);
   if(!stat.isFile()||!stat.size||stat.size>150*1024*1024||!usablePath(candidate.path))throw Error('非可交付文件');
   const hash=createHash('sha256');for await(const chunk of require('node:fs').createReadStream(file,{flags:require('node:fs').constants.O_RDONLY|require('node:fs').constants.O_NOFOLLOW})){signal?.throwIfAborted();hash.update(chunk);}
   const sha256=hash.digest('hex'),prior=run.artifacts.find(f=>f.path===candidate.path);
   // Refresh only intentionally registered paths, or exact successful receipts.
   if(!prior&&sha256!==candidate.sha256)throw Error('未登记文件的内容与回执不符');
   const changed=prior&&prior.sha256!==sha256;
   const value={...candidate,path:candidate.path,label:prior?.label||candidate.label||candidate.path,size:stat.size,sha256,...(changed?{previousSha256:prior.sha256,quality:'unverified',origin:'current_registered_file'}:{})};
   found.push(value);
   if(!prior||changed){
    refreshed.push(value);
    // Unobserved external changes must also invalidate revision-bound checks.
    if(changed&&candidate.sha256!==sha256)run.revision=(run.revision||0)+1;
   }
  }catch(error){signal?.throwIfAborted();unavailable.push(candidate.path);}
 }
 for(const value of refreshed){run.artifacts=run.artifacts.filter(f=>f.path!==value.path).concat(value);run.pendingArtifactUpdates=(run.pendingArtifactUpdates||[]).filter(p=>p!==value.path);await workspace.event('artifact_reconciled',{path:value.path,sha256:value.sha256,previousSha256:value.previousSha256,receiptId:value.receiptId,message:'收尾核对当前文件并更新成果登记；不代表要求验收通过'});}
 return {files:found,unavailable};
}
async function findings(workspace,{signal}={}){
 const sources=[];let used=0;
 for(const record of (await records(workspace,readable)).reverse()){
  signal?.throwIfAborted();const result=record.response?.result;
  if(record.response?.error||record.response?.notExecuted||!result||result.notExecuted||result.timedOut||result.exitCode!==undefined&&result.exitCode!==0)continue;
  if(result.path&&result.sha256)try{const hash=await require('./evidence.cjs').hashFile(await resolveFile(workspace.files,result.path));if(hash!==result.sha256)continue;}catch{continue;}
  const value=result.text||result.output||result.content||(result.results?JSON.stringify(result.results):'');
  if(typeof value!=='string'||!value.trim())continue;
  const text=value.slice(0,Math.min(2400,16000-used));if(!text)break;
  sources.push({id:record.id,path:result.path||record.action.path,label:workspace.lookup?.(record.action.id)?.name||({web_search:'搜索结果',knowledge:'知识库材料',run_command:'实际计算输出'}[record.action.action]),text,action:record.action.action});used+=text.length;
  if(used>=16000||sources.length>=8)break;
 }
 return sources.reverse();
}
module.exports={files,findings,records};

// Durable read identities and archive references, not a second source-text cache.
// Restoring a receipt never executes a tool, grants progress or changes retries.
const {normalizeProjectPath}=require('./workspace.cjs');
const MAX_RECEIPTS=256;
const actions=new Set(['list_files','read_file','read_material','read_source','inspect_source','search_materials','read_execution','read_history']);
const fields=new Set(['action','path','id','entry','pointer','query','view','offset','limit','version','revision','inputKey','indexSize','stateVersion']);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);
function identity(key){
 if(typeof key!=='string'||key.length>4096)return;
 let value;try{value=JSON.parse(key);}catch{return;}
 if(!value||typeof value!=='object'||Array.isArray(value)||!actions.has(value.action)||Object.keys(value).some(k=>!fields.has(k)))return;
 for(const field of ['path','id','entry','pointer','query','version','inputKey','stateVersion'])if(value[field]!==undefined&&(typeof value[field]!=='string'||value[field].length>2000||/[\x00-\x1f]/.test(value[field])))return;
 if(value.view!==undefined&&(value.action!=='read_execution'||!['record','result'].includes(value.view)))return;
 for(const field of ['revision','indexSize'])if(value[field]!==undefined&&(!Number.isSafeInteger(value[field])||value[field]<0))return;
 if(value.offset!==undefined&&(!Number.isSafeInteger(value.offset)||value.offset<0))return;
 if(value.limit!==undefined&&(!Number.isSafeInteger(value.limit)||value.limit<1||value.limit>12000))return;
 if(value.action==='list_files'){
  try{if(value.path!==undefined)normalizeProjectPath(value.path,true);}catch{return;}
  if(!Number.isSafeInteger(value.revision)||value.revision<0)return;
 }
 if(value.action==='read_file'){
  try{if(normalizeProjectPath(value.path)!==value.path)return;}catch{return;}
  if(!sha(value.version)||!Number.isSafeInteger(value.offset)||!Number.isSafeInteger(value.limit))return;
 }
 return value;
}
function normalize(key,metadata){
 const target=identity(key);
 if(!target||!metadata||!uuid(metadata.sourceObservationId))return;
 if(target.action==='read_file'){
  if(metadata.sha256!==target.version)return;
  if(metadata.path!==undefined&&metadata.path!==target.path)return;
  if(metadata.offset!==undefined&&metadata.offset!==target.offset)return;
  if(metadata.limit!==undefined&&metadata.limit!==target.limit)return;
 }
 for(const field of ['next','total'])if(Object.hasOwn(metadata,field)){
  const value=metadata[field];if(value===undefined)continue;
  if(field==='next'&&value===null)continue;
  if(!Number.isSafeInteger(value)||value<0)return;
 }
 if(Number.isSafeInteger(metadata.total)&&Number.isSafeInteger(metadata.next)&&metadata.next>metadata.total)return;
 const result={sourceObservationId:metadata.sourceObservationId};
 // Undefined is unknown, never an inferred EOF. Do not retain result.text,
 // arguments, commands, model summaries or other arbitrary metadata.
 for(const field of ['next','total'])if(metadata[field]!==undefined)result[field]=metadata[field];
 if(target.action==='read_file')Object.assign(result,{path:target.path,sha256:target.version,offset:target.offset,limit:target.limit});
 return result;
}
function ledger(run){
 if(run.readReceipts?.version!==1||run.readReceipts.executionId!==run.executionId)run.readReceipts={version:1,executionId:run.executionId,entries:[]};
 if(!Array.isArray(run.readReceipts.entries))run.readReceipts.entries=[];
 return run.readReceipts;
}
function remember(run,key,metadata){
 const value=normalize(key,metadata);if(!value)return false;
 const state=ledger(run);
 state.entries=[...state.entries.filter(entry=>entry&&entry.key!==key),{key,...value}].slice(-MAX_RECEIPTS);
 return true;
}
function restore(run){
 const state=run.readReceipts,result=new Map();
 if(state?.version!==1||state.executionId!==run.executionId||!Array.isArray(state.entries))return result;
 for(const entry of state.entries.slice(-MAX_RECEIPTS)){
  if(!entry||typeof entry!=='object')continue;
  const value=normalize(entry.key,entry);if(value)result.set(entry.key,value);
 }
 return result;
}
function sameFileRead(record,target){
 const action=record?.action,response=record?.response,result=response?.result;
 if(action?.action!=='read_file'||response?.error||response?.notExecuted||result?.notExecuted||typeof result?.text!=='string'||result.sha256!==target.version)return false;
 try{if(normalizeProjectPath(action.path)!==target.path||result.path!==undefined&&normalizeProjectPath(result.path)!==target.path)return false;}catch{return false;}
 return (action.offset??0)===target.offset&&(action.limit??10000)===target.limit&&(result.offset===undefined||result.offset===target.offset);
}
async function hydrate(workspace,{maxArchives=256}={}){
 if(!Number.isSafeInteger(maxArchives)||maxArchives<1||maxArchives>1024)throw Error('读取回执迁移预算无效');
 const run=workspace.run,restored=restore(run),wanted=new Map();
 for(const pair of (Array.isArray(run.readAttempts)?run.readAttempts:[]).slice(-MAX_RECEIPTS)){
  if(!Array.isArray(pair)||pair.length<2||!Number.isSafeInteger(pair[1])||pair[1]<1||restored.has(pair[0]))continue;
  const target=identity(pair[0]);if(target?.action==='read_file')wanted.set(pair[0],target);
 }
 if(!wanted.size)return {restored:0,checkedArchives:0,unresolved:0};
 const pending=new Map(wanted),candidates=[];
 for(const receipt of (Array.isArray(run.observationIndex)?run.observationIndex:[]).slice().reverse()){
  if(receipt?.action!=='read_file'||!uuid(receipt.id))continue;
  let relative;try{relative=normalizeProjectPath(receipt.path);}catch{continue;}
  if([...wanted.values()].some(target=>target.path===relative&&(receipt.offset??0)===target.offset))candidates.push(receipt);
 }
 let checked=0,added=0;
 const seen=new Set();
 for(const receipt of candidates){
  if(!pending.size||checked>=maxArchives)break;
  if(seen.has(receipt.id))continue;seen.add(receipt.id);
  let record;checked++;
  try{record=await workspace.observationRecord(receipt.id,{archiveOnly:true});}catch(error){if(['ENOENT','EXECUTION_RECORD_NOT_FOUND'].includes(error.code))continue;throw error;}
  if(record?.executionId&&run.executionId&&record.executionId!==run.executionId)continue;
  for(const [key,target]of pending){
   if(!sameFileRead(record,target))continue;
   const result=record.response.result;
   if(remember(run,key,{sourceObservationId:receipt.id,path:target.path,sha256:result.sha256,offset:target.offset,limit:target.limit,...(result.next!==undefined?{next:result.next}:{}),...(result.total!==undefined?{total:result.total}:{})})){
    pending.delete(key);added++;
   }
  }
 }
 return {restored:added,checkedArchives:checked,unresolved:pending.size};
}
module.exports={remember,restore,hydrate,MAX_RECEIPTS};

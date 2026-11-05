// A historical registration grants read-only access to a task-owned path. It
// never re-registers that file in the current execution or proves its current
// bytes equal a historical version. Filesystem containment/symlink checks still
// belong to resolveFile/scheduleArtifactRoot at the caller's read boundary.
const {normalizeProjectPath}=require('./agent/workspace.cjs');
const limits={snapshots:512,records:8192,depth:8,origins:32};
function inventory(run,{taskId}={}){
 const expected=taskId||run?.taskId;
 if(!run||typeof run!=='object'||expected&&run.taskId&&run.taskId!==expected)return {artifacts:[],truncated:false};
 const queue=[{value:run,kind:'current',depth:0}],visited=new Set(),artifacts=new Map();let records=0,snapshots=0,truncated=false;
 function permitted(value){return value&&typeof value==='object'&&!Array.isArray(value)&&!(expected&&value.taskId&&value.taskId!==expected);}
 function register(list,owner,kind){
  if(!Array.isArray(list))return;
  for(let i=0;i<list.length;i++){
   if(records>=limits.records){truncated=true;break;}records++;
   const item=list[i];if(!permitted(item)||typeof item.path!=='string')continue;
   let relative;try{relative=normalizeProjectPath(item.path);}catch{continue;}
   const origin={kind,...(typeof owner.executionId==='string'?{executionId:owner.executionId}:{}),...(typeof (owner.inputKey||owner.inputId)==='string'?{inputId:owner.inputKey||owner.inputId}:{}),...(typeof (owner.updatedAt||owner.at||owner.archivedAt)==='string'?{at:owner.updatedAt||owner.at||owner.archivedAt}:{})};
   const prior=artifacts.get(relative);
   if(prior){if(prior.origins.length<limits.origins&&!prior.origins.some(o=>JSON.stringify(o)===JSON.stringify(origin)))prior.origins.push(origin);continue;}
   artifacts.set(relative,{path:relative,...(typeof item.label==='string'?{label:item.label.slice(0,500)}:{}),...(typeof item.sha256==='string'&&/^[a-f0-9]{64}$/i.test(item.sha256)?{sha256:item.sha256}:{}),historical:!['current','delivery'].includes(kind),origins:[origin]});
  }
 }
 while(queue.length){
  if(snapshots>=limits.snapshots||records>=limits.records){truncated=true;break;}
  const {value,kind,depth}=queue.shift();if(!permitted(value)||visited.has(value))continue;visited.add(value);snapshots++;
  register(value.artifacts,value,kind);
  if(permitted(value.delivery))register(value.delivery.availableArtifacts,value.delivery,kind==='current'?'delivery':kind+':delivery');
  for(const key of ['history','requestArchive']){
   if(!Array.isArray(value[key]))continue;
   if(depth>=limits.depth){if(value[key].length)truncated=true;continue;}
   const room=limits.snapshots-queue.length-snapshots,count=Math.max(0,Math.min(room,value[key].length));
   if(count<value[key].length)truncated=true;
   for(let i=0;i<count;i++)queue.push({value:value[key][i],kind:key,depth:depth+1});
  }
 }
 return {artifacts:[...artifacts.values()],truncated};
}
function registeredArtifacts(run,options){return inventory(run,options).artifacts;}
function ownsArtifact(run,relative,options){let normalized;try{normalized=normalizeProjectPath(relative);}catch{return false;}return registeredArtifacts(run,options).some(a=>a.path===normalized);}
function assertOwnedArtifact(run,relative,options){let normalized;try{normalized=normalizeProjectPath(relative);}catch{throw Error('成果不属于当前任务');}const artifact=registeredArtifacts(run,options).find(a=>a.path===normalized);if(!artifact)throw Error('成果不属于当前任务');return artifact;}
module.exports={inventory,registeredArtifacts,ownsArtifact,assertOwnedArtifact,limits};

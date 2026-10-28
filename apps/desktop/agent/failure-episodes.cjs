const {createHash}=require('node:crypto');
const identity=require('./action-identity.cjs');
const bookkeeping=new Set(['route','checkpoint','artifact']);
function state(run){
 if(!run.failureEpisodes||run.failureEpisodes.version!==1||run.failureEpisodes.executionId!==run.executionId)run.failureEpisodes={version:1,executionId:run.executionId,records:[]};
 return run.failureEpisodes;
}
function subject(action){
 let a;try{a=identity.normalize(action);}catch{a={...action};delete a.progress;delete a.purpose;}
 const checks=Array.isArray(a.checks)?a.checks:[];
 // A changed explanation or evidence receipt cannot create a new product issue.
 return {action:a.action,operation:a.operation,path:a.path,id:a.id,entry:a.entry,pointer:a.pointer,
  criterionIds:checks.length?[...new Set(checks.map(c=>c.criterionId))].sort():undefined,
  command:a.command,tasks:a.tasks,offset:a.offset,limit:a.limit};
}
function failure(run,action,error){
 const ledger=state(run),target=subject(action),errorClass=error.code||'TOOL_FAILURE';
 if(action.action==='verify'&&typeof error.criterionId==='string'&&target.criterionIds?.includes(error.criterionId))target.criterionIds=[error.criterionId];
 const key=createHash('sha256').update(JSON.stringify(identity.stable({target,errorClass}))).digest('hex');
 let episode=ledger.records.find(e=>e.key===key&&e.status==='open');
 if(!episode){
  episode={id:'failure_'+key.slice(0,20),key,target,errorClass,status:'open',failures:0,recoveries:0,
   stepId:run.steps?.find(s=>s.status==='running')?.id,firstAt:new Date().toISOString(),resumes:0};
  ledger.records.push(episode);
 }
 episode.failures++;episode.lastAt=new Date().toISOString();episode.message=String(error.message||error).slice(0,1600);
 const errorId=require('./context-projections.cjs').errorReference(run,{...episode,lastEventId:undefined});if(errorId)episode.lastEventId=errorId;
 // Keep open episodes; prune only old resolved records. Renaming steps does not
 // create a fresh budget, and a checkpoint never mutates this ledger.
 if(ledger.records.length>128){let excess=ledger.records.length-128;ledger.records=ledger.records.filter(e=>e.status==='open'||excess--<=0);}
 return episode;
}
function next(episode){
 if(episode.failures<3)return 'continue';
 if(episode.recoveries<2+(episode.resumeCredits||0)){episode.recoveries++;return 'recover';}
 return 'exhausted';
}
function resume(run,{explicit=false}={}){
 if(!explicit)return;
 for(const e of state(run).records)if(e.status==='open'&&e.failures>=3&&e.recoveries>=2+(e.resumeCredits||0)){
  e.resumeCredits=(e.resumeCredits||0)+1;e.resumes++;e.resumedAt=new Date().toISOString();
 }
}
function successful(run,action,result){
 if(bookkeeping.has(action.action)||result?.changed===false||result?.notExecuted||result?.timedOut||result?.exitCode!==undefined&&result.exitCode!==0)return [];
 const records=state(run).records,closed=[];
 const checks=action.action==='verify'?result?.results||[]:[];
 const paths=new Set(checks.flatMap(c=>[c.path,c.scope?.path,...(c.sources||[]).map(s=>s.path)]).filter(Boolean));
 const ids=new Set(checks.map(c=>c.criterionId));
 for(const e of records){
  if(e.status!=='open')continue;
  const t=e.target;
  const accepted=checks.length&&(t.criterionIds?.length?t.criterionIds.every(id=>ids.has(id)):t.path&&paths.has(t.path));
  // A successful retry of the same failed operation proves that operational
  // failure resolved. Unrelated reads/writes cannot clear another episode.
  const same=action.action===t.action&&JSON.stringify(identity.stable(subject(action)))===JSON.stringify(identity.stable(t));
  if(!accepted&&!same)continue;
  e.status='resolved';e.resolvedAt=new Date().toISOString();e.resolution={action:action.action,criterionIds:checks.map(c=>c.criterionId)};closed.push(e.id);
 }
 return closed;
}
function context(run){return require('./context-projections.cjs').failureContext(run,state(run).records);}
module.exports={state,subject,failure,next,resume,successful,context};

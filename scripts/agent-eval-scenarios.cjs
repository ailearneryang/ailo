// Evaluation-only controls, installed in one isolated process at a time. The
// selected runtime still owns routing, acceptance, persistence and recovery.
const fs=require('node:fs/promises'),path=require('node:path');
const {hash}=require('./agent-eval-config.cjs');
const supported=new Set(['steering_material_safe_point','sequential_task_scope','transient_transport_and_resume','unknown_effect_fault_injection']);
function supports(fixture){return !fixture.adapter||supported.has(fixture.adapter);}
async function appendInput({task,base,followup,id}){
 const materials=[];for(const [name,text]of Object.entries(followup.materials||{})){
  const sourceId=require('node:crypto').randomUUID();await fs.mkdir(path.join(base,'imports'),{recursive:true,mode:0o700});await fs.writeFile(path.join(base,'imports',sourceId),text,{flag:'wx',mode:0o600});materials.push({name,size:Buffer.byteLength(text),text,sourceId});
 }
 return {id,role:'user',content:followup.content,materials,createdAt:new Date().toISOString()};
}
function install({source,fixture,task,base,trial,ablation}={}){
 if(!supports(fixture))throw Error('Unknown fixed evaluation scenario');
 const runner=require(path.join(source,'apps/desktop/agent/runner.cjs')),tools=require(path.join(source,'apps/desktop/agent/tools.cjs')),original=runner.runAgent;
 const events=[],invocations=[],counterWrites=[],segments=[];let chat,firstWrite=false,steered=false,faultActive=false,faultInjected=false,resumed=false,restoreCandidate;
 const event=(type,detail={})=>events.push({id:require('node:crypto').randomUUID(),type,at:new Date().toISOString(),detail});
 if(ablation){
  if(ablation!=='candidate-preservation')throw Error('Unsupported optional ablation');
  const candidate=require(path.join(source,'apps/desktop/agent/candidate-versions.cjs')),capture=candidate.capture;
  candidate.capture=async()=>({status:'evaluation_ablation',notice:'Optional snapshot preservation disabled only; all original acceptance remains active'});
  restoreCandidate=()=>{candidate.capture=capture;};event('ablation_enabled',{mechanism:ablation,requiredAcceptance:'unchanged'});
 }
 runner.runAgent=async options=>{
  const ask=options.ask;
  return original({...options,ask:async(...args)=>{
   if(fixture.adapter==='transient_transport_and_resume'&&firstWrite&&!resumed){
    if(!faultInjected){faultInjected=true;event('confirmed_not_dispatched_fault',{phase:'decision',externalRequestSent:false});}
    faultActive=true;throw Object.assign(Error('Isolated evaluation transport outage: this request was not dispatched'),{code:'MODEL_NETWORK',networkCode:'ERR_INTERNET_DISCONNECTED',requestAttempted:false});
   }
   return ask(...args);
  },executeTool:async(workspace,action,signal,toolOptions)=>{
   const realRoot=await fs.realpath(workspace.files),isolated=await fs.realpath(trial);
   if(!realRoot.startsWith(isolated+path.sep))throw Object.assign(Error('Evaluation tool escaped the isolated trial'),{code:'EVAL_ISOLATION',notExecuted:true});
   // No application connections, Android devices, outside-directory grants or
   // external network effects exist in this public fixture suite.
   if(['mcp','amap','feishu','build_android','android_device','request_directory','request_network','web_search','knowledge','assistant','memory'].includes(action.action))throw Object.assign(Error('Public evaluation fixtures do not authorize external services or devices'),{code:'EVAL_TOOL_NOT_AUTHORIZED',notExecuted:true});
   invocations.push({action:action.action,path:action.path,commandHash:action.command?hash(action.command):undefined});
   if(fixture.adapter==='unknown_effect_fault_injection'&&action.action==='write_file'&&action.path==='counter.txt')counterWrites.push({content:action.content,at:new Date().toISOString()});
   const permissions={commandOptions:async()=>({networkOutbound:false,readDirectories:[]})};
   const result=await tools.execute(workspace,action,signal,{...toolOptions,permissions});
   if(['write_file','edit_file'].includes(action.action)&&result.changed!==false){firstWrite=true;event('successful_source_write',{path:action.path,sha256:result.sha256});}
   if(fixture.adapter==='steering_material_safe_point'&&firstWrite&&!steered){
    steered=true;const input=await appendInput({task,base,followup:fixture.scenario.followup,id:'eval-followup'});
    await chat.steer({id:'trial',taskId:task.id,content:input.content,materials:input.materials,messageId:input.id});event('scripted_material_steering',{inputId:input.id,materialHashes:input.materials.map(m=>({name:m.name,sha256:hash(m.text)})),safePoint:'successful_tool_receipt_before_next_decision'});
   }
   if(fixture.adapter==='unknown_effect_fault_injection'&&action.action==='write_file'&&action.path==='counter.txt'&&!faultInjected){
    // The operation really happened. The driver never writes the counter or
    // reconciles the journal; only the selected runtime may hash/query it.
    faultInjected=true;event('committed_receipt_lost',{path:'counter.txt',sha256:result.sha256,resultObservedByHarness:true});
    throw Object.assign(Error('Isolated write committed, response receipt lost; check the actual file before any replay'),{code:'ACTION_RESULT_UNKNOWN'});
   }
   return result;
  }});
 };
 async function drive({complete,persistTask}){
  let result=await complete(),first=result?.agentRun;segments.push({phase:'initial',executionId:first?.executionId,status:first?.status,currentInputId:first?.currentInputId});
  if(fixture.adapter==='sequential_task_scope'&&(first?.delivery?.status==='settled'||first?.status==='completed')){
   const input=await appendInput({task,base,followup:fixture.scenario.followup,id:'eval-new-goal'});await persistTask(input,result);event('scripted_independent_goal',{inputId:input.id,priorExecutionId:first.executionId});result=await complete();
  }else if(fixture.adapter==='transient_transport_and_resume'&&faultActive||fixture.adapter==='unknown_effect_fault_injection'&&faultInjected){
   const before=await readState();segments[0].journal=(before?.actionJournal||[]).map(e=>({id:e.id,status:e.status,action:e.action,path:e.path}));segments[0].failureBudgets=budgets(before);
   resumed=true;faultActive=false;const input=await appendInput({task,base,followup:{content:fixture.scenario.followup?.content||'继续任务'},id:'eval-resume'});
   await persistTask(input,result);event('scripted_explicit_continue',{inputId:input.id,origin:'evaluation',priorExecutionId:first?.executionId});result=await complete();
  }
  segments.push({phase:'final',executionId:result?.agentRun?.executionId,status:result?.agentRun?.status,currentInputId:result?.agentRun?.currentInputId});return result;
 }
 const project=()=>require(path.join(source,'apps/desktop/agent/workspace-path.cjs')).workspacePath(base,task);
 async function readState(){try{return JSON.parse(await fs.readFile(path.join(project(),'runs',hash(task.id)+'.json'),'utf8'));}catch{return null;}}
 async function finish(){
  const run=await readState(),archiveFile=path.join(project(),'runs',hash(task.id)+'.json.jsonl');let archive=[];try{archive=(await fs.readFile(archiveFile,'utf8')).split('\n').filter(Boolean).map(JSON.parse);}catch{}
  const checks=[],add=(check,passed,detail)=>checks.push({check,passed:passed===true,...(detail?{detail}:{})});
  if(fixture.adapter==='steering_material_safe_point'){
   add('scripted attachment was submitted at a real successful-write safe point',steered);
   add('latest attached input actually adopted',run?.acceptedInputIds?.includes('eval-followup')&&run?.inputKey==='eval-followup');
   add('new attachment mapped to current requirements',run?.materialInput?.status==='adopted'||run?.materialInput?.history?.some(r=>r.inputId==='eval-followup'&&r.status==='adopted'));
  }
  if(fixture.adapter==='sequential_task_scope'){
   add('independent followup reached settled prior result',events.some(e=>e.type==='scripted_independent_goal'));
   add('independent goal has a new execution',!!run?.executionId&&run.executionId!==segments[0]?.executionId);
   const histories=[...(run?.requestArchive||[]),...(run?.history||[])];add('prior execution and artifact evidence retained',histories.some(r=>r.executionId===segments[0]?.executionId||r.id===segments[0]?.executionId));
   add('document goal does not inherit webpage visual acceptance',(run?.acceptanceCriteria||run?.requirements||[]).every(r=>r.type!=='visual'));
  }
  if(fixture.adapter==='transient_transport_and_resume'){
   add('confirmed undispatched fault and one scripted continuation exercised',faultInjected&&resumed);
   add('explicit continue retained original execution',!!run?.executionId&&run.executionId===segments[0]?.executionId);
   // The pure resume boundary is inspected before the next real model decision.
   add('continue did not reset failure budgets before new progress',events.some(e=>e.type==='resume_budget_checked'&&e.detail.passed));
  }
  if(fixture.adapter==='unknown_effect_fault_injection'){
   const counter=await fs.readFile(path.join(project(),'files/counter.txt'),'utf8').catch(()=>null);
   add('side effect happened once and lost receipt was injected',faultInjected&&counterWrites.length===1&&counter==='1');
   const recovered=archive.find(e=>e.type==='action_recovered'&&e.detail?.path==='counter.txt');const entry=(run?.actionJournal||[]).find(e=>e.id===recovered?.detail?.actionId);
   add('runtime reconciled actual expected bytes with durable receipt',!!recovered&&entry?.status==='succeeded'&&entry.recovered===true&&entry.expectedHash===hash('1'),{receiptEventId:recovered?.id,actionId:entry?.id,status:entry?.status,expectedHash:entry?.expectedHash,recovered:entry?.recovered});
   add('no unresolved effect was silently cleared',(run?.actionJournal||[]).every(e=>e.status!=='unknown'));
  }
  const evidence={schemaVersion:1,scenario:fixture.adapter||'static',complete:!fixture.adapter||checks.length>0&&checks.every(c=>c.passed),events,segments,checks,toolInvocations:invocations,counterWrites,requiredAcceptance:'unchanged',externalServicesAvailable:false};
  await fs.writeFile(path.join(trial,'scenario-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});return evidence;
 }
 // Inspect resumed state before an actual service request, with no mutation.
 const originalWrapped=runner.runAgent;runner.runAgent=async options=>{
  if(resumed&&fixture.adapter==='transient_transport_and_resume'){
   const ask=options.ask;options={...options,ask:async(...args)=>{if(!events.some(e=>e.type==='resume_budget_checked')){const current=await readState(),old=segments[0]?.failureBudgets;event('resume_budget_checked',{passed:preserved(old,budgets(current)),before:old,after:budgets(current)});}return ask(...args);}};
  }
  return originalWrapped(options);
 };
 return {attach(value){chat=value;},drive,finish,restore(){runner.runAgent=original;restoreCandidate?.();}};
}
function budgets(run){const recovery=require('../apps/desktop/agent/recovery-state.cjs'),state=typeof recovery.inspect==='function'?recovery.inspect(run):run?.executionRecovery,ledger=state?.failures||run?.failureEpisodes;return {repairValueStagnant:(state?.repair||run?.repairValue)?.stagnant||0,remainingDecisions:(state?.remaining||run?.resultRecovery)?.turns||0,episodes:(Array.isArray(ledger)?ledger:ledger?.records||[]).map(e=>({id:e.id,failures:e.failures||0,recoveries:e.recoveries||0}))};}
function preserved(before,after){return !!before&&after.repairValueStagnant>=before.repairValueStagnant&&after.remainingDecisions>=before.remainingDecisions&&before.episodes.every(e=>after.episodes.some(a=>a.id===e.id&&a.failures>=e.failures&&a.recoveries>=e.recoveries));}
module.exports={install,supports,appendInput,budgets,preserved};

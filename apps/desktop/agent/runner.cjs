const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {createWorkspace,resolveFile,normalizeProjectPath}=require('./workspace.cjs');
const {execute}=require('./tools.cjs');
const {decodeAction,parseAction,tool,allowedActions,parameterHint}=require('./protocol.cjs');

const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]))):value;
async function readIdentity(workspace,action) {
 const fields={list_files:['path'],read_file:['path'],read_material:['id'],read_source:['id','entry'],inspect_source:['id','entry','pointer','query'],search_materials:['query'],read_execution:['id','view'],read_history:[]}[action.action];
 const target={action:action.action,...Object.fromEntries(fields.filter(k=>action[k]!==undefined).map(k=>[k,action[k]]))};
 if(action.action==='list_files')target.revision=workspace.run.revision;
 if(action.action==='read_history')target.inputKey=workspace.run.inputKey;
 if(action.action==='read_execution'&&action.id==='observations')target.indexSize=workspace.run.observationIndex?.length||0;
 if(action.action==='read_execution'&&action.id==='state')target.stateVersion=createHash('sha256').update(JSON.stringify([workspace.run.revision,workspace.run.steps,workspace.run.executionState,workspace.run.artifacts])).digest('hex');
 if(action.action!=='search_materials')target.offset=action.offset??0;
 if(['read_file','read_material','read_execution','read_history'].includes(action.action))target.limit=action.limit??(action.action==='read_material'||action.action==='read_execution'&&!action.id?6000:10000);
 if(action.action==='read_file') {
  target.path=normalizeProjectPath(action.path);
  const restoration=workspace.run.candidateRecovery;
  if(restoration?.requiresReverification&&restoration.transactionId&&restoration.changedPaths?.includes(target.path))target.restorationTransaction=restoration.transactionId;
  try {
   const file=await resolveFile(workspace.files,target.path),hash=createHash('sha256');
   for await(const chunk of require('node:fs').createReadStream(file,{flags:require('node:fs').constants.O_RDONLY|require('node:fs').constants.O_NOFOLLOW}))hash.update(chunk);
   target.version=hash.digest('hex');
  }catch(e){if(e.code!=='ENOENT')throw e;} // Execution still reports missing files.
 }
 return target;
}
const acceptanceChecks=require('./acceptance.cjs');
const actionJournal=require('./action-journal.cjs');
const {validatePlan}=require('./plan.cjs');
const actionIdentity=require('./action-identity.cjs');
const failureEpisodes=require('./failure-episodes.cjs');
const settlement=require('./result-settlement.cjs');
const exitPolicy=require('./exit-policy.cjs');
const recoveryControl=require('./recovery-control.cjs');
function publicRun(run) {
  require('./recovery-state.cjs').bind(run);
  return {resultChanges:require('./input-turn.cjs').changes(run,run.artifacts||[]),resultPreview:require('./result-preview.cjs').publicPreview(run),qualityCoverage:acceptanceChecks.qualitySummary(run),inputCoverage:require('./input-coverage.cjs').rows(run),candidateProtection:require('./candidate-versions.cjs').summary(run),requestScope:run.requestScope,materialInput:require('./material-input.cjs').context(run),problemLedger:require('./problem-state.cjs').rows(run),resultRecovery:run.resultRecovery,visualAnalysisFailures:run.visualAnalysisFailures,waitingError:run.waitingError,taskContinuation:run.taskContinuation,runtimeRepairs:run.runtimeRepairs,runtimeContinuation:run.runtimeContinuation,interventionTracking:run.interventionTracking,runtimeIdentity:run.runtimeIdentity,segmentState:run.segmentState,failureEpisodes:failureEpisodes.context(run),designRegionIssues:[...require('./design-regions.cjs').issues(run).map(({regionId,region,reason})=>({regionId,region,reason})),...(run.visualQuality?.constraints||[]).filter(c=>c.status==='open'&&!c.assetOnly).map(c=>({regionId:c.id,region:'视觉质量',reason:c.description}))],currentOutcome:run.currentOutcome,currentInputId:run.inputKey,currentIntent:run.currentIntent,memoryUsed:run.memoryUsed,loadedExtensions:run.loadedExtensions,conversationTitle:run.conversationTitle,progressInputId:run.progressInputId,executionId:run.executionId,history:run.history||[],inFlight:run.inFlight?{...run.inFlight}:undefined,contextUsage:run.contextUsage,delivery:run.delivery,issues:run.issues||[],executionState:run.executionState,acceptanceCriteria:acceptanceChecks.criteria(run).map(({id,text,type,scope,scopes,quality,check})=>({id,text,type,scope,scopes,quality,level:quality?.level||'must',basis:check?.basis,status:check?.status==='passed'&&(run.freshAcceptanceIds||[]).includes(id)?'passed':'pending'})),recoverySummary:{retried:(run.actionJournal||[]).filter(e=>e.retries>0).length,recovered:(run.actionJournal||[]).filter(e=>e.recovered).length,unknown:(run.actionJournal||[]).filter(e=>e.status==='unknown').length},performance:run.performance,status:run.status,mode:run.mode,goal:run.goal,steps:run.steps,decisions:run.decisions,acceptance:run.acceptance,completionReview:run.completionReview,artifacts:run.artifacts,updatedAt:run.updatedAt,events:run.events.slice(-12).map(e=>({id:e.id,type:e.type,at:e.at,detail:{...require('../execution-activity.cjs').searchReceipt(e),...(e.type==='run_command'?{feedback:require('../operation-feedback.cjs').operationFeedback(e.detail)}:{}),actionId:e.detail.actionId,operation:e.detail.operation,action:e.detail.action,command:e.detail.command||e.detail.result?.command,startedAt:e.detail.startedAt,durationMs:e.detail.durationMs,timedOut:e.detail.result?.timedOut,outputTruncated:e.detail.result?.truncated||e.detail.result?.output?.length>24000,purpose:e.detail.purpose,exitCode:e.detail.result?.exitCode,path:e.detail.path,name:e.detail.name,offset:e.detail.offset,entry:e.detail.entry,pointer:e.detail.pointer,message:e.detail.message,output:['run_command','build_android','android_device','feishu','tool_error','command_interrupted'].includes(e.type)?e.detail.result?.output?.slice(-24000):undefined}}))};
}
async function runAgentImpl({base,task,ask,prepareModelMessages,summarizeResult,model,signal,onStatus,onRun,extensions=[],availableSkills=[],skillPackages,images,browser,android,authorizeBuild,directoryAccess,feishuCli,webSearch,amap,mcp,knowledge,personalAssistant,projectContext,projectMemoryContext,scheduledContext,runtimeContinuation,reasoningConfig,memory,permissions,maxSteps=240,batchSize=48,maxDurationMs=2*60*60*1000,continuationReason='user',requestOrigin='unknown',segmentIndex=0,retainBrowser=false,finalizeOnBudget=false,autonomous=false,onWorkspace,now=Date.now,executeTool=execute,getSteering=async()=>[],onSteeringAccepted}) {
  // Status is presentation only. A broken observer must never cancel a tool.
  const statusObserver=onStatus;
  onStatus=message=>{if(typeof message!=='string'||!message.trim())return;try{statusObserver?.(message);}catch{}};
  const runObserver=onRun;
  onRun=async value=>{try{await runObserver?.(value);}catch(error){if(error.code==='ERR_ASSERTION')throw error;}};
  for(const value of [maxSteps,batchSize,maxDurationMs])if(!Number.isSafeInteger(value)||value<=0)throw Error('执行预算必须为正整数');
  const startedAt=now();
  const performance=require('./performance.cjs');
  const recovery=require('./decision-recovery.cjs');
  const workspace=await createWorkspace(base,task),run=workspace.run,priorRuntime=run.runtimeIdentity&&structuredClone(run.runtimeIdentity);
  if(continuationReason!=='user'&&run.delivery?.status==='settled'){await onRun?.(publicRun(run));return {content:run.delivery.summary||'本轮尝试已结束，已有成果与原要求已保留。',agentRun:publicRun(run)};}
  // Reconcile already-issued native writes from their expected file hashes
  // before deciding whether a user continuation still has unknown effects.
  await actionJournal.reconcile(workspace);
  let scheduledMessage=require('../scheduled-message.cjs').reminderDelivery(task);
  if(requestOrigin==='user'&&continuationReason==='user'&&!require('./task-continuation.cjs').canResume(run,task)){await onRun?.(publicRun(run));return {content:require('./task-continuation.cjs').message(run),agentRun:publicRun(run)};}
  const commandRuntime=require('./command-runtime.cjs'),commandDiscovery=await commandRuntime.resolve();
  const runtimeIdentity=require('../runtime-provenance.cjs').forModel(model);
  onWorkspace?.(workspace);
  run.observationCapabilities=require('./model-capabilities.cjs').observationCapabilities(model,{images:!!images,browser:!!browser});
  const repairedReminder=requestOrigin==='user'&&continuationReason==='user'&&require('../scheduled-message.cjs').reminderResume(task,run);
  if(repairedReminder){run.runtimeRepairs=[...(run.runtimeRepairs||[]),repairedReminder.id];await workspace.event('runtime_repair_resume',{repairId:repairedReminder.id,message:'原任务仅要求文字提醒，改按回复交付，保留历史要求与未通过记录。'});}
  const repairedProtocol=requestOrigin==='user'&&continuationReason==='user'&&require('../legacy-protocol-recovery.cjs').legacyFeishuRecovery(run);
  if(repairedProtocol){run.runtimeRepairs=[...(run.runtimeRepairs||[]),repairedProtocol.id];await workspace.event('runtime_repair_resume',{repairId:repairedProtocol.id,message:'使用修复后的飞书参数协议继续原任务；已有结果不重放。'});}
  const priorExecutionId=run.executionId,priorRunStatus=run.status;
  require('./execution-rounds.cjs').beginRound(run,task,publicRun);
  require('./input-turn.cjs').begin(run);
  require('./input-coverage.cjs').receive(run,task);
  require('./html-validation.cjs').configure(run,task);
  if(requestOrigin==='user'&&continuationReason==='user'&&priorRuntime?.appVersion==='0.1.93'&&(run.pendingTaskChange?.adoptionDecisions||0)>=recoveryControl.limits.inputAdoptionDecisions&&!settlement.unknown(run)&&!run.inFlight){
    for(const row of (run.observationIndex||[]).filter(o=>o.action==='plan'&&String(o.error||'').startsWith('已有质量契约不可在执行中改变')).slice(-8).reverse()){
      let observation;try{observation=await workspace.observationRecord(row.id,{archiveOnly:true});}catch(error){if(error.code==='ERR_ASSERTION')throw error;continue;}
      const observedAt=Date.parse(observation.at),event=await workspace.findEvent(e=>e.type==='tool_error'&&e.detail?.action==='plan'&&e.detail.message===row.error&&Date.parse(e.at)<=observedAt&&Date.parse(e.at)>=observedAt-60000);
      const receipt=recoveryControl.grantInputContractRepair(run,{requestOrigin,continuationReason,priorRuntime,evidence:{event,observation}});
      if(receipt){await workspace.event('runtime_repair_resume',{repairId:receipt.repairId,sourceRuntime:receipt.sourceRuntime,observationId:receipt.evidence.observationId,maxDecisions:receipt.maxDecisions,originalAdoptionDecisions:receipt.originalAdoptionDecisions,message:'已核对旧版计划来源误拒绝；使用增量契约进行一次有上限的纠正，原任务、失败计数与证据保留。'});break;}
    }
  }
  const skillRuntime=await require('./skill-runtime.cjs').createSkillRuntime({workspace,available:availableSkills,manual:extensions,packages:skillPackages,signal});
  extensions=skillRuntime.items();
  if(requestOrigin==='evaluation'&&continuationReason==='user'&&runtimeContinuation?.kind==='assisted_resume'){
    const context={kind:'assisted_resume',deviceState:'new_environment'};
    for(const key of ['sourceTrialFingerprint','sourceRuntimeFingerprint'])if(typeof runtimeContinuation[key]==='string'&&/^[a-f0-9]{64}$/.test(runtimeContinuation[key]))context[key]=runtimeContinuation[key];
    if(typeof runtimeContinuation.sourceExecutionId==='string'&&/^[a-f0-9-]{36}$/.test(runtimeContinuation.sourceExecutionId))context.sourceExecutionId=runtimeContinuation.sourceExecutionId;
    for(const key of ['priorElapsedMs','priorModelRequests'])if(Number.isSafeInteger(runtimeContinuation[key])&&runtimeContinuation[key]>=0)context[key]=runtimeContinuation[key];
    run.runtimeContinuation=context;
    await workspace.event('evaluation_resume',context);
  }
  run.interventionTracking ||= {version:1,complete:priorExecutionId!==run.executionId&&!run.events.length&&!run.observationIndex?.length&&['user','evaluation','scheduled','assistant'].includes(requestOrigin),startedAt:new Date().toISOString(),origin:requestOrigin};
  let userContinuationEvent;
  if(continuationReason==='user'&&['blocked','paused','failed','partial'].includes(priorRunStatus)&&priorExecutionId===run.executionId){
    await workspace.event('user_continuation',{origin:requestOrigin,executionId:run.executionId,previousStatus:priorRunStatus});
    if(requestOrigin==='user')userContinuationEvent=run.events.at(-1);
  }
  if(continuationReason==='segment')await workspace.event('segment_continue',{origin:'runtime',index:segmentIndex});
  run.autonomousTasks=autonomous;
  run.runtimeIdentity=runtimeIdentity;
  run.runtimeHistory=(run.runtimeHistory||[]).filter(r=>r.runtimeFingerprint!==runtimeIdentity.runtimeFingerprint).concat(runtimeIdentity).slice(-8);
  failureEpisodes.resume(run,{explicit:continuationReason==='user'&&['blocked','paused','failed','partial'].includes(run.status)});
  if(continuationReason==='user'&&['blocked','paused','failed','partial'].includes(run.status)){run.unresolvedFailureStreak=0;require('./loop-recovery.cjs').resume(run);}
  if(continuationReason==='user')recovery.resume(run);
  if(continuationReason==='user'&&run.resultRecovery?.stage==='settled')run.resultRecovery={...run.resultRecovery,stage:'resuming',turns:0};
  const performanceBaseWall=performance.init(run).wallMs;
  const segmentProgressBefore=new Set(run.progressEvidence||[]),segmentReadsBefore=structuredClone(run.readCoverage||[]);
  run.segmentState={index:segmentIndex,reason:continuationReason,startedAt:new Date().toISOString()};
  if(continuationReason==='segment')run.performance.automaticContinuations=(run.performance.automaticContinuations||0)+1;
  // Report only extensions whose resources were successfully prepared.
  run.loadedExtensions=skillRuntime.loaded();
  if(run.loadedExtensions.length)run.progressInputId=run.inputKey;
  const savedProjectMemory=projectMemoryContext!==undefined?projectMemoryContext:task.projectId?await (async()=>{const root=require('./workspace-path.cjs').workspacePath(base,task),path=require('node:path');const saved=await require('./workspace.cjs').json(path.join(root,'memory.json'),{notes:''});let files=[];try{files=(await fs.readdir(path.join(root,'runs'))).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).slice(0,100);}catch(e){if(e.code!=='ENOENT')throw e;}const records=[];for(const name of files){const r=await require('./workspace.cjs').json(path.join(root,'runs',name),null);if(r&&r.taskId!==task.id&&!(saved.hiddenTaskIds||[]).includes(r.taskId))records.push({taskId:r.taskId,goal:r.goal,status:r.status,decisions:r.decisions,steps:r.steps,updatedAt:r.updatedAt});}records.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));return {...saved,records:records.slice(0,10)};})():null;
  const previousStatus=run.status;run.currentIntent=undefined;run.currentOutcome=undefined;
  if(run.delivery?.status==='settled')delete run.delivery;
  const {promptForState}=await import('./prompt.mjs');
  const {validateClarification}=await import('../clarification.mjs');
  const {countMessages,capacity,outputLimit}=await import('../context.mjs');
  const outputPolicy=require('./output-budget.cjs').createOutputBudget(model,outputLimit(model),run.outputBudget);
  const saveOutputBudget=async()=>{run.outputBudget=outputPolicy.snapshot();await workspace.save();};
  // The provider adapter budgets the actual selected wire schema after every
  // fallback. Do not subtract a different, fixed copy of the old tool here.
  const protocolTokens=0;
  const notify=async()=>{await require('./result-preview.cjs').refresh(workspace);await require('./problem-state.cjs').refresh(workspace);run.freshAcceptanceIds=[];for(const c of acceptanceChecks.criteria(run))if(c.check){try{await require('./evidence.cjs').assertFresh(workspace,c.check);run.freshAcceptanceIds.push(c.id);}catch{}}require('./input-coverage.cjs').refresh(run);require('./task-continuation.cjs').update(run);run.performance.wallMs=performanceBaseWall+Math.max(0,now()-startedAt);await workspace.save();await onRun?.(publicRun(run));};
  const restoreCandidate=async({resume=false}={})=>{
    const result=await require('./candidate-runtime.cjs').restore(workspace,{resume,signal});
    if(result.actualChanges?.length){displayRevision=-1;androidDesign=undefined;latestBuild=undefined;await notify();return true;}
    return false;
  };
  const settleResult=async error=>{
    if(error.code==='AGENT_PROTOCOL')await workspace.event('protocol_exhausted',{code:error.code,reason:error.reason,diagnostics:error.diagnostics,message:error.message});
    if(['MODEL_NO_ACTION_BUDGET','AGENT_NO_PROGRESS','AGENT_REPAIR_EXHAUSTED'].includes(error.code)){
      await workspace.event(error.code==='MODEL_NO_ACTION_BUDGET'?'no_action_budget':'recovery_exhausted',{code:error.code,message:error.message,episodeId:error.episodeId});
    }
    onStatus?.('正在整理已有成果与未完成项…');
    await require('./result-sources.cjs').files(workspace,{signal});
    const complete=await require('./completion-policy.cjs').completeFromEvidence(workspace,{images,signal});
    if(complete){await notify();return {...complete,agentRun:publicRun(run)};}
    const result=await settlement.settle(workspace,error,{signal,summarize:summarizeResult?async(state,summarySignal)=>{let requests=0,failed=false;const started=now();try{return await summarizeResult(state,summarySignal,record=>{Object.assign(record,{appVersion:runtimeIdentity.appVersion,runtimeFingerprint:runtimeIdentity.runtimeFingerprint});requests++;performance.request(run,record);});}catch(error){failed=true;throw error;}finally{if(!requests)performance.request(run,{durationMs:now()-started,action:'result_summary',outcome:failed?'failed':'completed'});}}:undefined});
    if(!result)return null;
    await notify();return {...result,agentRun:publicRun(run)};
  };
  const beginResultRecovery=async(error,{force=false}={})=>{
    if(run.resultRecovery?.stage==='remaining'||(!force&&!run.artifacts.length&&!run.events.some(e=>['write_file','edit_file','acceptance_verified'].includes(e.type)))||!settlement.begin(run,error))return false;
    await workspace.event('result_recovery',{code:error.code||'RECOVERY_EXHAUSTED',message:'当前方法恢复未成功，继续处理未受影响的工作，随后整理成果交付'});
    await notify();return true;
  };
  const optionalCatalog=async(service,name)=>{
    if(!service)return [];
    try{const items=await service.catalog();if(run.optionalContextFailures?.[name]){delete run.optionalContextFailures[name];await workspace.event('optional_context_recovered',{name,message:'可选应用上下文已恢复，继续原任务'});}return items;}catch(error){
      if(error.code==='ERR_ASSERTION'||signal.aborted)throw error;
      run.optionalContextFailures ||= {};
      if(!run.optionalContextFailures[name]){
        run.optionalContextFailures[name]={code:error.code||'OPTIONAL_CONTEXT_UNAVAILABLE',message:String(error.message||error).slice(0,1000)};
        await workspace.event('optional_context_failed',{name,...run.optionalContextFailures[name],message:'可选应用上下文暂不可用，继续处理其他要求'});
        await beginResultRecovery(Object.assign(Error(name+'的工具列表暂不可用。'),{code:'OPTIONAL_CONTEXT_UNAVAILABLE'}),{force:true});
      }
      return [];
    }
  };
  const visualFailureScope=()=>[run.inputKey,runtimeIdentity.runtimeFingerprint,runtimeIdentity.modelConfigFingerprint].join(':');
  const noteVisualFailures=async failures=>{
    for(const failure of failures||[]){
      run.visualAnalysisFailures ||= [];
      const prior=run.visualAnalysisFailures.find(f=>f.sourceHash===failure.sourceHash&&f.recoveryScope===visualFailureScope());
      if(!prior||prior.at!==failure.at||prior.attempts!==failure.attempts){if(prior)Object.assign(prior,failure);else run.visualAnalysisFailures.push({...failure,recoveryScope:visualFailureScope()});await workspace.event('visual_analysis_failed',failure);}
    }
  };
  const recordVisualQuality=async(reviews,observedImages)=>{
    for(const observed of observedImages){const receipt=run.visualObservations.find(o=>o.eventId===observed.eventId);if(!receipt)continue;
      for(const review of reviews||[])if(review.sourceHash===require('../model-routing.cjs').digest(observed.message.content)){run.visualAnalysisFailures=(run.visualAnalysisFailures||[]).filter(f=>f.sourceHash!==review.sourceHash||f.recoveryScope!==visualFailureScope());await require('./visual-quality.cjs').record(workspace,receipt,review);}
    }
  };
  let imageMessages=[],imageMaterialsKey;
  // Imported attachments do not require the native screenshot observer.
  let attachmentImagesEnabled=run.observationCapabilities.imageTransport!==false;
  let history=(task.messages||[{role:'user',content:task.request}]).slice(-10).map(m=>({role:m.role,content:m.content,clarification:m.clarification,answers:m.clarificationAnswers,materials:m.materials?.map(f=>f.name)}));
  run.observations = (run.observations || []).filter(o=>o.action?.action!=='protocol_error');
  run.readCoverage ||= [];
  run.workingMemory ||= '';
  run.visualObservations ||= [];
  const visual=require('./visual-observation.cjs');
  const visualWorkflow=require('./visual-workflow.cjs');
  const evidenceNavigation=require('./evidence-navigation.cjs');
  let verificationEvidence;
  if(run.observationCapabilities.images&&!require('./input-coverage.cjs').pending(run).length)await visualWorkflow.replay(workspace,{userContinuationEvent,allowAssisted:requestOrigin==='evaluation'});
  run.fileReadMemory ||= [];
  // Persist the review cadence across checkpoints, pauses and app restarts.
  const searchSources=new Map();let searchCalls=0;
  const progressTools=['knowledge','web_search','mcp','amap','feishu','list_files','read_file','batch_read','view_image','browser','write_file','edit_file','edit_spreadsheet','request_directory','run_command','build_android','android_device','read_material','read_source','inspect_source','search_materials','read_history','read_execution'];
  if (!Number.isInteger(run.actionsSincePlan)) {
    const lastPlan=run.events.findLastIndex(e=>e.type==='plan');
    run.actionsSincePlan=run.steps.length ? run.events.slice(lastPlan+1).filter(e=>progressTools.includes(e.type)||e.type==='tool_error').length : 0;
  }
  const workingContext=require('./working-context.cjs');
  const readReceipts=require('./read-receipts.cjs');
  const observationReceipt=o=>({...workingContext.receipt(o),tokens:countMessages([{role:'tool',content:JSON.stringify(o.response)}])});
  const sourceMemory=require('./source-memory.cjs');
  run.observationIndex ||= [];
  // Upgrade legacy in-memory history only after archiving every original.
  for(const observation of run.observations){
    if(!observation.observationId&&observation.response.result?.truncated){
      const event=run.events.find(e=>e.id===observation.response.eventId);
      if(event?.detail.result)observation.response={...observation.response,result:event.detail.result};
    }
    observation.observationId ||= await workspace.archiveObservation(observation.action,observation.response);
    const receipt=run.observationIndex.find(r=>r.id===observation.observationId);
    if(!receipt)run.observationIndex.push(observationReceipt(observation));
    else if(!Number.isFinite(receipt.tokens))receipt.tokens=observationReceipt(observation).tokens;
  }
  run.checkpointObservationCount ||= 0;
  run.observations=run.observations.slice(-workingContext.RECENT_COUNT).map(o=>({...o,response:workingContext.toolPreview(o.response)}));
  await sourceMemory.hydrate(workspace);
  const attempts=new Map(),failures=new Map(),actionReceipts=new Map();
  const readActions=new Set(['read_material','read_source','inspect_source','read_file','search_materials','read_execution','read_history']);
  await readReceipts.hydrate(workspace);
  const readAttempts=new Map(run.readAttempts||[]),readResults=readReceipts.restore(run), durableProgress=new Set();
  for(const observation of run.observations){
    if(!readActions.has(observation.action.action)||observation.response.error||observation.response.notExecuted)continue;
    const identity=await readIdentity(workspace,observation.action),result=observation.response.result;
    if(identity.version&&result?.sha256!==identity.version)continue;
    readResults.set(JSON.stringify(stable(identity)),{sourceObservationId:observation.observationId,next:result?.next,total:result?.total,result});
    readReceipts.remember(run,JSON.stringify(stable(identity)),{...result,sourceObservationId:observation.observationId});
  }
  const sourceRevisits=new Map();
  async function repeatedSource(action,identity,presented){
    // A committed restoration needs one actual read in its own generation;
    // cached identical bytes are context, not a post-restoration receipt.
    if(identity.restorationTransaction&&!(readAttempts.get(JSON.stringify(stable(identity)))>0))return;
    const source=await sourceMemory.readSource(workspace,action,identity);
    if(!source||!sourceMemory.covered(presented,source))return;
    const key=JSON.stringify([source.path,source.sha256]),count=(sourceRevisits.get(key)||0)+1;
    sourceRevisits.set(key,count);return count>=(recovery.active(run)?2:3)?source:undefined;
  }

  let readRecovery;
  const advanceReads=value=>{const key=createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');if(!durableProgress.has(key)){durableProgress.add(key);readRecovery=undefined;}};
  let unplannedReads=0, batchProgress=false, turns=0;
  const progressSeen=new Set();
  const markProgress=value=>{
    const key=createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
    if(!progressSeen.has(key)){progressSeen.add(key);batchProgress=true;}
  };
  const budgetPause=async(reason)=>{
    const elapsedMinutes=Math.floor((now()-startedAt)/60000);
    const message=reason==='time'?`本次连续执行已达到时长预算（${elapsedMinutes} 分钟），已暂停。`:`本次连续执行已达到决策轮数预算（${turns} 轮），已暂停。`;
    run.status='paused';
    await workspace.event('execution_budget',{message,reason,turns,elapsedMinutes,maxSteps,maxDurationMs});await notify();
    const progress=(run.progressEvidence||[]).filter(key=>!segmentProgressBefore.has(key)).length+require('./segment-progress.cjs').newCoverage(segmentReadsBefore,run.readCoverage);
    const unknown=recoveryControl.unknown(run);
    const safe=run.mode==='task'&&progress>0&&!unknown&&!signal.aborted;
    const stopReason=unknown?'unknown_result':!safe?'no_verified_progress':finalizeOnBudget?'total_budget':'segment_budget';
    run.segmentState={...run.segmentState,yieldedAt:new Date().toISOString(),progress,safe,stopReason};
    await workspace.save();
    if(requestOrigin!=='evaluation'&&run.mode==='task'&&(!safe||finalizeOnBudget)&&!unknown){const result=await settleResult(Object.assign(Error(message+' '+(stopReason==='total_budget'?'本次已到连续执行的最后预算片段，不再自动续跑。':stopReason==='no_verified_progress'?'本片段缺少新的可核对进展，已停止自动续跑。':'存在结果未知的操作，须先核对，不能自动重放。')),{code:'EXECUTION_BUDGET'}));if(result)return result;}
    return {content:message+'任务尚未完成，文件和计划已保存，可点击继续任务。',agentRun:publicRun(run),...(safe?{continuation:{safe:true,reason:'segment_budget',progress}}:{})};
  };
  const record=async(action,response,readKey)=>{
    // Preserve action/result pairs, including across pause and restart.
    const safeAction={...action};
    if(safeAction.content)safeAction.content='[内容已写入项目文件]';
    response={...response,arguments:safeAction};
    const observationId=await workspace.archiveObservation(safeAction,response);
    if(readKey&&!response.error&&!response.notExecuted&&!response.result?.notExecuted)readReceipts.remember(run,readKey,{...response.result,sourceObservationId:observationId});
    // Cache the original result before any UI/context preview truncates it.
    if(action.action==='read_file'&&!response.error&&!response.notExecuted)sourceMemory.remember(run,response.result,observationId);
    if(action.action==='read_execution'&&action.id&&!response.error&&!response.notExecuted){
      const source=await sourceMemory.archivedSource(workspace,action.id);
      if(source)await sourceMemory.rememberCurrent(workspace,source,source.observationId);
    }
    const observation={action:safeAction,response,observationId};
    run.observationIndex.push(observationReceipt(observation));
    const responsePreview=workingContext.toolPreview(action.action==='batch_read'?{...response,arguments:undefined}:response);
    run.observations.push({...observation,response:responsePreview});
    const observed=responsePreview.result;
    // Keep complete short files available across checkpoints. Receipts alone do
    // not contain the facts needed to decide the next action.
    if(action.action==='read_file' && observed?.next===null && observed.offset===0 && !observed.truncated && typeof observed.text==='string' && observed.text.length<=4000 && observed.sha256){
      const path=normalizeProjectPath(action.path);
      run.fileReadMemory=run.fileReadMemory.filter(r=>r.path!==path).concat({path,sha256:observed.sha256,text:observed.text,total:observed.total,observationId});
      while(run.fileReadMemory.length>6 || run.fileReadMemory.reduce((n,r)=>n+r.text.length,0)>12000)run.fileReadMemory.shift();
    }
    if(['read_material','read_source','inspect_source','read_file'].includes(action.action)&&observed&&observed.kind!=='json_search'){
      const receipt={id:observed.id||action.id,path:action.action==='read_file'&&observed.path?normalizeProjectPath(observed.path):observed.path,sha256:observed.sha256,name:observed.name,action:action.action,entry:action.entry,offset:observed.offset,end:Number.isInteger(observed.offset)?observed.offset+(observed.text?.length||0):undefined,total:observed.total,next:observed.next,pointer:action.pointer,kind:observed.kind};
      if(!run.readCoverage.some(r=>JSON.stringify(r)===JSON.stringify(receipt)))run.readCoverage.push(receipt);
    }
    run.observations=run.observations.slice(-workingContext.RECENT_COUNT);
    run.readAttempts=[...readAttempts].slice(-256);
    await workspace.save();
    return observationId;
  };
  async function recoverLoop(detail){
    const state=require('./loop-recovery.cjs').begin(run,{...detail,navigation:verificationEvidence});
    recovery.begin(run,'AGENT_LOOP',Math.min(3,state.attempt+1));
    const message=detail.kind==='no_progress'?'本批未产生有效进展，正在自动聚焦缺口并调整执行方式':'已阻止重复动作，正在复用已有结果并自动调整下一步';
    await workspace.event('loop_recovery',{...detail.location,kind:state.kind,attempt:state.attempt,message});
    await notify();onStatus?.(message);
  }
  let noActionFailures=0;
  let latestBuild=await workspace.findEvent(e=>e.type==='build_android');
  if(run.runtimeContinuation?.kind==='assisted_resume'&&latestBuild)await require('./delivery-milestones.cjs').registerBuild(workspace,latestBuild);
  let displayRevision=-1,androidDisplay,androidDesign;
  let invalid=0, protocolInvalid=0, intent=scheduledMessage?'chat':continuationReason==='segment'&&run.mode==='task'?'task':undefined, protocolRecovery;
  if(scheduledMessage){run.mode='chat';await workspace.event('delivery_route',{kind:'message',basis:'explicit_scheduled_reminder'});}
  if(intent){run.currentIntent=intent;run.status='running';}
  function synchronizeExecution(){
    latestBuild=undefined;androidDesign=undefined;androidDisplay=undefined;displayRevision=-1;verificationEvidence=undefined;
    attempts.clear();failures.clear();actionReceipts.clear();readAttempts.clear();readResults.clear();sourceRevisits.clear();durableProgress.clear();progressSeen.clear();searchSources.clear();
    readRecovery=undefined;unplannedReads=0;batchProgress=false;searchCalls=0;invalid=0;protocolInvalid=0;protocolRecovery=undefined;noActionFailures=0;
    performance.init(run);
  }
  async function acceptSteering() {
    const messages=await getSteering();
    if(!messages.length)return false;
    const oldInputId=run.inputKey,oldExecutionId=run.executionId;
    const next=messages.findLast(m=>m.materials?.length||!require('./input-turn.cjs').continuationOnly(m.content))||messages.at(-1);
    require('./request-scope.cjs').suspendRecovery(run,next);
    const known=new Set((task.messages||[]).map(m=>m.id).filter(Boolean));
    task.messages=[...(task.messages||[{role:'user',content:task.request}]),...messages.filter(m=>!m.id||!known.has(m.id))];
    await workspace.receiveMaterials(messages.flatMap(m=>m.materials||[]));
    require('./execution-rounds.cjs').beginRound(run,task,publicRun,{inputOverride:next});
    run.acceptedInputIds=[...new Set([...(run.acceptedInputIds||[]),...messages.map(m=>m.id).filter(Boolean)])].slice(-128);
    run.currentRequest=next.content;
    require('./input-coverage.cjs').receive(run,task,messages);
    require('./input-turn.cjs').begin(run);
    require('./html-validation.cjs').configure(run,task);
    imageMaterialsKey=undefined;
    history=task.messages.slice(-10).map(m=>({role:m.role,content:m.content,clarification:m.clarification,answers:m.clarificationAnswers,materials:m.materials?.map(f=>f.name)}));
    if(oldExecutionId!==run.executionId)synchronizeExecution();
    await skillRuntime.newInput({newExecution:oldExecutionId!==run.executionId});extensions=skillRuntime.items();
    run.requestScope={...run.requestScope,inputId:run.inputKey,previousInputId:oldInputId};
    // Re-route the latest user intent before further side effects.
    scheduledMessage=require('../scheduled-message.cjs').reminderDelivery(task);
    intent=scheduledMessage?'chat':undefined;
    if(next.materials?.length||!require('./input-turn.cjs').continuationOnly(next.content))readRecovery=undefined;
    await workspace.event('steering',{origin:requestOrigin,inputIds:messages.map(m=>m.id),materialCount:messages.reduce((n,m)=>n+(m.materials?.length||0),0),message:`已接收 ${messages.length} 条补充指令，将据此调整下一步`});
    try{await onSteeringAccepted?.(messages.map(m=>m.id),run.inputKey);}catch(error){if(error.code==='ERR_ASSERTION')throw error;await workspace.event('steering_ack_pending',{inputIds:messages.map(m=>m.id),message:'补充内容已进入执行器，界面接收状态暂未同步；不重放操作'});}
    await notify();return true;
  }

  if (!run.steps.length) run.status='understanding';
  if(run.loadedExtensions.length) {
    const message='本轮已加载：'+run.loadedExtensions.map(e=>(e.kind==='skill'?'技能 · ':'专家 · ')+e.name).join('、');
    await workspace.event('extensions_loaded',{message});
    onStatus?.(message);
  }
  await notify();
  try {
    await restoreCandidate({resume:true});
    if((await require('./visual-quality.cjs').reconcileStandalone(workspace)).changed)await notify();
    taskLoop: for(let turn=0;turn<maxSteps;turn++) {
      if(signal.aborted)throw Error('已停止执行');
      if(now()-startedAt>=maxDurationMs)return await budgetPause('time');
      if(turn>0 && turn%batchSize===0) {
        if(!batchProgress){
          await recoverLoop({kind:'no_progress'});
        }else{
          const message=`已保存第 ${turn/batchSize} 批执行进度，正在自动继续任务`;
          await workspace.event('batch_continue',{message,turns:turn});await notify();onStatus?.(message);
        }
        batchProgress=false;
        if(signal.aborted)throw Error('已停止执行');
      }
      turns=turn+1;
      await acceptSteering();
      const pendingInput=require('./request-scope.cjs').pending(run);
      // Routing still consumes the overall time/turn budget. Do not spend the
      // final adoption attempt merely identifying the already pending input.
      const inputContractPermit=(!pendingInput||intent)?recoveryControl.advance(run,{pendingInput}):undefined;
      if(inputContractPermit)await workspace.save();
      await require('./material-input.cjs').prepare(workspace,task,record);
      const adoptingInput=!!pendingInput||require('./input-coverage.cjs').pending(run).length>0||require('./material-input.cjs').pending(run);
      const prioritizeAdoption=!!pendingInput||require('./material-input.cjs').pending(run)||adoptingInput&&!!run.inputTurn?.followup;
      const activeVisualFailure=run.visualAnalysisFailures?.find(f=>f.recoveryScope===visualFailureScope());
      if(!adoptingInput&&activeVisualFailure&&!run.resultRecovery)await beginResultRecovery(Object.assign(Error(activeVisualFailure.message),{code:activeVisualFailure.code}));
      if(run.pendingArtifactUpdates?.length)await require('./result-sources.cjs').files(workspace,{signal});
      // Pair only after the original tool receipt has been archived, so the
      // device result keeps its own event identity and unknown-result guard.
      if(!adoptingInput&&run.observationCapabilities.images&&images){
        const preview=[...(run.visualObservations||[])].reverse().find(o=>o.automaticScreenshot&&!o.delivered&&!o.supersededBy);
        if(preview){const source=await require('./evidence.cjs').lookup(workspace,preview.eventId);if(source)await visualWorkflow.pairScreenshot(workspace,source,images);}
      }
      if(!pendingInput)await require('./repair-value.cjs').prepareVerificationPrerequisite(workspace);
      const repairValue=pendingInput||require('./material-input.cjs').pending(run)?undefined:require('./repair-value.cjs').tick(run);
      const recoveryDecision=recoveryControl.beforeDecision(run,{repair:repairValue,signal,pendingInput,inputContractPermit});
      if(recoveryDecision.action==='refocus'){run.repairValue.redirected=true;await workspace.event('repair_value_refocus',{problemIds:repairValue.problemIds,message:'当前修复尚未形成可核对结果，优先核对来源冲突并验证已有修改，停止生成无关资源'});}
      if(recoveryDecision.action==='settle'){if(await restoreCandidate())continue;const result=await settleResult(Object.assign(Error(recoveryDecision.message),{code:recoveryDecision.code}));if(result)return result;}
      // A file may have changed through run_command or another execution. Never
      // inject a stale cached value as current state.
      const currentFileMemory=[];
      for(const cached of run.fileReadMemory){
        try{if((await readIdentity(workspace,{action:'read_file',path:cached.path})).version===cached.sha256)currentFileMemory.push(cached);}catch{}
      }
      run.fileReadMemory=currentFileMemory;
      const currentSources=[];
      for(const cached of run.sourceFragments||[]){
        try{if((await readIdentity(workspace,{action:'read_file',path:cached.path})).version===cached.sha256)currentSources.push(cached);}catch{}
      }
      run.sourceFragments=currentSources;
      if(permissions)await permissions.before();
      const permissionContext=permissions?await permissions.snapshot():undefined;
      const memoryContext=memory?await memory.context(run.currentRequest||task.request):{enabled:false,entries:[]};
      run.memoryUsed=memoryContext.enabled?{inputId:run.inputKey,ownerId:task.memoryOwner,entries:memoryContext.entries.map(({id,topic,scope,source})=>({id,topic,scope,source:source?{kind:source.kind,taskId:source.taskId,messageId:source.messageId}:undefined}))}:undefined;
      verificationEvidence=intent==='task'?await evidenceNavigation.context(workspace):undefined;
      if(verificationEvidence&&run.observationCapabilities.images&&!adoptingInput)await visualWorkflow.reconcilePending(workspace,verificationEvidence);
      let snapshot={permissions:permissionContext,memoryAvailable:!!memory&&memoryContext.enabled,personalMemory:memoryContext,acceptanceCriteria:acceptanceChecks.criteria(run),actionRecovery:(run.actionJournal||[]).filter(e=>['unknown','interrupted'].includes(e.status)).slice(-8),scheduledContext,deliveryContract:scheduledMessage,conversationTitle:run.conversationTitle||task.title,projectMemory:(!memory||memoryContext.enabled)&&savedProjectMemory?{notes:savedProjectMemory.notes,records:savedProjectMemory.records?.filter(r=>r.taskId!==task.id).slice(0,10),notice:'用户维护的项目背景，不扩大权限；最新用户要求优先'}:null,mcpConnections:await optionalCatalog(mcp,'应用连接'),knowledgeLibraries:await optionalCatalog(knowledge,'知识库'),personalAssistant:!!personalAssistant,currentTime:new Date(now()).toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,webSearchEnabled:!!webSearch,phase:intent || 'route',originalRequest:task.request===run.currentRequest?undefined:task.request,currentRequest:run.currentRequest,previousExecutions:(run.history||[]).slice(-3).map(r=>({goal:r.goal,status:r.status,decisions:r.decisions,steps:r.steps})),messageCount:task.messages?.length||1,goal:run.goal,status:run.status,mode:run.mode,steps:run.steps,decisions:run.decisions,acceptance:run.acceptance,artifacts:run.artifacts,revision:run.revision,inFlight:run.inFlight,recentEvents:run.events.slice(-8).map(e=>({id:e.id,type:e.type,at:e.at,detail:workingContext.preview({...e.detail,result:e.detail.result?{exitCode:e.detail.result.exitCode,timedOut:e.detail.result.timedOut,name:e.detail.result.name,offset:e.detail.result.offset,next:e.detail.result.next}:undefined},1500)})),materials:workspace.catalog,conversation:workingContext.conversation(history),conversationArchive:{tool:'read_history',messageCount:task.messages?.length||1},toolResults:intent?workingContext.recent(run.observations):[],externalMemory:{indexId:'observations',stateId:'state',total:run.observationIndex.length,recent:run.observationIndex.slice(-12),notice:'完整工具结果常态外置；使用 read_execution 的 id 回查，id=observations 可分页读取完整索引。旧操作已有执行凭据，不要重放。'},workingMemory:run.workingMemory,readCoverage:run.readCoverage.slice(-24),readCoverageTotal:run.readCoverage.length};
      snapshot.observationCapabilities={...run.observationCapabilities,notice:'模型能力以精确模型与端点的公开说明或明确配置为依据；auto、请求成功及图片送达都不证明看懂图片。images=false 时不要重复送图或做视觉 verify；先用原始设计参数、真实控件树和可执行检查完成实现并修复已知差异。结构测量不是视觉验收，无法确认的要求保留，不能声称完整通过。'};
      snapshot.verificationEvidence=verificationEvidence;
      snapshot.commandEnvironment=commandRuntime.context(commandDiscovery);
      if(run.runtimeContinuation)snapshot.runtimeContinuation={...run.runtimeContinuation,notice:'这是修复运行时后的受辅助续跑，保留原始请求、验收与当前工程。旧事件仅证明明确版本的历史，不代表新模拟器已启动或安装。设备状态以当前受管服务为准；仍须修复已知实现差异并重新核验，不能把续段耗时当作从零完成耗时。'};
      snapshot.visualObservations=run.visualObservations.slice(-8).map(({transform,sources,designManifest,uiHierarchy,modelReviews,...o})=>({...o,modelReviews:modelReviews?.map(({observations,uncertainties,summary,...r})=>({...r,summary:summary.slice(0,300),observations:observations.slice(0,6).map(v=>v.slice(0,300)),uncertainties:uncertainties.slice(0,3).map(v=>v.slice(0,300)),preview:true,instruction:'完整视觉观察可通过 detailsEventId 回查；摘要不是验收通过。'})),designManifest:designManifest?{id:designManifest.id,regionCount:designManifest.regions.length}:undefined,uiHierarchy:uiHierarchy?{path:uiHierarchy.path,nodeCount:uiHierarchy.nodeCount,available:uiHierarchy.available}:undefined,sourceCount:sources?.length||0}));
      snapshot.designComparisons=(run.visualComparisons||[]).map(({eventId,path,reference,comparison,designBinding})=>({eventId,path,reference,comparison,designBinding,notice:'这是最近一次对照，不是验收通过；修改实现后重建、截图并成对复核。'}));
      snapshot.designRegionIssues=require('./design-regions.cjs').issues(run).map(({boardId,regionId,region,reason,eventId})=>({boardId,regionId,region,reason,eventId}));
      snapshot.completionReview=run.completionReview;
      snapshot.repairFocus=repairValue;
      snapshot.materialInput=require('./material-input.cjs').context(run);
      snapshot.deliveryValidation=intent!=='chat'?require('./html-validation.cjs').context(run):undefined;
      snapshot.requestContract=intent!=='chat'?require('./request-contract.cjs').context(run):undefined;
      snapshot.requestScope=run.requestScope;
      snapshot.inputCoverage=require('./input-coverage.cjs').context(run);
      const contractRepair=recoveryControl.inputContractRepair(run);if(contractRepair)snapshot.inputContractRepair={repairId:contractRepair.repairId,status:contractRepair.status,decisionsUsed:contractRepair.decisionsUsed,maxDecisions:contractRepair.maxDecisions,instruction:'这是已核对旧版契约错误的一次有限纠正，优先提交mode=amend的新增要求与未完成步骤，不重写旧质量政策或重复读取；不代表任务已完成。'};
      if(!intent&&run.requestScope?.parentInputId)snapshot.taskChangeContext={inputId:run.inputKey,parentExecutionId:run.requestScope.parentExecutionId||run.executionId,currentRelation:run.requestScope.kind,priorGoal:run.goal,pendingAdoption:require('./request-scope.cjs').pending(run)};
      if(intent==='task'&&require('./requirements.cjs').current(run).length>=12)snapshot.planCapacity={perUpdate:12,ledgerLimit:require('./plan.cjs').ledgerLimit,requirements:require('./requirements.cjs').current(run).length,steps:run.steps.length,instruction:'累计计划超过12项时必须用mode=amend每次提交至多12个新增或更新项；未列出的旧要求、步骤、质量契约和证据原样继承，不重写整份账本。'};
      // Visual ledgers only enter the request when the task has a visual
      // dimension; a plain document task should not pay for them every turn.
      const visualDimension=!!(run.visualQuality?.constraints?.length||run.visualQuality?.rejectedAssets?.length||run.visualQuality?.reviewErrors?.length||run.visualObservations?.length||run.visualComparisons?.length||acceptanceChecks.criteria(run).some(c=>c.type==='visual')||run.requestContract?.explicit?.visual||run.androidDesign||run.materialInput?.required);
      snapshot.visualQuality=intent!=='chat'&&visualDimension||run.visualQuality?.constraints?.length?require('./visual-quality.cjs').context(run):undefined;
      snapshot.visualDimension=visualDimension;
      snapshot.candidateRecovery=require('./candidate-runtime.cjs').context(run);snapshot.qualityContract=require('./quality-contract.cjs').context(run);snapshot.nativeFileOperations=require('./native-operation.cjs').context(run);
      snapshot.issues=run.issues||[];snapshot.executionState=run.executionState;
      snapshot.extensionPreparationFailure=run.extensionPreparationFailure;
      snapshot.optionalContextFailures=run.optionalContextFailures;
      if(autonomous)snapshot.autonomy=require('./operational-delivery.cjs').context(run);
      snapshot.currentInput=require('./input-turn.cjs').context(run);
      if(intent==='task'&&snapshot.currentInput?.followup&&!snapshot.currentInput.requirementsRecorded){snapshot.inputInstruction=snapshot.currentInput.instruction+'先读取必要来源并更新 plan；已有计划优先用 mode=amend 只提交本次新增或明确修改的要求和步骤，未列旧项原样继承，明确本次验收后再实现、构建和核验。';}
      snapshot.resultRecovery=settlement.context(run);snapshot.visualAnalysisFailures=run.visualAnalysisFailures||[];
      if(run.loopRecovery?.inputKey!==run.inputKey)require('./recovery-state.cjs').clear(run,'loopRecovery');
      snapshot.loopRecovery=run.loopRecovery;
      snapshot.toolRecovery=run.toolRecovery;snapshot.browserDiagnostics=run.browserDiagnostics;
      snapshot.failureEpisodes=failureEpisodes.context(run);
      snapshot.taskState=require('./task-state.cjs').context(run,task);
      snapshot.repairTargets=require('./validation-recovery.cjs').pending(run);
      snapshot.formatGuidance=require('./format-guidance.cjs').forMaterials(workspace.catalog);
      snapshot.pageChecks=run.events.filter(e=>e.type==='browser').slice(-3).map(e=>({evidenceId:e.id,path:e.detail.result?.path,layoutHealth:e.detail.result?.dom?.layoutHealth,sourceAudit:e.detail.result?.sourceAudit,repairRequired:e.detail.result?.repairRequired}));
      for(const c of snapshot.acceptanceCriteria)if(c.check){try{await require('./evidence.cjs').assertFresh(workspace,c.check);const summary=({status,basis,kind,reason,evidenceId,scope})=>({status,basis,kind,reason,evidenceId,scope});c.check={...summary(c.check),...(c.check.parts?{parts:c.check.parts.map(summary)}:{})};}catch{c.check=undefined;}}
      if(intent==='task'&&latestBuild){const result=latestBuild.detail.result||{};snapshot.androidBuild={eventId:latestBuild.id,revision:latestBuild.detail.revision,current:latestBuild.detail.revision===run.revision,exitCode:result.exitCode,buildArtifacts:result.buildArtifacts,scopes:result.scopes,...require('./android-build.cjs').diagnostics(result),instruction:'优先依据 errors 定位源码并修复；已有明确错误时不要逐页重读整份构建记录。成功构建可用本事件作 command 证据，scopes 绑定实际 APK；buildArtifacts 可直接登记 artifact。仍须核验版本，不必再用 ls/grep 伪造构建证明。'};}
      if(intent==='task'&&latestBuild&&latestBuild.detail.result?.exitCode!==0)snapshot.repairContext=await require('./repair-context.cjs').collect(workspace,latestBuild);
      snapshot.failureMemory=run.events.filter(e=>e.type==='tool_error').slice(-4).map(e=>({eventId:e.id,action:e.detail.action,path:e.detail.path,message:e.detail.message}));
      snapshot.efficiency={batchRead:{maxItems:6,concurrency:3},attachedProgress:true,noActionRetries:3,notice:'优先将独立本地读取合并为 batch_read；计划核对与累计记忆更新可附带 progress，避免单独模型往返。'};
      snapshot.pendingArtifactUpdates=run.pendingArtifactUpdates||[];
      snapshot.knownFileContents=run.fileReadMemory;
      snapshot.sourceContext=intent?sourceMemory.context(run):undefined;
      if(intent==='task'){
        const activeApk=run.artifacts.some(a=>/\.apk$/i.test(a.path));
        const contentOnly=run.requestContract?.kind==='document'&&!run.requestContract.checks?.behavior&&!run.requestContract.checks?.visual;
        const androidTask=activeApk||!contentOnly&&(/android|安卓|apk|模拟器/i.test((run.goal||'')+' '+(run.currentRequest||''))||await fs.access(await resolveFile(workspace.files,'app/src/main/AndroidManifest.xml')).then(()=>true,()=>false));
        if(androidTask){
          if(displayRevision!==run.revision){
            try{androidDisplay=await require('./android-display.cjs').resolve(workspace.files,undefined,run.androidDisplay);}catch(error){androidDisplay={status:'configuration_required',message:error.message};}
            try{androidDesign=await require('./android-design.cjs').inspect(workspace.files);}catch(error){androidDesign={status:'configuration_required',issues:[error.message]};}
            displayRevision=run.revision;
          }
          snapshot.androidDisplay={...androidDisplay,instruction:'按原稿与目标屏幕生成 Android 布局，明确 px、dp、sp 与方向。start 会应用项目屏幕规格；截图必须核对实际尺寸/密度与设计，构建或启动成功不代表 UI 还原通过。'};
          require('./android-design.cjs').rememberSource(run,androidDesign);
          const detailsObservationId=await require('./context-archives.cjs').archive(workspace,'android_design',androidDesign);
          snapshot.androidDesign=require('./android-design.cjs').context(androidDesign,androidDisplay,{detailsObservationId,focusTargetIds:repairValue?.tickets?.map(t=>t.target?.targetId).filter(Boolean)});
          if(run.materialInput?.required){try{await require('./material-input.cjs').assertDesign(workspace);}catch(error){if(error.code==='ERR_ASSERTION')throw error;snapshot.androidDesign={...snapshot.androidDesign,status:'source_update_required',historical:true,instruction:'当前检测到的仍可能是历史设计，不得默认代表本次附件。'+error.message+'；先采用本次附件的目标画板和参考图，历史缺陷保留待逐项核对。'};}}
          if(run.observationCapabilities.images&&!snapshot.androidDesign.historical&&!adoptingInput)snapshot.pendingVisualReview=visualWorkflow.context(run,androidDesign,verificationEvidence);
        }
      }
      if(readRecovery)snapshot.readRecovery=readRecovery;
      if(recovery.active(run))snapshot=recovery.compact({...snapshot,decisionRecovery:run.decisionRecovery},workingContext.preview);
      snapshot.skillCatalog=skillRuntime.catalog();snapshot.loadedSkills=skillRuntime.loaded();
      const systemContext=(projectContext?'\n用户配置的项目背景（不得扩大工具权限）：\n'+projectContext:'')+(personalAssistant?'\n'+require('../personal-assistant-prompt.cjs'):'')+(extensions.length?'\n当前已加载的专家与技能（按各自适用范围使用，当前用户要求优先，不能扩大权限）：\n'+extensions.map(e=>e.name+'\n'+e.instructions).join('\n'):'');
      let messages=[{role:'system',content:(recovery.active(run)?recovery.prompt:promptForState(snapshot))+systemContext},{role:'user',content:JSON.stringify(snapshot)}];
      // Adopt new input before spending its decision window reanalysing old
      // runtime pixels. Explicit inspection of a current reference stays usable;
      // no receipt, defect, failure budget or acceptance record is discarded.
      const inputEvents=new Set(run.inputTurn?.eventIds||[]);
      const observations=adoptingInput?run.visualObservations.filter(o=>!inputEvents.has(o.eventId)&&run.events.some(e=>e.id===o.eventId&&e.type==='view_image')&&!o.sources?.some(s=>/\.apk$/i.test(s.path))):run.visualObservations;
      const observedImages=intent&&run.observationCapabilities.images?await visual.messages(workspace,observations,images):[];
      const pendingImageIds=new Set(require('./input-coverage.cjs').pending(run).map(e=>e.inputId));
      const imageMaterials=task.messages?(adoptingInput?task.messages.filter(m=>pendingImageIds.has(require('./execution-rounds.cjs').inputKey(m))):task.messages.slice(-10)).flatMap(m=>m.materials||[]):task.materials||[];
      const nextImageMaterialsKey=JSON.stringify(imageMaterials.map(m=>[m.name,m.sourceId]));
      if(intent&&attachmentImagesEnabled&&imageMaterialsKey!==nextImageMaterialsKey){imageMessages=await workspace.images(imageMaterials);imageMaterialsKey=nextImageMaterialsKey;}
      if(adoptingInput)snapshot.visualAdoptionPriority={instruction:'先读取并采用本批用户输入与附件，历史运行截图的自动送审暂缓；原缺陷、证据与视觉验收要求仍保留，采用后按当前版本继续核验。'};
      snapshot.visualDeliveryErrors=run.visualObservations.filter(o=>!o.delivered&&o.deliveryError).slice(-2).map(({eventId,path,deliveryError})=>({eventId,path,error:deliveryError}));
      messages=[messages[0],...(intent&&attachmentImagesEnabled?imageMessages:[]),...observedImages.map(o=>o.message),messages[1]];
      const failedSources=new Map((run.visualAnalysisFailures||[]).filter(f=>f.recoveryScope===visualFailureScope()&&(!f.retryable||!Number.isFinite(f.retryAt)||Date.now()<f.retryAt||(f.attempts||0)>=3)).map(f=>[f.sourceHash,f]));
      messages=messages.map(message=>{
        if(!Array.isArray(message.content))return message;
        const failure=failedSources.get(require('../model-routing.cjs').digest(message.content));
        if(!failure)return message;
        return {...message,content:message.content.filter(p=>!['image_url','input_image'].includes(p.type)).map(p=>p.text||'').join('\n')+'\n视觉观察未取得有效结果，不是验收证据：'+JSON.stringify(failure)};
      });
      let preparedVisualReviews=[];
      if(prepareModelMessages){
        const prepared=await prepareModelMessages(messages,async stats=>{run.contextUsage=stats;await notify();},record=>{Object.assign(record,{appVersion:runtimeIdentity.appVersion,runtimeFingerprint:runtimeIdentity.runtimeFingerprint,promptSchemaVersion:runtimeIdentity.promptSchemaVersion,toolSchemaVersion:runtimeIdentity.toolSchemaVersion});performance.request(run,record);});
        messages=prepared.messages;preparedVisualReviews=prepared.reviews||[];await noteVisualFailures(prepared.failures);await recordVisualQuality(preparedVisualReviews,observedImages);
      }
      const pendingObservations=run.observationIndex.slice(run.checkpointObservationCount).filter(row=>!row.contextOnly);
      // A checkpoint must not preempt verified delivery merely because the
      // normal prompt was restored after recovery.
      const planComplete=intent==='task'&&run.steps.length&&run.steps.every(s=>s.status==='done');
      // Summarize compressible observations, not fixed instructions or protected
      // source ranges that a checkpoint cannot remove. Otherwise a larger tool
      // schema makes every few tiny reads demand another bookkeeping call.
      const observationTokens=countMessages([{role:'user',content:JSON.stringify(snapshot.toolResults||[])}]);
      const observationThreshold=workingContext.checkpointThreshold(capacity(model));
      const observationPressure=observationTokens>observationThreshold;
      // Archive volume also bounds unsummarized work after previews are trimmed,
      // including legacy histories imported on restart. It is not wire usage.
      const archiveTokens=pendingObservations.reduce((total,row)=>total+(Number.isFinite(row.tokens)?row.tokens:0),0);
      const archiveUnknown=pendingObservations.filter(row=>!Number.isFinite(row.tokens)).length;
      snapshot.externalMemory.pendingArchiveEstimate={tokens:archiveTokens,unknownObservations:archiveUnknown,notice:'启发式估算；旧记录缺少体量元数据时不按完整统计处理，已有预览估计也可能低估。计数节奏和实际容量检查仍生效。'};
      const archivePressure=archiveTokens>observationThreshold;
      const capacityPressure=observationTokens>2000&&countMessages(messages)+protocolTokens>capacity(model)-10000;
      const needsCheckpoint=intent && !prioritizeAdoption && !planComplete && pendingObservations.length>0 && (pendingObservations.length>=24 || pendingObservations.filter(o=>['read_material','read_source','inspect_source'].includes(o.action)).length>=12 || pendingObservations.length>=4 && (observationPressure||capacityPressure||archivePressure));
      if(needsCheckpoint) {
        run.checkpointPolicy={reason:capacityPressure?'capacity':observationPressure?'observations':archivePressure?'archive_volume':pendingObservations.length>=24?'observation_count':'material_count',observationTokens,archiveTokens,archiveUnknown,observationThreshold,window:capacity(model)};
        snapshot.requiredAction='checkpoint';
        snapshot.instruction='先保存20–10000字符的累计摘要（建议80–800字符），融合旧 workingMemory，保留需求结论、真实来源记录 id、未解决问题与下一步。单独 checkpoint 使用 text；优先在下一实际动作附带 progress.memory 一并完成，避免独立摘要调用。摘要信息不足时可先用 read_execution/read_history 回查；不得重复执行旧工具，也不得只记录“已读取”。';
      } else if(intent==='task' && run.steps.length && run.steps.every(s=>s.status==='done')) {
        snapshot.requiredAction='finish_review';
        snapshot.instruction=(run.pendingArtifactUpdates?.length?'当前成果登记过期，必须先对 pendingArtifactUpdates 中每个路径执行 artifact。重新登记全部完成后才可 verify 和 finish。':'')+'全部步骤已标记 done，进入成果核验与交付阶段。避免无目的重复探索；发现缺口可以针对性调查。利用 artifacts 和 completionEvidence 核对验收；证据充分时立即 finish。缺少验证则针对要求执行观察或检查，缺少成果登记则 artifact；发现实际缺口应继续针对性读取、修复，将相关计划状态如实更新。finish 必须提供 review，未验证项或已知问题不能隐去。无法满足验收则 blocked。';
        snapshot.completionEvidence=[];
        for(const e of run.events.slice(-80)){if(!['run_command','build_android','browser','view_image'].includes(e.type))continue;try{await require('./evidence.cjs').event(workspace,e.id);snapshot.completionEvidence.push({id:e.id,type:e.type,command:e.detail.command,scope:e.detail.result?.scope,revision:e.detail.revision});}catch{}}
        snapshot.completionEvidence=snapshot.completionEvidence.slice(-12);
      } else if(intent==='task' && run.steps.length && run.actionsSincePlan>=6) {
        snapshot.requiredAction='plan_update';
        snapshot.instruction='已执行多次工具操作，请根据实际结果核对步骤；优先在下一实际动作附带 progress.steps，不必单独调用 plan。已开始未验收的步骤为 running，满足验收才为 done，受阻为 blocked；不得凭一次写入成功认定整步完成。尚无状态变化也要如实核对。';
      } else if(intent==='task' && !run.steps.length && unplannedReads>=8) {
        snapshot.requiredAction='plan_or_clarify';
        snapshot.instruction='已有初步读取结果，请形成可调整计划，或澄清关键缺口；无法继续则 blocked。';
      }
      snapshot.currentInput=require('./input-turn.cjs').context(run);
      if(intent==='task'&&snapshot.currentInput?.followup&&!snapshot.currentInput.requirementsRecorded){snapshot.inputInstruction=snapshot.currentInput.instruction+'先读取必要来源并更新 plan；已有计划优先用 mode=amend 只提交本次新增或明确修改的要求和步骤，未列旧项原样继承，明确本次验收后再实现、构建和核验。';}
      snapshot.resultRecovery=settlement.context(run);
      if(snapshot.resultRecovery){snapshot.requiredAction='complete_remaining';snapshot.instruction=snapshot.resultRecovery.instruction;}
      if(intent==='task'&&prioritizeAdoption){snapshot.requiredAction='adopt_input';snapshot.instruction='优先采用本批每条实质输入：读取缺少的来源，已有计划优先提交 plan(mode=amend)：requirements/steps 只列本次新增或明确修改项，旧要求、质量政策和步骤映射由执行器继承；inputUse 分别关联本次新增或更新的要求。materialUse 只列 materialInput.materials 本批ID，不混入历史目录；旧要求和证据仍保留。计划全部验证成功前不实现、构建或核验旧步骤。可在本次 plan 附 progress.memory 保存累计结论；历史修复与视觉核验在采用后继续。';}
      snapshot=require('./model-capabilities.cjs').projectVisualConstraint(snapshot);
      if(protocolRecovery)snapshot.protocolRecovery={...protocolRecovery,allowedActions:allowedActions(snapshot),instruction:protocolRecovery.reason==='invalid_parameter'?'上次返回未执行。'+parameterHint(protocolRecovery):'上次返回未执行。请修正格式，仅提交一个 ailo_action，arguments 为含字符串 action 的对象；action 只能从 allowedActions 选择。不要返回 protocol_error、工具定义或动作数组。'};
      messages[messages.length-1].content=JSON.stringify(snapshot);
      if(!recovery.active(run))messages[0]={role:'system',content:promptForState(snapshot)+systemContext};
      // Omitted raw observations remain addressable through the external index.
      const available=capacity(model)-countMessages(messages)-protocolTokens-128;
      if(available<1024)throw Error('当前需求、计划或技能超过模型容量，请精简输入或选择更大容量模型。材料正文已按需读取，不会整体发送。');
      onStatus?.(needsCheckpoint?'正在保存需求结论与读取进度…':run.mode==='task'?'正在推进任务，检查下一步…':'正在理解需求与材料…');
      let action=null;
      if(intent==='task'){
        // Every mandatory requirement already has current evidence: finish from
        // the runtime's own ledger instead of spending a model request on it.
        const complete=await require('./completion-policy.cjs').completeFromEvidence(workspace,{images,signal});
        if(complete){await notify();return {...complete,agentRun:publicRun(run)};}
        action=await require('./completion-policy.cjs').automaticDelivery(workspace);
      }
      let oversizedArguments=false, emptyResponse=false, outputReason='action', outputFailures=0, argumentFailures=0;
      // Separate failure classes: earlier timeouts must not exhaust truncation recovery.
      for(let outputAttempt=0;!action&&outputAttempt<8;outputAttempt++) {
        signal.throwIfAborted();
        if(now()-startedAt>=maxDurationMs)return await budgetPause('time');
        const decisionSnapshot=recovery.active(run)?recovery.compact({...snapshot,decisionRecovery:run.decisionRecovery},workingContext.preview):snapshot;
        const retryMessages=outputAttempt?[...messages.slice(0,-1),{role:'user',content:JSON.stringify({...decisionSnapshot,recovery:emptyResponse?'上一轮在思考阶段或空响应中未产出动作，未执行任何工具。请只选择一个最小的下一步，优先复用已有观察，不重新分析整个任务。请按 responseContract 返回当前阶段允许的一个完整动作；不要只返回思考数据。':oversizedArguments?'上一轮工具参数超过250000字符，整条动作未执行。请返回一个完整的小动作，每次只写一个小文件；write_file.content最多200000字符、run_command.command最多8000字符，不要在命令中嵌入整个工程，不要续接残缺 JSON。':outputReason==='reasoning'?'上一轮在思考阶段耗尽输出额度，未产生正文或工具动作。请收敛分析，仅决定当前下一步，并按 responseContract 返回一个完整动作；不要尝试一次解决整个任务。':'上一轮动作因输出额度耗尽被截断，未执行任何动作。请重新返回一个完整且更小的动作，不要续接残缺 JSON。一次只处理一个小文件或一个步骤；若单文件过大，先拆分模块。摘要与计划应简洁。'})}]:[...messages];
        if(recovery.active(run))retryMessages[0]={role:'system',content:recovery.prompt+systemContext};
        const remaining=capacity(model)-countMessages(retryMessages)-protocolTokens-128;
        // Checkpoints need a concise summary, not the previous file-generation
        // budget. Retain bounded escalation if reasoning/output is truncated.
        const budgetStage=!intent?'route':needsCheckpoint?'summary':snapshot.requiredAction==='plan_update'?'review':'action';
        const actualControls=reasoningConfig===undefined?undefined:require('../reasoning.cjs').budgetControls(model,{reasoning:reasoningConfig,stage:require('../reasoning.cjs').decisionStage(decisionSnapshot),recovery:!!decisionSnapshot.decisionRecovery,recoveryStage:decisionSnapshot.decisionRecovery?.stage});
        const budget=recovery.budget(outputPolicy.budget(remaining,budgetStage,actualControls),remaining,outputLimit(model),decisionSnapshot.decisionRecovery);
        if(budget<256)throw Error('剩余上下文不足以生成完整动作；已保留任务状态，请调整模型容量或精简扩展。');
        let requestResponse;
        try {
          let observedRequests=0,response,requestError;const requestStarted=now();
          try{response=await ask(retryMessages,budget,async stats=>{run.contextUsage=stats;await notify();},record=>{Object.assign(record,{appVersion:runtimeIdentity.appVersion,runtimeFingerprint:runtimeIdentity.runtimeFingerprint,promptSchemaVersion:runtimeIdentity.promptSchemaVersion,toolSchemaVersion:runtimeIdentity.toolSchemaVersion});observedRequests++;performance.request(run,record);});}
          catch(error){requestError=require('../network-error.cjs').networkError(error);throw requestError;}
          finally{if(!observedRequests){let decoded;try{decoded=response&&decodeAction(response);}catch{}performance.request(run,{durationMs:now()-requestStarted,action:decoded?.action,outcome:requestError?'failed':'completed',errorCode:requestError?.code,...requestError?.diagnostics,providerUsage:response?.providerUsage||requestError?.providerUsage});}}
          await noteVisualFailures(response.visualFailures);
          response={...response,visualReviews:[...preparedVisualReviews,...response.visualReviews||[]]};
          requestResponse=response;
          if(response.visualReviews?.length){
            await recordVisualQuality(response.visualReviews,observedImages);
            const reviewEvent=await workspace.event('visual_analysis',{message:'已收到视觉模型观察，仍须按原要求核验',reviews:response.visualReviews});
            for(const observed of observedImages){const receipt=run.visualObservations.find(o=>o.eventId===observed.eventId);if(receipt)receipt.modelReviews=response.visualReviews.filter(review=>review.sourceHash===require('../model-routing.cjs').digest(observed.message.content)).map(review=>({...structuredClone(review),detailsEventId:reviewEvent?.id||run.events.at(-1)?.id}));}
          }
          for(const route of response.modelRoutes||[])await workspace.event('model_route',route);
          const parameterNormalizations=[];action=decodeAction(response,{nativeFileOperations:snapshot.nativeFileOperations,boundReadPages:true,boundActionContract:true,steps:run.steps,onNormalization:item=>parameterNormalizations.push(item),acceptanceCriteria:snapshot.acceptanceCriteria,resolveEvidenceId:id=>require('./evidence.cjs').resolveId(run,id)});
          delete run.waitingError;
          for(const item of parameterNormalizations)await workspace.event('protocol_normalized',{...item,message:item.reason==='page_limit_capped'?'只读分页长度已适配为 '+item.normalizedValue+' 字符，后续内容按 next 继续读取':'只读分页的空长度已改用工具默认值'});
          if(!recovery.active(run))noActionFailures=0;
          let deliveredImages=false;
          for(const observed of run.observationCapabilities.images?observedImages:[]){const receipt=run.visualObservations.find(o=>o.eventId===observed.eventId);if(receipt&&!receipt.delivered&&!run.visualAnalysisFailures?.some(f=>f.recoveryScope===visualFailureScope()&&f.sourceHash===require('../model-routing.cjs').digest(observed.message.content))){receipt.delivered=true;deliveredImages=true;}}
          // Prepared images in the just-sent snapshot were still awaiting
          // delivery. Only an actual successful response can advance this
          // navigation state; this grants neither progress nor acceptance.
          if(deliveredImages){verificationEvidence=await evidenceNavigation.context(workspace);await visualWorkflow.reconcilePending(workspace,verificationEvidence);}
          outputPolicy.succeeded(response.providerUsage,budgetStage,actualControls);await saveOutputBudget();break;
        }
        catch(e) {
          if(!signal.aborted&&!settlement.unknown(run)&&await acceptSteering()){await workspace.event('request_superseded',{code:typeof e.code==='string'?e.code:'REQUEST_ERROR',message:'旧请求失败时已接收新输入，按最新要求重新决策；未执行旧动作'});continue taskLoop;}
          if(e.code==='MODEL_IMAGE_UNSUPPORTED'&&(run.observationCapabilities.images||attachmentImagesEnabled&&imageMessages.length)){
            attachmentImagesEnabled=false;
            run.observationCapabilities={...run.observationCapabilities,images:false,visualReview:false};
            snapshot.observationCapabilities={...snapshot.observationCapabilities,...run.observationCapabilities};
            // Retry the same task as text; rejected image requests executed no tool.
            messages=messages.map(message=>{if(!Array.isArray(message.content))return message;const parts=message.content.filter(part=>part.type!=='image_url'&&part.type!=='input_image');return {...message,content:parts.length?parts:'图像未发送，当前接口不支持图像输入。'};});
            await workspace.event('capability_fallback',{message:'接口不支持图像输入，正在改用文本与结构检查继续任务，视觉效果留待人工确认'});await notify();
            action=intent==='task'?await require('./completion-policy.cjs').automaticDelivery(workspace):null;
            if(action)break;
            continue;
          }
          emptyResponse=e.code==='MODEL_EMPTY_RESPONSE';
          const reasoningOnly=e.code==='MODEL_OUTPUT_LIMIT'&&e.diagnostics?.contentChars===0&&!(e.diagnostics?.toolArgumentChars>0)&&(e.diagnostics?.reasoningTokens>0||e.diagnostics?.reasoningChars>0);
          if(emptyResponse||reasoningOnly||e.code==='MODEL_NO_ACTION_TIMEOUT'){
            noActionFailures=Math.max(noActionFailures,recovery.active(run)?run.decisionRecovery.noActionFailures||0:0)+1;
            if(reasoningOnly)outputPolicy.limited(budget,e.diagnostics,budgetStage,actualControls);
            await saveOutputBudget();
            const stopping=noActionFailures>=4;
            if(!stopping){
              recovery.begin(run,e.code,noActionFailures);
              run.decisionRecovery.maxOutputTokens=Math.min(32768,Math.max(run.decisionRecovery.maxOutputTokens,outputPolicy.budget(remaining,budgetStage,actualControls)));
              run.decisionRecovery.noActionFailures=noActionFailures;
            }
            const nextBudget=stopping?null:recovery.budget(outputPolicy.budget(remaining,budgetStage,actualControls),remaining,outputLimit(model),run.decisionRecovery);
            await workspace.event(emptyResponse?'empty_response':reasoningOnly?'output_limit':'no_action_timeout',{attempt:noActionFailures,...e.diagnostics,budget,nextBudget,reason:'reasoning',message:stopping?'分阶段自动恢复仍未产出有效进展，本次恢复预算已用尽':'未产出动作，将精简请求并适配输出预算与决策时间后继续'});
            if(stopping)throw Object.assign(Error('当前步骤在有限恢复期间多次未返回动作，期间的读取也未形成足够的实质进展。已尝试精简上下文、适配输出预算和决策时间；已有成果和进度已保存，任务尚未完成。'),{code:'MODEL_NO_ACTION_BUDGET'});
            await workspace.event('no_action_recovery',{attempt:noActionFailures,code:e.code,budget:nextBudget,noActionTimeoutMs:run.decisionRecovery.noActionTimeoutMs,maxWriteChars:recovery.contract.maxWriteChars,maxCommandChars:recovery.contract.maxCommandChars,stage:run.decisionRecovery.stage,message:({small_action:'自动恢复：精简决策上下文、缩小单次动作，保留已授权工具并适配输出预算。',refocus:'自动恢复：聚焦当前缺口，使用精简工具定义和当前源码，延长有限决策时间。',direct_action:'自动恢复：保留当前错误与源码，只生成一个修复或验证动作，不重复翻读已有日志。'})[run.decisionRecovery.stage]});
            emptyResponse=true;outputReason='reasoning';onStatus?.('正在自动恢复：'+({small_action:'缩小下一步动作',refocus:'聚焦当前步骤',direct_action:'改用单步动作'})[run.decisionRecovery.stage]+'…');continue;
          }
          if(e.code==='MODEL_TOOL_ARGUMENT_LIMIT') {
            oversizedArguments=true;argumentFailures++;
            recovery.begin(run,e.code,argumentFailures);
            await workspace.event('tool_argument_limit',{attempt:argumentFailures,...e.diagnostics});
            if(argumentFailures>=3)throw Error('单次工具参数仍然过大，已要求拆分并重试 2 次。已有文件与任务状态已保留，超限动作未执行；请拆分当前步骤后继续。');
            onStatus?.('工具参数过大，正在要求模型拆分为更小的动作…');
            continue;
          }
          if(e.code==='MODEL_OUTPUT_LIMIT') {
            outputFailures++;
            outputReason=outputPolicy.limited(budget,e.diagnostics,budgetStage,actualControls);await saveOutputBudget();
            recovery.begin(run,e.code,outputFailures);
            run.decisionRecovery.maxOutputTokens=Math.min(32768,outputPolicy.budget(remaining,budgetStage,actualControls));
            // Report the effective request budget, including the recovery cap.
            const nextBudget=recovery.budget(outputPolicy.budget(remaining,budgetStage,actualControls),remaining,outputLimit(model),run.decisionRecovery);
            const reason=outputReason==='reasoning'?'模型思考达到单次输出额度':'模型动作输出达到单次额度';
            const message=outputFailures>=4?reason+'，自动重试已用尽':reason+(nextBudget>budget?`，将提高额度至 ${nextBudget} 并自动重试`:'，正在缩小动作、精简上下文并自动重试');
            await workspace.event('output_limit',{attempt:outputFailures,budget,nextBudget,stage:run.decisionRecovery.stage,configuredLimit:outputLimit(model),...e.diagnostics,reason:outputReason,message});
            if(outputFailures>=4)throw Object.assign(Error('模型在缩小动作、精简上下文和单步直出恢复后仍持续截断。已有成果与任务进度已保存，截断动作未执行，任务尚未完成。'),{code:'MODEL_NO_ACTION_BUDGET'});
            onStatus?.(message);
            continue;
          }
          if(e.code!=='AGENT_PROTOCOL')throw e;
          if(e.reason==='invalid_json'){const pressure=outputPolicy.pressured(budget,requestResponse?.providerUsage,e.diagnostics,budgetStage,actualControls);if(pressure.pressured){await workspace.event('output_budget_pressure',{reason:'invalid_json_at_output_limit',...pressure,budget});await saveOutputBudget();}}
          await workspace.event('protocol_error',{reason:e.reason,...e.diagnostics,message:'模型动作格式待纠正：'+(e.diagnostics?.issue==='missing_action'?'缺少 action 字段':e.reason==='invalid_parameter'?parameterHint(e.diagnostics):({invalid_action:'动作名称或对象结构无效',wrong_tool:'工具名称不匹配',invalid_json:'返回内容不是完整动作对象',multiple_tools:'一次返回了多个工具调用',conflicting_action:'工具名称与动作字段冲突',missing_text:'缺少动作内容',tool_metadata_too_long:'工具元数据过长'}[e.reason]||e.reason))});
          if(++protocolInvalid>2)throw Object.assign(Error('模型连续返回无效动作，已自动纠正 2 次仍失败。原因：'+(e.diagnostics?.issue==='missing_action'?'缺少动作字段':e.reason==='invalid_json'?'返回内容不是完整动作对象':e.reason==='invalid_parameter'?parameterHint(e.diagnostics):'动作格式不符合协议')+'。失败动作均未执行，任务和材料已保留；可重试当前步骤。'),{code:'AGENT_PROTOCOL',reason:e.reason,diagnostics:e.diagnostics});
          onStatus?.('正在自动重试下一步，请稍候…');
          protocolRecovery={reason:e.reason,...e.diagnostics};break;
        }
      }
      if(await acceptSteering())continue;
      if(!action)continue;
      if(signal.aborted)throw Error('已停止执行');
      if(['route','plan','reply','clarify','finish'].includes(action.action)&&typeof action.conversationTitle==='string'){
        const title=action.conversationTitle.trim();
        if(title&&title.length<=40&&!/[\r\n\x00-\x1f]/.test(title))run.conversationTitle=title;
      }
      if(now()-startedAt>=maxDurationMs)return await budgetPause('time');
      protocolInvalid=0;protocolRecovery=undefined;
      if(signal.aborted)throw Error('已停止执行');
      try {
        if(action.action==='load_skill'){
          if(!allowedActions(snapshot).includes('load_skill'))throw Error('当前阶段不能加载技能');
          if(!skillRuntime.catalog().some(e=>e.id===action.id))throw Error('请只加载当前技能目录中的尚未加载项，不能重复加载或调用停用技能');
          const loaded=await skillRuntime.select([action.id],{reason:action.purpose});extensions=skillRuntime.items();
          await record(action,loaded);await notify();continue;
        }
        if(!intent) {
          if(action.action==='reply'){
            // A direct answer is a chat turn that skipped the separate route request.
            intent='chat';run.currentIntent=intent;invalid=0;
            await workspace.event('intent',{kind:intent,basis:'direct_reply'});
          } else {
          if(action.action!=='route'||!['chat','task'].includes(action.kind))throw Error('先使用 route 识别本次用户意图');
          if(action.taskChange){
            const adoption=require('./request-scope.cjs').adopt(run,task,action.taskChange,publicRun);
            if(adoption.changedExecution){synchronizeExecution();await skillRuntime.newInput({newExecution:true});extensions=skillRuntime.items();require('./input-turn.cjs').begin(run);require('./input-coverage.cjs').receive(run,task);require('./html-validation.cjs').configure(run,task);}
            await workspace.event('task_change',{...adoption.relation,message:'已依据当前用户原文确认任务关系，保留历史成果与证据'});
          }
          if(action.skillIds!==undefined){await skillRuntime.select(action.skillIds,{replace:true});extensions=skillRuntime.items();}
          intent=personalAssistant?'chat':action.kind;run.currentIntent=intent;
          if(intent==='task'){run.progressInputId=run.inputKey;run.mode='task';run.status=run.steps.length?'running':'understanding';}
          invalid=0;await workspace.event('intent',{kind:intent});await notify();continue;
          }
        }
        const readOnlyDeviceAction=action.action==='android_device'&&['status','logs','screenshot'].includes(action.operation);
        if(require('./input-turn.cjs').requiresAdoption(action)){
          if(settlement.unknown(run))throw Object.assign(Error('此前操作的结果尚未核对，禁止自动重放；先通过只读检查核对文件、日志或远端状态，再处理本次补充输入。'),{code:'ACTION_RESULT_UNKNOWN'});
          if(intent==='task'){require('./input-turn.cjs').assertReady(run);require('./material-input.cjs').assertReady(run);}
        }
        let planUpdate,commitPlanInputs,planProgress;
        if(action.action==='plan'){
          if(intent!=='task')throw Error('当前是问答，不执行交付计划');
          action=require('./plan.cjs').compile(run,action);
          if(Array.isArray(action.requirements)){action.acceptance=action.requirements.map(r=>r?.text);action.acceptanceTypes=action.requirements.map(r=>r?.type);}
          validatePlan(action);
          require('./html-validation.cjs').assertPlan(run,action);
          planUpdate=require('./requirements.cjs').update(run,action);
          require('./input-turn.cjs').assertPlan(run,planUpdate.requirements,action);
          require('./material-input.cjs').checkPlan(run,action,planUpdate.requirements);
          commitPlanInputs=require('./input-coverage.cjs').plan(run,task,action,planUpdate.requirements);
        }
        if(autonomous&&intent==='task'&&['pause','blocked'].includes(action.action)&&!(action.action==='pause'&&require('./operational-delivery.cjs').userRequestedPause(run))&&!settlement.unknown(run))throw Object.assign(Error('任务目标尚未完成，请继续执行或尝试已授权的兼容方式。内部错误不能通过pause/blocked交给用户；确实缺少授权、选择或关键资料时用clarify提出具体问题。'),{code:'AGENT_PROPOSED_STOP'});
        if(action.action==='blocked'&&intent==='task'&&!settlement.unknown(run)){
          const proposed=Object.assign(Error(action.text||'执行器未找到下一步方法。'),{code:'AGENT_PROPOSED_STOP'});
          if(run.resultRecovery?.stage!=='remaining'&&await beginResultRecovery(proposed,{force:true}))continue;
          const result=await settleResult(proposed);if(result)return result;
        }
        const actionSubject=failureEpisodes.subject(action);
        const exhaustedEpisode=(run.failureEpisodes?.records||[]).find(e=>{
          if(e.status!=='open'||e.exhaustedRevision!==run.revision||e.recoveries<2+(e.resumeCredits||0))return false;
          if(e.target.action!==action.action)return false;
          return action.action==='verify'?e.target.criterionIds?.some(id=>actionSubject.criterionIds?.includes(id)):JSON.stringify(stable(e.target))===JSON.stringify(stable(actionSubject));
        });
        // A plan is a local transaction. Its complete source/coverage preflight
        // can prove an old plan-contract failure corrected before any effects.
        // Keep the episode counts; only successful commit resolves that episode.
        if(exhaustedEpisode&&!planUpdate){const result=await settleResult(Object.assign(Error(exhaustedEpisode.message),{code:'AGENT_REPAIR_EXHAUSTED',episodeId:exhaustedEpisode.id}));if(result)return result;}
        if(recovery.active(run))recovery.validate(action);
        if(action.progress?.executionState){
          const normalized=require('./progress-normalization.cjs').normalize(action.progress,run);
          if(normalized.demoted){
            action.progress=normalized.progress;
            await workspace.event('progress_normalized',{message:'缺少来源的补充说明已保留为未确认内容，继续执行实际任务',count:normalized.demoted});
          }
        }
        if(action.progress!==undefined){
          // A plan can carry progress for the steps it is declaring, including
          // the first plan. Validate the full proposed plan before any commit.
          let progressRun=run;
          if(action.action==='plan'){
            progressRun={...run,goal:action.goal,decisions:action.decisions,acceptance:action.acceptance,steps:action.steps};
          }
          const update=require('./attached-progress.cjs').validate(action.progress,progressRun);
          const issueWorkspace=action.action==='plan'?{...workspace,run:{...structuredClone(run),...structuredClone(planUpdate)}}:workspace;
          const issueUpdates=update.issues!==undefined?await require('./issues.cjs').update(issueWorkspace,update.issues):undefined;
          const stateUpdate=update.executionState!==undefined?require('./execution-state.cjs').validate(update.executionState,run):undefined;
          if(update.steps&&intent!=='task')throw Error('问答不能更新任务步骤');
          // Validate all fields before committing either steps or memory.
          if(update.steps&&action.action==='plan')action.steps=update.steps;
          else if(update.steps){if(update.steps.filter(step=>step.status==='done').length>run.steps.filter(step=>step.status==='done').length)advanceReads({completed:update.steps.filter(step=>step.status==='done').map(step=>step.id).sort()});run.steps=update.steps.map(step=>({...step}));run.actionsSincePlan=0;markProgress({steps:run.steps.map(({id,status})=>({id,status}))});}
          if(action.action==='plan')planProgress={update,issueUpdates,stateUpdate};
          else{
            if(issueUpdates)require('./problem-state.cjs').replaceSource(run,'issue',issueUpdates);
            if(stateUpdate)run.executionState=stateUpdate;
            if(update.memory!==undefined){run.workingMemory=update.memory;run.checkpointObservationCount=run.observationIndex.length;}
            run.performance.attachedUpdates++;await workspace.event('attached_progress',{steps:!!update.steps,memory:!!update.memory});await notify();
          }
        }
        if(run.loopRecovery&&['pause','blocked'].includes(action.action)){
          await record(action,{notExecuted:true,instruction:'内部循环恢复不能通过暂停或阻塞交回用户。请复用已有观察，修正当前方法并继续；真实缺少授权时使用授权工具，确需用户补充信息或选择时使用 clarify。'});
          await recoverLoop({kind:'premature_stop',action:{action:'blocked_decision'},location:run.loopRecovery.location});continue;
        }
        // Reject obsolete exploration before repeat detection can stall a completed plan.
        if(snapshot.requiredAction==='finish_review' && !allowedActions(snapshot).includes(action.action)) {
          await record(action,{notExecuted:true,instruction:snapshot.instruction,allowedActions:allowedActions(snapshot)});
          await workspace.event('finish_review',{message:'计划步骤已完成，已阻止重复探索；请核验成果并提交 finish。'});
          await notify();continue;
        }
        const target=await actionIdentity.identity(workspace,{...action,id:workspace.lookup(action.id)?.id||action.id},{android});
        if(action.action==='batch_read')target.items=await Promise.all(require('./batch-read.cjs').validate(action.items).map(item=>readIdentity(workspace,item)));
        // Device state and schema-independent observation versions remain part
        // of the identity; writes/builds use actual inputs rather than revision.
        if(action.action==='android_device')target.deviceSession=android?.sessionId||run.androidCheck?.sessionId;
        const fingerprint=JSON.stringify(stable(target));
        const readAction=readActions.has(action.action);
        const readTarget=readAction?await readIdentity(workspace,{...action,id:target.id}):target;
        if(intent==='task'&&['read_file','read_execution'].includes(action.action)){
          const source=await repeatedSource(action,readTarget,snapshot.sourceContext);
          if(source){
            const instruction='所需原文已完整提供在 sourceContext 中，本次重复读取未执行。文件和归档引用的是同一版本，不再换偏移量或归档 ID 重读；直接使用 sourceContext 的 sha256 和 ranges.text 执行 edit_file，之后验证。确实缺少的范围才允许继续读取；审计执行参数可显式用 view=record。';
            readRecovery={kind:'source_reuse',...source,instruction};
            await recoverLoop({kind:'source_reuse',action,location:{path:source.path,offset:source.offset,inputVersion:source.sha256},receipt:source});
            await record(action,{action:action.action,notExecuted:true,source,instruction});
            await workspace.event('source_reuse',{path:source.path,offset:source.offset,message:'已保留当前源码，阻止跨文件与归档工具重复读取，正在推进修复与验证'});
            await notify();continue;
          }
        }
        const readFingerprint=JSON.stringify(stable(readTarget));
        const counters=readAction?readAttempts:attempts, key=readAction?readFingerprint:fingerprint;
        const repeats=(counters.get(key)||0)+1;if(!readAction)counters.set(key,repeats);
        const location={action:action.action,id:target.id,name:workspace.lookup(action.id)?.name,path:readTarget.path??action.path,entry:action.entry,pointer:action.pointer,offset:target.offset,inputVersion:readTarget.inputVersion||readTarget.version};
        if(readAction && repeats===3) {
          counters.set(key,repeats);
          const {result:cached,...previous}=readResults.get(key)||{};
          const coverage=run.readCoverage.filter(r=>r.id===target.id&&r.path===(readTarget.path??action.path)&&r.entry===action.entry&&r.pointer===action.pointer&&(!readTarget.version||r.sha256===readTarget.version)).slice(-8);
          const message='相同内容已读取两次，正在纠正重复读取：'+[location.name||location.path,location.entry,location.pointer,`位置 ${location.offset}`].filter(Boolean).join(' · ');
          const instruction='本次重复读取未执行。请利用已有结果推进；'+(action.action==='read_file'?'offset/limit 均按字符计数，不是行号。按 next 继续，或明确需要的不同范围；文件未改变，不要从头再读。':action.action==='read_execution'||action.action==='read_history'?'按相同 id 和 next 继续分页；已有片段不必重复回查。':'需要定位内容时使用 inspect_source 的 query，或按 next 读取新范围。')+'完整原文可使用 sourceObservationId 回查。纠正后仍重复同一范围时将自动聚焦当前缺口，复用已有结果并换一种有效动作继续。';
          readRecovery={...location,...previous,version:readTarget.version,coverage,instruction};
          await workspace.event('repeat_warning',{...location,next:previous?.next,observationId:previous?.sourceObservationId,message});
          await record(action,{action:action.action,notExecuted:true,...previous,result:cached,coverage,instruction});
          await notify();onStatus?.(message);continue;
        }
        if(action.action!=='verify' && repeats>=(readAction?4:3) && !(snapshot.requiredAction==='plan_update' && action.action==='plan')) {
          const previous=readAction?readResults.get(key):undefined;
          const receipt=previous?{sourceObservationId:previous.sourceObservationId,next:previous.next,total:previous.total}:actionReceipts.get(key);
          await recoverLoop({action,location,receipt});
          await record(action,{action:action.action,notExecuted:true,sourceObservationId:receipt?.sourceObservationId||receipt?.id,instruction:run.loopRecovery.instruction});
          continue;
        }
        if(action.action==='route') {
          if(action.kind!==intent)throw Error('本轮意图已确定，不能通过重复 route 改变执行权限');
          await record(action,{ok:true,instruction:'意图已识别，请继续读取、规划或回答，不要重复 route'});continue;
        }
        if(snapshot.requiredAction==='checkpoint' && !action.progress?.memory && !['checkpoint','read_execution','read_history','pause','blocked','clarify'].includes(action.action))throw Error('需要先 checkpoint 保存需求结论、来源、缺口与下一步；可只读回查归档，再继续执行');
        if(snapshot.requiredAction==='plan_or_clarify' && !['plan','clarify','blocked','pause','checkpoint'].includes(action.action))throw Error('请先制定可调整计划或澄清关键缺口，不要继续无计划读取');
        if(snapshot.requiredAction==='plan_update' && !action.progress?.steps && !['plan','clarify','blocked','pause'].includes(action.action))throw Error('请先根据实际结果更新计划步骤状态，再继续执行');
        if(!readOnlyDeviceAction&&['write_file','edit_file','edit_spreadsheet','run_command','build_android','android_device','browser','verify','finish'].includes(action.action))require('./material-input.cjs').assertReady(run);
        if(action.action==='checkpoint') {
          require('./working-memory.cjs').validate(action.text,'checkpoint.text');
          run.workingMemory=action.text;
          await workspace.event('checkpoint',{text:action.text,policy:run.checkpointPolicy});
          run.observations=run.observations.slice(-2);run.checkpointObservationCount=run.observationIndex.length;await saveOutputBudget();await notify();continue;
        }
        const text=()=>{if(typeof action.text!=='string'||!action.text.trim()||action.text.length>6000)throw Error('用户说明必须为1–6000字符');return action.text;};
        if(action.action==='plan') {
          if(intent!=='task')throw Error('当前是问答，不执行交付计划');
          if(Array.isArray(action.requirements)){action.acceptance=action.requirements.map(r=>r?.text);action.acceptanceTypes=action.requirements.map(r=>r?.type);}
          validatePlan(action);
          require('./html-validation.cjs').assertPlan(run,action);
          if(JSON.stringify(run.steps.map(({id,status})=>({id,status})))!==JSON.stringify(action.steps.map(({id,status})=>({id,status}))))markProgress({steps:action.steps.map(({id,status})=>({id,status}))});
          if(action.steps.filter(s=>s.status==='done').length>run.steps.filter(s=>s.status==='done').length)advanceReads({completed:action.steps.filter(s=>s.status==='done').map(s=>s.id).sort()});
          Object.assign(run,planUpdate);commitPlanInputs();
          require('./material-input.cjs').commit(run,action);
          if(action.materialUse){displayRevision=-1;androidDesign=undefined;}
          run.acceptanceInputKey=run.inputKey;
          run.mode='task';run.goal=action.goal;run.decisions=action.decisions;run.acceptanceTypes=run.requirements.map(r=>r.type);run.acceptance=action.acceptance;run.steps=action.steps.map(({id,title,status,detail,summary,requiresConfirmation,requirementIds})=>({id,title,status,...(requirementIds?{requirementIds}:{}),...(detail?{detail}:{}),...(summary?{summary}:{}),...(requiresConfirmation!==undefined?{requiresConfirmation}:{})}));run.status='running';
          if(planProgress){const {update,issueUpdates,stateUpdate}=planProgress;if(issueUpdates)require('./problem-state.cjs').replaceSource(run,'issue',issueUpdates);if(stateUpdate)run.executionState=stateUpdate;if(update.memory!==undefined){run.workingMemory=update.memory;run.checkpointObservationCount=run.observationIndex.length;}run.performance.attachedUpdates++;await workspace.event('attached_progress',{steps:!!update.steps,memory:!!update.memory});}
          run.actionsSincePlan=0;
          const adoption=require('./request-scope.cjs').adoptPlan(run,action);
          if(adoption){recoveryControl.adopt(run,adoption);await workspace.event('task_change_adopted',{...adoption,message:adoption.opensRepairWindow?'本次实际要求或材料已纳入计划，开始有来源的有限处理窗口':'本次计划未形成新工作，保留原恢复预算'});}
          const resolvedPlanEpisodes=failureEpisodes.successful(run,action,{ok:true});
          if(resolvedPlanEpisodes.length){
            if(run.executionState?.blocker?.action==='plan')delete run.executionState.blocker;
            if(run.toolRecovery?.action==='plan')require('./recovery-state.cjs').clear(run,'toolRecovery');
            if(run.decisionRecovery?.focus?.action==='plan')delete run.decisionRecovery.focus;
          }
          invalid=0;await workspace.event('plan',{goal:run.goal,steps:run.steps});await notify();await record(action,{ok:true,action:'plan'});continue;
        }
        if(action.action==='clarify') {
          const clarification=validateClarification(action.clarification);if(!clarification)throw Error('澄清格式无效');
          if(autonomous&&intent==='task')require('./operational-delivery.cjs').assertUserQuestion(run,clarification);
          const content=text();run.status='waiting_user';run.currentOutcome='clarify';run.question=clarification;await workspace.event('clarification',{title:clarification.title});await notify();return {content,clarification,agentRun:publicRun(run)};
        }
        if(['verify','finish'].includes(action.action)&&run.pendingArtifactUpdates?.length)throw Error('请先重新登记待更新成果：'+JSON.stringify(run.pendingArtifactUpdates)+'。必须逐个执行 artifact，不能用 verify 替代登记。');
        if(['reply','pause','blocked','finish'].includes(action.action)) {
          let content=text()+(searchSources.size?'\n\n搜索来源：\n'+[...searchSources.values()].slice(0,10).map(s=>'- ['+s.title.replace(/[\[\]\\<>`]/g,'')+']('+s.url.replace(/[()\s<>]/g,c=>encodeURIComponent(c))+')').join('\n'):'');
          if(action.action==='blocked'&&run.resultRecovery?.stage==='remaining'){const result=await settleResult(Object.assign(Error(content),{code:'AGENT_REPAIR_EXHAUSTED'}));if(result)return result;}
          if(action.action==='reply'&&intent==='task')throw Error('交付任务不能用聊天正文替代执行，请澄清、规划、执行，或说明阻塞');
          if(action.action==='reply'&&intent==='chat')require('./input-coverage.cjs').answer(run,action);
          if(action.action==='finish') {
            if(settlement.unknown(run)||run.inFlight)throw Object.assign(Error('存在结果未知或仍在执行的操作，须先核对实际结果，不能声明任务完成或重放操作。'),{code:'ACTION_RESULT_UNKNOWN'});
            if(run.inputTurn?.followup&&run.inputTurn.requiresPlan&&run.acceptanceInputKey!==run.inputKey)throw Object.assign(Error('本次补充要求尚未纳入计划，请先更新 plan 与 requirements，再核验和交付；旧成果不能替代本轮要求。'),{code:'INPUT_REQUIREMENTS_PENDING'});
            require('./input-coverage.cjs').assertPlanned(run);
            if(run.mode!=='task')throw Error('完成任务需要实际成果和有效的验证证据');
            const inlineDelivery=!run.artifacts.length?await require('./operational-delivery.cjs').assertReplyDelivery(workspace,content):undefined;
            const changedArtifacts=[];
            for(const artifact of run.artifacts) {const file=await resolveFile(workspace.files,artifact.path);const data=await fs.readFile(file);if(createHash('sha256').update(data).digest('hex')!==artifact.sha256)changedArtifacts.push(artifact.path);}
            if(changedArtifacts.length){run.pendingArtifactUpdates=changedArtifacts;throw Object.assign(Error('成果已发生变更：'+JSON.stringify(changedArtifacts)+'。请检查这些文件的最终内容，对每个文件重新执行 artifact 登记，然后重新 verify 核验；若验证命令会修改成果，请在命令执行后登记。不要直接重复 finish。'),{code:'ARTIFACT_CHANGED'});}
            if(action.evidence!==undefined){
              if(!Array.isArray(action.evidence)||action.evidence.length>24||action.evidence.some(id=>typeof id!=='string'))throw Error('交付引用须为最多24个真实记录 ID，也可以省略；完成资格由实际验收证据决定');
              for(const id of action.evidence)if(!await require('./evidence.cjs').lookup(workspace,id))throw Error('交付引用不存在：'+id+'；可省略 finish.evidence，运行时复用已通过的检查');
            }
            if(!run.steps.length || require('./completion-policy.cjs').pendingMandatorySteps(run).length)throw Error('计划尚未全部验收：请根据实际证据更新计划；受阻步骤保持 blocked 并说明阻塞，不能直接 finish');
            const outcome=action.outcome||'complete';
            if(!['complete','limited'].includes(outcome))throw Error('完成结果必须为 complete 或 limited');
            const review=require('./completion-review.cjs').validate(action.review,true);
            const optionalCriteria=acceptanceChecks.criteria(run).filter(c=>require('./quality-contract.cjs').optional(c)),optionalIds=new Set(optionalCriteria.flatMap(c=>[c.id,c.text]));
            review.optionalUnverified=[...new Set([...(review.optionalUnverified||[]),...review.unverified.filter(id=>optionalIds.has(id))])];review.unverified=review.unverified.filter(id=>!optionalIds.has(id));
            const limitation=require('./visual-limitation.cjs').prepare(run,action,review,acceptanceChecks.criteria(run));
            if(review.unverified.length&&!limitation)throw Error('仍有未验证要求，不能声明完成；请继续验证或暂停/阻塞交付');
            visual.assertComparisons(run);
            await require('./html-delivery.cjs').assertHtmlDelivery(workspace);
            await acceptanceChecks.assertAccepted(workspace,{unverifiedVisualIds:limitation?.ids});
            const qualityCoverage=acceptanceChecks.qualitySummary(run),optionalNotice=require('./quality-acceptance.cjs').notice(qualityCoverage);
            if(optionalNotice)content+='\n\n'+optionalNotice;
            await require('./android-delivery.cjs').assertAndroidDelivery(workspace);
            if(run.artifacts.some(a=>/\.apk$/i.test(a.path)))await require('./android-design.cjs').assertDelivery(workspace,images);
            const finalReview=limitation?.review||review;
            if(limitation){
              content+=limitation.notice;
              require('./problem-state.cjs').upsert(run,'issue',limitation.issue);
            }
            await require('./issues.cjs').assertDeliverable(workspace,outcome,finalReview,content);
            await require('./candidate-versions.cjs').capture(workspace,{reason:'verified_delivery',signal});
            run.completionReview={...finalReview,revision:run.revision,at:new Date().toISOString()};
            await workspace.event('completion_review',run.completionReview);
            run.delivery={...(inlineDelivery?{inlineResult:inlineDelivery}:{}),qualityCoverage,optionalUnverified:qualityCoverage.optional.pendingIds,outcome,visualReviewPending:!!limitation,unverified:limitation?.ids||[],proofs:acceptanceChecks.criteria(run).filter(c=>c.check).map(c=>({criterionId:c.id,evidence:(c.check.parts||[c.check]).map(p=>({kind:p.kind,evidenceId:p.evidenceId,path:p.path,scope:p.scope,basis:p.basis}))})),at:new Date().toISOString()};
          run.status='completed';if(run.resultRecovery)run.resultRecovery.stage='completed';
          await require('./completion-policy.cjs').finalizeCandidate(workspace,{signal});
          } else run.status=action.action==='blocked'?'blocked':action.action==='pause'?'paused':run.mode==='task'?previousStatus:'idle';
          if(['pause','blocked'].includes(action.action)){run.delivery={outcome:run.artifacts.length?'partial':'blocked',status:action.action,at:new Date().toISOString()};run.executionState={...run.executionState,goal:run.executionState?.goal||run.goal,blocker:content,updatedAt:new Date().toISOString()};}
          if(action.action==='reply'&&intent==='chat'){
            const adoption=require('./request-scope.cjs').adoptReply(run,action);
            if(adoption)await workspace.event('task_change_answered',{...adoption,message:'本次讨论已回答，原任务要求、证据与恢复预算保留'});
          }
          if(scheduledMessage&&action.action==='reply'&&run.taskContinuation)run.taskContinuation={...run.taskContinuation,state:'completed',taskOpen:false};
          run.currentOutcome=action.action;await workspace.event(action.action,{text:content});await notify();return {content,agentRun:publicRun(run)};
        }
        // Shared by the standalone verify/artifact actions and by the same work
        // attached to a successful write, so one write can register and prove
        // its deliverable without two further model round trips.
        const verifyAcceptance=async action=>{
          require('./input-coverage.cjs').assertPlanned(run);
          if(intent!=='task'||!run.steps.length)throw Error('请先制定任务验收要求');
          const result=await acceptanceChecks.verify(workspace,action),previousProgress=run.progressEvidence?.at(-1);recovery.progress(run,action,result);const resolved=failureEpisodes.successful(run,action,result);if(resolved.length||run.progressEvidence?.at(-1)!==previousProgress)run.unresolvedFailureStreak=0;require('./loop-recovery.cjs').progress(run,action,result,{freshProgress:run.progressEvidence?.at(-1)!==previousProgress});if(!recovery.active(run))noActionFailures=0;if(run.executionState?.blocker?.action==='verify')delete run.executionState.blocker;await record(action,{eventId:run.events.at(-1).id,result});
          recoveryControl.progress(run,{fresh:run.progressEvidence?.at(-1)!==previousProgress});
          await require('./candidate-versions.cjs').capture(workspace,{reason:'verified_increment',signal});
          if(!resolved.length&&run.progressEvidence?.at(-1)===previousProgress){
            const proofs=result.results.map(({criterionId,kind,path,sha256,sources,scope,evidenceId})=>({criterionId,kind,path,sha256,sources,scope,evidenceId}));
            await recoverLoop({kind:'repeated_verification',action:{action:'verify',checks:proofs.map(({evidenceId,...proof})=>proof)},location:{path:proofs.length===1?proofs[0].path:undefined},receipt:{results:proofs}});
          }
          invalid=0;for(const counters of [failures,attempts])for(const key of counters.keys())if(JSON.parse(key).action==='finish')counters.delete(key);await notify();
        };
        const registerArtifact=async action=>{
          if(run.mode!=='task')throw Error('请先制定任务计划');
          if(typeof action.label!=='string'||!action.label.trim()||action.label.length>120)throw Error('成果名称无效');
          const file=await resolveFile(workspace.files,action.path);const stat=await fs.stat(file);
          if(!stat.isFile()||stat.size>150*1024*1024||action.path.split('/').includes('.runtime'))throw Error('成果必须为150 MB以内项目文件');
          const sha256=createHash('sha256').update(await fs.readFile(file)).digest('hex');
          const artifact={path:action.path,label:action.label,size:stat.size,sha256};
          if(run.artifacts.some(a=>a.path===action.path&&a.sha256!==sha256))for(const key of attempts.keys()){const prior=JSON.parse(key);if(prior.action==='artifact'&&prior.path===action.path)attempts.delete(key);}
          run.pendingArtifactUpdates=(run.pendingArtifactUpdates||[]).filter(p=>p!==action.path);
          run.artifacts=run.artifacts.filter(a=>a.path!==action.path).concat(artifact);await notify();await record(action,{ok:true,artifact});invalid=0;for(const counters of [failures,attempts])for(const key of counters.keys())if(JSON.parse(key).action==='finish')counters.delete(key);
        };
        if(action.action==='verify'){await verifyAcceptance(action);continue;}
        if(action.action==='artifact'){await registerArtifact(action);continue;}
        if(!['request_network','memory','assistant','knowledge','web_search','mcp','amap','feishu','list_files','read_file','batch_read','view_image','browser','write_file','edit_file','edit_spreadsheet','request_directory','run_command','build_android','android_device','read_material','read_source','inspect_source','search_materials','read_history','read_execution'].includes(action.action))throw Error('未知动作');
        if(action.action==='view_image'&&!run.observationCapabilities.images)throw Error('当前模型已配置为不接受图像；请选择支持图像的模型后继续视觉检查');
        if(['browser','write_file','edit_file','edit_spreadsheet','request_directory','request_network','run_command','build_android','android_device'].includes(action.action)&&(intent!=='task'||!run.steps.length))throw Error('执行前必须识别交付目标并制定计划');
        if(action.action==='web_search'&&++searchCalls>3)throw Object.assign(Error('本轮已达到 3 次搜索上限，请根据已有结果回答或缩小问题范围。'),{code:'SEARCH_UNAVAILABLE'});
        // Attached artifact/checks are validated before the write so a bad
        // attachment rejects the whole action without side effects.
        const attachedDelivery=require('./attached-delivery.cjs').validate(workspace,action);
        onStatus?.(({batch_read:'正在批量读取项目资料…',view_image:'正在回看图片…',browser:'正在运行并观察网页…',mcp:'正在使用应用工具：'+String(action.purpose||action.query||'查看工具').slice(0,120),web_search:'正在搜索：'+String(action.query||'').slice(0,100),feishu:'正在处理飞书：'+String(action.purpose||action.query||action.path||'操作').slice(0,120),read_material:'正在读取项目材料…',read_source:'正在读取材料原文…',inspect_source:'正在检查材料结构…',read_execution:'正在回查执行记录…',read_history:'正在回查对话记录…',search_materials:'正在检索项目材料…',write_file:'正在写入工程文件…',edit_file:'正在修改文件片段…',build_android:'正在执行标准 Android 构建…',android_device:'正在执行项目模拟器操作…',run_command:'正在执行：'+String(action.purpose||'项目命令').slice(0,120),list_files:'正在检查项目文件…',read_file:'正在读取项目文件…'})[action.action]||'正在处理项目任务…');
        if(action.action==='run_command'&&action.scope&&!['file','document'].includes(require('./evidence.cjs').scope(action.scope).kind))throw Error('命令证据 scope 仅可关联文件或文档');
        if(permissions)await permissions.before(action,signal);
        // Save intent before side effects. Interrupted commands are never
        // automatically replayed; the next run inspects files and logs first.
        const displayCommand=action.action==='build_android'?'/bin/sh ./gradlew --no-daemon --no-watch-fs --console=plain '+require('./android-build.cjs').tasksFor(action).join(' '):action.command;
        const journalEntry=actionJournal.begin(run,action);
        run.inFlight={actionId:journalEntry.id,action:action.action,operation:action.operation,...(action.action==='web_search'?{query:action.query}:{}),command:displayCommand,path:action.path,purpose:action.purpose,name:workspace.lookup(action.id)?.name,entry:action.entry,at:new Date().toISOString()};await notify();
        const effectRevision=run.revision;
        if(['write_file','edit_file','edit_spreadsheet'].includes(action.action)){run.revision++;await workspace.save();}
        const commandRevision=action.action==='run_command'?run.revision:undefined;
        if(action.action==='run_command'){run.revision++;await workspace.save();}
        const fileState=require('./file-state.cjs');
        const commandBefore=action.action==='run_command'?await fileState.inventory(workspace.files):undefined;
        let previousContent;
        if(action.action==='write_file'){try{previousContent=await fs.readFile(await resolveFile(workspace.files,action.path),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}}
        let result;const toolStarted=now();run.performance.toolCalls++;
        const outputStream=require('./command-output.cjs').commandOutput(run,journalEntry.id,()=>onRun?.(publicRun(run)));
        try{
        if(action.action==='memory'){
          if(!memory)throw Error('当前会话没有个人记忆服务');
          result=await memory.execute(action);
        } else if(action.action==='batch_read'){
          const batch=require('./batch-read.cjs'),items=batch.validate(action.items),identities=await Promise.all(items.map(item=>readIdentity(workspace,item)));
          const keys=identities.map(identity=>JSON.stringify(stable(identity)));
          const duplicates=new Set();for(const key of keys){if(duplicates.has(key))throw Error('批量读取不能包含相同版本和范围的重复项');duplicates.add(key);}
          const completed=await batch.execute(items,signal,async item=>{const index=items.findIndex(i=>i.itemId===item.itemId),key=keys[index];const source=intent==='task'?await repeatedSource(item,identities[index],snapshot.sourceContext):undefined;if(source)return {notExecuted:true,sourceReuse:true,source,notice:'原文已在 sourceContext 中完整提供，请直接编辑并验证，不重复批量读取'};if((readAttempts.get(key)||0)>=2){const old=readResults.get(key);return {notExecuted:true,sourceObservationId:old?.sourceObservationId,next:old?.next,notice:'同一范围已读取两次，请使用旧结果或继续下一范围'};}if(permissions)await permissions.before(item,signal);const child={...item};delete child.itemId;return executeTool(workspace,child,signal,{directoryAccess,permissions});});
          const reused=completed.find(item=>item.result?.sourceReuse);
          if(reused)await recoverLoop({kind:'source_reuse',location:{path:reused.result.source.path,inputVersion:reused.result.source.sha256},receipt:reused.result.source});
          performance.batch(run,completed);
          for(const item of completed){const index=items.findIndex(i=>i.itemId===item.itemId),child={...items[index]};delete child.itemId;item.observationId=await record(child,{action:child.action,...(item.error?{error:item.error,errorCode:item.errorCode}:{result:item.result})},keys[index]);if(!item.error&&!item.result?.notExecuted){const key=keys[index];readAttempts.set(key,(readAttempts.get(key)||0)+1);readResults.set(key,{sourceObservationId:item.observationId,next:item.result?.next,total:item.result?.total,result:item.result});}if(item.result!==undefined)item.result=workingContext.preview(batch.preview(item.result,Math.floor(2400/items.length)),Math.floor(3600/items.length));}
          result={results:completed,notice:'每项独立返回，错误项未成功；成功项已归档，不重放整批。更长原文通过 observationId 回查。'};
        } else if(action.action==='assistant') {
          if(!personalAssistant)throw Error('当前会话不是个人助手');
          result=await personalAssistant(action,{task,signal,modelId:model.id});
        } else if(action.action==='read_history') {
          const offset=action.offset??0,limit=action.limit??10000;
          if(!Number.isInteger(offset)||offset<0)throw Error('历史读取位置无效');
          if(!Number.isSafeInteger(limit)||limit<1||limit>12000)throw Error('历史读取长度必须为 1–12000 的整数');
          const historyText=JSON.stringify((task.messages||[]).map(({role,content,clarification,clarificationAnswers})=>({role,content,clarification,clarificationAnswers})));
          result={offset,total:historyText.length,text:historyText.slice(offset,offset+limit),next:offset+limit<historyText.length?offset+limit:null};
        } else {
          if(action.action==='request_directory'){run.status='waiting_permission';await workspace.event('permission_requested',{path:action.path,purpose:action.purpose});await notify();onStatus?.('等待目录授权');}
          result=await actionJournal.executeWithRecovery(workspace,journalEntry,action,signal,()=>executeTool(workspace,action,signal,{commandRuntime:commandDiscovery,android,authorizeBuild,directoryAccess,permissions,feishuCli,webSearch,amap,mcp,knowledge,onStatus,onOutput:outputStream.update,images,browser}));
          if(action.action==='request_directory'){run.status='running';await notify();onStatus?.('目录已授权，继续执行');}
        }
        }finally{outputStream.close();run.performance.toolMs+=Math.max(0,now()-toolStarted);}
        if(['write_file','edit_file','edit_spreadsheet'].includes(action.action)&&result?.changed===false){run.revision=effectRevision;run.performance.noOpWrites=(run.performance.noOpWrites||0)+1;}
        if(result?.reused)run.performance.reusedTools=(run.performance.reusedTools||0)+1;
        if(!result?.timedOut&&(result?.exitCode===undefined||result.exitCode===0)&&!result?.results?.some(r=>r.error||r.result?.notExecuted))run.performance.successfulTools++;
        if(commandBefore){
          const after=await fileState.inventory(workspace.files),changes=fileState.changes(commandBefore,after);
          result.fileChanges=changes;result.changeCoverage=commandBefore.complete&&after.complete?'complete':'bounded';
          if(result.changeCoverage==='bounded')result.changeNotice='fileChanges只包含扫描覆盖足以确认的变化；未采样文件的状态未知，不能据此声称删除、新建或完全未变化。项目revision仍保守失效，它本身不证明修复。';
          run.revision=commandRevision+(changes.length||!commandBefore.complete||!after.complete?1:0);
          if(commandBefore.complete&&after.complete){result.sources=after.files;result.fileSet=after.files.map(f=>f.path).sort();}
          if(action.scope){const scope=require('./evidence.cjs').scope(action.scope);if(after.files.some(f=>f.path===scope.path))result.scope=scope;else result.scopeNotice='声明对象未包含在已记录文件范围内，未授予范围证据';}
          result.revision=run.revision;
        }
        if(action.action==='edit_file'&&result.changed)advanceReads({path:action.path,version:result.sha256});
        if(action.action==='view_image')delete result.image;
        if(journalEntry.status==='running'){journalEntry.status='succeeded';journalEntry.finishedAt=new Date().toISOString();}
        if(action.action==='web_search')for(const source of result.sources||[])searchSources.set(source.url,source);
        if(action.action==='write_file'&&previousContent!==action.content)advanceReads({path:action.path,content:action.content});
        // A new successful tool action is evidence of progress, not proof of task completion.
        // Exclude bookkeeping/log scans; repeated requests do not extend execution forever.
        if(result?.changed!==false&&!result?.reused&&!['list_files','read_history','read_execution'].includes(action.action) && (action.action!=='batch_read'||result.results.some(item=>!item.error&&!item.result?.notExecuted)) && !result?.timedOut && (result?.exitCode===undefined||result.exitCode===0))markProgress(actionIdentity.normalize(action));
        await workspace.event(action.action,{id:action.id,actionId:journalEntry.id,startedAt:run.inFlight?.at,durationMs:Math.max(0,now()-toolStarted),operation:action.operation,...(action.action==='web_search'?{query:action.query}:{}),entry:action.entry,pointer:action.pointer,offset:action.offset,name:result?.name,path:action.path,command:action.command,purpose:action.purpose,revision:run.revision,result:action.action==='memory'?{ok:true,id:result?.id,operation:action.operation}:result});
        if(action.action==='android_device'||action.action==='browser')await require('./result-preview.cjs').register(workspace,run.events.at(-1),{current:true});
        if(action.action==='build_android'){latestBuild=run.events.at(-1);await require('./delivery-milestones.cjs').registerBuild(workspace,latestBuild);}
        if(action.action==='android_device'&&run.observationCapabilities.images)await visualWorkflow.enqueueOperation(workspace,action,result,run.events.at(-1));
        if(action.action==='android_device'&&['start','check'].includes(action.operation)&&result.display){run.androidDisplay=result.display;displayRevision=-1;}
        if(action.action==='view_image'||action.action==='browser'&&result.screenshot){
          run.visualObservations.push({eventId:run.events.at(-1).id,path:result.screenshot||result.path,sha256:result.sha256,sources:result.sources,revision:run.revision,scope:result.scope,pixelSize:result.pixelSize,displayCheck:result.displayCheck,reference:result.reference,comparison:result.comparison,designBinding:result.designBinding,designManifest:result.designManifest,uiHierarchy:result.uiHierarchy,rendererState:result.rendererState,previewOnly:result.previewOnly===true,transform:action.action==='view_image'&&action.crop?{crop:action.crop}:{},delivered:false});
          run.visualObservations=run.visualObservations.slice(-64);
          require('./android-design.cjs').recordComparison(workspace,run.visualObservations.at(-1));
        }
        if(action.action==='browser'){
          require('./html-delivery.cjs').recordObservation(workspace,run.events.at(-1));
          require('./browser-diagnostics.cjs').record(workspace,run.events.at(-1),acceptanceChecks.criteria(run));
        }
        const priorProgress=run.progressEvidence?.at(-1);
        recovery.progress(run,action,result);
        recoveryControl.progress(run,{fresh:run.progressEvidence?.at(-1)!==priorProgress,readOnly:readAction});
        const resolvedFailures=failureEpisodes.successful(run,action,result);
        if(resolvedFailures.length||run.progressEvidence?.at(-1)!==priorProgress)run.unresolvedFailureStreak=0;
        require('./loop-recovery.cjs').progress(run,action,result,{freshProgress:run.progressEvidence?.at(-1)!==priorProgress});
        if(!recovery.active(run))noActionFailures=0;
        if(run.executionState?.blocker?.action===action.action&&run.executionState.blocker.path===action.path&&!result.timedOut&&(result.exitCode===undefined||result.exitCode===0))delete run.executionState.blocker;
        if(result.exitCode!==undefined&&result.exitCode!==0||result.timedOut)run.executionState={...run.executionState,goal:run.executionState?.goal||run.goal,blocker:{action:action.action,path:action.path,eventId:run.events.at(-1).id,exitCode:result.exitCode,timedOut:result.timedOut,stderr:result.stderr?.slice(-1500)},updatedAt:new Date().toISOString()};
        // Record the full result externally; only previews enter inference.
        if(['read_material','read_source','inspect_source'].includes(action.action) && result.kind!=='json_search') {
          unplannedReads++;
        }
        if(intent==='task' && run.steps.length)run.actionsSincePlan++;
        delete run.inFlight;await notify();const observationId=await record(action,{action:action.action,eventId:run.events.at(-1).id,result:action.action==='memory'?{ok:true,operation:action.operation,id:result?.id,forgotten:result?.forgotten,notice:'操作已完成。当前有效记忆见 personalMemory，其他条目可用更具体的查询。'}:result,instruction:repeats===2?'此动作已重复，请利用结果推进，避免第三次重复调用':undefined},readAction?key:undefined);
        if(!readAction)actionReceipts.set(key,{sourceObservationId:observationId,eventId:run.events.at(-1).id});
        if(readAction){counters.set(key,repeats);run.readAttempts=[...readAttempts].slice(-256);const page=run.observations.at(-1).response.result;readResults.set(key,{sourceObservationId:observationId,next:page?.next,total:page?.total,result:page});if(readRecovery?.action===action.action&&readRecovery.path===readTarget.path&&readRecovery.version!==readTarget.version)readRecovery=undefined;}
        invalid=0;require('./recovery-state.cjs').clear(run,'toolRecovery');
        if(attachedDelivery){
          if(attachedDelivery.artifact)await registerArtifact(attachedDelivery.artifact);
          if(attachedDelivery.verify){
            const verifyAction=attachedDelivery.verify;
            try{await verifyAcceptance(verifyAction);}
            catch(error){
              if(signal.aborted||error.code==='AGENT_NO_PROGRESS')throw error;
              // The write succeeded and stays recorded; only the attached proof failed.
              await require('./candidate-versions.cjs').capture(workspace,{reason:'partial_verification',signal});
              const requestInvalid=['VISUAL_REVIEW_PENDING','VERIFY_REQUEST_INVALID'].includes(error.code);
              run.executionState={...run.executionState,goal:run.executionState?.goal||run.goal,blocker:{action:'verify',path:action.path,code:requestInvalid?error.code:'ACCEPTANCE_FAILED',message:error.message,...(error.navigation?{navigation:error.navigation}:{})},updatedAt:new Date().toISOString()};
              await workspace.event('tool_error',{code:error.code,message:error.message,action:'verify',attachedTo:action.action,path:action.path});await notify();
              await record(verifyAction,{action:'verify',attachedTo:action.action,path:action.path,error:error.message});
              failureEpisodes.failure(run,verifyAction,error);
              run.unresolvedFailureStreak=(run.unresolvedFailureStreak||0)+1;run.performance.toolErrors=(run.performance.toolErrors||0)+1;
              if(!requestInvalid)run.performance.validationFailures=(run.performance.validationFailures||0)+1;
            }
          }
        }
      } catch(error) {
        if(signal.aborted)throw error;
        if(error.code==='AGENT_NO_PROGRESS')throw error;
        if(String(error.code||'').startsWith('PERMISSION_')){delete run.inFlight;run.status='waiting_permission';await workspace.event('permission_required',{message:error.message});await notify();return {content:error.message,agentRun:publicRun(run)};}
        if(['DIRECTORY_DECLINED','DIRECTORY_UNAVAILABLE','DIRECTORY_SYSTEM_PERMISSION'].includes(error.code)){delete run.inFlight;run.status=error.code==='DIRECTORY_UNAVAILABLE'?'blocked':'waiting_permission';await workspace.event('permission_required',{path:action.path,message:error.message});await notify();return {content:error.message,agentRun:publicRun(run)};}
        if(['unknown_result','permission'].includes(exitPolicy.classify(error,run,{signal}))){delete run.inFlight;run.status='blocked';await workspace.event('permission_required',{message:error.message});await notify();return {content:require('../task-outcome.cjs').pendingOutcomeMessage(run)||error.message,agentRun:publicRun(run)};}
        require('./html-delivery.cjs').rememberFailure(workspace,error);
        require('./android-design.cjs').rememberFailure(workspace,error);
        if(action.action==='verify')await require('./candidate-versions.cjs').capture(workspace,{reason:'partial_verification',signal});
        if(action.action==='verify'&&error.code!=='VERIFY_REQUEST_INVALID'&&await restoreCandidate()){
          failureEpisodes.failure(run,action,error);run.unresolvedFailureStreak=(run.unresolvedFailureStreak||0)+1;run.performance.toolErrors=(run.performance.toolErrors||0)+1;if(error.code!=='VISUAL_REVIEW_PENDING')run.performance.validationFailures=(run.performance.validationFailures||0)+1;
          await workspace.event('tool_error',{action:'verify',code:error.code,message:error.message,recoveredBy:'candidate_restore'});await record(action,{error:error.message,code:error.code,restoredCandidate:true});invalid=0;continue;}
        const failedPath=typeof action.path==='string'?action.path.slice(0,500):undefined;
        run.executionState={...run.executionState,goal:run.executionState?.goal||run.goal,blocker:{action:action.action,path:failedPath,code:action.action==='verify'&&!['VISUAL_REVIEW_PENDING','VERIFY_REQUEST_INVALID'].includes(error.code)?'ACCEPTANCE_FAILED':error.code,message:error.message,...(error.navigation?{navigation:error.navigation}:{})},updatedAt:new Date().toISOString()};
        const interruptedOutput=run.inFlight;delete run.inFlight;await workspace.event('tool_error',{code:error.code,actionId:interruptedOutput?.actionId,command:interruptedOutput?.command||action.command,purpose:action.purpose,startedAt:interruptedOutput?.at,result:interruptedOutput?.output!==undefined?{output:interruptedOutput.output,truncated:interruptedOutput.outputTruncated}:undefined,message:error.message,action:action.action,id:action.id,entry:action.entry,offset:action.offset,path:failedPath,...(action.action==='feishu'?{operation:action.operation,query:action.query,method:action.method}:{})});await notify();
        await record(action,{action:action.action,id:action.id,entry:action.entry,offset:action.offset,path:failedPath,error:error.message});
        let failureKey;try{failureKey=actionIdentity.fingerprint(action);}catch{failureKey=JSON.stringify(stable({...action,purpose:undefined,progress:undefined}));}
        const episode=failureEpisodes.failure(run,action,error),failed=episode.failures;
        failures.set(failureKey,failed);
        invalid++;
        run.unresolvedFailureStreak=(run.unresolvedFailureStreak||0)+1;
        run.performance.toolErrors=(run.performance.toolErrors||0)+1;
        if(action.action==='verify'&&!['VISUAL_REVIEW_PENDING','VERIFY_REQUEST_INVALID'].includes(error.code))run.performance.validationFailures=(run.performance.validationFailures||0)+1;
        // Ordinary execution and validation errors belong inside the task.
        // Change strategy before returning control to the user; retain failure
        // counts so repeated recovery cannot hide an endless loop.
        const recoveryDecision=recoveryControl.afterFailure(run,episode,{invalid,error,signal,canStartRemaining:true});
        if(recoveryDecision.action==='external')throw error;
        if(recoveryDecision.action==='remaining'){
          if(await beginResultRecovery(error,{force:true})){invalid=0;continue;}
        }
        if(recoveryDecision.action==='recover'){
          episode.recoveries=recoveryDecision.recoveries;
          recovery.begin(run,error.code||'TOOL_FAILURE',episode.recoveries+1);
          run.toolRecovery={episodeId:episode.id,attempt:episode.recoveries,action:action.action,path:failedPath,error:error.message,
            instruction:'普通工具错误或验收失败不需要用户点击重试。先依据错误和已有观察诊断原因，修正参数、文件、执行方式或拆分步骤，再继续原任务。不要重复相同失败动作，不放宽验收、不扩大权限。只有缺少用户授权、关键输入或必须由用户决定时才向用户提问。'};
          await workspace.event('tool_recovery',{...run.toolRecovery,message:'正在自动诊断执行问题并调整下一步，不需要手动重试'});
          await notify();invalid=0;
          continue;
        }
        if(recoveryDecision.action==='exhausted'){
          episode.exhaustedRevision=run.revision;
          const exhausted=Object.assign(Error('同一问题的有限恢复仍未成功：'+error.message),{code:'AGENT_REPAIR_EXHAUSTED',episodeId:episode.id});
          if(await beginResultRecovery(exhausted)){invalid=0;continue;}
          const result=await settleResult(exhausted);if(result)return result;
          throw exhausted;
        }
      }
    }
    if(signal.aborted)throw Error('已停止执行');
    return await budgetPause(now()-startedAt>=maxDurationMs?'time':'steps');
  }catch(error){if(error.code==='ERR_ASSERTION')throw error;if(!signal.aborted&&exitPolicy.classify(error,run,{signal})==='internal'){const result=await settleResult(error);if(result){if(error.code==='AGENT_PROTOCOL'){Object.assign(error,{taskContinues:true,taskMessage:result.content,agentRun:result.agentRun});throw error;}return result;}}if(['MODEL_NO_ACTION_BUDGET','AGENT_NO_PROGRESS','AGENT_REPAIR_EXHAUSTED'].includes(error.code)){run.status='blocked';run.executionState={...run.executionState,goal:run.executionState?.goal||run.goal,blocker:{code:error.code,stepId:recovery.stepId(run),focus:run.decisionRecovery?.focus,message:error.message},updatedAt:new Date().toISOString()};await workspace.event(error.code==='MODEL_NO_ACTION_BUDGET'?'no_action_budget':'recovery_exhausted',{message:error.message,code:error.code,episodeId:error.episodeId});run.delivery={outcome:run.artifacts.length?'partial':'blocked',status:'blocked',at:new Date().toISOString()};await notify();return {content:error.message,agentRun:publicRun(run)};}if(error.code==='MODEL_IMAGE_UNSUPPORTED'){run.status='blocked';await workspace.event('capability_missing',{message:error.message,capability:'image_input'});await notify();return {content:error.message+' 当前成果与进度已保存，尚未完成视觉验收。',agentRun:publicRun(run)};}if(run.inFlight&&['run_command','build_android'].includes(run.inFlight.action)){const live=run.inFlight;await workspace.event('command_interrupted',{actionId:live.actionId,action:live.action,command:live.command,purpose:live.purpose,startedAt:live.at,message:'执行已中断，操作结果待核对',result:{output:live.output,truncated:live.outputTruncated}});delete run.inFlight;}await actionJournal.reconcile(workspace);if(signal.aborted){run.status='paused';await workspace.event('interrupted',{message:error.message});await notify();throw error;}
    run.status='blocked';run.currentOutcome='pending';
    run.waitingError={code:error.code||'EXECUTION_DIAGNOSIS_REQUIRED',message:error.message,...(error.requestAttempted===false?{requestAttempted:false,lastErrorCode:error.lastErrorCode,retryAt:error.retryAt,recoveryExhausted:error.recoveryExhausted}:{}),...(error.providerCategory?{providerCategory:error.providerCategory}:{}),...(error.networkCode?{networkCode:error.networkCode}:{})};
    run.executionState={...run.executionState,goal:run.executionState?.goal||run.goal,blocker:run.executionState?.blocker||run.waitingError,updatedAt:new Date().toISOString()};
    await workspace.event('task_waiting',{code:error.code||'EXECUTION_DIAGNOSIS_REQUIRED',message:error.message,taskOpen:true});
    await notify();error.taskContinues=true;error.taskMessage=require('./task-continuation.cjs').message(run);error.agentRun=publicRun(run);throw error;}finally{run.performance.wallMs=performanceBaseWall+Math.max(0,now()-startedAt);try{await workspace.save();await onRun?.(publicRun(run));}finally{if(!retainBrowser)browser?.close(workspace);}}
}
// Initialization (skills, context hydration, archives) must use the same
// result boundary as the execution loop. Storage failure still propagates:
// never claim that an unsaved task has been safely preserved.
async function runAgent(options){
  try{return await runAgentImpl(options);}
  catch(error){
    if(error.code==='ERR_ASSERTION'||error.taskContinues||options.signal?.aborted||exitPolicy.classify(error,{},options)!=='internal')throw error;
    try{
      const workspace=await createWorkspace(options.base,options.task),run=workspace.run;
      await actionJournal.reconcile(workspace);
      if(settlement.unknown(run))throw error;
      require('./execution-rounds.cjs').beginRound(run,options.task,publicRun);
      require('./performance.cjs').init(run);
      const result=await settlement.settle(workspace,error,{signal:options.signal,summarize:options.summarizeResult?async(state,signal)=>options.summarizeResult(state,signal,record=>require('./performance.cjs').request(run,record)):undefined});
      if(!result)throw error;
      await workspace.save();const agentRun=publicRun(run);try{await options.onRun?.(agentRun);}catch{}
      return {...result,agentRun};
    }catch{throw error;}
  }
}
module.exports={runAgent,publicRun,parseAction};

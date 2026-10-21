const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {createWorkspace,resolveFile,normalizeProjectPath}=require('./workspace.cjs');
const {execute}=require('./tools.cjs');
const {decodeAction,parseAction,tool,allowedActions,parameterHint}=require('./protocol.cjs');

const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]))):value;
async function readIdentity(workspace,action) {
 const fields={list_files:['path'],read_file:['path'],read_material:['id'],read_source:['id','entry'],inspect_source:['id','entry','pointer','query'],search_materials:['query'],read_execution:['id'],read_history:[]}[action.action];
 const target={action:action.action,...Object.fromEntries(fields.filter(k=>action[k]!==undefined).map(k=>[k,action[k]]))};
 if(action.action==='list_files')target.revision=workspace.run.revision;
 if(action.action!=='search_materials')target.offset=action.offset??0;
 if(['read_file','read_material','read_execution','read_history'].includes(action.action))target.limit=action.limit??(action.action==='read_material'||action.action==='read_execution'&&!action.id?6000:10000);
 if(action.action==='read_file') {
  target.path=normalizeProjectPath(action.path);
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
function publicRun(run) {
  return {currentOutcome:run.currentOutcome,currentInputId:run.inputKey,currentIntent:run.currentIntent,memoryUsed:run.memoryUsed,loadedExtensions:run.loadedExtensions,conversationTitle:run.conversationTitle,progressInputId:run.progressInputId,executionId:run.executionId,history:run.history||[],inFlight:run.inFlight,contextUsage:run.contextUsage,delivery:run.delivery,issues:run.issues||[],executionState:run.executionState,acceptanceCriteria:acceptanceChecks.criteria(run).map(({id,text,type,scope,scopes,check})=>({id,text,type,scope,scopes,basis:check?.basis,status:check?.status==='passed'&&(run.freshAcceptanceIds||[]).includes(id)?'passed':'pending'})),recoverySummary:{retried:(run.actionJournal||[]).filter(e=>e.retries>0).length,recovered:(run.actionJournal||[]).filter(e=>e.recovered).length,unknown:(run.actionJournal||[]).filter(e=>e.status==='unknown').length},performance:run.performance,status:run.status,mode:run.mode,goal:run.goal,steps:run.steps,decisions:run.decisions,acceptance:run.acceptance,completionReview:run.completionReview,artifacts:run.artifacts,updatedAt:run.updatedAt,events:run.events.slice(-12).map(e=>({id:e.id,type:e.type,at:e.at,detail:{purpose:e.detail.purpose,exitCode:e.detail.result?.exitCode,path:e.detail.path,name:e.detail.name,offset:e.detail.offset,entry:e.detail.entry,pointer:e.detail.pointer,message:e.detail.message,output:['run_command','build_android','android_device','feishu'].includes(e.type)?e.detail.result?.output?.slice(-2000):undefined}}))};
}
async function runAgent({base,task,ask,model,signal,onStatus,onRun,extensions=[],skillPackages,images,browser,android,authorizeBuild,directoryAccess,feishuCli,webSearch,amap,mcp,knowledge,personalAssistant,projectContext,projectMemoryContext,scheduledContext,memory,permissions,maxSteps=240,batchSize=48,maxDurationMs=2*60*60*1000,now=Date.now,executeTool=execute,getSteering=async()=>[]}) {
  // Status is presentation only. A broken observer must never cancel a tool.
  const statusObserver=onStatus;
  onStatus=message=>{if(typeof message!=='string'||!message.trim())return;try{statusObserver?.(message);}catch{}};
  for(const value of [maxSteps,batchSize,maxDurationMs])if(!Number.isSafeInteger(value)||value<=0)throw Error('执行预算必须为正整数');
  const startedAt=now();
  const performance=require('./performance.cjs');
  const recovery=require('./decision-recovery.cjs');
  const workspace=await createWorkspace(base,task),run=workspace.run;
  run.observationCapabilities={images:!!images&&model.imageInput!=='disabled',browser:!!browser,imageInput:model.imageInput||'auto'};
  await actionJournal.reconcile(workspace);
  if (skillPackages) extensions = await skillPackages.prepare(workspace, extensions);
  require('./execution-rounds.cjs').beginRound(run,task,publicRun);
  const performanceBaseWall=performance.init(run).wallMs;
  // Report only extensions whose resources were successfully prepared.
  run.loadedExtensions=extensions.filter(e=>e.enabled!==false).map(({id,name,kind})=>({id,name,kind}));
  if(run.loadedExtensions.length)run.progressInputId=run.inputKey;
  const savedProjectMemory=projectMemoryContext!==undefined?projectMemoryContext:task.projectId?await (async()=>{const root=require('./workspace-path.cjs').workspacePath(base,task),path=require('node:path');const saved=await require('./workspace.cjs').json(path.join(root,'memory.json'),{notes:''});let files=[];try{files=(await fs.readdir(path.join(root,'runs'))).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).slice(0,100);}catch(e){if(e.code!=='ENOENT')throw e;}const records=[];for(const name of files){const r=await require('./workspace.cjs').json(path.join(root,'runs',name),null);if(r&&r.taskId!==task.id&&!(saved.hiddenTaskIds||[]).includes(r.taskId))records.push({taskId:r.taskId,goal:r.goal,status:r.status,decisions:r.decisions,steps:r.steps,updatedAt:r.updatedAt});}records.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));return {...saved,records:records.slice(0,10)};})():null;
  const previousStatus=run.status;run.currentIntent=undefined;run.currentOutcome=undefined;
  const {AGENT_PROMPT:PROMPT}=await import('./prompt.mjs');
  const {validateClarification}=await import('../clarification.mjs');
  const {countMessages,capacity,outputLimit}=await import('../context.mjs');
  const outputPolicy=require('./output-budget.cjs').createOutputBudget(model,outputLimit(model),run.outputBudget);
  const saveOutputBudget=async()=>{run.outputBudget=outputPolicy.snapshot();await workspace.save();};
  const protocolTokens=countMessages([{role:'system',content:JSON.stringify(tool)}])+128;
  const notify=async()=>{run.freshAcceptanceIds=[];for(const c of acceptanceChecks.criteria(run))if(c.check){try{await require('./evidence.cjs').assertFresh(workspace,c.check);run.freshAcceptanceIds.push(c.id);}catch{}}run.performance.wallMs=performanceBaseWall+Math.max(0,now()-startedAt);await workspace.save();await onRun?.(publicRun(run));};
  const imageMessages = model.imageInput==='disabled'?[]:await workspace.images(task.messages ? task.messages.slice(-10).flatMap(message => message.materials || []) : task.materials || []);
  let history=(task.messages||[{role:'user',content:task.request}]).slice(-10).map(m=>({role:m.role,content:m.content,clarification:m.clarification,answers:m.clarificationAnswers,materials:m.materials?.map(f=>f.name)}));
  run.observations = (run.observations || []).filter(o=>o.action?.action!=='protocol_error');
  run.readCoverage ||= [];
  run.workingMemory ||= '';
  run.visualObservations ||= [];
  const visual=require('./visual-observation.cjs');
  run.fileReadMemory ||= [];
  // Persist the review cadence across checkpoints, pauses and app restarts.
  const searchSources=new Map();let searchCalls=0;
  const progressTools=['knowledge','web_search','mcp','amap','feishu','list_files','read_file','batch_read','view_image','browser','write_file','edit_file','edit_spreadsheet','request_directory','run_command','build_android','android_device','read_material','read_source','inspect_source','search_materials','read_history','read_execution'];
  if (!Number.isInteger(run.actionsSincePlan)) {
    const lastPlan=run.events.findLastIndex(e=>e.type==='plan');
    run.actionsSincePlan=run.steps.length ? run.events.slice(lastPlan+1).filter(e=>progressTools.includes(e.type)||e.type==='tool_error').length : 0;
  }
  const workingContext=require('./working-context.cjs');
  run.observationIndex ||= [];
  // Upgrade legacy in-memory history only after archiving every original.
  for(const observation of run.observations){
    if(!observation.observationId&&observation.response.result?.truncated){
      const event=run.events.find(e=>e.id===observation.response.eventId);
      if(event?.detail.result)observation.response={...observation.response,result:event.detail.result};
    }
    observation.observationId ||= await workspace.archiveObservation(observation.action,observation.response);
    if(!run.observationIndex.some(r=>r.id===observation.observationId))run.observationIndex.push(workingContext.receipt(observation));
  }
  run.checkpointObservationCount ||= 0;
  run.observations=run.observations.slice(-workingContext.RECENT_COUNT).map(o=>({...o,response:workingContext.preview(o.response)}));
  const attempts=new Map(),failures=new Map();
  const readActions=new Set(['read_material','read_source','inspect_source','read_file','search_materials','read_execution','read_history']);
  const readAttempts=new Map(),readResults=new Map(), durableProgress=new Set();
  let readRecovery;
  const advanceReads=value=>{const key=createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');if(!durableProgress.has(key)){durableProgress.add(key);readAttempts.clear();readRecovery=undefined;}};
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
    return {content:message+'任务尚未完成，文件和计划已保存，可点击继续任务。',agentRun:publicRun(run)};
  };
  const record=async(action,response)=>{
    // Preserve action/result pairs, including across pause and restart.
    const safeAction={...action};
    if(safeAction.content)safeAction.content='[内容已写入项目文件]';
    response={...response,arguments:safeAction};
    const observationId=await workspace.archiveObservation(safeAction,response);
    const observation={action:safeAction,response,observationId};
    run.observationIndex.push(workingContext.receipt(observation));
    const responsePreview=workingContext.preview(action.action==='batch_read'?{...response,arguments:undefined}:response);
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
    await workspace.save();
    return observationId;
  };
  let noActionFailures=0;
  let invalid=0, protocolInvalid=0, intent, protocolRecovery, toolRecoveryAttempts=0;
  async function acceptSteering() {
    const messages=await getSteering();
    if(!messages.length)return false;
    task.messages=[...(task.messages||[{role:'user',content:task.request}]),...messages];
    run.inputKey=require('./execution-rounds.cjs').inputKey(messages.at(-1));
    run.currentRequest=messages.at(-1).content;
    history=[...history,...messages.map(m=>({role:'user',content:m.content}))].slice(-10);
    // Re-route the latest user intent before further side effects.
    intent=undefined;
    readAttempts.clear();readRecovery=undefined;
    await workspace.event('steering',{message:`已接收 ${messages.length} 条补充指令，将据此调整下一步`});
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
    for(let turn=0;turn<maxSteps;turn++) {
      if(signal.aborted)throw Error('已停止执行');
      if(now()-startedAt>=maxDurationMs)return await budgetPause('time');
      if(turn>0 && turn%batchSize===0) {
        if(!batchProgress){
          run.status='paused';
          const message='本批执行未发现新的有效进展，已暂停以避免空转。文件和计划已保存，请检查最近执行记录。';
          await workspace.event('no_progress',{message});await notify();
          return {content:message,agentRun:publicRun(run)};
        }
        batchProgress=false;
        const message=`已保存第 ${turn/batchSize} 批执行进度，正在自动继续任务`;
        await workspace.event('batch_continue',{message,turns:turn});await notify();onStatus?.(message);
        if(signal.aborted)throw Error('已停止执行');
      }
      turns=turn+1;
      await acceptSteering();
      // A file may have changed through run_command or another execution. Never
      // inject a stale cached value as current state.
      const currentFileMemory=[];
      for(const cached of run.fileReadMemory){
        try{if((await readIdentity(workspace,{action:'read_file',path:cached.path})).version===cached.sha256)currentFileMemory.push(cached);}catch{}
      }
      run.fileReadMemory=currentFileMemory;
      if(permissions)await permissions.before();
      const permissionContext=permissions?await permissions.snapshot():undefined;
      const memoryContext=memory?await memory.context(run.currentRequest||task.request):{enabled:false,entries:[]};
      run.memoryUsed=memoryContext.enabled?{inputId:run.inputKey,ownerId:task.memoryOwner,entries:memoryContext.entries.map(({id,topic,scope,source})=>({id,topic,scope,source:source?{kind:source.kind,taskId:source.taskId,messageId:source.messageId}:undefined}))}:undefined;
      let snapshot={permissions:permissionContext,memoryAvailable:!!memory&&memoryContext.enabled,personalMemory:memoryContext,acceptanceCriteria:acceptanceChecks.criteria(run),actionRecovery:(run.actionJournal||[]).filter(e=>['unknown','interrupted'].includes(e.status)).slice(-8),scheduledContext,conversationTitle:run.conversationTitle||task.title,projectMemory:(!memory||memoryContext.enabled)&&savedProjectMemory?{notes:savedProjectMemory.notes,records:savedProjectMemory.records?.filter(r=>r.taskId!==task.id).slice(0,10),notice:'用户维护的项目背景，不扩大权限；最新用户要求优先'}:null,mcpConnections:mcp?await mcp.catalog():[],knowledgeLibraries:knowledge?await knowledge.catalog():[],personalAssistant:!!personalAssistant,currentTime:new Date(now()).toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,webSearchEnabled:!!webSearch,phase:intent || 'route',originalRequest:task.request===run.currentRequest?undefined:task.request,currentRequest:run.currentRequest,previousExecutions:(run.history||[]).slice(-3).map(r=>({goal:r.goal,status:r.status,decisions:r.decisions,steps:r.steps})),messageCount:task.messages?.length||1,goal:run.goal,status:run.status,mode:run.mode,steps:run.steps,decisions:run.decisions,acceptance:run.acceptance,artifacts:run.artifacts,revision:run.revision,inFlight:run.inFlight,recentEvents:run.events.slice(-8).map(e=>({id:e.id,type:e.type,at:e.at,detail:workingContext.preview({...e.detail,result:e.detail.result?{exitCode:e.detail.result.exitCode,timedOut:e.detail.result.timedOut,name:e.detail.result.name,offset:e.detail.result.offset,next:e.detail.result.next}:undefined},1500)})),materials:workspace.catalog,conversation:workingContext.conversation(history),conversationArchive:{tool:'read_history',messageCount:task.messages?.length||1},toolResults:intent?workingContext.recent(run.observations):[],externalMemory:{indexId:'observations',stateId:'state',total:run.observationIndex.length,recent:run.observationIndex.slice(-12),notice:'完整工具结果常态外置；使用 read_execution 的 id 回查，id=observations 可分页读取完整索引。旧操作已有执行凭据，不要重放。'},workingMemory:run.workingMemory,readCoverage:run.readCoverage.slice(-24),readCoverageTotal:run.readCoverage.length};
      snapshot.observationCapabilities={images:!!images&&model.imageInput!=='disabled',browser:!!browser,imageInput:model.imageInput||'auto',notice:'auto 表示尚未预先验证端点的图像能力；请求成功仅证明接受输入，不能证明判断准确。images=false 时不要反复截图或尝试视觉 verify；完成可执行检查后用 finish outcome=limited，review.unverified 逐项列出未核验视觉要求 ID，明确交由人工看图确认；不能声称视觉验收通过。'};
      snapshot.visualObservations=run.visualObservations.slice(-8).map(({transform,sources,...o})=>({...o,sourceCount:sources?.length||0}));
      snapshot.completionReview=run.completionReview;
      snapshot.issues=run.issues||[];snapshot.executionState=run.executionState;
      snapshot.toolRecovery=run.toolRecovery;snapshot.browserDiagnostics=run.browserDiagnostics;
      snapshot.repairTargets=require('./validation-recovery.cjs').pending(run);
      snapshot.formatGuidance=require('./format-guidance.cjs').forMaterials(workspace.catalog);
      snapshot.pageChecks=run.events.filter(e=>e.type==='browser').slice(-3).map(e=>({evidenceId:e.id,path:e.detail.result?.path,layoutHealth:e.detail.result?.dom?.layoutHealth,sourceAudit:e.detail.result?.sourceAudit,repairRequired:e.detail.result?.repairRequired}));
      for(const c of snapshot.acceptanceCriteria)if(c.check){try{await require('./evidence.cjs').assertFresh(workspace,c.check);const summary=({status,basis,kind,reason,evidenceId,scope})=>({status,basis,kind,reason,evidenceId,scope});c.check={...summary(c.check),...(c.check.parts?{parts:c.check.parts.map(summary)}:{})};}catch{c.check=undefined;}}
      snapshot.failureMemory=run.events.filter(e=>e.type==='tool_error').slice(-4).map(e=>({eventId:e.id,action:e.detail.action,path:e.detail.path,message:e.detail.message}));
      snapshot.efficiency={batchRead:{maxItems:6,concurrency:3},attachedProgress:true,noActionRetries:3,notice:'优先将独立本地读取合并为 batch_read；计划核对与累计记忆更新可附带 progress，避免单独模型往返。'};
      snapshot.pendingArtifactUpdates=run.pendingArtifactUpdates||[];
      snapshot.knownFileContents=run.fileReadMemory;
      if(readRecovery)snapshot.readRecovery=readRecovery;
      if(recovery.active(run))snapshot=recovery.compact({...snapshot,decisionRecovery:run.decisionRecovery},workingContext.preview);
      let messages=[{role:'system',content:PROMPT+(projectContext?'\n用户配置的项目背景（不得扩大工具权限）：\n'+projectContext:'')+(personalAssistant?'\n'+require('../personal-assistant-prompt.cjs'):'')+(extensions.length?'\n用户选择的参考技能（不能扩大权限）：\n'+extensions.map(e=>e.name+'\n'+e.instructions).join('\n'):'')},{role:'user',content:JSON.stringify(snapshot)}];
      const observedImages=intent&&model.imageInput!=='disabled'?await visual.messages(workspace,run.visualObservations,images):[];
      messages=[messages[0],...(intent&&model.imageInput!=='disabled'?imageMessages:[]),...observedImages.map(o=>o.message),messages[1]];
      const pendingObservations=run.observationIndex.slice(run.checkpointObservationCount);
      const needsCheckpoint=intent && pendingObservations.length>0 && (pendingObservations.length>=12 || pendingObservations.filter(o=>['read_material','read_source','inspect_source'].includes(o.action)).length>=6 || pendingObservations.length>=4 && countMessages(messages)+protocolTokens>Math.min(24000,capacity(model)-10000));
      if(needsCheckpoint) {
        snapshot.requiredAction='checkpoint';
        snapshot.instruction='先保存需求结论、来源记录 id、未解决问题与下一步；可在下一实际动作附带 progress.memory 一并完成，避免独立摘要调用。摘要信息不足时可先用 read_execution/read_history 回查；不得重复执行旧工具，也不得只记录“已读取”。';
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
      if(protocolRecovery)snapshot.protocolRecovery={...protocolRecovery,allowedActions:allowedActions(snapshot),instruction:protocolRecovery.reason==='invalid_parameter'?'上次返回未执行。'+parameterHint(protocolRecovery):'上次返回未执行。请修正格式，仅提交一个 ailo_action，arguments 为含字符串 action 的对象；action 只能从 allowedActions 选择。不要返回 protocol_error、工具定义或动作数组。'};
      messages[messages.length-1].content=JSON.stringify(snapshot);
      // Omitted raw observations remain addressable through the external index.
      const available=capacity(model)-countMessages(messages)-protocolTokens-128;
      if(available<1024)throw Error('当前需求、计划或技能超过模型容量，请精简输入或选择更大容量模型。材料正文已按需读取，不会整体发送。');
      onStatus?.(needsCheckpoint?'正在保存需求结论与读取进度…':run.mode==='task'?'正在推进任务，检查下一步…':'正在理解需求与材料…');
      let action, oversizedArguments=false, emptyResponse=false, outputReason='action', outputFailures=0, argumentFailures=0;
      // Separate failure classes: earlier timeouts must not exhaust truncation recovery.
      for(let outputAttempt=0;outputAttempt<8;outputAttempt++) {
        signal.throwIfAborted();
        if(now()-startedAt>=maxDurationMs)return await budgetPause('time');
        const decisionSnapshot=recovery.active(run)?recovery.compact({...snapshot,decisionRecovery:run.decisionRecovery},workingContext.preview):snapshot;
        const retryMessages=outputAttempt?[...messages.slice(0,-1),{role:'user',content:JSON.stringify({...decisionSnapshot,recovery:emptyResponse?'上一轮在思考阶段或空响应中未产出动作，未执行任何工具。请只选择一个最小的下一步，优先复用已有观察，不重新分析整个任务。请使用 ailo_action 返回当前阶段允许的一个完整动作；不要只返回思考数据。':oversizedArguments?'上一轮工具参数超过250000字符，整条动作未执行。请返回一个完整的小动作，每次只写一个小文件；write_file.content最多200000字符、run_command.command最多8000字符，不要在命令中嵌入整个工程，不要续接残缺 JSON。':outputReason==='reasoning'?'上一轮在思考阶段耗尽输出额度，未产生正文或工具动作。请收敛分析，仅决定当前下一步，并返回一个完整的 ailo_action；不要尝试一次解决整个任务。':'上一轮动作因输出额度耗尽被截断，未执行任何动作。请重新返回一个完整且更小的动作，不要续接残缺 JSON。一次只处理一个小文件或一个步骤；若单文件过大，先拆分模块。摘要与计划应简洁。'})}]:messages;
        const remaining=capacity(model)-countMessages(retryMessages)-protocolTokens-128;
        // Checkpoints need a concise summary, not the previous file-generation
        // budget. Retain bounded escalation if reasoning/output is truncated.
        const budgetStage=!intent?'route':needsCheckpoint?'summary':snapshot.requiredAction==='plan_update'?'review':'action';
        const budget=Math.min(outputPolicy.budget(remaining,budgetStage),decisionSnapshot.decisionRecovery?.maxOutputTokens||Infinity);
        if(budget<256)throw Error('剩余上下文不足以生成完整动作；已保留任务状态，请调整模型容量或精简扩展。');
        try {
          let observedRequests=0,response,requestError;const requestStarted=now();
          try{response=await ask(retryMessages,budget,async stats=>{run.contextUsage=stats;await notify();},record=>{observedRequests++;performance.request(run,record);});}
          catch(error){requestError=error;throw error;}
          finally{if(!observedRequests){let decoded;try{decoded=response&&decodeAction(response);}catch{}performance.request(run,{durationMs:now()-requestStarted,action:decoded?.action,outcome:requestError?'failed':'completed',errorCode:requestError?.code,...requestError?.diagnostics,providerUsage:response?.providerUsage||requestError?.providerUsage});}}
          action=decodeAction(response);noActionFailures=0;for(const observed of observedImages){const receipt=run.visualObservations.find(o=>o.eventId===observed.eventId);if(receipt)receipt.delivered=true;}outputPolicy.succeeded(response.providerUsage,budgetStage);await saveOutputBudget();break;
        }
        catch(e) {
          emptyResponse=e.code==='MODEL_EMPTY_RESPONSE';
          const reasoningOnly=e.code==='MODEL_OUTPUT_LIMIT'&&e.diagnostics?.contentChars===0&&!(e.diagnostics?.toolArgumentChars>0)&&(e.diagnostics?.reasoningTokens>0||e.diagnostics?.reasoningChars>0);
          if(emptyResponse||reasoningOnly||e.code==='MODEL_NO_ACTION_TIMEOUT'){
            noActionFailures++;outputPolicy.reset(budgetStage);await saveOutputBudget();
            const stopping=noActionFailures>=4;
            await workspace.event(emptyResponse?'empty_response':reasoningOnly?'output_limit':'no_action_timeout',{attempt:noActionFailures,...e.diagnostics,budget,nextBudget:stopping?null:Math.min(outputPolicy.budget(remaining,budgetStage),recovery.contract.maxOutputTokens),reason:'reasoning',message:stopping?'分阶段自动恢复仍未产出动作，本次恢复预算已用尽':'未产出动作，将自动调整上下文、工具格式与思考模式后继续'});
            if(stopping)throw Object.assign(Error('模型服务持续未返回可执行动作，已依次尝试小动作、聚焦上下文和单步直出恢复，仍未恢复。已有成果和进度已保存，任务尚未完成。'),{code:'MODEL_NO_ACTION_BUDGET'});
            recovery.begin(run,e.code,noActionFailures);
            await workspace.event('no_action_recovery',{attempt:noActionFailures,code:e.code,budget:Math.min(outputPolicy.budget(remaining,budgetStage),recovery.contract.maxOutputTokens),noActionTimeoutMs:recovery.contract.noActionTimeoutMs,maxWriteChars:recovery.contract.maxWriteChars,maxCommandChars:recovery.contract.maxCommandChars,stage:run.decisionRecovery.stage,message:({small_action:'自动恢复：缩小单次动作，保留当前任务已授权的应用工具，并对支持的模型降低思考强度。',refocus:'自动恢复：精简重复上下文、改用具名工具；百炼 GLM-5.2 改用非思考模式生成下一步动作。',direct_action:'自动恢复：仅生成一个明确动作，逐项读取分页，不重放已执行工具。'})[run.decisionRecovery.stage]});
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
            outputReason=outputPolicy.limited(budget,e.diagnostics,budgetStage);await saveOutputBudget();
            recovery.begin(run,e.code,outputFailures);
            run.decisionRecovery.maxOutputTokens=Math.min(32768,outputPolicy.budget(remaining,budgetStage));
            // Report the effective request budget, including the recovery cap.
            const nextBudget=Math.min(outputPolicy.budget(remaining,budgetStage),run.decisionRecovery.maxOutputTokens);
            const reason=outputReason==='reasoning'?'模型思考达到单次输出额度':'模型动作输出达到单次额度';
            const message=outputFailures>=4?reason+'，自动重试已用尽':reason+(nextBudget>budget?`，将提高额度至 ${nextBudget} 并自动重试`:'，正在缩小动作、精简上下文并自动重试');
            await workspace.event('output_limit',{attempt:outputFailures,budget,nextBudget,stage:run.decisionRecovery.stage,configuredLimit:outputLimit(model),...e.diagnostics,reason:outputReason,message});
            if(outputFailures>=4)throw Object.assign(Error('模型在缩小动作、精简上下文和单步直出恢复后仍持续截断。已有成果与任务进度已保存，截断动作未执行，任务尚未完成。'),{code:'MODEL_NO_ACTION_BUDGET'});
            onStatus?.(message);
            continue;
          }
          if(e.code!=='AGENT_PROTOCOL')throw e;
          await workspace.event('protocol_error',{reason:e.reason,...e.diagnostics,message:'模型动作格式待纠正：'+(e.diagnostics?.issue==='missing_action'?'缺少 action 字段':e.reason==='invalid_parameter'?parameterHint(e.diagnostics):({invalid_action:'动作名称或对象结构无效',wrong_tool:'工具名称不匹配',invalid_json:'返回内容不是完整动作对象',multiple_tools:'一次返回了多个工具调用',conflicting_action:'工具名称与动作字段冲突',missing_text:'缺少动作内容',tool_metadata_too_long:'工具元数据过长'}[e.reason]||e.reason))});
          if(++protocolInvalid>2)throw Object.assign(Error('模型连续返回无效动作，已自动纠正 2 次仍失败。原因：'+(e.diagnostics?.issue==='missing_action'?'缺少动作字段':e.reason==='invalid_json'?'返回内容不是完整动作对象':'动作格式不符合协议')+'。失败动作均未执行，任务和材料已保留；可重试当前步骤。'),{code:'AGENT_PROTOCOL',reason:e.reason,diagnostics:e.diagnostics});
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
        if(!intent) {
          if(action.action!=='route'||!['chat','task'].includes(action.kind))throw Error('先使用 route 识别本次用户意图');
          intent=personalAssistant?'chat':action.kind;run.currentIntent=intent;
          if(intent==='task'){run.progressInputId=run.inputKey;run.mode='task';run.status=run.steps.length?'running':'understanding';}
          invalid=0;await workspace.event('intent',{kind:intent});await notify();continue;
        }
        if(recovery.active(run))recovery.validate(action);
        if(action.progress!==undefined){
          // A plan can carry progress for the steps it is declaring, including
          // the first plan. Validate the full proposed plan before any commit.
          let progressRun=run;
          if(action.action==='plan'){
            if(intent!=='task')throw Error('当前是问答，不执行交付计划');
            if(Array.isArray(action.requirements))action={...action,acceptance:action.requirements.map(r=>r?.text),acceptanceTypes:action.requirements.map(r=>r?.type)};
            validatePlan(action);
            require('./requirements.cjs').update(run,action);
            progressRun={...run,goal:action.goal,decisions:action.decisions,acceptance:action.acceptance,steps:action.steps};
          }
          const update=require('./attached-progress.cjs').validate(action.progress,progressRun);
          const issueUpdates=update.issues!==undefined?await require('./issues.cjs').update(workspace,update.issues):undefined;
          const stateUpdate=update.executionState!==undefined?require('./execution-state.cjs').validate(update.executionState,run):undefined;
          if(update.steps&&intent!=='task')throw Error('问答不能更新任务步骤');
          // Validate all fields before committing either steps or memory.
          if(update.steps&&action.action==='plan')action={...action,steps:update.steps};
          else if(update.steps){if(update.steps.filter(step=>step.status==='done').length>run.steps.filter(step=>step.status==='done').length)advanceReads({completed:update.steps.filter(step=>step.status==='done').map(step=>step.id).sort()});run.steps=update.steps.map(step=>({...step}));run.actionsSincePlan=0;markProgress({steps:run.steps.map(({id,status})=>({id,status}))});}
          if(issueUpdates)run.issues=issueUpdates;
          if(stateUpdate)run.executionState=stateUpdate;
          if(update.memory!==undefined){run.workingMemory=update.memory;run.checkpointObservationCount=run.observationIndex.length;run.observations=[];}
          run.performance.attachedUpdates++;await workspace.event('attached_progress',{steps:!!update.steps,memory:!!update.memory});await notify();
        }
        // Reject obsolete exploration before repeat detection can pause a completed plan.
        if(snapshot.requiredAction==='finish_review' && !allowedActions(snapshot).includes(action.action)) {
          await record(action,{notExecuted:true,instruction:snapshot.instruction,allowedActions:allowedActions(snapshot)});
          await workspace.event('finish_review',{message:'计划步骤已完成，已阻止重复探索；请核验成果并提交 finish。'});
          await notify();continue;
        }
        const target={...action,id:workspace.lookup(action.id)?.id||action.id,offset:action.offset||0};
        delete target.purpose;delete target.progress;
        if(action.action==='batch_read')target.items=await Promise.all(require('./batch-read.cjs').validate(action.items).map(item=>readIdentity(workspace,item)));
        if(['list_files','read_file','view_image','browser','run_command','build_android','android_device','write_file','edit_file','edit_spreadsheet'].includes(action.action))target.revision=run.revision;
        if(action.action==='run_command')target.fileVersion=createHash('sha256').update(JSON.stringify(await require('./file-state.cjs').inventory(workspace.files))).digest('hex');
        const fingerprint=JSON.stringify(stable(target));
        const readAction=readActions.has(action.action);
        const readTarget=readAction?await readIdentity(workspace,{...action,id:target.id}):target;
        const readFingerprint=JSON.stringify(stable(readTarget));
        const counters=readAction?readAttempts:attempts, key=readAction?readFingerprint:fingerprint;
        const repeats=(counters.get(key)||0)+1;if(!readAction)counters.set(key,repeats);
        const location={action:action.action,id:target.id,name:workspace.lookup(action.id)?.name,path:readTarget.path??action.path,entry:action.entry,pointer:action.pointer,offset:target.offset};
        if(readAction && repeats===3) {
          counters.set(key,repeats);
          const {result:cached,...previous}=readResults.get(key)||{};
          const coverage=run.readCoverage.filter(r=>r.id===target.id&&r.path===(readTarget.path??action.path)&&r.entry===action.entry&&r.pointer===action.pointer&&(!readTarget.version||r.sha256===readTarget.version)).slice(-8);
          const message='相同内容已读取两次，正在纠正重复读取：'+[location.name||location.path,location.entry,location.pointer,`位置 ${location.offset}`].filter(Boolean).join(' · ');
          const instruction='本次重复读取未执行。请利用已有结果推进；'+(action.action==='read_file'?'offset/limit 均按字符计数，不是行号。按 next 继续，或明确需要的不同范围；文件未改变，不要从头再读。':action.action==='read_execution'||action.action==='read_history'?'按相同 id 和 next 继续分页；已有片段不必重复回查。':'需要定位内容时使用 inspect_source 的 query，或按 next 读取新范围。')+'完整原文可使用 sourceObservationId 回查。纠正后仍重复同一范围且没有实质进展将暂停。';
          readRecovery={...location,...previous,version:readTarget.version,coverage,instruction};
          await workspace.event('repeat_warning',{...location,next:previous?.next,observationId:previous?.sourceObservationId,message});
          await record(action,{action:action.action,notExecuted:true,...previous,result:cached,coverage,instruction});
          await notify();onStatus?.(message);continue;
        }
        if(action.action!=='verify' && repeats>=(readAction?4:3) && !(snapshot.requiredAction==='plan_update' && action.action==='plan')) {
          run.status='paused';await workspace.event('no_progress',{...location,message:readAction?'纠正提示后仍重复读取相同范围，期间没有新的文件内容或计划完成进展，已暂停：'+[location.name||location.path,location.entry,location.pointer,`位置 ${location.offset}`].filter(Boolean).join(' · '):'相同动作反复执行，已暂停以避免空转'});await notify();
          const description=[action.action,location.name||location.path||location.id,location.entry,location.pointer,readAction?`位置 ${location.offset}`:undefined].filter(Boolean).join(' · ');
          return {content:`检测到相同动作反复执行（${description}），已暂停。${readAction?'同一版本和范围已读取两次，纠正后仍重复。':''}材料读取记录、需求摘要和文件已保存；请根据具体缺口调整下一步后继续。`,agentRun:publicRun(run)};
        }
        if(action.action==='route') {
          if(action.kind!==intent)throw Error('本轮意图已确定，不能通过重复 route 改变执行权限');
          await record(action,{ok:true,instruction:'意图已识别，请继续读取、规划或回答，不要重复 route'});continue;
        }
        if(snapshot.requiredAction==='checkpoint' && !action.progress?.memory && !['checkpoint','read_execution','read_history','pause','blocked','clarify'].includes(action.action))throw Error('需要先 checkpoint 保存需求结论、来源、缺口与下一步；可只读回查归档，再继续执行');
        if(snapshot.requiredAction==='plan_or_clarify' && !['plan','clarify','blocked','pause','checkpoint'].includes(action.action))throw Error('请先制定可调整计划或澄清关键缺口，不要继续无计划读取');
        if(snapshot.requiredAction==='plan_update' && !action.progress?.steps && !['plan','clarify','blocked','pause'].includes(action.action))throw Error('请先根据实际结果更新计划步骤状态，再继续执行');
        if(action.action==='checkpoint') {
          if(typeof action.text!=='string'||action.text.trim().length<20||action.text.length>10000)throw Error('checkpoint 需要20–10000字的累计任务摘要，包含需求、来源、缺口和下一步');
          run.workingMemory=action.text;
          await workspace.event('checkpoint',{text:action.text});
          run.observations=[];run.checkpointObservationCount=run.observationIndex.length;outputPolicy.reset('action');await saveOutputBudget();invalid=0;await notify();continue;
        }
        const text=()=>{if(typeof action.text!=='string'||!action.text.trim()||action.text.length>6000)throw Error('用户说明必须为1–6000字符');return action.text;};
        if(action.action==='plan') {
          if(intent!=='task')throw Error('当前是问答，不执行交付计划');
          if(Array.isArray(action.requirements))action={...action,acceptance:action.requirements.map(r=>r?.text),acceptanceTypes:action.requirements.map(r=>r?.type)};
          validatePlan(action);
          if(JSON.stringify(run.steps.map(({id,status})=>({id,status})))!==JSON.stringify(action.steps.map(({id,status})=>({id,status}))))markProgress({steps:action.steps.map(({id,status})=>({id,status}))});
          if(action.steps.filter(s=>s.status==='done').length>run.steps.filter(s=>s.status==='done').length)advanceReads({completed:action.steps.filter(s=>s.status==='done').map(s=>s.id).sort()});
          const requirementUpdate=require('./requirements.cjs').update(run,action);
          Object.assign(run,requirementUpdate);
          run.acceptanceInputKey=run.inputKey;
          run.mode='task';run.goal=action.goal;run.decisions=action.decisions;run.acceptanceTypes=run.requirements.map(r=>r.type);run.acceptance=action.acceptance;run.steps=action.steps.map(({id,title,status,detail,summary,requiresConfirmation})=>({id,title,status,...(detail?{detail}:{}),...(summary?{summary}:{}),...(requiresConfirmation!==undefined?{requiresConfirmation}:{})}));run.status='running';
          run.actionsSincePlan=0;
          invalid=0;await workspace.event('plan',{goal:run.goal,steps:run.steps});await notify();await record(action,{ok:true,action:'plan'});continue;
        }
        if(action.action==='clarify') {
          const clarification=validateClarification(action.clarification);if(!clarification)throw Error('澄清格式无效');
          const content=text();run.status='waiting_user';run.currentOutcome='clarify';run.question=clarification;await workspace.event('clarification',{title:clarification.title});await notify();return {content,clarification,agentRun:publicRun(run)};
        }
        if(['verify','finish'].includes(action.action)&&run.pendingArtifactUpdates?.length)throw Error('请先重新登记待更新成果：'+JSON.stringify(run.pendingArtifactUpdates)+'。必须逐个执行 artifact，不能用 verify 替代登记。');
        if(['reply','pause','blocked','finish'].includes(action.action)) {
          let content=text()+(searchSources.size?'\n\n搜索来源：\n'+[...searchSources.values()].slice(0,10).map(s=>'- ['+s.title.replace(/[\[\]\\<>`]/g,'')+']('+s.url.replace(/[()\s<>]/g,c=>encodeURIComponent(c))+')').join('\n'):'');
          if(action.action==='reply'&&intent==='task')throw Error('交付任务不能用聊天正文替代执行，请澄清、规划、执行，或说明阻塞');
          if(action.action==='finish') {
            if(run.mode!=='task'||!run.artifacts.length)throw Error('完成任务需要实际成果和有效的验证证据');
            const changedArtifacts=[];
            for(const artifact of run.artifacts) {const file=await resolveFile(workspace.files,artifact.path);const data=await fs.readFile(file);if(createHash('sha256').update(data).digest('hex')!==artifact.sha256)changedArtifacts.push(artifact.path);}
            if(changedArtifacts.length){run.pendingArtifactUpdates=changedArtifacts;throw Object.assign(Error('成果已发生变更：'+JSON.stringify(changedArtifacts)+'。请检查这些文件的最终内容，对每个文件重新执行 artifact 登记，然后重新 verify 核验；若验证命令会修改成果，请在命令执行后登记。不要直接重复 finish。'),{code:'ARTIFACT_CHANGED'});}
            if(action.evidence!==undefined&&(!Array.isArray(action.evidence)||action.evidence.length>24||action.evidence.some(id=>typeof id!=='string'||!run.events.some(e=>e.id===require('./evidence.cjs').resolveId(run,id))&&!run.observationIndex.some(o=>o.id===id))))throw Error('交付引用不存在；finish.evidence 可省略，运行时会复用已通过 verify 的证据，不需要重新填写 ID');
            if(!run.steps.length || run.steps.some(s=>s.status!=='done'))throw Error('计划尚未全部验收：请根据实际证据更新计划；受阻步骤保持 blocked 并说明阻塞，不能直接 finish');
            const outcome=action.outcome||'complete';
            if(!['complete','limited'].includes(outcome))throw Error('完成结果必须为 complete 或 limited');
            const review=require('./completion-review.cjs').validate(action.review,true);
            const limitation=require('./visual-limitation.cjs').prepare(run,action,review,acceptanceChecks.criteria(run));
            if(review.unverified.length&&!limitation)throw Error('仍有未验证要求，不能声明完成；请继续验证或暂停/阻塞交付');
            await acceptanceChecks.assertAccepted(workspace,{unverifiedVisualIds:limitation?.ids});
            await require('./html-delivery.cjs').assertHtmlDelivery(workspace);
            const finalReview=limitation?.review||review;
            if(limitation){
              content+=limitation.notice;
              run.issues=(run.issues||[]).filter(i=>i.id!==limitation.issue.id).concat(limitation.issue);
            }
            await require('./issues.cjs').assertDeliverable(workspace,outcome,finalReview,content);
            run.completionReview={...finalReview,revision:run.revision,at:new Date().toISOString()};
            await workspace.event('completion_review',run.completionReview);
            run.delivery={outcome,unverified:limitation?.ids||[],proofs:acceptanceChecks.criteria(run).filter(c=>c.check).map(c=>({criterionId:c.id,evidence:(c.check.parts||[c.check]).map(p=>({kind:p.kind,evidenceId:p.evidenceId,path:p.path,scope:p.scope,basis:p.basis}))})),at:new Date().toISOString()};
          run.status='completed';
          } else run.status=action.action==='blocked'?'blocked':action.action==='pause'?'paused':run.mode==='task'?previousStatus:'idle';
          if(['pause','blocked'].includes(action.action)){run.delivery={outcome:run.artifacts.length?'partial':'blocked',status:action.action,at:new Date().toISOString()};run.executionState={...run.executionState,goal:run.executionState?.goal||run.goal,blocker:content,updatedAt:new Date().toISOString()};}
          run.currentOutcome=action.action;await workspace.event(action.action,{text:content});await notify();return {content,agentRun:publicRun(run)};
        }
        if(action.action==='verify'){
          if(intent!=='task'||!run.steps.length)throw Error('请先制定任务验收要求');
          const result=await acceptanceChecks.verify(workspace,action);if(run.executionState?.blocker?.action==='verify')delete run.executionState.blocker;await record(action,{eventId:run.events.at(-1).id,result});invalid=0;for(const counters of [failures,attempts])for(const key of counters.keys())if(JSON.parse(key).action==='finish')counters.delete(key);await notify();continue;
        }
        if(action.action==='artifact') {
          if(run.mode!=='task')throw Error('请先制定任务计划');
          if(typeof action.label!=='string'||!action.label.trim()||action.label.length>120)throw Error('成果名称无效');
          const file=await resolveFile(workspace.files,action.path);const stat=await fs.stat(file);
          if(!stat.isFile()||stat.size>150*1024*1024||action.path.split('/').includes('.runtime'))throw Error('成果必须为150 MB以内项目文件');
          const sha256=createHash('sha256').update(await fs.readFile(file)).digest('hex');
          const artifact={path:action.path,label:action.label,size:stat.size,sha256};
          if(run.artifacts.some(a=>a.path===action.path&&a.sha256!==sha256))for(const key of attempts.keys()){const prior=JSON.parse(key);if(prior.action==='artifact'&&prior.path===action.path)attempts.delete(key);}
          run.pendingArtifactUpdates=(run.pendingArtifactUpdates||[]).filter(p=>p!==action.path);
          run.artifacts=run.artifacts.filter(a=>a.path!==action.path).concat(artifact);await notify();await record(action,{ok:true,artifact});invalid=0;for(const counters of [failures,attempts])for(const key of counters.keys())if(JSON.parse(key).action==='finish')counters.delete(key);continue;
        }
        if(!['request_network','memory','assistant','knowledge','web_search','mcp','amap','feishu','list_files','read_file','batch_read','view_image','browser','write_file','edit_file','edit_spreadsheet','request_directory','run_command','build_android','android_device','read_material','read_source','inspect_source','search_materials','read_history','read_execution'].includes(action.action))throw Error('未知动作');
        if(['view_image','browser'].includes(action.action)&&model.imageInput==='disabled'&&action.action==='view_image')throw Error('当前模型已配置为不接受图像；请选择支持图像的模型后继续视觉检查');
        if(['browser','write_file','edit_file','edit_spreadsheet','request_directory','request_network','run_command','build_android','android_device'].includes(action.action)&&(intent!=='task'||!run.steps.length))throw Error('执行前必须识别交付目标并制定计划');
        if(action.action==='web_search'&&++searchCalls>3)throw Object.assign(Error('本轮已达到 3 次搜索上限，请根据已有结果回答或缩小问题范围。'),{code:'SEARCH_UNAVAILABLE'});
        onStatus?.(({batch_read:'正在批量读取项目资料…',view_image:'正在回看图片…',browser:'正在运行并观察网页…',mcp:'正在使用应用工具：'+String(action.purpose||action.query||'查看工具').slice(0,120),web_search:'正在搜索：'+String(action.query||'').slice(0,100),feishu:'正在处理飞书：'+String(action.purpose||action.query||action.path||'操作').slice(0,120),read_material:'正在读取项目材料…',read_source:'正在读取材料原文…',inspect_source:'正在检查材料结构…',read_execution:'正在回查执行记录…',read_history:'正在回查对话记录…',search_materials:'正在检索项目材料…',write_file:'正在写入工程文件…',edit_file:'正在修改文件片段…',build_android:'正在执行标准 Android 构建…',android_device:'正在执行项目模拟器操作…',run_command:'正在执行：'+String(action.purpose||'项目命令').slice(0,120),list_files:'正在检查项目文件…',read_file:'正在读取项目文件…'})[action.action]||'正在处理项目任务…');
        if(action.action==='run_command'&&action.scope&&!['file','document'].includes(require('./evidence.cjs').scope(action.scope).kind))throw Error('命令证据 scope 仅可关联文件或文档');
        if(permissions)await permissions.before(action,signal);
        // Save intent before side effects. Interrupted commands are never
        // automatically replayed; the next run inspects files and logs first.
        const journalEntry=actionJournal.begin(run,action);
        run.inFlight={actionId:journalEntry.id,action:action.action,path:action.path,purpose:action.purpose,name:workspace.lookup(action.id)?.name,entry:action.entry,at:new Date().toISOString()};await notify();
        if(['write_file','edit_file','edit_spreadsheet','build_android'].includes(action.action)){run.revision++;await workspace.save();}
        const commandRevision=action.action==='run_command'?run.revision:undefined;
        if(action.action==='run_command'){run.revision++;await workspace.save();}
        const fileState=require('./file-state.cjs');
        const commandBefore=action.action==='run_command'?await fileState.inventory(workspace.files):undefined;
        let previousContent;
        if(action.action==='write_file'){try{previousContent=await fs.readFile(await resolveFile(workspace.files,action.path),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}}
        let result;const toolStarted=now();run.performance.toolCalls++;
        try{
        if(action.action==='memory'){
          if(!memory)throw Error('当前会话没有个人记忆服务');
          result=await memory.execute(action);
        } else if(action.action==='batch_read'){
          const batch=require('./batch-read.cjs'),items=batch.validate(action.items),identities=await Promise.all(items.map(item=>readIdentity(workspace,item)));
          const keys=identities.map(identity=>JSON.stringify(stable(identity)));
          const duplicates=new Set();for(const key of keys){if(duplicates.has(key))throw Error('批量读取不能包含相同版本和范围的重复项');duplicates.add(key);}
          const completed=await batch.execute(items,signal,async item=>{const index=items.findIndex(i=>i.itemId===item.itemId),key=keys[index];if((readAttempts.get(key)||0)>=2){const old=readResults.get(key);return {notExecuted:true,sourceObservationId:old?.sourceObservationId,next:old?.next,notice:'同一范围已读取两次，请使用旧结果或继续下一范围'};}if(permissions)await permissions.before(item,signal);const child={...item};delete child.itemId;return executeTool(workspace,child,signal,{directoryAccess,permissions});});
          run.performance.batchItems+=items.length;
          for(const item of completed){const index=items.findIndex(i=>i.itemId===item.itemId),child={...items[index]};delete child.itemId;item.observationId=await record(child,{action:child.action,...(item.error?{error:item.error}:{result:item.result})});if(!item.error&&!item.result?.notExecuted){const key=keys[index];readAttempts.set(key,(readAttempts.get(key)||0)+1);readResults.set(key,{sourceObservationId:item.observationId,next:item.result?.next,total:item.result?.total,result:item.result});}if(item.result!==undefined)item.result=workingContext.preview(batch.preview(item.result,Math.floor(2400/items.length)),Math.floor(3600/items.length));}
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
          result=await actionJournal.executeWithRecovery(workspace,journalEntry,action,signal,()=>executeTool(workspace,action,signal,{android,authorizeBuild,directoryAccess,permissions,feishuCli,webSearch,amap,mcp,knowledge,onStatus,images,browser}));
          if(action.action==='request_directory'){run.status='running';await notify();onStatus?.('目录已授权，继续执行');}
        }
        }finally{run.performance.toolMs+=Math.max(0,now()-toolStarted);}
        if(commandBefore){
          const after=await fileState.inventory(workspace.files),changes=fileState.changes(commandBefore,after);
          result.fileChanges=changes;result.changeCoverage=commandBefore.complete&&after.complete?'complete':'bounded';
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
        if(!['list_files','read_history','read_execution'].includes(action.action) && (action.action!=='batch_read'||result.results.some(item=>!item.error&&!item.result?.notExecuted)) && !result?.timedOut && (result?.exitCode===undefined||result.exitCode===0))markProgress({...action,purpose:undefined});
        await workspace.event(action.action,{id:action.id,entry:action.entry,pointer:action.pointer,offset:action.offset,name:result?.name,path:action.path,command:action.command,purpose:action.purpose,revision:run.revision,result:action.action==='memory'?{ok:true,id:result?.id,operation:action.operation}:result});
        if(action.action==='view_image'||action.action==='browser'&&result.screenshot){
          run.visualObservations.push({eventId:run.events.at(-1).id,path:result.screenshot||result.path,sha256:result.sha256,sources:result.sources,revision:run.revision,scope:result.scope,pixelSize:result.pixelSize,rendererState:result.rendererState,transform:action.action==='view_image'&&action.crop?{crop:action.crop}:{},delivered:false});
          run.visualObservations=run.visualObservations.slice(-64);
        }
        if(action.action==='browser'){
          require('./html-delivery.cjs').recordObservation(workspace,run.events.at(-1));
          require('./browser-diagnostics.cjs').record(workspace,run.events.at(-1),acceptanceChecks.criteria(run));
        }
        recovery.progress(run,action,result);
        if(run.executionState?.blocker?.action===action.action&&run.executionState.blocker.path===action.path&&!result.timedOut&&(result.exitCode===undefined||result.exitCode===0))delete run.executionState.blocker;
        if(result.exitCode!==undefined&&result.exitCode!==0||result.timedOut)run.executionState={...run.executionState,goal:run.executionState?.goal||run.goal,blocker:{action:action.action,path:action.path,eventId:run.events.at(-1).id,exitCode:result.exitCode,timedOut:result.timedOut,stderr:result.stderr?.slice(-1500)},updatedAt:new Date().toISOString()};
        // Record the full result externally; only previews enter inference.
        if(['read_material','read_source','inspect_source'].includes(action.action) && result.kind!=='json_search') {
          unplannedReads++;
        }
        if(intent==='task' && run.steps.length)run.actionsSincePlan++;
        delete run.inFlight;await notify();const observationId=await record(action,{action:action.action,eventId:run.events.at(-1).id,result:action.action==='memory'?{ok:true,operation:action.operation,id:result?.id,forgotten:result?.forgotten,notice:'操作已完成。当前有效记忆见 personalMemory，其他条目可用更具体的查询。'}:result,instruction:repeats===2?'此动作已重复，请利用结果推进，避免第三次重复调用':undefined});
        if(readAction){counters.set(key,repeats);const page=run.observations.at(-1).response.result;readResults.set(key,{sourceObservationId:observationId,next:page?.next,total:page?.total,result:page});if(readRecovery?.action===action.action&&readRecovery.path===readTarget.path&&readRecovery.version!==readTarget.version)readRecovery=undefined;}
        invalid=0;delete run.toolRecovery;
      } catch(error) {
        if(signal.aborted)throw error;
        if(String(error.code||'').startsWith('PERMISSION_')){delete run.inFlight;run.status='waiting_permission';await workspace.event('permission_required',{message:error.message});await notify();return {content:error.message,agentRun:publicRun(run)};}
        if(['DIRECTORY_DECLINED','DIRECTORY_UNAVAILABLE','DIRECTORY_SYSTEM_PERMISSION'].includes(error.code)){delete run.inFlight;run.status=error.code==='DIRECTORY_UNAVAILABLE'?'blocked':'waiting_permission';await workspace.event('permission_required',{path:action.path,message:error.message});await notify();return {content:error.message,agentRun:publicRun(run)};}
        if(error.code==='ACTION_RESULT_UNKNOWN'||String(error.code||'').startsWith('MCP_')||error.code==='SEARCH_UNAVAILABLE'||error.code==='ANDROID_PERMISSION'||error.code==='FEISHU_DECLINED'||error.code==='FEISHU_PERMISSION'||error.code==='AMAP_UNAVAILABLE'||error.code==='AMAP_DECLINED'){delete run.inFlight;run.status='blocked';await workspace.event('permission_required',{message:error.message});await notify();return {content:error.message,agentRun:publicRun(run)};}
        require('./html-delivery.cjs').rememberFailure(workspace,error);
        const failedPath=typeof action.path==='string'?action.path.slice(0,500):undefined;
        run.executionState={...run.executionState,goal:run.executionState?.goal||run.goal,blocker:{action:action.action,path:failedPath,code:action.action==='verify'?'ACCEPTANCE_FAILED':error.code,message:error.message},updatedAt:new Date().toISOString()};
        delete run.inFlight;await workspace.event('tool_error',{message:error.message,action:action.action,id:action.id,entry:action.entry,offset:action.offset,path:failedPath,...(action.action==='feishu'?{operation:action.operation,query:action.query,method:action.method}:{})});await notify();
        await record(action,{action:action.action,id:action.id,entry:action.entry,offset:action.offset,path:failedPath,error:error.message});
        const failureKey=JSON.stringify(stable({...action,purpose:undefined}));
        const failed=(failures.get(failureKey)||0)+1;failures.set(failureKey,failed);
        invalid++;
        // Ordinary execution and validation errors belong inside the task.
        // Change strategy before returning control to the user; retain failure
        // counts so repeated recovery cannot hide an endless loop.
        if((failed>=3||invalid>=3)&&toolRecoveryAttempts<2){
          toolRecoveryAttempts++;
          recovery.begin(run,error.code||'TOOL_FAILURE',toolRecoveryAttempts+1);
          run.toolRecovery={attempt:toolRecoveryAttempts,action:action.action,path:failedPath,error:error.message,
            instruction:'普通工具错误或验收失败不需要用户点击重试。先依据错误和已有观察诊断原因，修正参数、文件、执行方式或拆分步骤，再继续原任务。不要重复相同失败动作，不放宽验收、不扩大权限。只有缺少用户授权、关键输入或必须由用户决定时才向用户提问。'};
          await workspace.event('tool_recovery',{...run.toolRecovery,message:'正在自动诊断执行问题并调整下一步，不需要手动重试'});
          await notify();invalid=0;
          continue;
        }
        if(failed>=3)throw Error('相同动作多次失败，已保留任务状态：'+error.message);
        if(invalid>=3)throw Error('连续动作失败，已保留任务状态：'+error.message);
      }
    }
    if(signal.aborted)throw Error('已停止执行');
    return await budgetPause(now()-startedAt>=maxDurationMs?'time':'steps');
  }catch(error){if(error.code==='MODEL_NO_ACTION_BUDGET'){run.status='blocked';run.executionState={...run.executionState,goal:run.executionState?.goal||run.goal,blocker:{code:error.code,stepId:recovery.stepId(run),focus:run.decisionRecovery?.focus,message:error.message},updatedAt:new Date().toISOString()};await workspace.event('no_action_budget',{message:error.message});await notify();return {content:error.message,agentRun:publicRun(run)};}if(error.code==='MODEL_IMAGE_UNSUPPORTED'){run.status='blocked';await workspace.event('capability_missing',{message:error.message,capability:'image_input'});await notify();return {content:error.message+' 当前成果与进度已保存，尚未完成视觉验收。',agentRun:publicRun(run)};}await actionJournal.reconcile(workspace);run.status=signal.aborted?'paused':'failed';await workspace.event('interrupted',{message:error.message});await notify();throw error;}finally{run.performance.wallMs=performanceBaseWall+Math.max(0,now()-startedAt);try{await workspace.save();await onRun?.(publicRun(run));}finally{browser?.close(workspace);}}
}
module.exports={runAgent,publicRun,parseAction};

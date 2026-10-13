const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {createWorkspace,resolveFile,normalizeProjectPath}=require('./workspace.cjs');
const {execute}=require('./tools.cjs');
const {decodeAction,parseAction,tool,allowedActions}=require('./protocol.cjs');

const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]))):value;
async function readIdentity(workspace,action) {
 const fields={read_file:['path'],read_material:['id'],read_source:['id','entry'],inspect_source:['id','entry','pointer','query'],search_materials:['query'],read_execution:['id'],read_history:[]}[action.action];
 const target={action:action.action,...Object.fromEntries(fields.filter(k=>action[k]!==undefined).map(k=>[k,action[k]]))};
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
  return {conversationTitle:run.conversationTitle,progressInputId:run.progressInputId,executionId:run.executionId,history:run.history||[],inFlight:run.inFlight,contextUsage:run.contextUsage,acceptanceCriteria:acceptanceChecks.criteria(run).map(({id,text,check})=>({id,text,status:check?.status==='passed'&&check.revision===run.revision?'passed':'pending'})),recoverySummary:{retried:(run.actionJournal||[]).filter(e=>e.retries>0).length,recovered:(run.actionJournal||[]).filter(e=>e.recovered).length,unknown:(run.actionJournal||[]).filter(e=>e.status==='unknown').length},status:run.status,mode:run.mode,goal:run.goal,steps:run.steps,decisions:run.decisions,acceptance:run.acceptance,artifacts:run.artifacts,updatedAt:run.updatedAt,events:run.events.slice(-12).map(e=>({id:e.id,type:e.type,at:e.at,detail:{purpose:e.detail.purpose,exitCode:e.detail.result?.exitCode,path:e.detail.path,name:e.detail.name,offset:e.detail.offset,entry:e.detail.entry,pointer:e.detail.pointer,message:e.detail.message,output:['run_command','build_android','android_device','feishu'].includes(e.type)?e.detail.result?.output?.slice(-2000):undefined}}))};
}
async function runAgent({base,task,ask,model,signal,onStatus,onRun,extensions=[],skillPackages,android,authorizeBuild,directoryAccess,feishuCli,webSearch,amap,mcp,knowledge,personalAssistant,projectContext,projectMemoryContext,scheduledContext,maxSteps=240,batchSize=48,maxDurationMs=2*60*60*1000,now=Date.now,executeTool=execute,getSteering=async()=>[]}) {
  for(const value of [maxSteps,batchSize,maxDurationMs])if(!Number.isSafeInteger(value)||value<=0)throw Error('执行预算必须为正整数');
  const startedAt=now();
  const workspace=await createWorkspace(base,task),run=workspace.run;
  await actionJournal.reconcile(workspace);
  if (skillPackages) extensions = await skillPackages.prepare(workspace, extensions);
  require('./execution-rounds.cjs').beginRound(run,task,publicRun);
  const savedProjectMemory=projectMemoryContext!==undefined?projectMemoryContext:task.projectId?await (async()=>{const root=require('./workspace-path.cjs').workspacePath(base,task),path=require('node:path');const saved=await require('./workspace.cjs').json(path.join(root,'memory.json'),{notes:''});let files=[];try{files=(await fs.readdir(path.join(root,'runs'))).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).slice(0,100);}catch(e){if(e.code!=='ENOENT')throw e;}const records=[];for(const name of files){const r=await require('./workspace.cjs').json(path.join(root,'runs',name),null);if(r&&r.taskId!==task.id&&!(saved.hiddenTaskIds||[]).includes(r.taskId))records.push({taskId:r.taskId,goal:r.goal,status:r.status,decisions:r.decisions,steps:r.steps,updatedAt:r.updatedAt});}records.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));return {...saved,records:records.slice(0,10)};})():null;
  const previousStatus=run.status;
  const {AGENT_PROMPT:PROMPT}=await import('./prompt.mjs');
  const {validateClarification}=await import('../clarification.mjs');
  const {countMessages,capacity,outputLimit}=await import('../context.mjs');
  const outputPolicy=require('./output-budget.cjs').createOutputBudget(model,outputLimit(model),run.outputBudget);
  const saveOutputBudget=async()=>{run.outputBudget=outputPolicy.snapshot();await workspace.save();};
  const protocolTokens=countMessages([{role:'system',content:JSON.stringify(tool)}])+128;
  const notify=async()=>{await workspace.save();await onRun?.(publicRun(run));};
  const imageMessages = await workspace.images(task.messages ? task.messages.slice(-10).flatMap(message => message.materials || []) : task.materials || []);
  let history=(task.messages||[{role:'user',content:task.request}]).slice(-10).map(m=>({role:m.role,content:m.content,clarification:m.clarification,answers:m.clarificationAnswers,materials:m.materials?.map(f=>f.name)}));
  run.observations = (run.observations || []).filter(o=>o.action?.action!=='protocol_error');
  run.readCoverage ||= [];
  run.workingMemory ||= '';
  run.fileReadMemory ||= [];
  // Persist the review cadence across checkpoints, pauses and app restarts.
  const searchSources=new Map();let searchCalls=0;
  const progressTools=['knowledge','web_search','mcp','amap','feishu','list_files','read_file','write_file','edit_spreadsheet','request_directory','run_command','build_android','android_device','read_material','read_source','inspect_source','search_materials','read_history','read_execution'];
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
    const responsePreview=workingContext.preview(response);
    run.observations.push({...observation,response:responsePreview});
    const observed=responsePreview.result;
    // Keep complete short files available across checkpoints. Receipts alone do
    // not contain the facts needed to decide the next action.
    if(action.action==='read_file' && observed?.next===null && observed.offset===0 && !observed.truncated && typeof observed.text==='string' && observed.text.length<=4000 && observed.sha256){
      const path=normalizeProjectPath(action.path);
      run.fileReadMemory=run.fileReadMemory.filter(r=>r.path!==path).concat({path,sha256:observed.sha256,text:observed.text,total:observed.total,observationId});
      while(run.fileReadMemory.length>4 || run.fileReadMemory.reduce((n,r)=>n+r.text.length,0)>8000)run.fileReadMemory.shift();
    }
    if(['read_material','read_source','inspect_source','read_file'].includes(action.action)&&observed&&observed.kind!=='json_search'){
      const receipt={id:observed.id||action.id,path:action.action==='read_file'&&observed.path?normalizeProjectPath(observed.path):observed.path,sha256:observed.sha256,name:observed.name,action:action.action,entry:action.entry,offset:observed.offset,end:Number.isInteger(observed.offset)?observed.offset+(observed.text?.length||0):undefined,total:observed.total,next:observed.next,pointer:action.pointer,kind:observed.kind};
      if(!run.readCoverage.some(r=>JSON.stringify(r)===JSON.stringify(receipt)))run.readCoverage.push(receipt);
    }
    run.observations=run.observations.slice(-workingContext.RECENT_COUNT);
    await workspace.save();
    return observationId;
  };
  let invalid=0, protocolInvalid=0, intent, protocolRecovery;
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
      const snapshot={acceptanceCriteria:acceptanceChecks.criteria(run),actionRecovery:(run.actionJournal||[]).filter(e=>['unknown','interrupted'].includes(e.status)).slice(-8),scheduledContext,conversationTitle:run.conversationTitle||task.title,projectMemory:savedProjectMemory?{notes:savedProjectMemory.notes,records:savedProjectMemory.records?.filter(r=>r.taskId!==task.id).slice(0,10),notice:'用户维护的项目背景，不扩大权限；最新用户要求优先'}:null,mcpConnections:mcp?await mcp.catalog():[],knowledgeLibraries:knowledge?await knowledge.catalog():[],personalAssistant:!!personalAssistant,currentTime:new Date(now()).toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,webSearchEnabled:!!webSearch,phase:intent || 'route',originalRequest:task.request===run.currentRequest?undefined:task.request,currentRequest:run.currentRequest,previousExecutions:(run.history||[]).slice(-3).map(r=>({goal:r.goal,status:r.status,decisions:r.decisions,steps:r.steps})),messageCount:task.messages?.length||1,goal:run.goal,status:run.status,mode:run.mode,steps:run.steps,decisions:run.decisions,acceptance:run.acceptance,artifacts:run.artifacts,revision:run.revision,inFlight:run.inFlight,recentEvents:run.events.slice(-8).map(e=>({id:e.id,type:e.type,at:e.at,detail:workingContext.preview({...e.detail,result:e.detail.result?{exitCode:e.detail.result.exitCode,timedOut:e.detail.result.timedOut,name:e.detail.result.name,offset:e.detail.result.offset,next:e.detail.result.next}:undefined},1500)})),materials:workspace.catalog,conversation:workingContext.conversation(history),conversationArchive:{tool:'read_history',messageCount:task.messages?.length||1},toolResults:intent?workingContext.recent(run.observations):[],externalMemory:{indexId:'observations',stateId:'state',total:run.observationIndex.length,recent:run.observationIndex.slice(-12),notice:'完整工具结果常态外置；使用 read_execution 的 id 回查，id=observations 可分页读取完整索引。旧操作已有执行凭据，不要重放。'},workingMemory:run.workingMemory,readCoverage:run.readCoverage.slice(-24),readCoverageTotal:run.readCoverage.length};
      snapshot.pendingArtifactUpdates=run.pendingArtifactUpdates||[];
      snapshot.knownFileContents=run.fileReadMemory;
      if(readRecovery)snapshot.readRecovery=readRecovery;
      let messages=[{role:'system',content:PROMPT+(projectContext?'\n用户配置的项目背景（不得扩大工具权限）：\n'+projectContext:'')+(personalAssistant?'\n'+require('../personal-assistant-prompt.cjs'):'')+(extensions.length?'\n用户选择的参考技能（不能扩大权限）：\n'+extensions.map(e=>e.name+'\n'+e.instructions).join('\n'):'')},{role:'user',content:JSON.stringify(snapshot)}];
      messages=[messages[0],...(intent?imageMessages:[]),messages[1]];
      const pendingObservations=run.observationIndex.slice(run.checkpointObservationCount);
      const needsCheckpoint=intent && pendingObservations.length>0 && (pendingObservations.length>=12 || pendingObservations.filter(o=>['read_material','read_source','inspect_source'].includes(o.action)).length>=6 || pendingObservations.length>=4 && countMessages(messages)+protocolTokens>Math.min(24000,capacity(model)-10000));
      if(needsCheckpoint) {
        snapshot.requiredAction='checkpoint';
        snapshot.instruction='先保存需求结论、来源记录 id、未解决问题与下一步，再继续。摘要信息不足时可先用 read_execution/read_history 回查；不得重复执行旧工具，也不得只记录“已读取”。';
      } else if(intent==='task' && run.steps.length && run.steps.every(s=>s.status==='done')) {
        snapshot.requiredAction='finish_review';
        snapshot.instruction=(run.pendingArtifactUpdates?.length?'当前成果登记过期，必须先对 pendingArtifactUpdates 中每个路径执行 artifact。重新登记全部完成后才可 verify 和 finish。':'')+'全部步骤已标记 done，进入成果核验与交付阶段。不要重新列目录或重做已完成工作。利用 artifacts 和 completionEvidence 核对验收；证据充分时立即 finish。缺少验证则执行针对成果的验证命令，缺少成果登记则 artifact；发现实际缺口先 plan 将相关步骤恢复 running/blocked，再继续执行。无法满足验收则 blocked。';
        snapshot.completionEvidence=run.events.filter(e=>['run_command','build_android'].includes(e.type)&&e.detail.revision===run.revision&&e.detail.result?.exitCode===0&&!e.detail.result.timedOut).slice(-12).map(e=>({id:e.id,type:e.type,command:e.detail.command,revision:e.detail.revision}));
      } else if(intent==='task' && run.steps.length && run.actionsSincePlan>=6) {
        snapshot.requiredAction='plan_update';
        snapshot.instruction='已执行多次工具操作，请先根据实际结果更新 plan 中每个步骤的状态。已开始未验收的步骤为 running，满足验收才为 done，受阻为 blocked；不得凭一次写入成功认定整步完成。尚无状态变化也要如实核对。';
      } else if(intent==='task' && !run.steps.length && unplannedReads>=8) {
        snapshot.requiredAction='plan_or_clarify';
        snapshot.instruction='已有初步读取结果，请形成可调整计划，或澄清关键缺口；无法继续则 blocked。';
      }
      if(protocolRecovery)snapshot.protocolRecovery={...protocolRecovery,allowedActions:allowedActions(snapshot),instruction:protocolRecovery.reason==='invalid_parameter'?`上次返回未执行。${protocolRecovery.field} 必须是 JSON 整数，offset 不小于 0，limit 在 1–12000 内。分页使用当前结果的 next；只提交一个允许的动作。`:'上次返回未执行。请修正格式，仅提交一个 ailo_action，arguments 为含字符串 action 的对象；action 只能从 allowedActions 选择。不要返回 protocol_error、工具定义或动作数组。'};
      messages[messages.length-1].content=JSON.stringify(snapshot);
      // Omitted raw observations remain addressable through the external index.
      const available=capacity(model)-countMessages(messages)-protocolTokens-128;
      if(available<1024)throw Error('当前需求、计划或技能超过模型容量，请精简输入或选择更大容量模型。材料正文已按需读取，不会整体发送。');
      onStatus?.(needsCheckpoint?'正在保存需求结论与读取进度…':run.mode==='task'?'正在推进任务，检查下一步…':'正在理解需求与材料…');
      let action, oversizedArguments=false, emptyResponse=false, outputReason='action';
      for(let outputAttempt=0;outputAttempt<3;outputAttempt++) {
        const retryMessages=outputAttempt?[...messages.slice(0,-1),{role:'user',content:JSON.stringify({...snapshot,recovery:emptyResponse?'上一轮响应为空，没有可执行动作，也未执行任何工具。请使用 ailo_action 返回当前阶段允许的一个完整动作；不要只返回思考数据。':oversizedArguments?'上一轮工具参数超过250000字符，整条动作未执行。请返回一个完整的小动作，每次只写一个小文件；write_file.content最多200000字符、run_command.command最多8000字符，不要在命令中嵌入整个工程，不要续接残缺 JSON。':outputReason==='reasoning'?'上一轮在思考阶段耗尽输出额度，未产生正文或工具动作。请收敛分析，仅决定当前下一步，并返回一个完整的 ailo_action；不要尝试一次解决整个任务。':'上一轮动作因输出额度耗尽被截断，未执行任何动作。请重新返回一个完整且更小的动作，不要续接残缺 JSON。一次只处理一个小文件或一个步骤；若单文件过大，先拆分模块。摘要与计划应简洁。'})}]:messages;
        const remaining=capacity(model)-countMessages(retryMessages)-protocolTokens-128;
        // Checkpoints need a concise summary, not the previous file-generation
        // budget. Retain bounded escalation if reasoning/output is truncated.
        const budgetStage=!intent?'route':needsCheckpoint?'summary':snapshot.requiredAction==='plan_update'?'review':'action';
        const budget=outputPolicy.budget(remaining,budgetStage);
        if(budget<256)throw Error('剩余上下文不足以生成完整动作；已保留任务状态，请调整模型容量或精简扩展。');
        try {
          const response=await ask(retryMessages,budget,async stats=>{run.contextUsage=stats;await notify();});
          action=decodeAction(response);outputPolicy.succeeded(response.providerUsage,budgetStage);await saveOutputBudget();break;
        }
        catch(e) {
          emptyResponse=e.code==='MODEL_EMPTY_RESPONSE';
          if(emptyResponse) {
            await workspace.event('empty_response',{attempt:outputAttempt+1,...e.diagnostics,message:e.message});
            if(outputAttempt===2)throw Object.assign(Error('模型连续返回空响应或仅思考内容，已自动重试 2 次，仍未获得可执行动作。任务进度和材料已保留；可稍后重试或检查模型服务。'),{code:'MODEL_EMPTY_RESPONSE'});
            onStatus?.(`模型未返回下一步动作，正在重试（${outputAttempt+1}/2）…`);
            continue;
          }
          if(e.code==='MODEL_TOOL_ARGUMENT_LIMIT') {
            oversizedArguments=true;
            await workspace.event('tool_argument_limit',{attempt:outputAttempt+1,...e.diagnostics});
            if(outputAttempt===2)throw Error('单次工具参数仍然过大，已要求拆分并重试 2 次。已有文件与任务状态已保留，超限动作未执行；请拆分当前步骤后继续。');
            onStatus?.('工具参数过大，正在要求模型拆分为更小的动作…');
            continue;
          }
          if(e.code==='MODEL_OUTPUT_LIMIT') {
            outputReason=outputPolicy.limited(budget,e.diagnostics,budgetStage);await saveOutputBudget();
            const nextBudget=outputPolicy.budget(remaining,budgetStage);
            const reason=outputReason==='reasoning'?'模型思考达到单次输出额度':'模型动作输出达到单次额度';
            const message=outputAttempt===2?reason+'，自动重试已用尽':reason+(nextBudget>budget?`，将提高额度至 ${nextBudget} 并自动重试`:'，额度已受上限限制，正在收敛输出并重试');
            await workspace.event('output_limit',{attempt:outputAttempt+1,budget,nextBudget,configuredLimit:outputLimit(model),...e.diagnostics,reason:outputReason,message});
            if(outputAttempt===2)throw Error('本次模型输出达到上限，已自动调整额度或要求拆分动作重试 2 次。任务状态已保留，截断动作未执行；请检查模型最大输出额度，或进一步拆分任务。');
            onStatus?.(message);
            continue;
          }
          if(e.code!=='AGENT_PROTOCOL')throw e;
          await workspace.event('protocol_error',{reason:e.reason,...e.diagnostics,message:'模型动作格式待纠正：'+(e.diagnostics?.issue==='missing_action'?'缺少 action 字段':e.reason==='invalid_parameter'?`${e.diagnostics.field} 必须是有效整数`:({invalid_action:'动作名称或对象结构无效',wrong_tool:'工具名称不匹配',invalid_json:'返回内容不是完整动作对象',multiple_tools:'一次返回了多个工具调用',conflicting_action:'工具名称与动作字段冲突',missing_text:'缺少动作内容',tool_metadata_too_long:'工具元数据过长'}[e.reason]||e.reason))});
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
          intent=personalAssistant?'chat':action.kind;
          if(intent==='task'){run.progressInputId=run.inputKey;run.mode='task';run.status=run.steps.length?'running':'understanding';}
          invalid=0;await workspace.event('intent',{kind:intent});await notify();continue;
        }
        // Reject obsolete exploration before repeat detection can pause a completed plan.
        if(snapshot.requiredAction==='finish_review' && !allowedActions(snapshot).includes(action.action)) {
          await record(action,{notExecuted:true,instruction:snapshot.instruction,allowedActions:allowedActions(snapshot)});
          await workspace.event('finish_review',{message:'计划步骤已完成，已阻止重复探索；请核验成果并提交 finish。'});
          await notify();continue;
        }
        const target={...action,id:workspace.lookup(action.id)?.id||action.id,offset:action.offset||0};
        delete target.purpose;
        if(['list_files','read_file','run_command','build_android','android_device','write_file','edit_spreadsheet'].includes(action.action))target.revision=run.revision;
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
        if(repeats>=(readAction?4:3) && !(snapshot.requiredAction==='plan_update' && action.action==='plan')) {
          run.status='paused';await workspace.event('no_progress',{...location,message:readAction?'纠正提示后仍重复读取相同范围，期间没有新的文件内容或计划完成进展，已暂停：'+[location.name||location.path,location.entry,location.pointer,`位置 ${location.offset}`].filter(Boolean).join(' · '):'相同动作反复执行，已暂停以避免空转'});await notify();
          const description=[action.action,location.name||location.path||location.id,location.entry,location.pointer,readAction?`位置 ${location.offset}`:undefined].filter(Boolean).join(' · ');
          return {content:`检测到相同动作反复执行（${description}），已暂停。${readAction?'同一版本和范围已读取两次，纠正后仍重复。':''}材料读取记录、需求摘要和文件已保存；请根据具体缺口调整下一步后继续。`,agentRun:publicRun(run)};
        }
        if(action.action==='route') {
          if(action.kind!==intent)throw Error('本轮意图已确定，不能通过重复 route 改变执行权限');
          await record(action,{ok:true,instruction:'意图已识别，请继续读取、规划或回答，不要重复 route'});continue;
        }
        if(snapshot.requiredAction==='checkpoint' && !['checkpoint','read_execution','read_history','pause','blocked','clarify'].includes(action.action))throw Error('需要先 checkpoint 保存需求结论、来源、缺口与下一步；可只读回查归档，再继续执行');
        if(snapshot.requiredAction==='plan_or_clarify' && !['plan','clarify','blocked','pause','checkpoint'].includes(action.action))throw Error('请先制定可调整计划或澄清关键缺口，不要继续无计划读取');
        if(snapshot.requiredAction==='plan_update' && !['plan','clarify','blocked','pause'].includes(action.action))throw Error('请先根据实际结果更新计划步骤状态，再继续执行');
        if(action.action==='checkpoint') {
          if(typeof action.text!=='string'||action.text.trim().length<20||action.text.length>10000)throw Error('checkpoint 需要20–10000字的累计任务摘要，包含需求、来源、缺口和下一步');
          run.workingMemory=action.text;
          await workspace.event('checkpoint',{text:action.text});
          run.observations=[];run.checkpointObservationCount=run.observationIndex.length;outputPolicy.reset('action');await saveOutputBudget();invalid=0;await notify();continue;
        }
        const text=()=>{if(typeof action.text!=='string'||!action.text.trim()||action.text.length>6000)throw Error('用户说明必须为1–6000字符');return action.text;};
        if(action.action==='plan') {
          if(intent!=='task')throw Error('当前是问答，不执行交付计划');
          validatePlan(action);
          if(JSON.stringify(run.steps.map(({id,status})=>({id,status})))!==JSON.stringify(action.steps.map(({id,status})=>({id,status}))))markProgress({steps:action.steps.map(({id,status})=>({id,status}))});
          if(action.steps.filter(s=>s.status==='done').length>run.steps.filter(s=>s.status==='done').length)advanceReads({completed:action.steps.filter(s=>s.status==='done').map(s=>s.id).sort()});
          run.mode='task';run.goal=action.goal;run.decisions=action.decisions;run.acceptance=action.acceptance;run.steps=action.steps.map(({id,title,status})=>({id,title,status}));run.status='running';
          run.actionsSincePlan=0;
          invalid=0;await workspace.event('plan',{goal:run.goal,steps:run.steps});await notify();await record(action,{ok:true,action:'plan'});continue;
        }
        if(action.action==='clarify') {
          const clarification=validateClarification(action.clarification);if(!clarification)throw Error('澄清格式无效');
          const content=text();run.status='waiting_user';run.question=clarification;await workspace.event('clarification',{title:clarification.title});await notify();return {content,clarification,agentRun:publicRun(run)};
        }
        if(['verify','finish'].includes(action.action)&&run.pendingArtifactUpdates?.length)throw Error('请先重新登记待更新成果：'+JSON.stringify(run.pendingArtifactUpdates)+'。必须逐个执行 artifact，不能用 verify 替代登记。');
        if(['reply','pause','blocked','finish'].includes(action.action)) {
          const content=text()+(searchSources.size?'\n\n搜索来源：\n'+[...searchSources.values()].slice(0,10).map(s=>'- ['+s.title.replace(/[\[\]\\<>`]/g,'')+']('+s.url.replace(/[()\s<>]/g,c=>encodeURIComponent(c))+')').join('\n'):'');
          if(action.action==='reply'&&intent==='task')throw Error('交付任务不能用聊天正文替代执行，请澄清、规划、执行，或说明阻塞');
          if(action.action==='finish') {
            if(run.mode!=='task'||!run.artifacts.length||!Array.isArray(action.evidence)||!action.evidence.length)throw Error('完成任务需要实际成果和验证命令证据');
            for(const id of action.evidence){const e=run.events.find(e=>e.id===id&&['run_command','build_android'].includes(e.type));if(!e||e.detail.revision!==run.revision||e.detail.result.exitCode!==0||e.detail.result.timedOut)throw Error('验证证据无效或在文件修改之前，请重新验证');}
            const changedArtifacts=[];
            for(const artifact of run.artifacts) {const file=await resolveFile(workspace.files,artifact.path);const data=await fs.readFile(file);if(createHash('sha256').update(data).digest('hex')!==artifact.sha256)changedArtifacts.push(artifact.path);}
            if(changedArtifacts.length){run.pendingArtifactUpdates=changedArtifacts;throw Object.assign(Error('成果已发生变更：'+JSON.stringify(changedArtifacts)+'。请检查这些文件的最终内容，对每个文件重新执行 artifact 登记，然后重新 verify 核验；若验证命令会修改成果，请在命令执行后登记。不要直接重复 finish。'),{code:'ARTIFACT_CHANGED'});}
            if(!run.steps.length || run.steps.some(s=>s.status!=='done'))throw Error('计划尚未全部验收：请根据实际证据更新计划；受阻步骤保持 blocked 并说明阻塞，不能直接 finish');
            await acceptanceChecks.assertAccepted(workspace);
          run.status='completed';
          } else run.status=action.action==='blocked'?'blocked':action.action==='pause'?'paused':run.mode==='task'?previousStatus:'idle';
          await workspace.event(action.action,{text:content});await notify();return {content,agentRun:publicRun(run)};
        }
        if(action.action==='verify'){
          if(intent!=='task'||!run.steps.length)throw Error('请先制定任务验收要求');
          const result=await acceptanceChecks.verify(workspace,action);await record(action,{result});invalid=0;for(const counters of [failures,attempts])for(const key of counters.keys())if(JSON.parse(key).action==='finish')counters.delete(key);await notify();continue;
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
        if(!['assistant','knowledge','web_search','mcp','amap','feishu','list_files','read_file','write_file','edit_spreadsheet','request_directory','run_command','build_android','android_device','read_material','read_source','inspect_source','search_materials','read_history','read_execution'].includes(action.action))throw Error('未知动作');
        if(['write_file','edit_spreadsheet','request_directory','run_command','build_android','android_device'].includes(action.action)&&(intent!=='task'||!run.steps.length))throw Error('执行前必须识别交付目标并制定计划');
        if(action.action==='web_search'&&++searchCalls>3)throw Object.assign(Error('本轮已达到 3 次搜索上限，请根据已有结果回答或缩小问题范围。'),{code:'SEARCH_UNAVAILABLE'});
        onStatus?.(({mcp:'正在使用应用工具：'+String(action.purpose||action.query||'查看工具').slice(0,120),web_search:'正在搜索：'+String(action.query||'').slice(0,100),feishu:'正在处理飞书：'+String(action.purpose||action.query||action.path||'操作').slice(0,120),read_material:'正在读取项目材料…',search_materials:'正在检索项目材料…',write_file:'正在写入工程文件…',build_android:'正在执行标准 Android 构建…',android_device:'正在执行项目模拟器操作…',run_command:'正在执行：'+String(action.purpose||'项目命令').slice(0,120),list_files:'正在检查项目文件…',read_file:'正在读取项目文件…'})[action.action]);
        // Save intent before side effects. Interrupted commands are never
        // automatically replayed; the next run inspects files and logs first.
        const journalEntry=actionJournal.begin(run,action);
        run.inFlight={actionId:journalEntry.id,action:action.action,path:action.path,purpose:action.purpose,name:workspace.lookup(action.id)?.name,entry:action.entry,at:new Date().toISOString()};await notify();
        if(['write_file','edit_spreadsheet','run_command','build_android'].includes(action.action)){run.revision++;await workspace.save();}
        let previousContent;
        if(action.action==='write_file'){try{previousContent=await fs.readFile(await resolveFile(workspace.files,action.path),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}}
        let result;
        if(action.action==='assistant') {
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
          result=await actionJournal.executeWithRecovery(workspace,journalEntry,action,signal,()=>executeTool(workspace,action,signal,{android,authorizeBuild,directoryAccess,feishuCli,webSearch,amap,mcp,knowledge,onStatus}));
          if(action.action==='request_directory'){run.status='running';await notify();onStatus?.('目录已授权，继续执行');}
        }
        if(journalEntry.status==='running'){journalEntry.status='succeeded';journalEntry.finishedAt=new Date().toISOString();}
        if(action.action==='web_search')for(const source of result.sources||[])searchSources.set(source.url,source);
        if(action.action==='write_file'&&previousContent!==action.content)advanceReads({path:action.path,content:action.content});
        // A new successful tool action is evidence of progress, not proof of task completion.
        // Exclude bookkeeping/log scans; repeated requests do not extend execution forever.
        if(!['list_files','read_history','read_execution'].includes(action.action) && !result?.timedOut && (result?.exitCode===undefined||result.exitCode===0))markProgress({...action,purpose:undefined});
        await workspace.event(action.action,{id:action.id,entry:action.entry,pointer:action.pointer,offset:action.offset,name:result?.name,path:action.path,command:action.command,purpose:action.purpose,revision:run.revision,result});
        // Record the full result externally; only previews enter inference.
        if(['read_material','read_source','inspect_source'].includes(action.action) && result.kind!=='json_search') {
          unplannedReads++;
        }
        if(intent==='task' && run.steps.length)run.actionsSincePlan++;
        delete run.inFlight;await notify();const observationId=await record(action,{action:action.action,eventId:run.events.at(-1).id,result,instruction:repeats===2?'此动作已重复，请利用结果推进，避免第三次重复调用':undefined});
        if(readAction){counters.set(key,repeats);const page=run.observations.at(-1).response.result;readResults.set(key,{sourceObservationId:observationId,next:page?.next,total:page?.total,result:page});if(readRecovery?.action===action.action&&readRecovery.path===readTarget.path&&readRecovery.version!==readTarget.version)readRecovery=undefined;}
        invalid=0;
      } catch(error) {
        if(signal.aborted)throw error;
        if(['DIRECTORY_DECLINED','DIRECTORY_UNAVAILABLE','DIRECTORY_SYSTEM_PERMISSION'].includes(error.code)){delete run.inFlight;run.status=error.code==='DIRECTORY_UNAVAILABLE'?'blocked':'waiting_permission';await workspace.event('permission_required',{path:action.path,message:error.message});await notify();return {content:error.message,agentRun:publicRun(run)};}
        if(error.code==='ACTION_RESULT_UNKNOWN'||String(error.code||'').startsWith('MCP_')||error.code==='SEARCH_UNAVAILABLE'||error.code==='ANDROID_PERMISSION'||error.code==='FEISHU_DECLINED'||error.code==='FEISHU_PERMISSION'||error.code==='AMAP_UNAVAILABLE'||error.code==='AMAP_DECLINED'){delete run.inFlight;run.status='blocked';await workspace.event('permission_required',{message:error.message});await notify();return {content:error.message,agentRun:publicRun(run)};}
        const failedPath=typeof action.path==='string'?action.path.slice(0,500):undefined;
        delete run.inFlight;await workspace.event('tool_error',{message:error.message,action:action.action,id:action.id,entry:action.entry,offset:action.offset,path:failedPath,...(action.action==='feishu'?{operation:action.operation,query:action.query,method:action.method}:{})});await notify();
        await record(action,{action:action.action,id:action.id,entry:action.entry,offset:action.offset,path:failedPath,error:error.message});
        const failureKey=JSON.stringify(stable({...action,purpose:undefined}));
        const failed=(failures.get(failureKey)||0)+1;failures.set(failureKey,failed);
        if(failed>=3)throw Error('相同动作多次失败，已保留任务状态：'+error.message);
        if(++invalid>=3)throw Error('连续动作失败，已保留任务状态：'+error.message);
      }
    }
    if(signal.aborted)throw Error('已停止执行');
    return await budgetPause(now()-startedAt>=maxDurationMs?'time':'steps');
  }catch(error){await actionJournal.reconcile(workspace);run.status=signal.aborted?'paused':'failed';await workspace.event('interrupted',{message:error.message});await notify();throw error;}
}
module.exports={runAgent,publicRun,parseAction};

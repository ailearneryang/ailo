const {randomUUID,createHash}=require('node:crypto');
const ASSISTANT_ID='my-ailo-assistant';
function createPersonalAssistant({storage,chat,schedules,notify=()=>{}}){
  const launches=new Map();
  function launch(task,modelId){
    const id=randomUUID();
    const promise=chat.complete({id,taskId:task.id,modelId,extensionIds:task.extensionIds,searchEnabled:task.searchEnabled,feishuEnabled:task.feishuEnabled,
      messages:(task.messages||[]).map(({role,content})=>({role,content})),
      onRun:run=>notify({id,taskId:task.id,run}),onStatus:message=>notify({id,taskId:task.id,message}),onText:content=>notify({id,taskId:task.id,content})});
    launches.set(task.id,promise);
    void promise.then(result=>storage.patchTask(task.id,{contextCheckpoint:result.contextCheckpoint,promptTokens:result.promptTokens,lastError:undefined},[{id:id+'-assistant',role:'assistant',content:result.content,clarification:result.clarification,modelName:result.modelName}]))
      .catch(error=>storage.patchTask(task.id,{lastError:String(error.message||error)}))
      .finally(()=>{launches.delete(task.id);notify({id,taskId:task.id,finished:true});}).catch(error=>console.error('Assistant task persistence failed:',error.message));
    return id;
  }
  return async function execute(action,context){
    if(context.task.id!==ASSISTANT_ID)throw Error('此功能仅限我的 Ailo 会话');
    if(context.signal.aborted)throw Error('已停止执行');
    const state=await storage.readWorkspace(),live=chat.sessions();
    const input=context.task.messages?.findLast(m=>m.role==='user');
    const params=action.data||{};
    async function reference(id){
      const owner=(await storage.readWorkspace()).tasks.find(t=>t.id===ASSISTANT_ID);
      const refs=owner?.assistantReferences||{};
      await storage.patchTask(ASSISTANT_ID,{assistantReferences:{...refs,[input.id]:[...new Set([...(refs[input.id]||[]),id])]}});
    }
    if(action.operation==='list')return {tasks:state.tasks.filter(t=>t.id!==ASSISTANT_ID).slice(0,60).map(t=>({id:t.id,title:t.title,projectId:t.projectId,parentMessageId:t.parentMessageId,status:live.some(s=>s.taskId===t.id)?'running':t.assistantPaused?'paused':t.agentRun?.status|| (t.lastError?'failed':'idle'),goal:t.agentRun?.goal,lastError:t.lastError,latest:t.messages?.at(-1)?.content?.slice(0,1200),artifacts:t.agentRun?.artifacts||[]})),projects:state.projects.map(p=>({id:p.id,name:p.name})),schedules:await schedules.list(),truncated:state.tasks.length>61};
    if(action.operation==='read'){
      const t=state.tasks.find(t=>t.id===action.id&&t.id!==ASSISTANT_ID);if(!t)throw Error('未找到对应任务');
      await reference(t.id);
      return {id:t.id,title:t.title,status:live.find(s=>s.taskId===t.id)?.status||t.agentRun?.status,lastError:t.lastError,messages:t.messages?.slice(-12).map(({role,content,clarification})=>({role,content,clarification})),run:t.agentRun};
    }
    if(action.operation==='delegate'){
      if(typeof params.prompt!=='string'||!params.prompt.trim()||params.prompt.length>20000)throw Error('请提供具体任务指令');
      if(params.projectId&&!state.projects.some(p=>p.id===params.projectId))throw Error('项目不存在');
      const duplicate=state.tasks.find(t=>t.parentMessageId===input?.id&&t.parentAssistantId===ASSISTANT_ID&&t.request===params.prompt.trim());
      if(duplicate)return {taskId:duplicate.id,title:duplicate.title,alreadyCreated:true,status:live.some(s=>s.taskId===duplicate.id)?'running':duplicate.agentRun?.status||'saved'};
      const id=randomUUID(),task=await storage.patchTask(id,{title:String(params.title||params.prompt).slice(0,60),request:params.prompt.trim(),created:new Date().toISOString(),materials:context.task.materials||[],projectId:params.projectId||'',parentAssistantId:ASSISTANT_ID,parentMessageId:input?.id,modelId:context.modelId,extensionIds:context.task.extensionIds||[],searchEnabled:context.task.searchEnabled===true,feishuEnabled:context.task.feishuEnabled===true},[{id:randomUUID(),role:'user',content:params.prompt.trim(),materials:input?.materials||[]}]);
      if(context.signal.aborted){await storage.patchTask(id,{lastError:'助手已停止，任务尚未开始。'});throw Error('已停止执行');}
      launch(task,context.modelId);return {taskId:id,title:task.title,status:'started',note:'任务已开始，尚未完成。进度与成果将在关联任务卡片显示。'};
    }
    if(['continue','update','pause'].includes(action.operation)){
      const t=state.tasks.find(t=>t.id===action.id&&t.id!==ASSISTANT_ID);if(!t)throw Error('未找到对应任务');
      await reference(t.id);
      const session=live.find(s=>s.taskId===t.id);
      if(action.operation==='pause'){if(session)chat.cancel(session.id);await storage.patchTask(t.id,{assistantPaused:true});return {taskId:t.id,status:'pause_requested',note:'已请求停止本轮执行，已产生的成果保留。'};}
      if(typeof params.prompt!=='string'||!params.prompt.trim()||params.prompt.length>20000)throw Error('请提供补充要求或继续指令');
      const instructionKey=createHash('sha256').update(String(input?.id)+'|'+params.prompt.trim()).digest('hex');
      if(t.assistantInstructionKey===instructionKey)return {taskId:t.id,status:'already_sent'};
      if(session){await chat.steer({id:session.id,taskId:t.id,content:params.prompt.trim()});await storage.patchTask(t.id,{assistantInstructionKey:instructionKey});return {taskId:t.id,status:'instruction_sent'};}
      const updated=await storage.patchTask(t.id,{assistantPaused:false,assistantInstructionKey:instructionKey,lastError:undefined},[{id:randomUUID(),role:'user',content:params.prompt.trim()}]);
      if(context.signal.aborted)throw Error('已停止执行');
      launch(updated,updated.modelId||context.modelId);return {taskId:t.id,status:'started'};
    }
    if(action.operation==='schedule'){
      const key=createHash('sha256').update(String(input?.id)+'|'+JSON.stringify(params)).digest('hex');
      const owner=state.tasks.find(t=>t.id===ASSISTANT_ID),known=owner?.assistantSchedules?.[key];
      if(known){const schedule=(await schedules.list()).find(s=>s.id===known);if(schedule)return {schedule,alreadyCreated:true};}
      const schedule=await schedules.save({...params,modelId:context.modelId,searchEnabled:context.task.searchEnabled===true,feishuEnabled:context.task.feishuEnabled===true&&params.feishuEnabled!==false});
      await storage.patchTask(ASSISTANT_ID,{assistantSchedules:{...owner?.assistantSchedules,[key]:schedule.id},assistantScheduleLinks:[...(owner?.assistantScheduleLinks||[]),{messageId:input.id,id:schedule.id,title:schedule.title}]});
      notify({finished:true});return {schedule,note:'已保存，Ailo 运行且电脑唤醒时按本机时区执行。'};
    }
    if(action.operation==='schedule_toggle'){
      if(typeof params.enabled!=='boolean')throw Error('请指定是否启用');await schedules.toggle({id:action.id,enabled:params.enabled});notify({finished:true});return {id:action.id,enabled:params.enabled};
    }
    throw Error('不支持的助手操作');
  };
}
module.exports={ASSISTANT_ID,createPersonalAssistant};

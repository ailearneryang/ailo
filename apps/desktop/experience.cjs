const path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {workspacePath}=require('./agent/workspace-path.cjs');
const {json,key,resolveFile}=require('./agent/workspace.cjs');
const copy=value=>structuredClone(value);
const messages=t=>t.messages?.length?t.messages:[{id:t.id+'-original',role:'user',content:t.request,materials:t.materials,createdAt:t.created},...(t.answer?[{id:t.id+'-answer',role:'assistant',content:t.answer,createdAt:t.created}]:[])];
const clean=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(label+'无效');return v.trim();};
function createExperience({storage,sessions=()=>[],cancel=()=>{}}){
 const replyFiles=new Map();
 const temporary=new Map(),retired=new Set();const original={};for(const name of ['messageFeedback','readWorkspace','patchTask','saveWorkspace','saveContextCheckpoint','recordModelRequest','recordExecution','editLastMessage'])original[name]=storage[name]?.bind(storage);
 storage.isTemporary=id=>temporary.has(id)||retired.has(id);
 storage.readWorkspace=async()=>{const state=await original.readWorkspace();return {...state,tasks:[...temporary.values(),...state.tasks]};};
 storage.patchTask=async(id,patch,append=[])=>{
  if(retired.has(id))throw Error('临时对话已结束');
  if(temporary.has(id)){const old=temporary.get(id),merged=copy(old.messages||[]);for(const m of [...(patch.messages||[]),...append])if(!merged.some(x=>x.id===m.id))merged.push({...m,createdAt:m.createdAt||new Date().toISOString()});if(merged.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.materials?.length)||JSON.stringify(merged).length>1000000)throw Error('临时对话仅支持文本，或内容已超过容量');const task={...old,...patch,id,temporary:true,projectId:undefined,permissionMode:'standard',memoryEnabled:false,knowledgeIds:[],materials:[],extensionIds:[],feishuEnabled:false,amapEnabled:false,searchEnabled:false,mcpConnectionIds:[],messages:merged};temporary.set(id,task);return copy(task);}
  if(patch?.temporary)throw Error('请通过临时对话入口创建');return original.patchTask(id,patch,append);
 };
 storage.messageFeedback=async input=>{if(retired.has(input?.taskId))throw Error('临时对话已结束');if(temporary.has(input?.taskId))return copy(require('./message-feedback.cjs').applyMessageFeedback(temporary.get(input.taskId),input));return original.messageFeedback(input);};
 storage.editLastMessage=async(id,messageId,content)=>{if(!temporary.has(id))return original.editLastMessage(id,messageId,content);const t=temporary.get(id),all=t.messages,index=all.findLastIndex(m=>m.role==='user');if(index<0||all[index].id!==messageId)throw Error('只能编辑最近一条用户消息');const replacement={...all[index],id:randomUUID(),content:clean(content,20000,'消息'),createdAt:new Date().toISOString()};const next={...t,messages:[...all.slice(0,index),replacement]};delete next.contextCheckpoint;delete next.lastError;temporary.set(id,next);return copy(next);};
 storage.saveWorkspace=(state,preserve)=>original.saveWorkspace({...state,tasks:state.tasks.filter(t=>!storage.isTemporary(t.id))},preserve);
 storage.saveContextCheckpoint=async(id,checkpoint)=>temporary.has(id)?storage.patchTask(id,{contextCheckpoint:checkpoint}):retired.has(id)?undefined:original.saveContextCheckpoint(id,checkpoint);
 const ephemeralRequests=new Set();
 for(const name of ['recordModelRequest','recordExecution'])storage[name]=async record=>{if(storage.isTemporary(record.taskId)||ephemeralRequests.has(record.id))return;return original[name]?.(record);};
 const busy=id=>sessions().some(s=>s.taskId===id);
 function idle(id){if(busy(id))throw Error('请先停止执行或取消排队，再进行此操作');}
 const owner=async()=>((await storage.account())?.id||'local');
 async function mutate(id,fn,{messageHistory=false}={}){return storage.mutateWorkspace(state=>{const task=state.tasks.find(t=>t.id===id);if(!task)throw Error('对话不存在或已删除');idle(id);if(id==='my-ailo-assistant'&&!messageHistory)throw Error('此操作不适用于我的 Ailo');return fn(state,task);});}
 async function action(input){
  const {id,action,value}=input||{};if(typeof id!=='string')throw Error('对话操作无效');
  if(action==='rename')return mutate(id,(_,t)=>{t.title=clean(value,100,'对话名称');t.titleGenerated=true;t.manualTitle=true;t.updatedAt=new Date().toISOString();return copy(t);});
  if(action==='archive'||action==='restore')return mutate(id,(_,t)=>{t.archived=action==='archive';t.archivedAt=t.archived?new Date().toISOString():undefined;t.pinned=false;return copy(t);});
  if(action==='move')return mutate(id,(state,t)=>{if(t.scheduledTaskId)throw Error('定时对话请在定时任务设置中更改项目');if(value&&!state.projects.some(p=>p.id===value))throw Error('目标项目不存在');if((t.projectId||'')===(value||''))return copy(t);t.resourceOrigins=[...(t.resourceOrigins||[]),{id:t.id,projectId:t.projectId,scheduledTaskId:t.scheduledTaskId,runRecordId:t.runRecordId}].slice(-20);t.projectId=value||undefined;t.runRecordId=randomUUID();delete t.agentRun;delete t.contextCheckpoint;delete t.promptTokens;delete t.lastError;t.memorySince=new Date().toISOString();t.updatedAt=t.memorySince;return copy(t);});
  if(action==='delete')return mutate(id,(state,t)=>{state.tasks=state.tasks.filter(x=>x.id!==id);return {deleted:true,id};});
  if(action==='branch'||action==='regenerate')return mutate(id,(_,t)=>{
   if(t.temporary)throw Error('此操作不适用于临时对话');
   const all=messages(t),index=all.findIndex(m=>m.id===input.messageId);
   if(index<0)throw Error('来源消息不存在');
   let end=index+1;
   if(action==='regenerate'){
    if(all[index].role!=='assistant')throw Error('只能重新生成助手回答');
    const user=all.slice(0,index+1).findLastIndex(m=>m.role==='user');
    if(user<0)throw Error('没有可重新生成的用户消息');end=user+1;
   }
   const kept=copy(all.slice(0,end));
   if(action==='regenerate'&&input.useFeedback===true){
    kept.splice(0,kept.length,...copy(all.slice(0,index+1)),{id:randomUUID(),role:'user',content:require('./answer-style.cjs').correction(all[index].feedback),createdAt:new Date().toISOString()});
   }
   const at=new Date().toISOString();
   // Keep alternate history inside this conversation, outside active context.
   // Preserve the previous execution identity as a resource origin before
   // starting a new local segment; no prior tool action is replayed here.
   t.conversationSections=[...(t.conversationSections||[]),{id:randomUUID(),kind:action,afterMessageId:kept.at(-1).id,sourceMessageId:input.messageId,createdAt:at,messages:copy(all),tailStart:end,agentRun:copy(t.agentRun)}];
   t.resourceOrigins=[...(t.resourceOrigins||[]),{id:t.id,projectId:t.projectId,scheduledTaskId:t.scheduledTaskId,runRecordId:t.runRecordId}];
   t.runRecordId=randomUUID();t.messages=kept;t.responseOnly=action==='regenerate';t.permissionMode='standard';t.updatedAt=at;
   for(const key of ['agentRun','contextCheckpoint','promptTokens','lastError','lastErrorCode','partialReply','answer','pendingInputIds'])delete t[key];
   return copy(t);
  },{messageHistory:true});
  throw Error('不支持的对话操作');
 }
 async function temporaryCreate(){const id=randomUUID(),task={id,title:'临时对话',request:'临时对话',materials:[],messages:[],created:new Date().toISOString(),temporary:true,memoryEnabled:false,permissionMode:'standard'};temporary.set(id,task);return copy(task);}
 async function temporaryEnd(id){if(!temporary.has(id))return;for(const s of sessions().filter(s=>s.taskId===id))cancel(s.id);temporary.delete(id);retired.add(id);if(retired.size>2000)retired.delete(retired.values().next().value);}
 async function exportTask(id){const task=(await storage.readWorkspace()).tasks.find(t=>t.id===id);if(!task||task.temporary)throw Error('对话不存在或为临时对话');return '# '+task.title+'\n\n'+messages(task).map(m=>'## '+(m.role==='user'?'你':'Ailo')+'\n\n'+m.content+(m.materials?.length?'\n\n附件：'+m.materials.map(f=>f.name).join('、'):'' )).join('\n\n');}
 async function projectSave(input){return storage.mutateWorkspace(state=>{const p=state.projects.find(p=>p.id===input.id);if(!p)throw Error('项目不存在');if(state.tasks.some(t=>t.projectId===p.id&&busy(t.id)))throw Error('项目仍有任务正在执行');if(input.revision!==(p.settingsRevision||0))throw Error('项目设置已更新，请刷新后重试');if(typeof input.instructions!=='string'||input.instructions.length>12000)throw Error('项目指令最多12000字符');if(!Array.isArray(input.sources)||input.sources.length>20||input.sources.some(s=>typeof s.name!=='string'||typeof s.text!=='string'||s.text.length>100000))throw Error('项目资料无效，最多20份，每份最多10万字符');p.instructions=input.instructions;p.sources=input.sources.map(s=>({id:typeof s.id==='string'?s.id:randomUUID(),name:s.name.slice(0,200),text:s.text,createdAt:s.createdAt||new Date().toISOString()}));p.defaultTools={searchEnabled:input.defaultTools?.searchEnabled===true,feishuEnabled:input.defaultTools?.feishuEnabled===true,amapEnabled:input.defaultTools?.amapEnabled===true,mcpConnectionIds:Array.isArray(input.defaultTools?.mcpConnectionIds)?input.defaultTools.mcpConnectionIds.filter(x=>typeof x==='string').slice(0,30):[]};p.settingsRevision=(p.settingsRevision||0)+1;return copy(p);});}
 async function files(){const state=await storage.readWorkspace(),out=[],seen=new Set();for(const task of state.tasks.filter(t=>!t.temporary)){
  const origins=[{id:task.id,projectId:task.projectId,scheduledTaskId:task.scheduledTaskId,runRecordId:task.runRecordId},...(task.resourceOrigins||[])];for(let i=0;i<origins.length;i++){const source=origins[i],run=await json(path.join(workspacePath(storage.agentDirectory,source),'runs',key(source.runRecordId||source.id)+'.json'),null);
   const versions=[...(run?.history||[]),...(run?[run]:[])];for(let v=0;v<versions.length;v++)for(const a of versions[v].artifacts||[]){const token=createHash('sha256').update(JSON.stringify([task.id,source.projectId||source.id,a.path,a.sha256])).digest('hex');if(seen.has(token))continue;seen.add(token);out.push({id:token,taskId:task.id,originIndex:i,path:a.path,label:a.label||a.path,size:a.size||0,sha256:a.sha256||'',kind:'delivery',projectId:task.projectId,taskTitle:task.title,at:versions[v].updatedAt||task.created,version:v+1,archived:!!task.archived});}
  }
  for(const message of messages(task).filter(m=>m.role==='assistant')){
   require('./reply-html.cjs').replyHtml(message.content).forEach((html,index)=>{
    const sha256=key(html),id=key(JSON.stringify([task.id,message.id,index,sha256]));
    out.push({id,taskId:task.id,messageId:message.id,replyHtmlIndex:index,path:'reply-'+id.slice(0,16)+'.html',label:'回复网页成果 '+(index+1),size:Buffer.byteLength(html),sha256,kind:'delivery',projectId:task.projectId,taskTitle:task.title,at:message.createdAt||task.created||'',version:1,archived:!!task.archived});
   });
  }
  const materialSeen=new Set();
  const materials=[...(task.materials||[]),...(task.messages||[]).flatMap(message=>message.materials||[])];
  for(const m of materials){
   const identity=m.sourceId||key(JSON.stringify([m.name,m.text,m.size]));if(materialSeen.has(identity))continue;materialSeen.add(identity);
   out.push({id:task.id+':material:'+identity,taskId:task.id,path:m.name,label:m.name,size:m.size||0,sourceId:m.sourceId,kind:'material',projectId:task.projectId,taskTitle:task.title,at:task.created,text:m.text,version:1,archived:!!task.archived});
  }
 }return out.sort((a,b)=>b.at.localeCompare(a.at));}
 async function fileResolve(input){
  const entries=await files(),item=entries.find(x=>x.id===input.id);if(!item)throw Error('文件记录不存在');
  const state=await storage.readWorkspace(),task=state.tasks.find(t=>t.id===item.taskId);if(!task)throw Error('来源对话已不存在');
  if(item.messageId){
   const message=messages(task).find(m=>m.id===item.messageId&&m.role==='assistant');
   const html=require('./reply-html.cjs').replyHtml(message?.content)[item.replyHtmlIndex];
   if(!html||key(html)!==item.sha256)throw Error('回复成果已变化，请刷新后查看');
   if(replyFiles.has(item.id))return {item,...replyFiles.get(item.id)};
   const fs=require('node:fs/promises'),root=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'ailo-reply-'));
   const file=path.join(root,item.path);await fs.writeFile(file,html,{mode:0o600});replyFiles.set(item.id,{root,file});return {item,root,file};
  }
  if(item.kind==='material'){
   const origins=require('./material-originals.cjs');
   const file=item.sourceId?await origins.findMaterialOriginal(storage.agentDirectory,origins.withMaterialOrigins(task,state.tasks),item.sourceId):null;
   return {item,file,root:file?path.dirname(file):undefined};
  }
  const source=item.originIndex===0?task:task.resourceOrigins[item.originIndex-1];
  const root=await require('./schedule-context.cjs').scheduleArtifactRoot(storage.agentDirectory,source,item.path);const file=await resolveFile(root,item.path);return {item,root,file};
 }
 async function filePreview(input){
  const {item,file,root}=await fileResolve(input);
  if(item.kind==='material'){
   if(!file){
    if(typeof item.text==='string'&&item.text.length)return {kind:/\.(md|markdown)$/i.test(item.path)?'markdown':'text',version:key(item.text),content:item.text.slice(0,100000),truncated:item.text.length>100000};
    throw Error('附件原文件已缺失，请在来源对话重新添加；未用同名文件替代。');
   }
   const fs=require('node:fs/promises'),stat=await fs.stat(file);if(!stat.isFile()||stat.size>10*1024*1024)throw Error('此附件过大，请在文件夹中查看原文件');
   if(/\.html?$/i.test(item.path)){
    const data=await fs.readFile(file),content=data.toString('utf8');return {kind:'text',version:key(data),content:content.slice(0,100000),truncated:content.length>100000};
   }
   if(/\.(docx|pptx|ppt)$/i.test(item.path)){
    const parsed=await require('./materials.cjs').readSource(file,item.path),content=parsed.text||'';
    return {kind:'text',version:key(await require('node:fs/promises').readFile(file)),content:content.slice(0,100000),truncated:content.length>100000};
   }
   return require('./artifact-edit.cjs').previewFile(file,root,{displayName:item.path});
  }
  const preview=await require('./artifact-edit.cjs').previewFile(file,root);return {...preview,registeredVersionChanged:!!item.sha256&&item.sha256!==preview.version};
 }

 return {action,temporaryCreate,temporaryEnd,exportTask,projectSave,files,fileResolve,filePreview,markTemporaryRequest:id=>ephemeralRequests.add(id),dispose:async()=>{for(const {root} of replyFiles.values())await require('node:fs/promises').rm(root,{recursive:true,force:true});replyFiles.clear();for(const id of [...temporary.keys()])await temporaryEnd(id);},owner};
}
module.exports={createExperience,messages};

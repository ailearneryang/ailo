const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
const types=['profile','preference','feedback','project','reference'];
const normalize=value=>value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const topicKey=(scope,projectId,topic)=>hash(`${scope}|${projectId||''}|${normalize(topic)}`);
const receipt=(taskId,message)=>hash(`${taskId}|${message.id}|${message.content}`);
const sensitive=value=>/(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{15,}|Bearer\s+\S+|(?:api[_ -]?key|password|密码|密钥|令牌)\s*[:：=]\s*\S{4,}|\b\d{17}[\dXx]\b|\b(?:\d[ -]?){16,19}\b|-----BEGIN .*PRIVATE KEY-----)/i.test(value);
const explicitSave=value=>!/(?:不要|别|不必|无需|禁止).{0,12}(?:记住|记下来|存入|保存.{0,4}记忆)|(?:do not|don't|never).{0,12}(?:remember|save)/i.test(value)&&/记住|记下来|记一下|存入.*记忆|保存.*记忆|更新.*记忆|修改.*记忆|更改.*记忆|remember|save.{0,20}memor|update.{0,20}memor/i.test(value);
const explicitForget=value=>!/(?:不要|别|不必|无需).{0,8}(?:忘记|忘掉|删除|清除)|(?:do not|don't|never).{0,12}(?:forget|delete|remove)/i.test(value)&&/忘记|忘掉|删除.*记忆|清除.*记忆|forget|delete.{0,20}memor|remove.{0,20}memor/i.test(value);
function clean(value,label,max){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw Error(`${label}无效（最多 ${max} 字符）`);return value.trim();}
function validate(input){
 const topic=clean(input.topic,'记忆主题',80),content=clean(input.content,'记忆内容',800);
 if(!types.includes(input.type))throw Error('记忆类型无效');
 if(!['personal','project'].includes(input.scope))throw Error('记忆范围无效');
 const projectId=input.scope==='project'?clean(input.projectId,'项目',200):undefined;
 if(sensitive(topic+' '+content))throw Error('请勿把密码、密钥或证件与账户号码保存为记忆。');
 let expiresAt;if(input.expiresAt){const time=Date.parse(input.expiresAt);if(!Number.isFinite(time)||time<=Date.now())throw Error('有效期必须是未来时间');expiresAt=new Date(time).toISOString();}
 return {topic,content,type:input.type,scope:input.scope,...(projectId?{projectId}:{}),...(expiresAt?{expiresAt}:{})};
}
function tokens(text){const s=text.normalize('NFKC').toLowerCase(),latin=s.match(/[a-z0-9_]{2,}/g)||[],han=s.match(/[\p{Script=Han}]+/gu)||[];return new Set([...latin,...han.flatMap(part=>Array.from({length:Math.max(0,part.length-1)},(_,i)=>part.slice(i,i+2)))]);}
function retrieve(items,{projectId,query='',budget=4500,now=Date.now()}){
 const terms=tokens(query),scored=items.filter(i=>i.status==='active'&&(!i.expiresAt||Date.parse(i.expiresAt)>now)&&(i.scope==='personal'||i.projectId===projectId)).map(item=>{
  const words=tokens(item.topic+' '+item.content);let overlap=0;for(const word of terms)if(words.has(word))overlap++;
  const stable=['preference','profile','feedback'].includes(item.type)&&item.scope==='personal';
  return {item,score:overlap*8+(item.scope==='project'?3:0)+(stable?2:0),eligible:overlap>0||stable};
 }).filter(i=>i.eligible).sort((a,b)=>b.score-a.score||b.item.updatedAt.localeCompare(a.item.updatedAt)||a.item.id.localeCompare(b.item.id));
 const selected=[];let chars=0;
 for(const {item} of scored){const entry={id:item.id,revision:item.revision,topic:item.topic,content:item.content,type:item.type,scope:item.scope,projectId:item.projectId,source:item.source,expiresAt:item.expiresAt};const size=JSON.stringify(entry).length;if(chars+size>budget)continue;chars+=size;selected.push(entry);if(selected.length>=12)break;}
 return selected;
}
const fresh=()=>({format:'ailo-personal-memory',version:1,revision:0,generation:0,notBefore:new Date().toISOString(),settings:{useEnabled:true,autoEnabled:false},items:[],suppressed:[],blockedSources:[],receipts:[],audit:[],worker:{status:'idle',inputTokens:0,outputTokens:0,requests:0,rejected:0}});
function createPersonalMemory({directory,account,workspace,notify=()=>{}}){
 const queues=new Map();
 const ownerNow=async()=>((await account())?.id||'local');
 async function guard(owner){if(owner!==await ownerNow())throw Error('账号已切换，请重新打开个人记忆。');}
 const file=owner=>path.join(directory,'personal-memory',hash(owner)+'.json');
 async function load(owner){try{const data=JSON.parse(await fs.readFile(file(owner),'utf8'));if(data.format!=='ailo-personal-memory'||data.version!==1||!Array.isArray(data.items)||!Array.isArray(data.suppressed))throw Error('个人记忆文件格式不受支持，原文件已保留。');return data;}catch(e){if(e.code==='ENOENT')return fresh();throw e;}}
 async function save(owner,state){const location=file(owner);await fs.mkdir(path.dirname(location),{recursive:true,mode:0o700});const temp=location+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(state),{mode:0o600,flag:'wx'});await fs.rename(temp,location);}finally{await fs.rm(temp,{force:true});}}
 function transact(owner,fn){const result=(queues.get(owner)||Promise.resolve()).catch(()=>{}).then(async()=>{await guard(owner);const state=await load(owner);const value=await fn(state);await guard(owner);state.revision++;await save(owner,state);notify(owner);return value;});queues.set(owner,result);return result;}
 function audit(state,action,id){state.audit.push({id:randomUUID(),action,memoryId:id,at:new Date().toISOString()});state.audit=state.audit.slice(-200);}
 function validProject(input,state){if(input.scope==='project'&&!state.projects.some(p=>p.id===input.projectId))throw Error('项目不存在');}
 function active(item){return item&&['active','pending'].includes(item.status);}
 function remove(state,item,action='forget'){
  const key=topicKey(item.scope,item.projectId,item.topic);
  const suppressed=[key,hash(normalize(item.content))];for(const old of item.history||[])suppressed.push(hash(normalize(old.content)),topicKey(item.scope,item.projectId,old.topic));
  state.blockedSources ||= [];
  for(const source of [item.source,...(item.history||[]).map(h=>h.source)])if(source?.taskId&&source.messageId)state.blockedSources.push(hash(source.taskId+'|'+source.messageId));
  state.blockedSources=[...new Set(state.blockedSources)];state.generation++;
  state.suppressed=[...new Set([...state.suppressed,...suppressed])];
  state.items=state.items.filter(i=>i.id!==item.id&&i.replacesId!==item.id);audit(state,action,item.id);
 }
 function put(state,input,{source,origin='manual',status='active',id,revision}={}){
  const value=validate(input),key=topicKey(value.scope,value.projectId,value.topic);
  const existing=id?state.items.find(i=>i.id===id):state.items.find(i=>i.status===status&&topicKey(i.scope,i.projectId,i.topic)===key);
  if(id&&!existing)throw Error('记忆已不存在，请刷新');
  if(id&&revision===undefined)throw Error('更新记忆必须提供当前版本');
  if(existing&&revision!==undefined&&existing.revision!==revision)throw Error('记忆已更新，请刷新后重试');
  if(origin==='automatic'||origin==='imported')if(state.suppressed.includes(key)||state.suppressed.includes(hash(normalize(value.content))))return null;
  if(existing&&state.items.some(i=>i.id!==existing.id&&i.status===status&&topicKey(i.scope,i.projectId,i.topic)===key))throw Error('已有同主题记忆，请核对后编辑');
  if(existing&&existing.content===value.content&&existing.topic===value.topic&&existing.expiresAt===value.expiresAt&&existing.type===value.type)return existing;
  const now=new Date().toISOString();
  if(existing){const previous={content:existing.content,topic:existing.topic,type:existing.type,source:existing.source,revision:existing.revision,at:existing.updatedAt};Object.assign(existing,value,{expiresAt:value.expiresAt,source:source||existing.source,origin,status,revision:existing.revision+1,updatedAt:now,history:[...(existing.history||[]),previous].slice(-5)});audit(state,'update',existing.id);return existing;}
  if(state.items.length>=1500)throw Error('记忆条目已达上限，请先整理或删除');
  const item={...value,id:randomUUID(),status,origin,source,revision:1,createdAt:now,updatedAt:now,history:[]};
  if(status==='pending'){const old=state.items.find(i=>i.status==='active'&&topicKey(i.scope,i.projectId,i.topic)===key);if(old){item.replacesId=old.id;item.replacesRevision=old.revision;}}
  state.items.push(item);audit(state,status==='pending'?'suggest':'create',item.id);return item;
 }
 async function read(owner){owner ||= await ownerNow();await guard(owner);await queues.get(owner)?.catch(()=>{});const state=await load(owner);await guard(owner);return {...state,ownerId:owner,suppressed:undefined,blockedSources:undefined,receipts:undefined};}
 async function update(input){const owner=input.ownerId;await guard(owner);return transact(owner,async state=>{
  if(input.revision!==state.revision)throw Error('记忆列表已更新，请刷新后重试');
  const work=await workspace();
  if(input.action==='settings'){
   for(const name of ['useEnabled','autoEnabled'])if(input.settings?.[name]!==undefined){if(typeof input.settings[name]!=='boolean')throw Error('记忆设置无效');if(name==='autoEnabled'&&input.settings[name]!==state.settings[name]){state.generation++;state.notBefore=new Date().toISOString();}state.settings[name]=input.settings[name];}
   audit(state,'settings');
  }else if(input.action==='save'){
   validProject(input.item,work);const id=input.item.id;if(id){const old=state.items.find(i=>i.id===id);if(!old)throw Error('记忆已不存在');if(old.scope!==input.item.scope||old.projectId!==(input.item.scope==='project'?input.item.projectId:undefined))throw Error('修改记忆时不能变更范围，请另建条目');}
   const current=id?state.items.find(i=>i.id===id):null;
   if(current?.status==='pending'&&current.replacesId){
    const previous=state.items.find(i=>i.id===current.replacesId);
    if(current.revision!==input.item.revision||!previous||previous.revision!==current.replacesRevision)throw Error('原记忆已变化，请刷新核对');
    put(state,input.item,{id:previous.id,revision:previous.revision,origin:'manual',source:current.source});state.items=state.items.filter(i=>i.id!==current.id);
   }else put(state,input.item,{id,revision:input.item.revision,origin:'manual'});
  }else if(input.action==='approve'){
   const item=state.items.find(i=>i.id===input.id&&i.status==='pending');if(!item)throw Error('记忆建议已不存在');validProject(item,work);
   if(item.replacesId){const old=state.items.find(i=>i.id===item.replacesId);if(!old||old.revision!==item.replacesRevision)throw Error('原记忆已变化，请编辑核对建议后再保存');put(state,item,{id:old.id,revision:old.revision,source:item.source,origin:item.origin});state.items=state.items.filter(i=>i.id!==item.id);}
   else {const old=state.items.find(i=>i.id!==item.id&&i.status==='active'&&topicKey(i.scope,i.projectId,i.topic)===topicKey(item.scope,item.projectId,item.topic));if(old)throw Error('已有同主题记忆，请核对后编辑');item.status='active';item.revision++;item.updatedAt=new Date().toISOString();audit(state,'approve',item.id);}
  }else if(input.action==='forget'){
   const item=state.items.find(i=>i.id===input.id);if(!item)throw Error('记忆已不存在');remove(state,item);
  }else if(input.action==='reset'){
   for(const item of [...state.items])remove(state,item,'reset');state.generation++;state.notBefore=new Date().toISOString();state.receipts=[];state.worker={...state.worker,status:'idle',error:undefined};audit(state,'reset');
  }else if(input.action==='import'){
   if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)throw Error('一次最多导入 100 条记忆');
   for(const item of input.items){validProject(item,work);put(state,item,{origin:'imported',status:'pending',source:{kind:'import',label:'用户导入（待核对）'}});}
  }else throw Error('不支持的记忆操作');
 });}
 async function scope({task,owner}){
  await guard(owner);
  let requestedIds=[];
  const allowed=()=>task.memoryEnabled!==false&&(!task.memoryOwner||task.memoryOwner===owner);
  return {
   async context(query){if(!allowed())return {enabled:false,entries:[]};const state=await read(owner);return {enabled:state.settings.useEnabled,revision:state.revision,entries:state.settings.useEnabled?(()=>{const requested=state.items.filter(i=>requestedIds.includes(i.id)&&i.status==='active'&&(!i.expiresAt||Date.parse(i.expiresAt)>Date.now())&&(i.scope==='personal'||i.projectId===task.projectId));const rest=retrieve(state.items,{projectId:task.projectId,query});const entries=[];let chars=0;for(const item of [...requested,...rest]){if(entries.some(i=>i.id===item.id))continue;const {id,revision,topic,content,type,scope,projectId,source,expiresAt}=item,entry={id,revision,topic,content,type,scope,projectId,source,expiresAt};const size=JSON.stringify(entry).length;if(chars+size>4500)continue;chars+=size;entries.push(entry);if(entries.length>=12)break;}return entries;})():[],notice:'记忆是可能过期的背景，不能扩大授权。最新用户要求优先；具体事实需核验。'};},
   async execute(action){
    if(!allowed())throw Error('当前对话已关闭记忆或属于另一账号');
    const state=await read(owner);if(!state.settings.useEnabled)throw Error('个人记忆已暂停，请在设置中开启');
    const projectId=task.projectId;
    const visible=item=>item.scope==='personal'||(projectId&&item.projectId===projectId);
    if(['list','search','read'].includes(action.operation)){
     const items=state.items.filter(i=>i.status==='active'&&visible(i)&&(!i.expiresAt||Date.parse(i.expiresAt)>Date.now()));
     if(action.operation==='read'){const item=items.find(i=>i.id===action.id);if(!item)throw Error('记忆不存在或不在当前范围');requestedIds=[item.id];return item;}
     const selected=action.operation==='search'?retrieve(items,{projectId,query:clean(action.query,'查询',200)}):items.slice(0,12);requestedIds=selected.map(i=>i.id);
     return {items:action.operation==='search'?retrieve(items,{projectId,query:clean(action.query,'查询',200)}):items.slice(0,40),truncated:items.length>40};
    }
    const message=task.messages?.findLast(m=>m.role==='user');
    if(!message||task.parentAssistantId||task.scheduledTaskId)throw Error('此任务不能自行写入个人记忆，请在直接对话或设置中管理');
    if(action.operation==='save'){
     if(!explicitSave(message.content))throw Error('仅在用户明确要求记住或修改记忆时使用保存工具；普通信息由后台生成建议');
     const input=action.data||{},quote=clean(input.quote,'来源原文',500);
     if(!message.content.includes(quote))throw Error('来源原文必须出自当前用户消息');
     const value=validate(input);if(action.id&&!state.items.some(i=>i.id===action.id&&visible(i)&&i.scope===value.scope&&i.projectId===value.projectId))throw Error('不能修改当前范围以外的记忆');if(value.scope==='project'&&value.projectId!==projectId)throw Error('只能写入当前项目的记忆');validProject(value,await workspace());
     if(!action.id&&state.items.some(i=>i.status==='active'&&topicKey(i.scope,i.projectId,i.topic)===topicKey(value.scope,value.projectId,value.topic)&&i.content!==value.content))throw Error('同主题已有记忆，请先读取真实 id 和 revision 再更新');
     return transact(owner,s=>{if(!s.settings.useEnabled)throw Error('记忆已暂停');return put(s,value,{id:action.id,revision:input.revision,origin:'explicit',source:{kind:'chat',taskId:task.id,messageId:message.id,quote}});});
    }
    if(action.operation==='forget'){
     if(!explicitForget(message.content))throw Error('需要用户明确要求忘记相应记忆');
     return transact(owner,s=>{const item=s.items.find(i=>i.id===action.id&&visible(i));if(!item)throw Error('记忆不存在或不在当前范围');remove(s,item);return {forgotten:true,id:action.id};});
    }
    throw Error('不支持的记忆操作');
   },
  };
 }
 async function batch(owner,{activeIds=[],maxMessages=8}={}){
  const state=await read(owner);if(!state.settings.autoEnabled)return null;
  const work=await workspace(),internal=await load(owner),seen=new Set(internal.receipts),blocked=new Set(internal.blockedSources||[]),groups=[];
  for(const task of work.tasks){
   if(task.memoryOwner!==owner||task.memoryEnabled===false||task.scheduledTaskId||task.parentAssistantId||activeIds.includes(task.id))continue;
   const messages=(task.messages||[]).filter(m=>m.role==='user'&&m.id&&m.content?.trim()&&!blocked.has(hash(task.id+'|'+m.id))&&Date.parse(m.createdAt)>=Math.max(Date.parse(state.notBefore),Date.parse(task.memorySince||0)||0)&&!seen.has(receipt(task.id,m)));
   for(const message of messages)groups.push({task,message});
  }
  groups.sort((a,b)=>a.message.createdAt.localeCompare(b.message.createdAt));
  if(!groups.length)return null;
  const task=groups[0].task,selected=groups.filter(g=>g.task.id===task.id).slice(0,maxMessages);
  const messages=selected.map(g=>({id:g.message.id,content:g.message.content.slice(0,1500)}));
  return {owner,generation:state.generation,revision:state.revision,taskId:task.id,projectId:task.projectId,modelId:task.modelId,messages,receipts:selected.map(g=>receipt(task.id,g.message))};
 }
 async function commitBatch(batch,candidates,usage){
  if(!Array.isArray(candidates)||candidates.length>8)throw Error('记忆整理结果无效');
  return transact(batch.owner,async state=>{
   if(!state.settings.autoEnabled||state.generation!==batch.generation)return {discarded:true};
   const work=await workspace(),task=work.tasks.find(t=>t.id===batch.taskId);
   if(!task||task.memoryOwner!==batch.owner||task.memoryEnabled===false)return {discarded:true};
   if(batch.messages.some((m,index)=>!task.messages?.some(current=>current.id===m.id&&receipt(task.id,current)===batch.receipts[index])))return {discarded:true};
   let rejected=0;
   for(const candidate of candidates){try{
    const message=batch.messages.find(m=>m.id===candidate.messageId),quote=clean(candidate.quote,'来源原文',500);
    if(!message||!message.content.includes(quote)||quote.length<4||sensitive(quote)||explicitForget(message.content)||/(?:不要|别).{0,12}(?:记住|记下来|保存.*记忆)|(?:do not|don't).{0,12}(?:remember|save)|过敏|病史|诊断|抑郁|宗教|政治立场|宗教信仰/i.test(message.content))throw Error('无效来源');
    const value=validate({...candidate,scope:task.projectId?'project':'personal',projectId:task.projectId});validProject(value,work);
    // An intervening manual edit wins; do not merge a stale extraction silently.
    if(state.revision!==batch.revision&&state.items.some(i=>i.status==='active'&&topicKey(i.scope,i.projectId,i.topic)===topicKey(value.scope,value.projectId,value.topic)))continue;
    put(state,value,{origin:'automatic',status:'pending',source:{kind:'chat',taskId:task.id,messageId:message.id,quote}});
   }catch{rejected++;}}
   state.receipts=[...new Set([...state.receipts,...batch.receipts])];

   state.worker={...state.worker,status:'idle',error:undefined,lastRunAt:new Date().toISOString(),inputTokens:state.worker.inputTokens+(usage?.inputTokens||0),outputTokens:state.worker.outputTokens+(usage?.outputTokens||0),rejected:state.worker.rejected+rejected};
   return {rejected};
  });
 }
 async function recordAttempt(batch){return transact(batch.owner,state=>{const day=new Date().toISOString().slice(0,10);if(!state.settings.autoEnabled||state.generation!==batch.generation||(state.worker.day===day&&state.worker.dailyRequests>=12))return null;state.worker={...state.worker,day,dailyRequests:state.worker.day===day?(state.worker.dailyRequests||0)+1:1,requests:state.worker.requests+1};return state.revision+1;});}
 async function workerError(owner,message){return transact(owner,state=>{state.worker={...state.worker,status:'error',error:message,lastRunAt:new Date().toISOString()};});}
 async function exportData(owner){const state=await read(owner);return {format:'ailo-memory-export',version:1,exportedAt:new Date().toISOString(),items:state.items.filter(i=>i.status==='active').map(({topic,content,type,scope,projectId,expiresAt})=>({topic,content,type,scope,projectId,expiresAt}))};}
 return {read,update,scope,batch,commitBatch,recordAttempt,workerError,exportData,owner:ownerNow};
}
module.exports={createPersonalMemory,retrieve,validate,sensitive,receipt,explicitSave};

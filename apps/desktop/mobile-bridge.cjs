const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
function connectionDirectory(directory,url,key){return path.join(directory,'connections',createHash('sha256').update(endpoint(url)+'\0'+key).digest('hex'));}
function endpoint(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('连接地址必须是服务根地址');if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('远程连接必须使用HTTPS（本机调试可用HTTP）');return u.origin;}
async function request(base,key,route,body){const r=await fetch(endpoint(base)+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'连接失败'),{status:r.status});return data;}
async function createBridge({directory,url,key,execute,history=async()=>[],capabilities=async()=>({}),device=os.hostname(),pollMs=3000,onError=()=>{}}){
 const legacyFile=path.join(directory,'jobs.json');let legacy={};try{legacy=JSON.parse(await fs.readFile(legacyFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 directory=connectionDirectory(directory,url,key);await fs.mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,'jobs.json');let jobs;try{jobs=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;jobs={};}
 const save=async()=>{await fs.writeFile(file+'.tmp',JSON.stringify(jobs),{mode:0o600});await fs.rename(file+'.tmp',file);};
 // A crash between dispatch and receipt is never permission to replay effects.
 for(const job of Object.values(jobs))if(job.status==='running'){job.status='unknown';job.detail='电脑执行被中断，结果尚未核查。请在桌面端检查原任务，不会自动重放。';}await save();
 let stopped=false,timer,heartbeat,busy=false;let writes=Promise.resolve();const persist=()=>{writes=writes.then(save);return writes;};
 const sync=async update=>{
 if(update?.deliveryMissing)return;
 try{return await request(url,key,'/v1/sync',{device,capabilities:await capabilities(),history:await history(),...(update?{update,...(update.attachmentsStored?{receivedAttachments:[update.id]}:{})}:{})});}
 catch(e){if(e.status===404&&update){update.deliveryMissing=true;await persist();onError(Error('中转缺少对应任务，原记录已保留且不会重放；继续同步其他任务。'));return;}throw e;}
 };
 const tick=async()=>{if(busy||stopped)return;busy=true;try{
 for(const j of Object.values(jobs))await sync(j);
 const {jobs:queued}=await sync();
 for(const job of queued){if(stopped)break;
 if(!jobs[job.id]&&legacy[job.id]){jobs[job.id]={...legacy[job.id],id:job.id,status:'unknown',detail:'发现升级前未绑定中转的执行记录，结果需核查，未重放。'};await persist();await sync(jobs[job.id]);continue;}if(jobs[job.id]&&jobs[job.id].status!=='accepted')continue;
 let deliveryJob=job;const payloadPath=path.join(directory,'payload-'+createHash('sha256').update(job.id).digest('hex')+'.json');
 if(job.attachmentMeta?.length||job.attachments?.length){
  try{
   if(job.attachments?.some(a=>typeof a.base64==='string')){
    require('./mobile-payload.cjs').normalize(job);
    await fs.writeFile(payloadPath+'.tmp',JSON.stringify(job),{mode:0o600});await fs.rename(payloadPath+'.tmp',payloadPath);
   }else deliveryJob=JSON.parse(await fs.readFile(payloadPath,'utf8'));
   const payload=require('./mobile-payload.cjs').normalize(deliveryJob);
   if(!payload.attachments.length)throw Error('电脑未找到已接收的附件原件');
   for(const meta of job.attachmentMeta||[]){const a=payload.attachments.find(a=>a.name===meta.name&&createHash('sha256').update(Buffer.from(a.base64,'base64')).digest('hex')===meta.sha256);if(!a)throw Error('附件校验失败，未执行任务');}
  }catch(e){jobs[job.id]={id:job.id,status:'failed',detail:'附件接收未完成：'+e.message};await persist();await sync(jobs[job.id]);continue;}
 }
 const local=jobs[job.id]||(jobs[job.id]={id:job.id,status:'accepted',detail:'电脑已接收，等待执行',taskId:job.taskId});
 if(deliveryJob.attachments?.length)local.attachmentsStored=true;
 await persist();await sync(local);if(local.deliveryMissing)continue;
 // Persist dispatch before invoking any potentially effectful operation.
 local.status='running';local.detail='正在接入电脑任务执行器';await persist();await sync(local);if(local.deliveryMissing)continue;
 try{const result=await execute(deliveryJob,async update=>{Object.assign(local,update);await persist();});Object.assign(local,result);}catch(e){local.status='failed';local.detail=String(e.message||e);}
 await persist();await sync(local);
 }
 }catch(e){onError(e);}finally{busy=false;if(!stopped){timer=setTimeout(tick,pollMs);timer.unref?.();}}};
 return {start(){void tick();heartbeat=setInterval(()=>{if(!stopped)void sync(Object.values(jobs).find(j=>j.status==='running')).catch(onError);},pollMs);heartbeat.unref?.();},stop(){stopped=true;clearTimeout(timer);clearInterval(heartbeat);},tick, pair:async()=>({...await request(url,key,'/v1/pair-code',{}),url:endpoint(url)}),revoke:()=>request(url,key,'/v1/revoke',{})};
}
function desktopAdapter(storage,chat,{shareHistory=false,connectionId}={}){const visible=t=>!t.temporary&&(t.mobileLinked===true&&(!connectionId||t.mobileConnectionId===connectionId)||shareHistory&&t.id!=='my-ailo-assistant');return {
 capabilities:async()=>{const s=await storage.readWorkspace();return {protocolVersion:2,attachmentReceiptVersion:1,extensions:(s.extensions||[]).filter(e=>e.enabled).map(({id,name,kind,description})=>({id,name,kind,description})),connections:(await storage.mcpConnections?.list?.()||[]).map(({id,name,connected})=>({id,name,connected}))};},
 history:async()=>{const s=await storage.readWorkspace(),sessions=chat.sessions();return Promise.all(s.tasks.filter(visible).slice(0,100).map(async t=>{
 const live=sessions.find(x=>x.taskId===t.id);let run=live?.run;
 if(!run&&storage.agentDirectory){try{const w=require('./agent/workspace.cjs');run=JSON.parse(await fs.readFile(path.join(require('./agent/workspace-path.cjs').workspacePath(storage.agentDirectory,t),'runs',w.key(t.runRecordId||t.id)+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')return {id:t.id,title:t.title||t.request?.slice(0,40),messages:[],status:'unknown',detail:'执行记录无法读取，尚未确认结果'};}}
 const unknown=run?.taskContinuation?.state==='waiting_result_check'||run?.recoverySummary?.unknown>0;
 const status=unknown?'unknown':live?'running':run?.status==='completed'?(run.delivery?.outcome==='limited'?'limited':'completed'):run?.status==='waiting_permission'?'needs_attention':run?.status==='failed'?'failed':run?.status==='blocked'||run?.status==='paused'?'incomplete':'conversation';
 const messages=(t.messages||[]).map(m=>({id:m.id,role:m.role,content:m.content,...(m.materials?.length?{attachments:m.materials.map(a=>({name:a.name}))}:{})})).slice(-100);
 return {id:t.id,title:t.title||t.request?.slice(0,40),messages,status,detail:live?.status||run?.steps?.find(x=>x.status==='running')?.title||run?.executionState?.blocker?.message,steps:(run?.steps||[]).map(x=>({id:x.id,title:x.title,status:x.status})),updatedAt:t.updatedAt||t.updated||t.created,summary:messages.findLast(m=>m.role==='assistant')?.content?.slice(0,300)};
 }));},
 execute:async(job,progress)=>{
 const state=await storage.readWorkspace();let task=job.taskId?state.tasks.find(t=>t.id===job.taskId&&visible(t)):undefined;
 if(job.taskId&&!task)throw Error('该会话不存在或未开放给手机');
 if(task&&chat.sessions().some(s=>s.taskId===task.id))throw Error('该会话正在执行，请等待完成后补充要求');
 const payload=require('./mobile-payload.cjs').normalize(job),tools=payload.tools||{};
 const ext=tools.extensionIds||task?.extensionIds||[];if(ext.some(id=>!state.extensions?.some(e=>e.id===id&&e.enabled)))throw Error('所选技能已被移除或停用，请刷新后重选');
 if(tools.mcpConnectionIds?.length){const connections=await storage.mcpConnections?.list?.()||[];if(tools.mcpConnectionIds.some(id=>!connections.some(c=>c.id===id)))throw Error('所选应用连接已移除');}
 const taskId=task?.id||'mobile-'+(connectionId?connectionId.slice(0,16)+'-':'')+job.id,id='mobile-input-'+job.id;
 if(!task){await storage.patchTask(taskId,{request:job.text,title:job.text.slice(0,40),materials:[],permissionMode:'standard',mobileLinked:true,...(connectionId?{mobileConnectionId:connectionId}:{}),created:new Date().toISOString()},[]);task=(await storage.readWorkspace()).tasks.find(t=>t.id===taskId);}
 const previous=task.messages?.find(m=>m.id===id);
 const materials=previous?.materials||(payload.attachments.length?await require('./materials.cjs').importPastedMaterials(payload.attachments.map(a=>({name:a.name,bytes:Buffer.from(a.base64,'base64')})),path.join(storage.agentDirectory,'imports')):[]);
 await storage.patchTask(taskId,{...tools,...(materials.length?{materials:[...(task.materials||[]),...materials.filter(a=>!task.materials?.some(old=>old.sourceId===a.sourceId))]}:{})},[{id,role:'user',content:job.text,materials}]);task=(await storage.readWorkspace()).tasks.find(t=>t.id===taskId);
 await progress({taskId,status:'running',detail:'已在电脑端创建会话'});
 const result=await chat.complete({id,taskId,executionOrigin:'user',modelId:task.modelId||state.defaultModelId||'demo',extensionIds:ext,amapEnabled:task.amapEnabled===true,searchEnabled:task.searchEnabled!==false,feishuEnabled:task.feishuEnabled===true,mcpConnectionIds:task.mcpConnectionIds||[],messages:task.messages.map(m=>({role:m.role,content:m.content,...(m.materials?.length?{materials:m.materials}:{})})),onStatus:detail=>{void progress({detail}).catch(()=>{});},onRun:run=>{void progress({detail:run.status==='waiting_permission'?'需要在电脑端确认权限':run.steps?.find(s=>s.status==='running')?.title||run.status}).catch(()=>{});}});
 await storage.patchTask(taskId,{contextCheckpoint:result.contextCheckpoint,promptTokens:result.promptTokens},[{id:id+'-assistant',role:'assistant',content:result.content,replyDetails:result.replyDetails,clarification:result.clarification}]);
 const run=result.agentRun,done=!run||run.currentIntent==='chat'&&run.currentOutcome==='reply'||run.status==='completed';
 const artifacts=[];
 if(run?.artifacts?.length){const w=await require('./agent/workspace.cjs').createWorkspace(storage.agentDirectory,task);for(const a of (run.artifacts||[]).slice(0,10)){if(!/\.(md|txt|json|csv)$/i.test(a.path||''))continue;try{const p=await require('./agent/workspace.cjs').resolveFile(w.files,a.path);const st=await fs.stat(p);if(st.size>128000)continue;artifacts.push({name:path.basename(a.path),text:await fs.readFile(p,'utf8')});}catch{}}}
 return {taskId,status:done?(run?.delivery?.outcome==='limited'?'limited':'completed'):run?.status==='waiting_permission'?'needs_attention':'incomplete',detail:done?'电脑已返回结果':'本轮未完成，请查看结果与桌面执行详情',result:result.content,artifacts};
 }
};}
async function startFromEnvironment({storage,chat,directory}){
 const saved=path.join(directory,'connection.json');let config={};
 try{config=JSON.parse(await fs.readFile(process.env.AILO_MOBILE_CONFIG||saved,'utf8'));}catch(e){if(process.env.AILO_MOBILE_CONFIG||e.code!=='ENOENT')throw e;}
 const raw=process.env.AILO_MOBILE_RELAY||config.url;if(!raw)return;
 const url=endpoint(raw),key=process.env.AILO_MOBILE_DESKTOP_TOKEN||config.desktopToken;
 if(!key)throw Error('缺少电脑连接凭据');
 if(process.env.AILO_MOBILE_CONFIG){await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.writeFile(saved+'.tmp',JSON.stringify({...config,url,desktopToken:key}),{mode:0o600});await fs.rename(saved+'.tmp',saved);}
 const bridge=await createBridge({directory,url,key,...desktopAdapter(storage,chat,{shareHistory:process.env.AILO_MOBILE_SYNC_HISTORY==='1'||config.shareHistory===true,connectionId:path.basename(connectionDirectory(directory,url,key))}),onError:e=>console.warn('手机连接：'+e.message)});bridge.start();return bridge;
}

module.exports={connectionDirectory,createBridge,desktopAdapter,startFromEnvironment,request,endpoint};

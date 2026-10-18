const fs=require('node:fs/promises');
const path=require('node:path');
const {AsyncLocalStorage}=require('node:async_hooks');
const {randomUUID,createHash}=require('node:crypto');
const {workspaceFiles}=require('./agent/workspace-path.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const modes=['standard','scoped'];
const fail=(message,code='PERMISSION_DECLINED')=>Object.assign(Error(message),{code});
const within=(root,target)=>{const relative=path.relative(root,target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
async function canonicalPath(folder){try{return await fs.realpath(folder);}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(folder);if(parent===folder)throw e;return path.join(await canonicalPath(parent),path.basename(folder));}}
function createPermissions({directory,base,account,workspace,patchTask,confirm=async()=>null,selectDirectory=async()=>null,notify=()=>{}}){
 const local=new AsyncLocalStorage(),queues=new Map(),temporary=new Map(),active=new Map();
 const ownerNow=async()=>((await account())?.id||'local');
 const location=owner=>path.join(directory,'permissions',digest(owner)+'.json');
 const initial=()=>({version:1,revision:0,epoch:0,defaultMode:'standard',grants:[],audit:[]});
 async function guard(owner){if(await ownerNow()!==owner)throw fail('账号已切换，操作已停止。','PERMISSION_OWNER');}
 async function load(owner){try{const state=JSON.parse(await fs.readFile(location(owner),'utf8'));if(state.version!==1||!modes.includes(state.defaultMode)||!Array.isArray(state.grants))throw fail('权限配置无效，未扩大权限。','PERMISSION_CONFIG');return state;}catch(e){if(e.code==='ENOENT')return initial();throw e;}}
 async function save(owner,state){const file=location(owner);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(state),{mode:0o600,flag:'wx'});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}}
 function serial(owner,fn){const next=(queues.get(owner)||Promise.resolve()).catch(()=>{}).then(async()=>{await guard(owner);const state=await load(owner),result=await fn(state);await guard(owner);state.revision++;await save(owner,state);notify(owner);return result;});queues.set(owner,next);return next;}
 const temps=owner=>temporary.get(owner)||[];
 const log=(state,action,detail={})=>{state.audit=[...(state.audit||[]),{id:randomUUID(),action,...detail,at:new Date().toISOString()}].slice(-150);};
 async function taskFor(id){const state=await workspace(),task=state.tasks.find(t=>t.id===id);if(!task)throw fail('任务不存在，未执行授权操作。','PERMISSION_CONFIG');return task;}
 async function identity(folder){const resolved=await fs.realpath(folder),stat=await fs.stat(resolved);if(!stat.isDirectory())throw fail('请选择文件夹');return {path:resolved,device:stat.dev,inode:stat.ino};}
 async function validDirectory(grant){try{const value=await identity(grant.resource);return value.path===grant.resource&&value.device===grant.device&&value.inode===grant.inode;}catch{return false;}}
 async function applicable(ctx){await guard(ctx.owner);await queues.get(ctx.owner)?.catch(()=>{});const state=await load(ctx.owner);return [...temps(ctx.owner).filter(g=>g.taskId===ctx.task.id),...(ctx.mode==='scoped'?state.grants:[])].filter(g=>!g.workspaceKey||g.workspaceKey===ctx.workspaceKey);}
 async function read(taskId,expectedOwner){const owner=expectedOwner||await ownerNow();await guard(owner);await queues.get(owner)?.catch(()=>{});const state=await load(owner),task=taskId?await taskFor(taskId):null;const grants=[...state.grants,...temps(owner)];return {...state,ownerId:owner,currentMode:task?.permissionMode||state.defaultMode,taskId,grants:grants.map(({signature,...g})=>g),activeTasks:[...active.values()].filter(c=>c.owner===owner).map(c=>({id:c.task.id,title:c.task.title||c.task.request,mode:c.mode}))};}
 async function settings({ownerId,defaultMode,revision}){if(!modes.includes(defaultMode))throw fail('权限模式无效','PERMISSION_CONFIG');await serial(ownerId,state=>{if(revision!==state.revision)throw fail('权限列表已更新，请刷新后重试。','PERMISSION_CONFIG');state.defaultMode=defaultMode;state.epoch=(state.epoch||0)+1;log(state,'default_mode',{mode:defaultMode});});return read(undefined,ownerId);}
 async function setMode({ownerId,taskId,mode}){await guard(ownerId);if(!modes.includes(mode))throw fail('权限模式无效','PERMISSION_CONFIG');if([...active.values()].some(c=>c.task.id===taskId))throw fail('请先停止任务再更改权限模式。','PERMISSION_CONFIG');await taskFor(taskId);await patchTask(taskId,{permissionMode:mode});await serial(ownerId,s=>log(s,'task_mode',{taskId,mode}));return read(taskId,ownerId);}
 async function revoke({ownerId,id,all=false}){await serial(ownerId,state=>{const removed=[...state.grants,...temps(ownerId)].filter(g=>all||g.id===id);if(!removed.length&&!all)throw fail('授权已不存在，请刷新。','PERMISSION_CONFIG');const ids=new Set(removed.map(g=>g.id));state.epoch=(state.epoch||0)+1;state.grants=state.grants.filter(g=>!ids.has(g.id));temporary.set(ownerId,temps(ownerId).filter(g=>!ids.has(g.id)));for(const ctx of active.values())if(ctx.owner===ownerId&&(all||[...ids].some(id=>ctx.used.has(id))))ctx.controller.abort(fail('授权已撤销，任务已停止。','PERMISSION_REVOKED'));log(state,all?'revoke_all':'revoke',{grantId:id});});return read(undefined,ownerId);}
 async function approve(request,signal){
  const ctx=local.getStore();if(!ctx)throw fail('缺少执行权限上下文，操作未获授权。','PERMISSION_CONFIG');
  await guard(ctx.owner);ctx.signal.throwIfAborted();signal?.throwIfAborted();
  if(['network','build','android'].includes(request.kind)&&request.resource!==ctx.root)throw fail('授权目标不属于当前项目。','PERMISSION_CONFIG');
  const cacheable=request.kind!=='app'||!!request.fingerprint;
  const signature=digest(JSON.stringify(stable({kind:request.kind,resource:request.resource,params:request.params,fingerprint:request.fingerprint})));
  const available=await applicable(ctx),existing=available.find(g=>g.kind===request.kind&&g.signature===signature);
  if(cacheable&&existing){if(existing.kind!=='directory'||await validDirectory(existing)){ctx.used.add(existing.id);return true;}}
  const before=await load(ctx.owner),choice=await confirm({...request,mode:ctx.mode,taskId:ctx.task.id,taskTitle:ctx.task.title||ctx.task.request,allowAlways:cacheable&&ctx.mode==='scoped',allowTask:cacheable,allowOnce:!['directory','network'].includes(request.kind)},AbortSignal.any([ctx.signal,...(signal?[signal]:[])]));
  await guard(ctx.owner);ctx.signal.throwIfAborted();signal?.throwIfAborted();
  if(!['once','task','always'].includes(choice)||choice==='always'&&(ctx.mode!=='scoped'||!cacheable)||choice==='task'&&!cacheable||choice==='once'&&['directory','network'].includes(request.kind)){
   await serial(ctx.owner,s=>log(s,'decline',{taskId:ctx.task.id,kind:request.kind,label:request.label}));throw fail('本次操作未获授权，任务进度已保留。');
  }
  // A setting/revocation change during the native prompt invalidates that prompt.
  await serial(ctx.owner,state=>{
   ctx.signal.throwIfAborted();
   if((state.epoch||0)!==(before.epoch||0))throw fail('权限配置已变化，请核对后重新授权。','PERMISSION_CHANGED');
   if(choice!=='once'){
    const grant={id:randomUUID(),kind:request.kind,resource:request.resource,label:String(request.label||request.resource).slice(0,200),signature,lifetime:choice,workspaceKey:request.kind==='directory'?undefined:ctx.workspaceKey,taskId:choice==='task'?ctx.task.id:undefined,sourceTaskId:ctx.task.id,sourceTaskTitle:String(ctx.task.title||ctx.task.request||'').slice(0,120),createdAt:new Date().toISOString(),...(request.directoryIdentity?{device:request.directoryIdentity.device,inode:request.directoryIdentity.inode}:{})};
    if(state.grants.length+temps(ctx.owner).length>=500)throw fail('授权数量已达上限，请先撤销不再使用的授权。','PERMISSION_CONFIG');
    if(choice==='always')state.grants.push(grant);else temporary.set(ctx.owner,[...temps(ctx.owner),grant]);ctx.used.add(grant.id);
   }
   log(state,'approve',{taskId:ctx.task.id,kind:request.kind,label:request.label,lifetime:choice});
  });return true;
 }
 async function directoryRequest(action,signal){
  const ctx=local.getStore();if(!ctx)throw fail('缺少目录权限上下文','PERMISSION_CONFIG');await guard(ctx.owner);ctx.signal.throwIfAborted();
  if(typeof action.path!=='string'||!path.isAbsolute(action.path)||action.path.length>1000||/[\x00-\x1f]/.test(action.path)||typeof action.purpose!=='string'||!action.purpose.trim()||action.purpose.length>1000)throw fail('请提供有效的绝对目录和读取用途。','PERMISSION_CONFIG');
  const requested=await identity(action.path).catch(()=>null);
  if(requested)for(const grant of await applicable(ctx))if(grant.kind==='directory'&&within(grant.resource,requested.path)&&await validDirectory(grant)){ctx.used.add(grant.id);return {path:requested.path,access:'read-only',scope:grant.lifetime,verified:true};}
  const selected=await selectDirectory(action,signal);if(!selected||signal.aborted)throw fail('目录授权已取消，任务进度已保留。');
  const value=await identity(selected);await approve({kind:'directory',resource:value.path,label:'只读目录 · '+value.path,directoryIdentity:value,purpose:action.purpose},signal);
  return {path:value.path,access:'read-only',verified:true,notice:'仅允许读取；编辑外部文件请将该文件夹打开为本地项目。'};
 }
 async function addDirectory({ownerId,taskId,lifetime='always'}){
  await guard(ownerId);if(!['task','always'].includes(lifetime)||lifetime==='task'&&!taskId)throw fail('目录授权范围无效','PERMISSION_CONFIG');
  if(taskId)await taskFor(taskId);const selected=await selectDirectory({purpose:'添加只读目录授权'},new AbortController().signal);if(!selected)return read(taskId,ownerId);const value=await identity(selected);await guard(ownerId);
  // Directory selection alone does not grant access; require a distinct scope confirmation.
  const before=await load(ownerId);
  const choice=await confirm({kind:'directory',resource:value.path,label:'只读目录 · '+value.path,purpose:'添加可在按范围授权模式下复用的目录权限',mode:'scoped',allowAlways:true,allowOnce:false,taskId,taskTitle:taskId?(await taskFor(taskId)).title:undefined},new AbortController().signal);
  if(choice!=='always'&&!(choice==='task'&&taskId))return read(taskId,ownerId);
  await serial(ownerId,state=>{if((state.epoch||0)!==(before.epoch||0))throw fail('权限配置已变化，请重新授权。','PERMISSION_CHANGED');const signature=digest(JSON.stringify(stable({kind:'directory',resource:value.path}))),existing=[...state.grants,...temps(ownerId)].find(g=>g.signature===signature&&g.lifetime===choice&&g.taskId===(choice==='task'?taskId:undefined));if(existing)return;const grant={id:randomUUID(),kind:'directory',resource:value.path,label:'只读目录 · '+value.path,signature,lifetime:choice,taskId:choice==='task'?taskId:undefined,device:value.device,inode:value.inode,createdAt:new Date().toISOString()};if(choice==='always')state.grants.push(grant);else temporary.set(ownerId,[...temps(ownerId),grant]);log(state,'approve',{kind:'directory',label:grant.label,lifetime:choice});});return read(taskId,ownerId);
 }
 async function run(task,signal,fn){
  const owner=await ownerNow(),state=await load(owner),mode=task.permissionMode||state.defaultMode;if(!modes.includes(mode))throw fail('权限模式无效，未启动执行。','PERMISSION_CONFIG');
  const controller=new AbortController(),root=await workspaceFiles(base,task),canonical=await canonicalPath(root),workspaceKey=task.projectId?'project:'+task.projectId:task.scheduledTaskId?'schedule:'+task.scheduledTaskId:'task:'+task.id;
  const ctx={id:randomUUID(),owner,task,mode,root:canonical,workspaceKey,controller,signal:AbortSignal.any([signal,controller.signal]),used:new Set()};
  ctx.before=async()=>{await guard(owner);ctx.signal.throwIfAborted();};
  ctx.snapshot=async()=>({mode,workspace:canonical,commandNetworkAuthorized:(await applicable(ctx)).some(g=>g.kind==='network'&&g.resource===canonical),externalDirectories:(await applicable(ctx)).filter(g=>g.kind==='directory').map(g=>({path:g.resource,access:'read-only',lifetime:g.lifetime})),notice:'项目内可读写。项目命令默认禁止联网；需要时先 request_network。应用连接仍需启用，系统权限及平台限制不会被绕过。'});
  ctx.directoryAccess={request:(_taskId,action,s)=>directoryRequest(action,s),directories:()=>[]};
  ctx.commandOptions=async()=>{await ctx.before();const grants=await applicable(ctx),readDirectories=[];let networkOutbound=false;for(const g of grants){if(g.kind==='directory'&&await validDirectory(g)){readDirectories.push(g.resource);ctx.used.add(g.id);}if(g.kind==='network'&&g.resource===canonical){networkOutbound=true;ctx.used.add(g.id);}}return {readDirectories,networkOutbound};};
  ctx.requestNetwork=async(action,s)=>{if(typeof action.purpose!=='string'||!action.purpose.trim()||action.purpose.length>1000)throw fail('请说明项目命令联网用途。','PERMISSION_CONFIG');await approve({kind:'network',resource:canonical,label:'项目命令联网 · '+(task.title||task.id),purpose:action.purpose},s);return {access:'network-outbound',workspace:canonical,notice:'仅对当前项目或任务的命令生效；不扩大文件访问范围。'};};
  active.set(ctx.id,ctx);try{return await local.run(ctx,()=>fn(ctx));}finally{active.delete(ctx.id);}
 }
 return {read,settings,setMode,revoke,addDirectory,run,approve,current:()=>local.getStore(),cancelAll(){for(const ctx of active.values())ctx.controller.abort(fail('权限上下文已结束','PERMISSION_REVOKED'));}};
}
module.exports={createPermissions,within};

const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const defaults={enabled:true,native:true,completed:true,attention:true,output:true};
function hasOutput(task,run){
 if(!run)return false;
 if(run.resultPreview?.available&&run.resultPreview.changedSinceInput)return true;
 const changed=run.resultChanges?.changedArtifacts||run.delivery?.changes?.changedArtifacts;
 if(!Array.isArray(changed))return false;
 return require('./artifact-presentation.cjs').groupArtifacts(run.artifacts||run.delivery?.availableArtifacts||[],{request:run.goal||task.request,changedPaths:changed}).current.some(f=>f.path!==run.resultPreview?.path||run.resultPreview.changedSinceInput);
}
function notificationIntent(task,result={},stage='final'){
 if(!task?.id||task.temporary||task.archived)return;
 const run=result.agentRun,status=run?.status||(result.error?'failed':'completed');
 if(stage==='progress')return hasOutput(task,run)?{kind:'output',status,message:'已有新的阶段成果，尚未完成最终验收。',setting:'output'}:undefined;
 if(['paused','cancelled'].includes(status))return;
 if(result.clarification||['failed','blocked','waiting_permission','waiting_user'].includes(status))return {kind:'attention',status,message:'任务尚未完成，需要你处理后继续。',setting:'attention'};
 if(run?.delivery?.outcome==='limited')return {kind:'output',status,message:'结果已生成，仍有待确认项。',setting:'completed'};
 if(status==='partial'||run?.delivery?.outcome==='partial')return {kind:'ended',status,message:run.resultPreview?.available||require('./artifact-presentation.cjs').groupArtifacts(run.artifacts||[]).primary.length?'本轮已结束，已有结果可查看；任务尚未全部完成。':'本轮已结束，尚未形成可展示成果。',setting:'completed'};
 if(status==='completed'||status==='chat'||status==='idle'&&run?.currentIntent==='chat')return {kind:'completed',status,message:!run||run.currentIntent==='chat'?'回复已生成。':'任务已完成。',setting:'completed'};
 return {kind:'ended',status,message:'本轮已结束，任务尚未完成，可查看当前记录。',setting:'completed'};
}
function createTaskNotifications({directory,account,changed=()=>{},native=()=>{},notify=()=>{}}){
 let queue=Promise.resolve();
 async function safe(fn){try{await fn();}catch{/* Notification transport must not fail the task or lose its stored receipt. */}}
 async function run(fn){
  const owner=(await account())?.id||'local',file=path.join(directory,'notifications',createHash('sha256').update(owner).digest('hex')+'.json');
  const result=queue.catch(()=>{}).then(async()=>{
   let state;try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={settings:{...defaults},items:[]};}
   const out=await fn(state,owner);
   if(out?.write){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file+'.tmp',JSON.stringify(state),{mode:0o600});await fs.rename(file+'.tmp',file);await safe(()=>changed(owner));}
   if(out?.alert&&((await account())?.id||'local')===owner){await safe(()=>notify(out.alert,owner));if(out.system)await safe(()=>native(out.alert,owner));}
   return {settings:{...defaults,...state.settings},items:state.items};
  });queue=result;return result;
 }
 return {
  read:()=>run(()=>{}),
  update:input=>run(state=>{if(input.action==='settings'){for(const [key,v]of Object.entries(input.value||{}))if(Object.hasOwn(defaults,key)&&typeof v==='boolean')state.settings[key]=v;}else if(input.action==='read'){for(const item of state.items)if(!input.id||item.id===input.id)item.read=true;}else if(input.action==='clear'){if(input.id!==undefined&&(typeof input.id!=='string'||!input.id))throw Error('通知标识无效');state.items=input.id?state.items.filter(item=>item.id!==input.id):[];}else throw Error('通知操作无效');return {write:true};}),
  publish:(task,result,requestId,{stage='final',ownerId}={})=>{
   const intent=notificationIntent(task,result,stage);if(!intent)return Promise.resolve();
   return run((state,owner)=>{
    if(ownerId&&ownerId!==owner)return;
    const settings={...defaults,...state.settings};if(!settings.enabled||!settings[intent.setting])return;
    const inputId=result?.agentRun?.currentInputId||requestId;
    const token=task.id+':'+requestId+':'+(stage==='progress'?'output:'+inputId:'final');
    state.seen||=state.items.map(x=>x.token);if(state.seen.includes(token))return;
    const item={id:randomUUID(),token,taskId:task.id,title:String(task.title||'Ailo 任务').slice(0,160),kind:intent.kind,status:intent.status,message:intent.message,read:false,at:new Date().toISOString()};
    state.items.unshift(item);state.items=state.items.slice(0,150);state.seen.push(token);state.seen=state.seen.slice(-600);
    return {write:true,alert:item,system:settings.native};
   });
  }
 };
}
module.exports={createTaskNotifications,notificationIntent,hasOutput};

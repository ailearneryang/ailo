// Skill discovery supplies metadata, not authority or tool execution.
const {selectedExtensions}=require('../extensions.cjs');
const automatic=e=>e.kind==='skill'&&e.enabled!==false&&e.invocation!=='manual';
async function createSkillRuntime({workspace,available=[],manual=[],packages,signal}){
 const run=workspace.run,definitions=new Map([...available,...manual].map(e=>[e.id,e]));
 const fixed=manual.filter(e=>e.enabled!==false),fixedIds=new Set(fixed.map(e=>e.id));
 const prior=run.skillSelection?.executionId===run.executionId?run.skillSelection:undefined;
 let active=[],inputId=run.inputKey,failed=new Set(prior?.inputId===inputId?prior.failedIds||[]:[]),sources=new Map(fixed.map(e=>[e.id,{source:'manual',reason:'用户明确选用'}]));
 if(!failed.size)delete run.extensionPreparationFailure;
 function candidates(){return [...definitions.values()].filter(automatic);}
 function publish(){
  run.loadedExtensions=active.map(e=>({id:e.id,name:e.name,kind:e.kind,...sources.get(e.id)}));
  run.skillSelection={executionId:run.executionId,inputId:run.inputKey,autoIds:active.filter(e=>!fixedIds.has(e.id)).map(e=>e.id),failedIds:[...failed],selections:run.loadedExtensions};
  if(active.length)run.progressInputId=run.inputKey;
 }
 async function prepare(items,retain){
  signal?.throwIfAborted();
  try{const prepared=packages?await packages.prepare(workspace,items,{retainExisting:retain}):items;for(const item of prepared)failed.delete(item.id);if(!failed.size)delete run.extensionPreparationFailure;return prepared;}
  catch(error){
   if(error.code==='ERR_ASSERTION'||signal?.aborted)throw error;
   // A damaged optional skill does not suppress already loaded skills.
   const prepared=[],errors=[];
   for(const item of items){
    try{prepared.push(...(packages?await packages.prepare(workspace,[item],{retainExisting:true}):[item]));failed.delete(item.id);}
    catch(error){if(error.code==='ERR_ASSERTION'||signal?.aborted)throw error;failed.add(item.id);errors.push({id:item.id,name:item.name,message:String(error.message||error).slice(0,300)});}
   }
   if(!items.length||errors.length){run.extensionPreparationFailure={names:errors.map(e=>e.name),message:errors.map(e=>e.message).join('；')||String(error.message||error).slice(0,300)};await workspace.event('extension_prepare_failed',{...run.extensionPreparationFailure,message:'部分技能未能加载，不能宣称已使用其指令或资源'});}
   return prepared;
  }
 }
 const restored=(prior?.autoIds||[]).map(id=>definitions.get(id)).filter(e=>e&&automatic(e)&&!fixedIds.has(e.id));
 for(const e of restored)sources.set(e.id,{source:'auto',reason:prior.selections?.find(s=>s.id===e.id)?.reason||'继续当前任务'});
 // Current manual choice takes priority over previously selected automatic skills.
 const initial=[...fixed];for(const item of restored){try{selectedExtensions([...definitions.values()],initial.concat(item).map(e=>e.id));initial.push(item);}catch{}}
 // At the run boundary the complete active selection is known. Clean up
 // deselected packages; selected packages keep their installed dependencies.
 // Incremental loads below retain mounts because they prepare only new items.
 active=await prepare(initial,false);publish();
 function catalog(){return candidates().filter(e=>!active.some(a=>a.id===e.id)&&!failed.has(e.id)).map(({id,name,description})=>({id,name,description}));}
 async function select(ids,{replace=false,reason='根据本次任务选用'}={}){
  if(!Array.isArray(ids)||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw Error('自动技能选择需要最多5个不重复的技能ID');
  const chosen=ids.map(id=>{const item=definitions.get(id);if(!item||!automatic(item)||failed.has(id))throw Error('该技能不可自动加载，请从当前技能目录选择：'+id);return item;});
  const current=replace?active.filter(e=>fixedIds.has(e.id)):active;
  const requested=[...new Map([...current.map(e=>definitions.get(e.id)),...chosen].map(e=>[e.id,e])).values()];
  selectedExtensions([...definitions.values()],requested.map(e=>e.id));
  const added=requested.filter(e=>!active.some(a=>a.id===e.id));
  const prepared=await prepare(added,true);
  const kept=active.filter(e=>requested.some(r=>r.id===e.id));
  active=[...kept,...prepared];for(const item of prepared)if(!fixedIds.has(item.id))sources.set(item.id,{source:'auto',reason:String(reason).trim().slice(0,200)});
  publish();
  for(const item of prepared)await workspace.event('skill_loaded',{id:item.id,name:item.name,purpose:sources.get(item.id)?.reason,message:'自动加载技能 · '+item.name});
  await workspace.save();
  return {loaded:prepared.map(e=>({id:e.id,name:e.name})),active:run.loadedExtensions,failedIds:added.filter(e=>!prepared.some(p=>p.id===e.id)).map(e=>e.id)};
 }
 async function newInput({newExecution=false}={}){
  if(newExecution||inputId!==run.inputKey){failed=new Set();delete run.extensionPreparationFailure;inputId=run.inputKey;}
  if(newExecution){failed=new Set();active=await prepare(fixed,false);sources=new Map(fixed.map(e=>[e.id,{source:'manual',reason:'用户明确选用'}]));}
  publish();
 }
 return {catalog,select,newInput,items:()=>active,loaded:()=>run.loadedExtensions};
}
module.exports={createSkillRuntime,automatic};

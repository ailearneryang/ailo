// Technical proof selection is separate from the user's requirement and scope.
// Binding only selects a recorded receipt; verification still checks success,
// freshness, coverage and the original requirement before granting any pass.
const kinds=['command','visual','observation','operation'];
const schema={type:'object',additionalProperties:false,required:['kind','evidenceId'],properties:{kind:{type:'string',enum:kinds},evidenceId:{type:'string',minLength:1,maxLength:100},operation:require('./native-operation.cjs').schema}};
const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]))):value;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function invalid(message){return Object.assign(Error('证据绑定无效：'+message),{code:'EVIDENCE_BINDING_INVALID'});}
function update(run,binding,requirement){
 if(!binding||typeof binding!=='object'||Array.isArray(binding)||Object.keys(binding).some(k=>!['kind','evidenceId','operation'].includes(k))||!kinds.includes(binding.kind)||typeof binding.evidenceId!=='string'||!binding.evidenceId||binding.evidenceId.length>100)throw invalid('须提供 kind 与当前任务已记录的完整 evidenceId');
 if(binding.kind==='operation'){
  const native=require('./native-operation.cjs'),operation=native.prepare(run,binding.operation,requirement),expected=native.expectedId(operation);
  const receipt=run.observationIndex?.find(r=>r.id===binding.evidenceId||r.eventId===binding.evidenceId),id=operation.phase==='effect'?binding.evidenceId:receipt?.id;
  if(id!==expected)throw invalid('operation evidenceId须与绑定phase对应的完整读取回执/原actionId一致');
  return {kind:'operation',evidenceId:expected,operation};
 }
 if(binding.operation!==undefined)throw invalid('operation只适用于明确的native文件过程');
 if(requirement.type==='visual'&&binding.kind!=='visual'||requirement.type==='behavior'&&!['command','observation'].includes(binding.kind))throw invalid('不能改变原要求的验证类型');
 // Exact identity only. Do not infer an event from a prefix, array position,
 // description, path, or a semantically similar requirement.
 const receipt=run.observationIndex?.find(r=>r.id===binding.evidenceId);
 const id=receipt?.eventId||binding.evidenceId,event=run.events?.find(e=>e.id===id);
 if(!event)throw invalid('未找到当前任务的完整事件 ID；先回查真实记录，不猜测或制造映射');
 const result=event.detail?.result;
 if(binding.kind==='command'&&(!['run_command','build_android'].includes(event.type)||result?.exitCode!==0||result.timedOut))throw invalid('command 必须关联已成功结束的命令或标准构建');
 if(binding.kind==='visual'&&(!['browser','view_image'].includes(event.type)||!run.visualObservations?.some(o=>o.eventId===id&&o.delivered)))throw invalid('visual 必须关联已经传给模型的图像观察');
 if(binding.kind==='observation'){
  if(!['browser','android_device'].includes(event.type))throw invalid('observation 必须关联实际浏览器或设备操作');
  if(event.type==='browser'&&(!result?.dom||result.errors?.length||result.dom.missingImages?.length))throw invalid('浏览器操作尚无成功的运行观察');
  if(event.type==='android_device'){
   const operation=event.detail.operation,ok=operation==='install'?result?.installed===true:operation==='launch'?/\bStatus:\s*ok\b/.test(result?.output||''):operation==='logs'?result?.running===true&&!/FATAL EXCEPTION/.test(result?.output||''):operation==='screenshot'?!!result?.pixelSize&&result.displayCheck?.matches===true:false;
   if(!ok||!result?.apkSha256||!result.sources?.some(s=>s.path===result.apkPath&&s.sha256===result.apkSha256))throw invalid('设备操作尚无成功且绑定 APK 版本的运行观察');
  }
 }
 return {kind:binding.kind,evidenceId:id};
}
function select(check,criterion){
 const binding=criterion?.evidenceBinding;
 if(check&&check.evidenceId===undefined&&binding&&check.kind===binding.kind)return {...check,evidenceId:binding.evidenceId};
 return check;
}
module.exports={schema,update,select,equal};

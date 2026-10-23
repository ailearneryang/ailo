const {createHash}=require('node:crypto'),fs=require('node:fs/promises');
const {resolveFile}=require('./workspace.cjs'),proof=require('./evidence.cjs'),journal=require('./action-journal.cjs');
// Each authorized child is journalled separately. The orchestrator itself has
// no side effects and may resume; an unknown installation/launch may not replay.
async function execute(workspace,action,signal,options){
 if(typeof action.path!=='string'||!action.path.endsWith('.apk')||action.path.split('/').includes('.runtime'))throw Error('check 需要当前项目 APK 路径');
 const apk=await resolveFile(workspace.files,action.path),stat=await fs.stat(apk);
 if(!stat.isFile()||stat.size<=0||stat.size>150*1024*1024)throw Error('check 需要非空且不超过150MB的普通 APK 文件');
 const apkSha256=await proof.hashFile(apk);
 if(action.display)require('./android-display.cjs').validate(action.display);
 const key=createHash('sha256').update(JSON.stringify([action.path,apkSha256,action.display])).digest('hex');
 const run=workspace.run;
 if(run.actionJournal?.some(e=>e.action==='android_device'&&!e.readOnly&&['running','unknown'].includes(e.status)))throw Object.assign(Error('设备仍有结果未知或进行中的操作，请先核对原操作，不能复用检查或重放安装、启动。'),{code:'ACTION_RESULT_UNKNOWN'});
 if(run.androidCheck?.pending){
  const entry=run.actionJournal?.find(e=>e.id===run.androidCheck.pending);
  if(!entry||['running','unknown'].includes(entry.status)||entry.status==='succeeded'&&!entry.readOnly)throw Object.assign(Error('设备检查操作结果尚未完整归档，请先核对原操作，禁止重复安装或启动。'),{code:'ACTION_RESULT_UNKNOWN'});
  delete run.androidCheck.pending;
 }
 if(run.androidCheck?.key!==key){
  run.androidCheck={key,apkSha256,steps:[]};
 }
 let state=run.androidCheck;
 const device=await options.android.execute(workspace.files,{action:'android_device',operation:'status'},signal,options.onStatus);
 if(device.busy)throw Error('当前项目设备正在执行其他操作，请等待完成后重新检查');
 if(state.sessionId&&(!device.running||device.sessionId!==state.sessionId||state.steps.some(s=>s.operation==='install')&&device.apkSha256!==apkSha256))state=run.androidCheck={key,apkSha256,steps:[]};
 // Installation and launch are durable effects; logs and screenshots describe
 // mutable runtime state. A completed check must refresh its read-only suffix.
 if(state.steps.some(s=>s.operation==='screenshot'))state.steps=state.steps.filter(s=>!['logs','screenshot'].includes(s.operation));
 for(const operation of ['start','install','launch','logs','screenshot']){
  signal.throwIfAborted();
  if(state.steps.some(s=>s.operation===operation))continue;
  if(await proof.hashFile(await resolveFile(workspace.files,action.path))!==apkSha256)throw Error('设备检查期间 APK 已改变，请检查构建与安装版本');
  const child={action:'android_device',operation,...(operation==='install'?{path:action.path}:{}),...(operation==='start'&&action.display?{display:action.display}:{})};
  if(options.permissions)await options.permissions.before(child,signal);
  options.onStatus?.('运行核对 · '+({start:'准备模拟器',install:'安装指定 APK',launch:'启动应用',logs:'检查运行日志',screenshot:'获取运行截图'})[operation]);
  const entry=journal.begin(run,child);state.pending=entry.id;await workspace.save();
  const result=await journal.executeWithRecovery(workspace,entry,child,signal,()=>options.android.execute(workspace.files,child,signal,options.onStatus));
  await workspace.event('android_device',{actionId:entry.id,operation,revision:run.revision,result});
  const eventId=run.events.at(-1).id;
  if(operation!=='start'&&result.apkSha256!==apkSha256)throw Error('设备上的 APK 版本不匹配，停止检查，不采纳其他任务的运行证据');
  if(operation!=='start')await proof.event(workspace,eventId);
  if(operation==='start'){if(!result.running||typeof result.sessionId!=='string'||!result.sessionId)throw Error('未取得有效模拟器会话，不能复用设备检查');state.sessionId=result.sessionId;}
  state.steps.push({operation,eventId,result});delete state.pending;
  require('./decision-recovery.cjs').progress(run,child,result);await workspace.save();
 }
 const shot=state.steps.find(s=>s.operation==='screenshot').result;
 await proof.assertFresh(workspace,shot);
 return {...shot,checks:state.steps.map(({operation,eventId})=>({operation,eventId})),notice:'安装、启动、日志和截图已分别记录；不证明页面交互或视觉还原。请 view_image 对照 reference，使用 checks 中的真实事件验收。'};
}
module.exports={execute};

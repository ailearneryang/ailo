const fs=require('node:fs/promises');
const {resolveFile}=require('./workspace.cjs'),proof=require('./evidence.cjs');
const assisted=run=>run.runtimeContinuation?.kind==='assisted_resume'&&run.runtimeContinuation.deviceState==='new_environment';
const assistedError=()=>Object.assign(Error('受辅助续跑使用新的设备环境。旧截图仍可回查，但运行验收须绑定本次 evaluation_resume 之后同一新会话的 start、install 当前 APK、launch 和 screenshot 真实成功记录；尚未运行时不能声明已启动。'),{code:'ANDROID_ASSISTED_RUNTIME_REQUIRED'});
function after(run,event,boundary){
 if(!event||!boundary||event.id===boundary.id)return false;
 const events=run.events||[],position=events.findIndex(e=>e.id===event.id),start=events.findIndex(e=>e.id===boundary.id);
 if(position>=0&&start>=0)return position>start;
 const time=Date.parse(event.at),from=Date.parse(boundary.at);
 // Equal timestamps without an ordered in-memory pair are ambiguous. Do not
 // promote a historical receipt to proof of a new device environment.
 return Number.isFinite(time)&&Number.isFinite(from)&&time>from;
}
async function assertAssistedDeviceEvidence(workspace,event){
 const run=workspace.run;if(!assisted(run))return;
 const boundary=await workspace.findEvent(e=>e.type==='evaluation_resume'&&e.detail?.kind==='assisted_resume');
 const result=event?.detail?.result,operation=event?.detail?.operation,session=result?.sessionId;
 if(event?.type!=='android_device'||!boundary||!after(run,event,boundary)||typeof session!=='string'||!session||session.length>200)throw assistedError();
 const find=(operation,predicate=()=>true)=>workspace.findEvent(e=>e.type==='android_device'&&e.detail?.operation===operation&&e.detail.result?.sessionId===session&&after(run,e,boundary)&&after(run,event,e)&&predicate(e.detail.result));
 const start=operation==='start'&&result.running===true?event:await find('start',r=>r.running===true);
 if(!start||operation!=='start'&&!after(run,event,start))throw assistedError();
 // An explicit new-environment continuation cannot reuse its source session.
 if(await workspace.findEvent(e=>e.type==='android_device'&&e.detail?.result?.sessionId===session&&!after(run,e,boundary)))throw assistedError();
 if(operation==='start')return;
 const sameApk=r=>typeof result.apkPath==='string'&&r.apkPath===result.apkPath&&r.apkSha256===result.apkSha256&&typeof r.apkSha256==='string';
 const install=operation==='install'?event:await find('install',r=>r.installed===true&&sameApk(r));
 if(!install||install.detail.result.installed!==true||!sameApk(install.detail.result)||!install.detail.result.sources?.some(s=>s.path===result.apkPath&&s.sha256===result.apkSha256)||!after(run,install,start)||operation!=='install'&&!after(run,event,install))throw assistedError();
 if(operation==='install')return;
 const launch=operation==='launch'?event:await find('launch',r=>sameApk(r)&&/\bStatus:\s*ok\b/.test(r.output||''));
 if(!launch||!sameApk(launch.detail.result)||!/\bStatus:\s*ok\b/.test(launch.detail.result.output||'')||!after(run,launch,install)||operation!=='launch'&&!after(run,event,launch))throw assistedError();
}
async function assertAssistedImageEvidence(workspace,event){
 if(!assisted(workspace.run))return;
 const path=event?.detail?.result?.path;if(typeof path!=='string')return;
 const source=await workspace.findEvent(e=>e.type==='android_device'&&e.detail?.operation==='screenshot'&&e.detail.result?.path===path&&e.detail.result?.apkSha256);
 if(!source)return; // Ordinary reference images and browser evidence retain their contract.
 const boundary=await workspace.findEvent(e=>e.type==='evaluation_resume'&&e.detail?.kind==='assisted_resume');
 if(!after(workspace.run,event,boundary))throw assistedError();
 await assertAssistedDeviceEvidence(workspace,source);
}
async function assertAndroidDelivery(workspace){
 const run=workspace.run,apks=run.artifacts.filter(a=>/\.apk$/i.test(a.path));
 if(!apks.length)return;
 const criteria=require('./requirements.cjs').current(run);
 const requiresRuntime=criteria.some(c=>c.type==='visual'||/模拟器|安装运行|运行截图|启动验证|emulator|screenshot/i.test(c.text));
 if(!requiresRuntime)return; // Building an APK alone does not authorize a device.
 for(const apk of apks){
  const screenshot=await workspace.findEvent(e=>e.type==='android_device'&&e.detail.result?.apkSha256===apk.sha256&&e.detail.result?.pixelSize);
  if(!screenshot)throw Object.assign(Error('此 APK 尚无匹配版本的模拟器运行截图；请安装当前 APK、启动并截图，不能用构建成功替代运行或设计验收。'),{code:'ANDROID_RUNTIME_REQUIRED'});
  await assertAssistedDeviceEvidence(workspace,screenshot);
  const result=screenshot.detail.result;
  if(assisted(run)&&criteria.some(c=>/(?:无|没有|未发生|不(?:应|得|会|发生)?)[^。；;\n]{0,12}崩溃|\bno\s+(?:known\s+)?crash(?:es)?\b|\bcrash[- ]free\b/i.test(c.text))){
   const logs=await workspace.findEvent(e=>e.type==='android_device'&&e.detail.operation==='logs'&&e.detail.result?.sessionId===result.sessionId&&e.detail.result.apkPath===apk.path&&e.detail.result.apkSha256===apk.sha256);
   if(!logs||logs.detail.result.running!==true||/FATAL EXCEPTION/.test(logs.detail.result.output||''))throw Object.assign(Error('原验收要求包含无崩溃检查。本次新设备会话尚无当前 APK 的有效 logs 运行记录，或日志仍包含崩溃；请重新检查日志并修复已知问题。'),{code:'ANDROID_ASSISTED_LOGS_REQUIRED'});
   await assertAssistedDeviceEvidence(workspace,logs);
  }
  if(!result.sources?.some(s=>s.path===apk.path&&s.sha256===apk.sha256)||!result.sources.some(s=>s.path===result.path)||!Number.isSafeInteger(result.displayCheck?.actual?.density))throw Object.assign(Error('运行截图缺少当前 APK、图像或实际密度凭据，请重新安装并截图。'),{code:'ANDROID_RUNTIME_REQUIRED'});
  await proof.assertFresh(workspace,{sources:result.sources,revision:screenshot.detail.revision});
  const latestStart=await workspace.findEvent(e=>e.type==='android_device'&&e.detail.operation==='start'&&e.detail.result?.display);
  const target=await require('./android-display.cjs').resolve(workspace.files,undefined,latestStart?.detail.result.display||result.display);
  const size=require('./android-display.cjs').pngSize(await fs.readFile(await resolveFile(workspace.files,result.path)));
  if(!require('./android-display.cjs').check(target,{...size,density:result.displayCheck?.actual?.density}).matches)throw Object.assign(Error(`模拟器截图为 ${size.width}×${size.height}、${result.displayCheck.actual.density}dpi，目标为 ${target.width}×${target.height}、${target.density}dpi。先修正设备规格或应用方向锁定并重新截图，不能声明设计还原通过。`),{code:'ANDROID_DISPLAY_MISMATCH'});
 }
}
module.exports={assertAndroidDelivery,assertAssistedDeviceEvidence,assertAssistedImageEvidence};

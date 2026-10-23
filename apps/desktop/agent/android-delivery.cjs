const fs=require('node:fs/promises');
const {resolveFile}=require('./workspace.cjs'),proof=require('./evidence.cjs');
async function assertAndroidDelivery(workspace){
 const run=workspace.run,apks=run.artifacts.filter(a=>/\.apk$/i.test(a.path));
 if(!apks.length)return;
 const criteria=require('./requirements.cjs').current(run);
 const requiresRuntime=criteria.some(c=>c.type==='visual'||/模拟器|安装运行|运行截图|启动验证|emulator|screenshot/i.test(c.text));
 if(!requiresRuntime)return; // Building an APK alone does not authorize a device.
 for(const apk of apks){
  const screenshot=await workspace.findEvent(e=>e.type==='android_device'&&e.detail.result?.apkSha256===apk.sha256&&e.detail.result?.pixelSize);
  if(!screenshot)throw Object.assign(Error('此 APK 尚无匹配版本的模拟器运行截图；请安装当前 APK、启动并截图，不能用构建成功替代运行或设计验收。'),{code:'ANDROID_RUNTIME_REQUIRED'});
  const result=screenshot.detail.result;
  if(!result.sources?.some(s=>s.path===apk.path&&s.sha256===apk.sha256)||!result.sources.some(s=>s.path===result.path)||!Number.isSafeInteger(result.displayCheck?.actual?.density))throw Object.assign(Error('运行截图缺少当前 APK、图像或实际密度凭据，请重新安装并截图。'),{code:'ANDROID_RUNTIME_REQUIRED'});
  await proof.assertFresh(workspace,{sources:result.sources,revision:screenshot.detail.revision});
  const latestStart=await workspace.findEvent(e=>e.type==='android_device'&&e.detail.operation==='start'&&e.detail.result?.display);
  const target=await require('./android-display.cjs').resolve(workspace.files,undefined,latestStart?.detail.result.display||result.display);
  const size=require('./android-display.cjs').pngSize(await fs.readFile(await resolveFile(workspace.files,result.path)));
  if(!require('./android-display.cjs').check(target,{...size,density:result.displayCheck?.actual?.density}).matches)throw Object.assign(Error(`模拟器截图为 ${size.width}×${size.height}、${result.displayCheck.actual.density}dpi，目标为 ${target.width}×${target.height}、${target.density}dpi。先修正设备规格或应用方向锁定并重新截图，不能声明设计还原通过。`),{code:'ANDROID_DISPLAY_MISMATCH'});
 }
}
module.exports={assertAndroidDelivery};

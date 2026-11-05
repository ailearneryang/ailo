// Preview receipts describe observed output, independently of acceptance.
// A screenshot is useful even when the task stops; it is never a visual pass.
const fs=require('node:fs/promises');
const {resolveFile}=require('./workspace.cjs'),proof=require('./evidence.cjs');
function capture(event){
 const r=event?.detail?.result;
 if(!r||r.notExecuted||r.timedOut||r.exitCode!==undefined&&r.exitCode!==0)return;
 const android=event.type==='android_device'&&['screenshot','check'].includes(event.detail.operation);
 const browser=event.type==='browser'&&r.screenshot;
 if(!android&&!browser)return;
 const path=browser?r.screenshot:r.path;
 const sourceHash=r.sources?.find(s=>s.path===path)?.sha256,sha256=r.sha256||sourceHash;
 if(r.sha256&&sourceHash&&r.sha256!==sourceHash)return;
 if(typeof path!=='string'||!path.endsWith('.png')||!r.pixelSize||!Number.isFinite(r.pixelSize.width)||r.pixelSize.width<=0||!Number.isFinite(r.pixelSize.height)||r.pixelSize.height<=0||!/^[a-f0-9]{64}$/.test(sha256||''))return;
 if(android&&(!r.apkPath||!/^[a-f0-9]{64}$/.test(r.apkSha256||'')||!r.sources?.some(s=>s.path===r.apkPath&&s.sha256===r.apkSha256)))return;
 return {path,sha256,kind:android?'android':'browser',...(android?{apk:{path:r.apkPath,sha256:r.apkSha256}}:{document:r.path}),pixelSize:r.pixelSize};
}
async function register(workspace,event,{current=false}={}){
 const value=capture(event);if(!value)return false;
 const run=workspace.run;
 try{
  const file=await resolveFile(workspace.files,value.path),stat=await fs.stat(file);
  if(!stat.isFile()||!stat.size||stat.size>20*1024*1024||await proof.hashFile(file)!==value.sha256)return false;
  const header=Buffer.alloc(24),handle=await fs.open(file,'r');try{await handle.read(header,0,24,0);}finally{await handle.close();}
  const size=require('./android-display.cjs').pngSize(header);if(size.width!==value.pixelSize.width||size.height!==value.pixelSize.height)return false;
  const oldIds=new Set(run.inputTurn?.eventIds||[]),thisInput=current||!!run.inputTurn?.startedAt&&event.at>=run.inputTurn.startedAt&&!oldIds.has(event.id);
  if(!thisInput&&run.inputTurn&&run.inputTurn.previewSha256===undefined)run.inputTurn.previewSha256=value.sha256;
  const previous=run.resultPreview;
  if(previous?.eventId===event.id&&previous.sha256===value.sha256)return true;
  const artifact={path:value.path,label:'运行效果截图（待核验）',sha256:value.sha256,size:stat.size,origin:'runtime_preview',previewEventId:event.id,quality:'unverified'};
  run.artifacts=(run.artifacts||[]).filter(a=>a.path!==value.path).concat(artifact);
  if(!thisInput&&run.inputTurn){run.inputTurn.artifacts||={};run.inputTurn.artifacts[value.path]??=value.sha256;}
  run.resultPreview={...value,size:stat.size,eventId:event.id,capturedAt:event.at,revision:event.detail.revision,inputId:thisInput?run.inputKey:undefined,available:true,sourceStatus:'unknown',sources:event.detail.result.sources||[]};
  return true;
 }catch(error){if(error.code==='ERR_ASSERTION')throw error;return false;}
}
async function refresh(workspace,{hydrate=false}={}){
 const run=workspace.run;
 if(hydrate||!run.resultPreview){
  // Use archived receipts for old tasks too. No tool, device or model is replayed.
  const recent=(run.events||[]).filter(capture).reverse();
  for(const event of recent)if(await register(workspace,event))break;
  if(!run.resultPreview&&hydrate&&typeof workspace.observationRecord==='function'){const records=await require('./result-sources.cjs').records(workspace,new Set(['android_device','browser']));for(const record of records.reverse()){const e={id:record.response?.eventId||record.id,at:record.at,type:record.action.action,detail:{...record.action,result:record.response?.result}};if(await register(workspace,e))break;}}
 }
 const p=run.resultPreview;if(!p)return;
 try{
  if(await proof.hashFile(await resolveFile(workspace.files,p.path))!==p.sha256)throw Error('预览图片与运行回执不一致');
  p.available=true;
 }catch{p.available=false;p.sourceStatus='unavailable';return;}
 if(p.checkedRevision!==run.revision){
  try{
   await proof.assertFresh(workspace,{sources:p.sources,revision:p.revision});
   if(p.apk){const matches=e=>e.type==='build_android'&&e.detail.result?.exitCode===0&&e.detail.result.buildArtifacts?.some(a=>a.path===p.apk.path&&a.sha256===p.apk.sha256);const build=run.events.findLast(matches)||await workspace.findEvent?.(matches);if(build){await proof.assertFresh(workspace,{...build.detail.result,revision:build.detail.revision});p.sourceStatus='current';}else p.sourceStatus='unknown';}
   else p.sourceStatus='current';
  }catch{p.sourceStatus='changed';}
  p.checkedRevision=run.revision;
 }
 if(p.apk){try{p.apkAvailable=await proof.hashFile(await resolveFile(workspace.files,p.apk.path))===p.apk.sha256;}catch{p.apkAvailable=false;}}
 p.capturedThisInput=p.inputId===run.inputKey;
 p.changedSinceInput=p.capturedThisInput&&p.sha256!==run.inputTurn?.previewSha256;
 return p;
}
function publicPreview(run){const p=run.resultPreview;if(!p)return;const {sources,checkedRevision,...value}=p;return value;}
module.exports={capture,register,refresh,publicPreview};
// Old stopped tasks can expose their recorded screenshots on read without
// modifying their files, timestamps, acceptance ledger or recovery budgets.
const projections=new Map();
async function projectLegacy(files,run){
 if(!run||run.resultPreview)return;
 const key=files+'\0'+run.taskId,signature=JSON.stringify([run.updatedAt,run.revision,run.inputKey,run.events?.at(-1)?.id]);
 let cached=projections.get(key);
 if(!cached||cached.signature!==signature||Date.now()-cached.at>5000){
  const copy=structuredClone(run);await refresh({files,run:copy},{hydrate:true});
  cached={signature,at:Date.now(),preview:copy.resultPreview,artifact:copy.artifacts?.find(a=>a.path===copy.resultPreview?.path)};projections.set(key,cached);
  if(projections.size>32)projections.delete(projections.keys().next().value);
 }
 if(cached.preview){run.resultPreview=structuredClone(cached.preview);if(cached.artifact)run.artifacts=(run.artifacts||[]).filter(a=>a.path!==cached.artifact.path).concat(structuredClone(cached.artifact));}
}
module.exports.projectLegacy=projectLegacy;

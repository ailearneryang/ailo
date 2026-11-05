const proof=require('./evidence.cjs');
function screenshotObservation(event){
 const r=event?.detail?.result,source=r?.sources?.find(s=>s.path===r.path);
 if(event?.type!=='android_device'||event.detail.operation!=='screenshot'||!source?.sha256||!r.apkSha256||r.displayCheck?.matches!==true)return;
 return {eventId:event.id,path:r.path,sha256:source.sha256,sources:r.sources,revision:event.detail.revision,scope:r.scope,pixelSize:r.pixelSize,displayCheck:r.displayCheck,sessionId:r.sessionId,apkSha256:r.apkSha256,automaticScreenshot:true,previewOnly:true,delivered:false};
}
function enqueue(run,event){
 const observation=screenshotObservation(event);if(!observation)return false;
 run.visualObservations ||= [];
 if(run.visualObservations.some(o=>o.eventId===observation.eventId))return false;
 run.visualObservations.push(observation);run.visualObservations=run.visualObservations.slice(-64);return true;
}
async function enqueueOperation(workspace,action,result,event){
 let source=event;
 if(action.operation==='check'){
  const id=result?.checks?.find(item=>item.operation==='screenshot')?.eventId;
  if(!id)return false;
  source=await proof.lookup(workspace,id);
  if(source?.detail?.result?.path!==result.path||source.detail.result.apkSha256!==result.apkSha256)return false;
 }
 if(!['check','screenshot'].includes(action.operation))return false;
 return enqueue(workspace.run,source);
}
// Read-only pairing is allowed only for one unambiguous, source-bound board.
// A separate view_image receipt preserves the original device event and cannot
// pretend a device operation or an acceptance check has happened.
async function pairScreenshot(workspace,event,images){
 if(!images||!screenshotObservation(event)||require('./recovery-control.cjs').unknown(workspace.run))return false;
 const run=workspace.run,shot=event.detail.result;
 if(run.visualObservations?.some(o=>o.path===shot.path&&o.reference&&o.sources?.some(s=>s.path===shot.apkPath&&s.sha256===shot.apkSha256)))return false;
 try{
 const design=await require('./android-design.cjs').inspect(workspace.files);
 if(design.status!=='bound')return false;
 const reference=shot.display?.reference||shot.reference?.path||shot.reference;
 const screens=(design.screens||[]).filter(s=>reference?s.reference===reference:true);
 if(screens.length!==1||!screens[0].reference)return false;
  const action={action:'view_image',path:shot.path,reference:screens[0].reference};
  const result=await require('./visual-observation.cjs').imageObservation(workspace,action,images);
  if(!result.designBinding||result.designBinding.apkSha256!==shot.apkSha256||result.previewOnly)return false;
  delete result.image;
  await workspace.event('view_image',{origin:'runtime_pairing',screenshotEventId:event.id,path:shot.path,purpose:'按唯一已绑定画板将原稿与当前运行图成对送审',revision:run.revision,result});
  const paired={...result,eventId:run.events.at(-1).id,transform:{},delivered:false,automaticPair:true};
  run.visualObservations.push(paired);run.visualObservations=run.visualObservations.slice(-64);
  require('./android-design.cjs').recordComparison(workspace,paired);
  // Deliver the stronger pair rather than separately analysing the same preview.
  const preview=run.visualObservations.find(o=>o.eventId===event.id);if(preview)preview.supersededBy=paired.eventId;
  return true;
 }catch(error){
  const preview=run.visualObservations?.find(o=>o.eventId===event.id);if(preview)preview.pairingError=String(error.message).slice(0,500);
  if(error instanceof TypeError||error instanceof ReferenceError)throw error;
  return false;
 }
}
async function replay(workspace,{userContinuationEvent,allowAssisted=true}={}){
 const run=workspace.run;
 const userBoundary=userContinuationEvent&&run.events?.find(e=>e.id===userContinuationEvent.id&&e.type==='user_continuation'&&e.detail?.origin==='user'&&e.detail.executionId===run.executionId&&['blocked','paused','failed'].includes(e.detail.previousStatus));
 if(!userBoundary&&(!allowAssisted||run.runtimeContinuation?.kind!=='assisted_resume'))return false;
 const boundary=userBoundary||await workspace.findEvent(e=>e.type==='evaluation_resume');
 if(!boundary||run.visualReplayBoundary===boundary.id)return false;
 run.visualReplayBoundary=boundary.id;
 for(const observation of [...(run.visualObservations||[])].reverse()){
  // A standalone reference image cannot substitute for current APK pixels.
  // Explicit desktop continuation reuses one existing receipt, never records
  // another observation of the same event or claims a newly operated device.
  if(userBoundary&&!observation.sources?.some(s=>/\.apk$/i.test(s.path)))continue;
  try{await proof.assertFresh(workspace,observation);await proof.assertFresh(workspace,{sources:[{path:observation.path,sha256:observation.sha256}]});}
  catch{continue;}
  observation.delivered=false;observation.historicalReplay=true;observation.replayKind=userBoundary?'user_continuation':'assisted_resume';return true;
 }
 if(userBoundary)return false;
 const event=await workspace.findEvent(e=>!!screenshotObservation(e));
 if(!event)return false;
 try{await proof.assertFresh(workspace,event.detail.result);}catch{return false;}
 if(!enqueue(run,event))return false;
 run.visualObservations.at(-1).historicalReplay=true;run.visualObservations.at(-1).replayKind='assisted_resume';return true;
}
function context(run,design,navigation){
 const image=run.visualObservations?.at(-1);if(!image)return;
 const paired=[...(navigation?.visual?.paired||[]),...(navigation?.visual?.awaitingDelivery||[]).filter(p=>p.reference)].slice(0,8).map(({eventId,path,sha256,reference,apkSha256,delivered,fresh,grossMismatch})=>({eventId,path,sha256,reference,apkSha256,delivered,fresh,grossMismatch,status:delivered?'paired_delivered':'awaiting_delivery',allowedKinds:delivered&&fresh?['visual']:[]}));
 const same=paired.find(p=>p.path===image.path&&p.sha256===image.sha256),ready=same?.delivered&&same.fresh;
 return {path:image.path,eventId:image.eventId,previewOnly:!!image.previewOnly,historical:!!image.historicalReplay,
  status:ready?'paired_delivered':same?'awaiting_delivery':image.previewOnly?'preview':'reference_or_image',pairedCandidates:paired,
  referenceCandidates:(design?.screens||[]).slice(0,12).map(s=>({boardId:s.boardId,layout:s.layout,reference:s.reference})),
  instruction:ready?`同图同版本已有送达的成对观察 ${same.eventId}，无需再次 view_image；依据实际图片与节点检查，真实差异先修实现，证据充分时用 kind=visual 和此完整 evidenceId 提交 regions。成对候选不代表验收通过；view_image 不能作 kind=observation 的行为证据。`:same?'本请求将提供原稿与当前结果，状态 awaiting_delivery；请依据真实图片检查或修复，图片实际送达后才能作为视觉证据。不能视为通过或新增执行进展。':image.previewOnly?'当前截图仅作预览，不能用于设计验收；先检查 verificationEvidence.visual.paired 是否已有同图已送达成对候选，只有确实缺少时才 view_image(path=本图,reference=正确画板)。view_image 不能作为行为证据。':'图像事实仍须按原稿核对；已有送达的成对观察直接复用，不重复读图。真实差异先定点修复实现，再重建、安装并成对观察。历史图片不能证明新会话已运行，图像也不能代替行为验证。'};
}
const legacyPairMessage='自动截图预览不能替代原稿成对核验；请先 view_image(path=当前截图,reference=正确原稿)，再按实际图像检查。';
async function pendingNavigation(workspace,focus){
 if(focus?.code!=='VISUAL_REVIEW_PENDING')return;
 const typed=focus.navigation||focus.evidenceNavigation;
 if(typed?.issue==='paired_image_required')return typed;
 // Legacy runs had no typed waiter. Match the exact old failure and its real
 // failed request; an unrelated regions/unverified error must stay untouched.
 if(focus.message!==legacyPairMessage)return;
 const run=workspace.run,candidates=[...(run.observations||[])].reverse();
 for(const row of [...(run.observationIndex||[])].reverse().filter(row=>row.action==='verify').slice(0,8)){
  if(candidates.some(o=>o.observationId===row.id))continue;
  try{const record=await workspace.observationRecord(row.id,{archiveOnly:true});candidates.push(record);}catch{}
 }
 for(const record of candidates){
  if(record.action?.action!=='verify'||record.response?.error!==focus.message)continue;
  for(const check of record.action.checks||[]){
   const id=proof.resolveId(run,check.evidenceId),image=run.visualObservations?.find(o=>o.eventId===id);
   if(check.kind!=='visual'||!image?.previewOnly||!image.path||!image.sha256)continue;
   const apkHashes=[...new Set((image.sources||[]).filter(s=>/\.apk$/i.test(s.path)).map(s=>s.sha256).filter(Boolean))];
   const apkSha256=image.apkSha256||(apkHashes.length===1?apkHashes[0]:undefined);
   if(apkSha256)return {issue:'paired_image_required',waitFor:'paired_image_delivery',criterionId:check.criterionId,evidenceId:id,path:image.path,sha256:image.sha256,apkSha256};
  }
  return;
 }
}
async function reconcilePending(workspace,navigation){
 const run=workspace.run,nav=require('./evidence-navigation.cjs');let changed=false;
 for(const [owner,key] of [[run.executionState,'blocker'],[run.decisionRecovery,'focus']]){
  const focus=owner?.[key],derived=['VISUAL_REVIEW_READY','VISUAL_REPAIR_REQUIRED'].includes(focus?.code)&&focus.navigation?.status==='paired_delivered';
  const waiter=derived?focus.navigation:await pendingNavigation(workspace,focus);if(!waiter)continue;
  const paired=await nav.pairedForPending(workspace,waiter,{context:navigation});
  if(!paired){
   if(derived){owner[key]={...focus,code:'VISUAL_REVIEW_REFRESH_REQUIRED',navigation:{...waiter,status:'no_current_pair'},message:'先前成对图当前不再有同身份的新鲜已送达候选；按 verificationEvidence 核对当前版本，需要时重建、安装并观察。旧图不作当前验收，真实差异与要求仍保留。'};changed=true;}
   continue;
  }
  if(derived&&focus.navigation.resolvedBy===paired.eventId&&focus.code===(paired.grossMismatch?'VISUAL_REPAIR_REQUIRED':'VISUAL_REVIEW_READY'))continue;
  // Only the obsolete navigation changes. No acceptance, mismatch ledger,
  // loop credit, progress evidence or recovery budget is granted here.
  owner[key]={...focus,code:paired.grossMismatch?'VISUAL_REPAIR_REQUIRED':'VISUAL_REVIEW_READY',navigation:{...waiter,resolvedBy:paired.eventId,status:'paired_delivered'},
   message:paired.grossMismatch?`成对图 ${paired.eventId} 已送达且存在真实差异；先修复实现并重新构建观察，不要重复读取同一图。`:`同图同版本的成对观察 ${paired.eventId} 已真实送达；复用该 visual 证据逐区检查或修复，不再为补成对图重复 view_image。图片不证明行为，验收仍未通过。`};
  changed=true;
 }
 return changed;
}
module.exports={enqueue,enqueueOperation,replay,context,screenshotObservation,reconcilePending,pendingNavigation,pairScreenshot};

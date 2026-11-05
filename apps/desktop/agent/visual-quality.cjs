// Durable model-assessed visual defects. Source hashes come from tool receipts,
// never from the model. Observation failure cannot close a known defect.
const {hash,assertFresh}=require('./evidence.cjs');
const fs=require('node:fs/promises');
const {resolveFile}=require('./workspace.cjs');
const kinds=['watermark','missing_content','layout','readability','other'];
const facets=['position','size','spacing','typography','color','content','visibility','asset','other'];
const normalizedDescription=text=>text.replace(/[\s\p{P}]/gu,'');
function validReport(value){
 if(!value||typeof value!=='object')return false;
 if(value.defects!==undefined&&(!Array.isArray(value.defects)||value.defects.length>16||value.defects.some(d=>!d||!kinds.includes(d.kind)||(d.id!==undefined&&!/^visual_[a-f0-9]{24}$/.test(d.id))||(d.targetId!==undefined&&(typeof d.targetId!=='string'||!d.targetId.trim()||d.targetId.length>300))||(d.facet!==undefined&&!facets.includes(d.facet))||(d.certainty!==undefined&&!['confirmed','suspected'].includes(d.certainty))||!['actual','reference'].includes(d.subject)||typeof d.description!=='string'||!d.description.trim()||d.description.length>800)))return false;
 if(value.checks!==undefined&&(!Array.isArray(value.checks)||value.checks.length>64||value.checks.some(c=>!c||typeof c.id!=='string'||!['matched','mismatch','unverified','not_applicable'].includes(c.status)||(c.status==='not_applicable'&&(typeof c.sourceEvidenceId!=='string'||!c.sourceEvidenceId.trim()))||typeof c.reason!=='string'||!c.reason.trim()||c.reason.length>800)))return false;
 return true;
}
function scope(o){return JSON.stringify([o.designBinding?.layout||o.scope?.path||o.path,o.reference?.path||null]);}
function blocking(c){return c.status==='open'&&!c.assetOnly&&!(c.certainty==='suspected'&&!c.hasConfirmedFinding);}
function componentAnchors(o){return new Set([...(o.designManifest?.targets||[]).map(t=>t.id),...(o.designManifest?.regions||[]).flatMap(r=>(r.repeats||[]).flatMap(g=>g.sourceIds||[]))].filter(Boolean));}
function anchors(o){return new Set([...componentAnchors(o),...(o.designManifest?.regions||[]).flatMap(r=>[r.id,...(r.repeats||[]).map(g=>g.id)])].filter(Boolean));}
function context(run){require('./problem-state.cjs').ensure(run);return {constraints:(run.visualQuality?.constraints||[]).map(({id,description,kind,scopeKey,status,path,subject,assetOnly,certainty,targetId,facet,revision,verifiedRevision,evidenceId,verifiedEvidenceId})=>({id,description,kind,scopeKey,status,path,subject,assetOnly,certainty,targetId,facet,revision,verifiedRevision,evidenceId,verifiedEvidenceId,needsReview:status!=='dismissed'&&(status!=='verified'||!run.problemFreshIds?.includes(id))})),rejectedAssets:run.visualQuality?.rejectedAssets||[],reviewErrors:run.visualQuality?.reviewErrors||[],instruction:'assetOnly 表示素材本身的问题：不要反复修原文件，禁止在实际界面或交付中引用其已否决字节；未使用的原始素材可以保留。其他已发现的视觉缺陷是持续约束，不得因记忆摘要、重命名、重新复制或局部修复而丢失。certainty=suspected 表示待调查，不新增硬性验收阻塞；原用户视觉要求仍须独立验收。targetId只能使用designManifest真实region、targets或重复组件sourceIds中的ID。粗region或重复组中可能有多个缺陷，只有明确旧id才沿用不同措辞；自动归并仅限真实细组件targetId与相同受控facet(position/size/spacing/typography/color/content/visibility/asset)，other不自动归并；必须补充真实图像或来源观察，不能仅修改措辞、换id或同图改成confirmed。revision与evidenceId为发现版本，verifiedRevision与verifiedEvidenceId为最近复验版本，不能混用旧截图与新APK。按问题id逐项checks，可独立关闭有新鲜证据的修复；剩余问题继续阻止整体通过。相反的历史修复要求先核对androidDesign完整规格：误报可用not_applicable+sourceEvidenceId引用android_design_details归档，保留理由，不计为修复或修改原要求；确认的水印不可仅因原稿有标识而撤销。matched须说明本次真实图像依据。新图像同时保留原稿内容与消除已知缺陷；纯色替代不能证明场景背景已还原。原稿含问题素材时明确披露，核对组件裁剪与导出来源，不擅自涂抹标识或降低要求。'};}
// A standalone browser defect can be rechecked against its actual earlier
// rendering. A design comparison still requires its real paired reference.
async function standaloneBrowserRepair(workspace,c,o,observed,review,lookup){
 const run=workspace.run,contract=run.requestContract;
 if(contract?.version!==1||!['application','document'].includes(contract.kind)||contract.executionId!==run.executionId||c.subject!=='actual'||!['readability','layout','watermark'].includes(c.kind))return false;
 const linked=(c.requirementIds||[]).map(id=>require('./requirements.cjs').current(run).find(r=>r.id===id));if(!linked.length||linked.some(r=>!r||r.type!=='visual')||!linked.some(r=>!r.scope&&!r.scopes||r.scope?.path===o.scope?.path||r.scopes?.some(s=>s.path===o.scope?.path)))return false;
 if(o.previewOnly||o.requiresReference||o.designBinding||o.designManifest||c.findingVersion?.reference||run.androidDesignSourceBaseline)return false;
 if((run.requestContractHistory||[]).some(x=>x.executionId===run.executionId&&x.kind==='design'))return false;
 if((run.materialInput?.uses||[]).some(u=>u.role==='design'&&(!u.requirementIds?.length||!c.requirementIds?.length||u.requirementIds.some(id=>c.requirementIds.includes(id)))))return false;
 // An unanchored contrary finding cannot be treated as a separate repair by
 // giving it another description or id. Precisely different targets can close
 // independently through their own checks.
 if((review.defects||[]).some(d=>contrary(c,d)))return false;
 const proof=require('./evidence.cjs'),old=await (lookup|| (id=>proof.lookup(workspace,id)))(c.findingVersion?.eventId||c.evidenceId);
 const before=await fullBrowserPage(workspace,old,c.findingVersion?.image?.path||c.path,c.sha256),after=await fullBrowserPage(workspace,observed,o.path,o.sha256);
 if(!before||!after||!laterEvent(run,after.event,before.event)||before.result.scope.path!==after.result.scope.path||after.result.scope.path!==o.scope?.path)return false;
 const a=before.result.scope.rect,b=after.result.scope.rect;if(!a||!b||!['x','y','width','height'].every(k=>Number.isFinite(a[k])&&a[k]===b[k]))return false;
 try{require('./html-delivery.cjs').assertPageHealth(after.result);await proof.assertFresh(workspace,after.result);}catch(error){if(!ordinaryEvidenceGap(error))throw error;return false;}
 return true;
}
function ordinaryEvidenceGap(error){return !(error instanceof TypeError||error instanceof ReferenceError)&&(!error.code||['EVIDENCE_SOURCE_CHANGED','EVIDENCE_SOURCE_SIZE','ENOENT'].includes(error.code));}
function contrary(c,d){return d.subject==='actual'&&(d.id===c.id||d.kind===c.kind&&(!c.targetId||!d.targetId||c.targetId===d.targetId));}
function laterEvent(run,current,previous){
 const a=Date.parse(current?.at),b=Date.parse(previous?.at);if(!Number.isFinite(a)||!Number.isFinite(b)||current?.id===previous?.id)return false;if(a!==b)return a>b;
 const events=run.events||[],x=events.findIndex(e=>e.id===current.id),y=events.findIndex(e=>e.id===previous.id);return x>=0&&y>=0&&x>y;
}
async function fullBrowserPage(workspace,event,imagePath,sha){
 if(event?.type==='view_image')event=await workspace.findEvent?.(e=>e.type==='browser'&&e.detail.result?.screenshot===imagePath&&e.detail.result?.sha256===sha);
 const r=event?.detail?.result;
 if(event?.type!=='browser'||!Number.isFinite(Date.parse(event.at))||r?.screenshot!==imagePath||r.sha256!==sha||r.scope?.kind!=='viewport'||!r.dom||r.errors?.length||r.dom.missingImages?.length||r.reference||r.designBinding||r.previewOnly||r.requiresReference||r.sourceAudit?.sources?.length)return;
 return {event,result:r};
}
function verifiedRepair(o,version,at){return {status:'verified',verifiedEvidenceId:o.eventId,verifiedSha256:o.sha256,verifiedRevision:o.revision,sources:require('./evidence-version.cjs').sources(o),verifiedVersion:version,verifiedAt:at};}
async function standaloneClosure(workspace,c,o,observed,review,lookup){
 if(o.reference||c.assetOnly||c.scopeKey!==scope(o)||o.sha256===c.sha256||o.transform?.crop||o.scope?.kind!=='viewport'||!review.checks?.some(x=>x.id===c.id&&x.status==='matched'))return false;
 return standaloneBrowserRepair(workspace,c,o,observed,review,lookup);
}
// Compatibility replay applies an already archived decision, never invents a
// new observation. Bounded startup work, idempotent through the existing status.
async function reconcileStandalone(workspace){
 const run=workspace.run,problems=require('./problem-state.cjs'),proof=require('./evidence.cjs'),result={changed:false,reconciledIds:[],checked:0};
 if(run.candidateRecovery||!run.visualQuality?.constraints?.some(c=>c.status==='open'&&!c.assetOnly))return result;
 problems.ensure(run);const state=run.visualQuality,open=new Map(state.constraints.filter(c=>c.status==='open'&&!c.assetOnly&&!run.problemState.records[c.id]?.requiresVerificationAfter).map(c=>[c.id,c]));if(!open.size)return result;
 const cache=new Map(),lookup=id=>{if(!cache.has(id))cache.set(id,proof.lookup(workspace,id));return cache.get(id);},packets=[];
 for(const o of (run.visualObservations||[]).slice(-8).reverse()){
  if(o.reference||o.transform?.crop||o.previewOnly||o.scope?.kind!=='viewport')continue;
  for(const metadata of (o.modelReviews||[]).slice(-2).reverse()){
   if(!metadata||!validReport(metadata)||typeof metadata.detailsEventId!=='string'||!metadata.checks?.some(x=>open.has(x.id))&&!metadata.defects?.some(d=>[...open.values()].some(c=>contrary(c,d))))continue;
   const archive=await lookup(metadata.detailsEventId);if(archive?.type!=='visual_analysis')continue;
   const {detailsEventId,...stored}=metadata,review=(archive.detail?.reviews||[]).find(r=>r&&r.inputHash===metadata.inputHash&&r.sourceHash===metadata.sourceHash&&require('./evidence-binding.cjs').equal(r,stored));if(!review||!validReport(review))continue;
   const key=hash(JSON.stringify([o.eventId,review.inputHash,review.defects,review.checks]));if(!state.reviews?.includes(key))continue;
   const observed=await lookup(o.eventId),page=await fullBrowserPage(workspace,observed,o.path,o.sha256),reviewAt=Date.parse(review.at);if(!page||!Number.isFinite(reviewAt)||reviewAt<Date.parse(page.event.at)||!Number.isFinite(Date.parse(archive.at))||Date.parse(archive.at)<reviewAt)continue;
   packets.push({o,observed,review,archive,page});
  }
 }
 packets.sort((a,b)=>Date.parse(b.page.event.at)-Date.parse(a.page.event.at)||Date.parse(b.archive.at)-Date.parse(a.archive.at));
 const examined=new Set();for(const packet of packets)for(const check of packet.review.checks||[]){
  const c=open.get(check.id);if(check.status!=='matched'||!c||examined.has(c.id))continue;if(result.checked>=8)break;examined.add(c.id);result.checked++;
  const {o,observed,review,archive,page}=packet,knownAt=Math.max(...[c.at,c.findingVersion?.at].map(Date.parse).filter(Number.isFinite));if(!Number.isFinite(knownAt)||Date.parse(review.at)<knownAt)continue;
  const newer=packets.some(p=>(laterEvent(run,p.page.event,page.event)||p.page.event.id===page.event.id&&laterEvent(run,p.archive,archive))&&scope(p.o)===c.scopeKey&&(p.review.checks?.some(x=>x.id===c.id&&x.status==='mismatch')||p.review.defects?.some(d=>contrary(c,d))));
  const laterFinding=state.constraints.some(other=>other.id!==c.id&&other.status==='open'&&other.scopeKey===c.scopeKey&&contrary(c,other)&&Math.max(...[other.findingVersion?.at,other.at].map(Date.parse).filter(Number.isFinite))>Date.parse(review.at));if(newer||laterFinding)continue;
  try{await assertFresh(workspace,{...o,sources:require('./evidence-version.cjs').sources(o)});if(!await standaloneClosure(workspace,c,o,observed,review,lookup))continue;}catch(error){if(!ordinaryEvidenceGap(error))throw error;continue;}
  problems.transition(run,c.id,verifiedRepair(o,require('./evidence-version.cjs').capture(o,observed.at),review.at),'archived_visual_recheck_reconciled');result.reconciledIds.push(c.id);
 }
 if(result.reconciledIds.length){result.changed=true;await workspace.event('visual_repair_reconciled',{problemIds:result.reconciledIds,origin:'archived_model_review',message:'已按原始视觉报告与当前文件复核既有修复；没有新增模型判断或任务通过。'});}
 return result;
}
async function record(workspace,o,review){
 if(!validReport(review))return;
 const versions=require('./evidence-version.cjs');
 await assertFresh(workspace,{...o,sources:versions.sources(o)});
 const run=workspace.run;require('./problem-state.cjs').ensure(run);const state=run.visualQuality||={version:1,constraints:[],rejectedAssets:[],reviews:[]};
 const key=hash(JSON.stringify([o.eventId,review.inputHash,review.defects,review.checks]));if(state.reviews.includes(key))return;
 state.reviews.push(key);state.reviews=state.reviews.slice(-128);
 const knownTargets=anchors(o),preciseTargets=componentAnchors(o),reportedIds=new Set();
 const scopeKey=scope(o),now=new Date().toISOString(),observed=await require('./evidence.cjs').lookup(workspace,o.eventId),version=versions.capture(o,observed?.at||now);
 for(const d of review.defects||[]){
  const targetId=d.targetId&&knownTargets.has(d.targetId)?d.targetId:undefined;
  if(d.targetId&&!targetId){const failure={id:d.id,message:'缺陷targetId不属于当前原稿，未采用该定位：'+d.targetId};state.reviewErrors=[...(state.reviewErrors||[]),failure].slice(-4);}
  const facet=d.facet,match=c=>c.scopeKey===scopeKey&&c.kind===d.kind&&c.subject===d.subject;
  const explicit=d.id&&state.constraints.find(c=>c.id===d.id&&match(c)&&(!targetId||!c.targetId||c.targetId===targetId)&&(!facet||!c.facet||c.facet===facet));
  const precise=targetId&&preciseTargets.has(targetId)&&facet&&facet!=='other';
  const anchored=precise&&state.constraints.find(c=>match(c)&&c.targetId===targetId&&c.facet===facet);
  const sameDescription=state.constraints.find(c=>match(c)&&c.targetId===targetId&&c.facet===facet&&normalizedDescription(c.description)===normalizedDescription(d.description));
  const existing=explicit||anchored||sameDescription;
  const identity=precise?['component',targetId,facet]:['observation',targetId||null,facet||null,normalizedDescription(d.description)];
  const id=existing?.id||'visual_'+hash(JSON.stringify([scopeKey,d.kind,d.subject,identity])).slice(0,24);
  let item=state.constraints.find(c=>c.id===id);
  if(!item){item={id,description:d.description,kind:d.kind,subject:d.subject,scopeKey,path:o.path,...(targetId?{targetId}: {}),...(facet?{facet}: {})};require('./problem-state.cjs').upsert(run,'visual',item);state.constraints=run.visualQuality.constraints;}
  if(targetId&&!item.targetId)item.targetId=targetId;if(facet&&!item.facet)item.facet=facet;
  reportedIds.add(item.id);
  item.observations=[...(item.observations||[]),{description:d.description,evidenceId:o.eventId,at:now}].slice(-8);
  item.requirementIds||=require('./requirements.cjs').current(run).filter(r=>r.type==='visual'&&(!r.scope&&!r.scopes||r.scope?.path===(o.designBinding?.layout||o.scope?.path)||r.scopes?.some(s=>s.path===(o.designBinding?.layout||o.scope?.path)))).map(r=>r.id);
  const certainty=d.certainty||item.certainty||'confirmed';
  const confirmationBase=item.certainty==='suspected'?item:state.constraints.find(c=>c.scopeKey===scopeKey&&c.kind===d.kind&&c.subject===d.subject&&(!targetId||c.targetId===targetId)&&c.certainty==='suspected'&&c.status==='open'&&!versions.canConfirm(c,o))||item;
  const confirmed=certainty==='confirmed'&&versions.canConfirm(confirmationBase,o);
  item.hasConfirmedFinding||=item.certainty==='confirmed'||confirmed;
  if(item.status==='open'&&item.certainty==='confirmed'&&!confirmed)continue;
  if(item.status==='verified'&&confirmed){item.regressions=(item.regressions||0)+1;}
  item.firstSeenAt||=now;
  Object.assign(item,{findingSources:versions.sources(o),findingVersion:version,certainty:confirmed?'confirmed':'suspected',status:'open',evidenceId:o.eventId,sha256:o.sha256,revision:o.revision,at:now,assetOnly:d.subject==='reference'||o.scope?.kind==='file'&&!o.reference&&!o.transform?.crop});
  // Only a direct image observation can identify a bad asset. A screenshot
  // cannot blacklist every image in the application's build inputs.
  const asset=d.subject==='reference'?o.reference:d.subject==='actual'&&o.scope?.kind==='file'&&!o.reference&&!o.transform?.crop?o:null;
  if(d.kind==='watermark'&&item.certainty==='confirmed'&&asset&&/^[a-f0-9]{64}$/.test(asset.sha256||'')){
   if(!state.rejectedAssets.some(a=>a.sha256===asset.sha256))state.rejectedAssets.push({path:asset.path,sha256:asset.sha256,evidenceId:o.eventId,reason:d.description});
  }
 }
 const related=state.constraints.filter(c=>c.scopeKey===scopeKey&&!c.assetOnly);
 for(const c of related){
  const check=(review.checks||[]).find(v=>v.id===c.id);
  if(check?.status==='mismatch'){const confirmed=versions.canConfirm(c,o);if(c.status==='verified'&&confirmed)c.regressions=(c.regressions||0)+1;Object.assign(c,{status:'open',evidenceId:o.eventId,sha256:o.sha256,revision:o.revision,findingSources:versions.sources(o),findingVersion:version,certainty:confirmed?'confirmed':'suspected'});}
  if(check?.status==='not_applicable'){
   try{
    if(c.kind==='watermark'&&(c.certainty==='confirmed'||c.hasConfirmedFinding))throw Error('确认存在的水印不能仅因原稿也有水印而撤销，须修复实际交付画面');
    const sourceReview=await require('./source-review.cjs').prove(workspace,check.sourceEvidenceId,c);Object.assign(c,{status:'dismissed',sourceReview,dismissalReason:check.reason});
   }catch(error){if(error.code==='ERR_ASSERTION')throw error;const failure={id:c.id,message:String(error.message).slice(0,800),sourceEvidenceId:check.sourceEvidenceId};state.reviewErrors=[...(state.reviewErrors||[]).filter(e=>e.id!==c.id),failure].slice(-4);await workspace.event('visual_source_review_rejected',{...failure,message:'未撤销问题：'+failure.message+'；请纠正来源引用，其他可行工作继续'});}
   continue;
  }
  // Individual repairs close independently; other open findings still block
  // whole-task acceptance. No same-image reread or crop can prove a repair.
  const contradicted=reportedIds.has(c.id);
  if(check?.status==='matched'&&!contradicted&&o.sha256!==c.sha256&&!o.transform?.crop&&o.scope?.kind==='viewport'&&(o.reference||await standaloneClosure(workspace,c,o,observed,review)))Object.assign(c,verifiedRepair(o,version,now));
 }
 for(const c of state.constraints)require('./problem-state.cjs').upsert(run,'visual',c);
 if(related.some(c=>blocking(c)&&require('./problem-state.cjs').rows(run).some(p=>p.id===c.id&&p.blocking)))for(const r of require('./requirements.cjs').current(run).filter(c=>c.type==='visual'))if(run.acceptanceResults)delete run.acceptanceResults[r.id];
 await workspace.event('visual_quality_recorded',{evidenceId:o.eventId,open:related.filter(c=>c.status==='open').map(c=>c.id),message:'保留已发现的视觉问题；局部修复不能替代全部条件复验'});
}
function assertNoOpen(run){const problems=require('./problem-state.cjs'),state=problems.rows(run),active=new Set(state.filter(p=>p.blocking).map(p=>p.id)),open=problems.entries(run).filter(p=>p.source==='visual'&&(p.raw.status==='open'||state.find(r=>r.id===p.id)?.forcedRecheck)&&active.has(p.id));if(open.length)throw Object.assign(Error('已知视觉问题尚未同时复验：'+open.map(c=>c.description).join('；')),{code:'VISUAL_QUALITY_PENDING'});}
async function activeRejected(workspace,{includeArtifacts=true}={}){
 const rejected=workspace.run.visualQuality?.rejectedAssets||[];if(!rejected.length)return [];
 const root=workspace.files,files=[];
 async function scan(relative){for(const e of await fs.readdir(await resolveFile(root,relative),{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){
  if(e.isSymbolicLink())continue;const p=relative+'/'+e.name;
  if(e.isDirectory())await scan(p);else if(e.isFile())files.push(p);
 }}
 await scan('app/src/main');
 const refs=new Set(),byName=new Map();
 for(const p of files){const m=p.match(/\/res\/(drawable|mipmap)[^/]*\/([^/.]+)\.[^/]+$/);if(m){const key=m[1]+'/'+m[2];byName.set(key,[...(byName.get(key)||[]),p]);}}
 const seed=files.filter(p=>/\.(?:kt|java)$/.test(p)||/\/res\/layout[^/]*\/.*\.xml$/.test(p));
 const used=new Set(),queue=[...seed];
 for(let i=0;i<queue.length;i++){
  const p=queue[i];if(used.has(p))continue;used.add(p);if(!/\.(?:xml|java|kt)$/.test(p))continue;
  const file=await resolveFile(root,p);if((await fs.stat(file)).size>2*1024*1024)throw Error('素材引用扫描不完整，不能确认已排除问题素材');
  const text=await fs.readFile(file,'utf8');for(const m of text.matchAll(/(?:@(?:\+)?(drawable|mipmap)\/|R\.(drawable|mipmap)\.)([a-zA-Z0-9_]+)/g)){const key=(m[1]||m[2])+'/'+m[3];refs.add(key);queue.push(...(byName.get(key)||[]));}
 }
 const found=[];
 for(const a of includeArtifacts?workspace.run.artifacts||[]:[]){const bad=rejected.find(r=>r.sha256===a.sha256);if(bad&&await require('./evidence.cjs').hashFile(await resolveFile(root,a.path))===bad.sha256)found.push({path:a.path,sha256:bad.sha256,originalPath:bad.path,reason:bad.reason});}
 for(const p of used)if(/\.(?:png|jpe?g|webp|gif)$/i.test(p)){const digest=await require('./evidence.cjs').hashFile(await resolveFile(root,p));const bad=rejected.find(a=>a.sha256===digest);if(bad)found.push({path:p,sha256:digest,originalPath:bad.path,reason:bad.reason});}
 return found;
}
async function assertDeliverable(workspace){
 assertNoOpen(workspace.run);
 for(const c of workspace.run.visualQuality?.constraints||[]){if(require('./problem-state.cjs').rows(workspace.run).find(p=>p.id===c.id)?.optional)continue;if(c.certainty==='suspected'&&!c.hasConfirmedFinding)continue;if(c.status==='dismissed')await require('./source-review.cjs').assertFresh(workspace,c.sourceReview);if(c.status==='verified')await assertFresh(workspace,{revision:c.verifiedRevision,sources:c.sources});}
 await assertAssets(workspace);
}
async function assertAssets(workspace,options){
 const bad=await activeRejected(workspace,options);if(bad.length)throw Object.assign(Error('当前界面仍引用已否决素材：'+bad.map(b=>b.path+'（'+b.reason+'；原路径 '+b.originalPath+'）').join('；')+'。保留原视觉内容，改用经过核对的合格素材；不能用纯色替代后宣称完成。'),{code:'VISUAL_ASSET_REJECTED'});
}
module.exports={reconcileStandalone,validReport,context,record,blocking,assertNoOpen,activeRejected,assertDeliverable,assertAssets};

const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {resolveFile}=require('./workspace.cjs');
const acceptance=require('./acceptance.cjs');
const visual=require('./visual-limitation.cjs');
// Completion is a runtime decision once every feasible check has passed.
// It must not depend on another model call successfully formatting finish.
async function automaticDelivery(workspace,{allowComplete=false,images}={}){
 const run=workspace.run;
 if(run.mode!=='task'||run.acceptanceInputKey!==run.inputKey||!run.steps.length||run.steps.some(s=>s.status!=='done')||!run.artifacts.length||run.pendingArtifactUpdates?.length||require('./result-settlement.cjs').unknown(run))return null;
 const criteria=acceptance.criteria(run),pending=criteria.filter(c=>c.type==='visual'&&!c.check);
 const limits=(run.issues||[]).filter(i=>i.status==='limitation');
 if(allowComplete&&criteria.length&&criteria.every(c=>c.check?.status==='passed')&&!limits.length&&!run.issues?.some(i=>i.status==='open')){
  try{
   for(const file of run.artifacts)if(await require('./evidence.cjs').hashFile(await resolveFile(workspace.files,file.path))!==file.sha256)return null;
   require('./visual-observation.cjs').assertComparisons(run);
   await acceptance.assertAccepted(workspace);
   await require('./html-delivery.cjs').assertHtmlDelivery(workspace);
   await require('./android-delivery.cjs').assertAndroidDelivery(workspace);
   if(run.artifacts.some(a=>/\.apk$/i.test(a.path)))await require('./android-design.cjs').assertDelivery(workspace,images);
   const text=`已完成原任务，${criteria.length} 项原要求均有当前有效的通过证据。\n\n成果：\n`+run.artifacts.slice(0,24).map(f=>'- '+(f.label||f.path)+'（'+f.path+'）').join('\n')+(run.artifacts.length>24?`\n其余 ${run.artifacts.length-24} 项成果可在成果区查看。`:'');
   const review={summary:'按正常交付的文件、验收、页面、设备与问题检查完成自动收尾',issues:[],unverified:[]};
   await require('./issues.cjs').assertDeliverable(workspace,'complete',review,text);
   return {action:'finish',outcome:'complete',text,review};
  }catch{return null;}
 }
 if(!visual.unavailable(run))return null;
 if(!pending.length||run.issues?.some(i=>i.status==='open')||limits.some(i=>!i.requirementIds?.length||i.requirementIds.some(id=>!pending.some(c=>c.id===id))))return null;
 try{
  require('./visual-observation.cjs').assertComparisons(run);
  for(const file of run.artifacts){
   const bytes=await fs.readFile(await resolveFile(workspace.files,file.path));
   if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)return null;
  }
  await acceptance.assertAccepted(workspace,{unverifiedVisualIds:pending.map(c=>c.id)});
  await require('./html-delivery.cjs').assertHtmlDelivery(workspace);
 }catch{return null;}
 return {action:'finish',outcome:'limited',text:`已生成并登记 ${run.artifacts.length} 项产物。${criteria.some(c=>c.type!=='visual')?'可执行的内容与运行检查已通过。':''}视觉效果待人工确认。`+(limits.length?'\n\n限制说明：\n'+limits.map(i=>'- '+i.description).join('\n'):''),
  review:{summary:'已完成当前能力范围内的检查并交付成果；视觉要求保留为未核验，交由人工确认。',issues:limits.map(i=>i.id),unverified:pending.map(c=>c.id)}};
}
async function completeFromEvidence(workspace,{images}={}){
 const action=await automaticDelivery(workspace,{allowComplete:true,images});
 if(action?.outcome!=='complete')return null;
 const run=workspace.run,at=new Date().toISOString();
 run.completionReview={...action.review,revision:run.revision,at};
 run.delivery={outcome:'complete',at,proofs:acceptance.criteria(run).map(c=>({criterionId:c.id,evidence:(c.check.parts||[c.check]).map(p=>({kind:p.kind,evidenceId:p.evidenceId,path:p.path,scope:p.scope,basis:p.basis}))}))};
 run.status='completed';run.currentOutcome='finish';if(run.resultRecovery)run.resultRecovery.stage='completed';
 await workspace.event('completion_review',run.completionReview);await workspace.event('finish',{text:action.text,origin:'runtime_evidence'});
 return {content:action.text};
}
module.exports={automaticDelivery,completeFromEvidence};

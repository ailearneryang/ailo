const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {resolveFile}=require('./workspace.cjs');
const acceptance=require('./acceptance.cjs');
const visual=require('./visual-limitation.cjs');
// Completion is a runtime decision once every feasible check has passed.
// It must not depend on another model call successfully formatting finish.
async function automaticDelivery(workspace,{allowComplete=false,images}={}){
 const run=workspace.run;
 await require('./problem-state.cjs').refresh(workspace);
 if(run.mode!=='task'||run.acceptanceInputKey!==run.inputKey||!run.steps.length||pendingMandatorySteps(run).length||!run.artifacts.length||run.pendingArtifactUpdates?.length||require('./result-settlement.cjs').unknown(run))return null;
 try{require('./input-coverage.cjs').assertPlanned(run);}catch{return null;}
 const criteria=acceptance.criteria(run),must=criteria.filter(c=>!require('./quality-contract.cjs').optional(c)),pending=must.filter(c=>c.type==='visual'&&!c.check),problemRows=require('./problem-state.cjs').rows(run),blockingIssueIds=new Set(problemRows.filter(p=>p.blocking&&p.source==='issue').map(p=>p.id.slice(6)));
 const limits=(run.issues||[]).filter(i=>i.status==='limitation'&&blockingIssueIds.has(i.id));
 if(allowComplete&&must.length&&must.every(c=>c.check?.status==='passed')&&!limits.length&&!run.issues?.some(i=>i.status==='open'&&blockingIssueIds.has(i.id))){
  try{
   for(const file of run.artifacts)if(await require('./evidence.cjs').hashFile(await resolveFile(workspace.files,file.path))!==file.sha256)return null;
   require('./visual-observation.cjs').assertComparisons(run);
   await acceptance.assertAccepted(workspace);
   await require('./html-delivery.cjs').assertHtmlDelivery(workspace);
   await require('./android-delivery.cjs').assertAndroidDelivery(workspace);
   if(run.artifacts.some(a=>/\.apk$/i.test(a.path)))await require('./android-design.cjs').assertDelivery(workspace,images);
   const qualityCoverage=acceptance.qualitySummary(run);
   const text=`已完成原任务，${must.length} 项原要求均有当前有效的通过证据。\n\n`+require('../artifact-presentation.cjs').summaryLines(run.artifacts,{request:run.currentRequest||run.goal,max:3}).join('\n')+(require('./quality-acceptance.cjs').notice(qualityCoverage)?'\n\n'+require('./quality-acceptance.cjs').notice(qualityCoverage):'');
   const review={summary:'按正常交付的文件、验收、页面、设备与问题检查完成自动收尾',issues:[],unverified:[],optionalUnverified:qualityCoverage.optional.pendingIds};
   await require('./issues.cjs').assertDeliverable(workspace,'complete',review,text);
   return {action:'finish',outcome:'complete',text,review,qualityCoverage};
  }catch{return null;}
 }
 if(!visual.unavailable(run))return null;
 if(!pending.length||run.issues?.some(i=>i.status==='open'&&blockingIssueIds.has(i.id))||limits.some(i=>!i.requirementIds?.length||i.requirementIds.some(id=>!pending.some(c=>c.id===id))))return null;
 try{
  require('./visual-observation.cjs').assertComparisons(run);
  for(const file of run.artifacts){
   const bytes=await fs.readFile(await resolveFile(workspace.files,file.path));
   if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)return null;
  }
  await acceptance.assertAccepted(workspace,{unverifiedVisualIds:pending.map(c=>c.id)});
  await require('./html-delivery.cjs').assertHtmlDelivery(workspace);
 }catch{return null;}
 const qualityCoverage=acceptance.qualitySummary(run),optionalNotice=require('./quality-acceptance.cjs').notice(qualityCoverage);
 return {action:'finish',outcome:'limited',text:`已有成果已登记。${must.some(c=>c.type!=='visual')?'可执行的内容与运行检查已通过。':''}视觉效果待人工确认。`+(limits.length?'\n\n限制说明：\n'+limits.map(i=>'- '+i.description).join('\n'):'')+(optionalNotice?'\n\n'+optionalNotice:''),
  qualityCoverage:acceptance.qualitySummary(run),review:{optionalUnverified:acceptance.qualitySummary(run).optional.pendingIds,summary:'已完成当前能力范围内的检查并交付成果；视觉要求保留为未核验，交由人工确认。',issues:limits.map(i=>i.id),unverified:pending.map(c=>c.id)}};
}
async function completeFromEvidence(workspace,{images,signal}={}){
 const action=await automaticDelivery(workspace,{allowComplete:true,images});
 if(action?.outcome!=='complete')return null;
 await require('./candidate-versions.cjs').capture(workspace,{reason:'verified_automatic_delivery',signal});
 await finalizeCandidate(workspace,{signal});
 const run=workspace.run,at=new Date().toISOString();
 run.completionReview={...action.review,revision:run.revision,at};
 run.delivery={qualityCoverage:action.qualityCoverage||acceptance.qualitySummary(run),outcome:'complete',at,inputId:run.inputKey,changes:require('./input-turn.cjs').changes(run,run.artifacts),proofs:acceptance.criteria(run).filter(c=>c.check).map(c=>({criterionId:c.id,evidence:(c.check.parts||[c.check]).map(p=>({kind:p.kind,evidenceId:p.evidenceId,path:p.path,scope:p.scope,basis:p.basis}))}))};
 run.status='completed';run.currentOutcome='finish';if(run.resultRecovery)run.resultRecovery.stage='completed';
 await workspace.event('completion_review',run.completionReview);await workspace.event('finish',{text:action.text,origin:'runtime_evidence'});
 return {content:action.text};
}
async function finalizeCandidate(workspace,{signal}={}){const transactionId=workspace.run.candidateRecovery?.transactionId;if(!transactionId)return;try{const result=await require('./candidate-recovery.cjs').finalize(workspace,{transactionId,signal});await workspace.event(result.status==='finalized'?'candidate_recovery_finalized':'candidate_cleanup_pending',{transactionId,status:result.status,code:result.code,reason:result.reason});return result;}catch(error){signal?.throwIfAborted();if(error.code==='ERR_ASSERTION')throw error;await workspace.event('candidate_cleanup_pending',{transactionId,code:error.code||'CANDIDATE_FINALIZE_FAILED',message:String(error.message||error).slice(0,600)});}}
function pendingMandatorySteps(run){return (run.steps||[]).filter(s=>s.status!=='done'&&!require('./plan.cjs').optionalStep(run,s));}
function optionalStepIds(run){return (run.steps||[]).filter(s=>require('./plan.cjs').optionalStep(run,s)).map(s=>s.id);}
module.exports={automaticDelivery,completeFromEvidence,pendingMandatorySteps,optionalStepIds,finalizeCandidate};

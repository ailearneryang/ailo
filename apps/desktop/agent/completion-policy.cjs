const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {resolveFile}=require('./workspace.cjs');
const acceptance=require('./acceptance.cjs');
const visual=require('./visual-limitation.cjs');
// Completion is a runtime decision once every feasible check has passed.
// It must not depend on another model call successfully formatting finish.
async function automaticDelivery(workspace){
 const run=workspace.run;
 if(run.mode!=='task'||run.acceptanceInputKey!==run.inputKey||!visual.unavailable(run)||!run.steps.length||run.steps.some(s=>s.status!=='done')||!run.artifacts.length||run.pendingArtifactUpdates?.length)return null;
 const criteria=acceptance.criteria(run),pending=criteria.filter(c=>c.type==='visual'&&!c.check);
 const limits=(run.issues||[]).filter(i=>i.status==='limitation');
 if(!pending.length||run.issues?.some(i=>i.status==='open')||limits.some(i=>!i.requirementIds?.length||i.requirementIds.some(id=>!pending.some(c=>c.id===id))))return null;
 try{
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
module.exports={automaticDelivery};

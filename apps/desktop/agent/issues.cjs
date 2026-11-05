const {scopeSchema,scope,covers,event}=require('./evidence.cjs');
const schema={type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['id','status'],properties:{id:{type:'string',maxLength:64},status:{type:'string',enum:['open','resolved','limitation','dismissed']},description:{type:'string',maxLength:800},requirementIds:{type:'array',items:{type:'string'}},scope:scopeSchema,evidenceId:{type:'string'},sourceEvidenceId:{type:'string'},dependsOn:{type:'array',maxItems:12,items:{type:'string',maxLength:80}},dependencyEvidenceId:{type:'string'},reason:{type:'string',maxLength:800}}}};
async function update(workspace,updates){
 if(!Array.isArray(updates)||updates.length>12)throw Error('issues 须为最多12条增量更新');
 require('./problem-state.cjs').ensure(workspace.run);
 const ledger=structuredClone(workspace.run.issues||[]),seen=new Set(),requirements=require('./requirements.cjs').current(workspace.run);
 for(const raw of updates){
  const old=ledger.find(i=>i.id===raw?.id),managed=old?.managedBy==='html-delivery';
  // System-owned fields are authoritative. Model paraphrases belong in the
  // audit trail, never in the detector's description or original scope.
  const item=managed?{...raw,description:old.description,scope:old.scope,
   requirementIds:Array.isArray(raw.requirementIds)?[...new Set([...old.requirementIds,...raw.requirementIds])]:old.requirementIds}:raw;
  if(!item||!/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)||seen.has(item.id)||!['open','resolved','limitation','dismissed'].includes(item.status)||typeof item.description!=='string'||!item.description.trim()||item.description.length>800||!Array.isArray(item.requirementIds)||!item.requirementIds.length||item.requirementIds.some(id=>!requirements.some(r=>r.id===id)))throw Error('问题更新需唯一 ID、状态、说明及有效 requirementIds');
  seen.add(item.id);
  if(item.dependsOn!==undefined){if(!Array.isArray(item.dependsOn)||item.dependsOn.length>12||new Set(item.dependsOn).size!==item.dependsOn.length||item.dependsOn.some(id=>typeof id!=='string'||id==='issue_'+item.id||!require('./problem-state.cjs').entries(workspace.run).some(p=>p.id===id)))throw Error('修复依赖须引用已登记的其他问题稳定ID');if(item.dependsOn.length)await event(workspace,item.dependencyEvidenceId);}
  if(item.id.startsWith('html_')&&!old?.managedBy)throw Error('html_ 为系统问题保留标识，不能由模型创建或覆盖');
  if(old?.managedBy==='html-delivery'){
   if(['limitation','dismissed'].includes(item.status))throw Error('系统检测的页面缺陷不能直接改为限制，必须修复并重新通过检查');
   if(item.status==='resolved')await require('./html-delivery.cjs').assertRepair(workspace,old,item.evidenceId);
  }
  if(old&&old.requirementIds.some(id=>!item.requirementIds.includes(id)))throw Error('问题不能解除与已有要求的关联');
  const range=item.scope?scope(item.scope):old?.scope;
  if(old?.scope&&JSON.stringify(range)!==JSON.stringify(old.scope))throw Error('关闭问题不能改变原检查对象或范围');
  if(item.status!=='open'){
   if(typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>800)throw Error('关闭问题须说明修复依据或为何不影响要求');
   if(item.status==='resolved'){
    const e=await event(workspace,item.evidenceId),observed=e.detail.result?.scope;
    if(range&&!covers(observed,range))throw Error('修复证据未覆盖问题对象和范围');
   }
  }
  let verifiedMetadata={};
  if(item.status==='dismissed'){if(!old)throw Error('不能凭空创建已撤销问题');if(item.requirementIds.some(id=>requirements.find(r=>r.id===id)?.type!=='visual'))throw Error('设计规格不能撤销内容或行为缺陷，须按原要求核验');verifiedMetadata={sourceReview:await require('./source-review.cjs').prove(workspace,item.sourceEvidenceId,old)};}
  if(item.status==='resolved'){const observed=await event(workspace,item.evidenceId);const r=observed.detail?.result||{};verifiedMetadata={sources:r.sources,verifiedSources:r.sources,verifiedRevision:observed.detail?.revision,verifiedAt:new Date().toISOString(),verifiedVersion:require('./evidence-version.cjs').capture({...r,path:r.screenshot||(/\.(png|jpe?g|webp)$/i.test(r.path||'')?r.path:undefined),eventId:observed.id,revision:observed.detail?.revision},observed.at)};}
  const value={...old,...item,...verifiedMetadata,regressions:(old?.regressions||0)+(old?.status==='resolved'&&item.status==='open'?1:0),...(range?{scope:range}:{}),history:[...(old?.history||[]),{status:item.status,description:item.description,evidenceId:item.evidenceId,reason:item.reason,...(managed&&typeof raw.description==='string'&&raw.description!==old.description?{submittedDescription:raw.description.slice(0,800)}:{}),at:new Date().toISOString()}]};
  if(old)ledger[ledger.indexOf(old)]=value;else ledger.push(value);
 }
 const graph=new Map(ledger.map(i=>['issue_'+i.id,i.dependsOn||[]])),visiting=new Set(),done=new Set();
 const visit=id=>{if(visiting.has(id))throw Error('修复依赖不能形成循环');if(done.has(id))return;visiting.add(id);for(const next of graph.get(id)||[])visit(next);visiting.delete(id);done.add(id);};for(const id of graph.keys())visit(id);
 return require('./problem-state.cjs').replaceSource(workspace.run,'issue',ledger);
}
async function assertDeliverable(workspace,outcome,review,text){
 await require('./visual-quality.cjs').assertDeliverable(workspace);
 require('./problem-state.cjs').ensure(workspace.run);
 const ledger=workspace.run.issues||[];
 for(const issue of ledger){
  if(require('./problem-state.cjs').rows(workspace.run).find(p=>p.id==='issue_'+issue.id)?.optional)continue;
  if(issue.status==='open')throw Error('仍有未解决问题：'+issue.id+'；请继续处理或如实暂停/阻塞交付');
  if(issue.status==='dismissed')await require('./source-review.cjs').assertFresh(workspace,issue.sourceReview);
  if(issue.status==='resolved'){if(issue.managedBy==='html-delivery')await require('./html-delivery.cjs').assertRepair(workspace,issue,issue.evidenceId);else await event(workspace,issue.evidenceId);}
  if(issue.status==='limitation'&&(outcome!=='limited'||!review.issues.includes(issue.id)||!text.includes(issue.description)))throw Error('带限制交付须在 review.issues 引用问题 ID，并在交付文字披露问题说明');
 }
 if(outcome==='limited'&&!ledger.some(i=>i.status==='limitation'))throw Error('带限制交付须关联持续记录的问题及不影响要求的理由');
 if(review.issues.some(id=>!ledger.some(i=>i.id===id&&i.status==='limitation')))throw Error('复核问题须先记录到 progress.issues，不能用临时说明替代问题记录');
}
module.exports={schema,update,assertDeliverable};

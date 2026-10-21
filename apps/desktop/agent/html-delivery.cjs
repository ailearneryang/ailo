const proof=require('./evidence.cjs');
function assertLayout(dom){
 const health=dom?.layoutHealth;
 // Only unreachable clipping counts. Content reachable through scrolling is
 // reported separately by the observer, not treated as a broken document.
 if(health?.textNodes>=10&&health.clippedTextNodes/health.textNodes>=0.8)
  throw Error(`HTML 大量内容被容器裁剪（${health.clippedTextNodes}/${health.textNodes} 个文本节点）；请检查坐标与 overflow，修复后重新 browser 观察`);
}
function assertPageHealth(result){
 assertLayout(result.dom);
 if(result.dom?.layoutHealth?.truncated)throw Error('页面文本诊断已截断，不能确认布局完整；请拆分页面后重新检查');
 if(result.sourceAudit?.issues?.length)throw Error('原稿完整性检查未通过：'+result.sourceAudit.issues.join('；'));
}
function issueId(path){return 'html_'+proof.hash(path).slice(0,16);}
function failure(artifact,event,message){
 return Object.assign(Error(`HTML 成果 ${artifact.path} 尚未通过最终页面检查：${message}。先处理此缺口，再重新观察；不要重复提交相同 finish。无法检查时请 blocked，如实说明限制。`),{code:'HTML_DELIVERY_BLOCKED',path:artifact.path,evidenceId:event?.id,scope:event?.detail.result?.scope,sourceBaseline:event?.detail.result?.sourceAudit?.sources,sourcePaths:event?.detail.result?.sourceAudit?.sources?.map(s=>s.path),requiresSourceAudit:event?.detail.result?.sourceAudit?.status==='checked'});
}
function rememberFailure(workspace,error){
 if(error.code!=='HTML_DELIVERY_BLOCKED')return;
 const run=workspace.run,id=issueId(error.path),description=error.message.slice(0,800);
 const requirementIds=require('./requirements.cjs').current(run).filter(r=>!r.scope&&!r.scopes||r.scope?.path===error.path||r.scopes?.some(s=>s.path===error.path)).map(r=>r.id);
 run.issues ||= [];
 const old=run.issues.find(i=>i.id===id);
 const history={status:'open',description,evidenceId:error.evidenceId,at:new Date().toISOString()};
 const value={...old,id,status:'open',managedBy:'html-delivery',sourceBaseline:old?.sourceBaseline?.length?old.sourceBaseline:error.sourceBaseline,sourcePaths:[...new Set([...(old?.sourcePaths||[]),...(error.sourcePaths||[])])],requiresSourceAudit:old?.requiresSourceAudit||error.requiresSourceAudit,description,requirementIds:requirementIds.length?requirementIds:require('./requirements.cjs').current(run).map(r=>r.id),scope:{kind:'viewport',path:error.path},evidenceId:error.evidenceId,history:[...(old?.history||[]),history]};
 if(old)run.issues[run.issues.indexOf(old)]=value;else run.issues.push(value);
 const prefix='HTML '+error.path+'：';
 run.executionState={...run.executionState,goal:run.executionState?.goal||run.goal,facts:run.executionState?.facts||[],gaps:[(prefix+description).slice(0,1200),...(run.executionState?.gaps||[]).filter(g=>!g.startsWith(prefix))].slice(0,12),nextAction:'针对页面检查缺口修复，重新打开页面并回看主体区域',expectedResult:'同一成果的最新页面观察覆盖视口，主体内容可访问且截图已回看',updatedAt:new Date().toISOString()};
 // A failed final check reopens the last step instead of repeatedly asking the
 // model to finish an allegedly completed plan. Normal loop guards still apply.
 if(run.steps.length&&run.steps.every(s=>s.status==='done'))run.steps[run.steps.length-1]={...run.steps.at(-1),status:'running'};
 run.actionsSincePlan=0;
}
function resolveFailure(workspace,artifact,event){
 const issue=workspace.run.issues?.find(i=>i.id===issueId(artifact.path)&&i.managedBy==='html-delivery');
 if(!issue||issue.status==='resolved'&&issue.evidenceId===event.id)return;
 issue.status='resolved';issue.evidenceId=event.id;issue.reason=workspace.run.observationCapabilities?.images===false?'当前成果已重新进行页面级结构观察，布局诊断通过；当前无图像能力，视觉质量仍待人工核验':'当前成果已重新进行页面级观察，截图已传给模型且布局诊断通过';
 issue.history.push({status:issue.status,evidenceId:event.id,reason:issue.reason,at:new Date().toISOString()});
 if(workspace.run.executionState)workspace.run.executionState.gaps=(workspace.run.executionState.gaps||[]).filter(g=>!g.startsWith('HTML '+artifact.path+'：'));
}
async function checkArtifact(workspace,artifact){
 const candidates=workspace.run.events.filter(e=>e.type==='browser'&&e.detail.result?.path===artifact.path&&e.detail.result?.screenshot);
 const issue=workspace.run.issues?.find(i=>i.id===issueId(artifact.path)&&i.managedBy==='html-delivery');
 let lastError;
 for(const event of candidates.slice().reverse()){
  const result=event.detail.result;
  try{
   if(!result.sources?.some(s=>s.path===artifact.path&&s.sha256===artifact.sha256))throw Error('HTML 观察版本与成果不一致');
   await proof.assertFresh(workspace,{revision:event.detail.revision,sources:result.sources,rendererState:result.rendererState});
  }catch(error){lastError=error;continue;}
  if(!result.sourceAudit){
   const source=await require('./sketch-fidelity.cjs').audit(workspace.files,artifact.path,result.dom||{});
   if(source.sources.length)throw failure(artifact,event,'旧页面观察未包含原稿完整性检查，请重新 browser 打开最终文件');
  }
  // Never hide a current defective observation behind a historical good one.
  try{assertPageHealth(result);await proof.event(workspace,event.id);}catch(error){throw failure(artifact,event,error.message);}
  if(workspace.run.observationCapabilities?.images!==false&&!workspace.run.visualObservations?.some(o=>o.eventId===event.id&&o.delivered))throw failure(artifact,event,'HTML 截图尚未传给模型回看');
  if(issue?.sourceBaseline?.some(source=>!result.sourceAudit?.sources?.some(s=>s.path===source.path&&s.sha256===source.sha256)))throw failure(artifact,event,'原稿依赖与发现问题时的版本不同；不能修改或删除原稿数据来使产物通过检查，请恢复原稿后修复生成逻辑');
  if(issue?.requiresSourceAudit&&(result.sourceAudit?.status!=='checked'||issue.sourcePaths?.some(p=>!result.sourceAudit.sources.some(s=>s.path===p))))throw failure(artifact,event,'先前发现的原稿缺陷尚未重新检查；不能删除或省略原稿依赖来关闭问题');
  if(result.scope?.kind!=='viewport'||result.dom?.layoutHealth?.scope!=='document'){
   lastError=Error('局部截图不能替代页面级观察；请 browser 打开页面，不指定 selector 或 crop，再按要求检查主体区域');continue;
  }
  return event;
 }
 throw failure(artifact,null,lastError?.message||'请先 browser 打开最终文件并回看截图，确认主体内容和布局；不能只检查文件存在或文字关键词');
}
async function assertRepair(workspace,issue,evidenceId){
 const path=issue.scope.path;
 const fs=require('node:fs/promises'),{resolveFile}=require('./workspace.cjs');
 const artifact={path,sha256:proof.hash(await fs.readFile(await resolveFile(workspace.files,path)))};
 const event=await checkArtifact(workspace,artifact),id=proof.resolveId(workspace.run,evidenceId);
 const cited=workspace.run.events.find(e=>e.id===id);
 const sameScreenshot=cited?.type==='view_image'&&cited.detail.result?.path===event.detail.result.screenshot&&cited.detail.result?.rendererState?.id===event.detail.result.rendererState?.id&&cited.detail.result?.rendererState?.version===event.detail.result.rendererState?.version;
 if(id!==event.id&&!sameScreenshot)throw Error('关闭系统问题须引用当前通过页面检查的 browser 证据，不能用旧截图或普通命令替代');
 return event;
}
function recordObservation(workspace,event){
 try{assertPageHealth(event.detail.result);}catch(error){
  const blocked=failure({path:event.detail.result.path},event,error.message);
  rememberFailure(workspace,blocked);
  event.detail.result.repairRequired=blocked.message;
 }
}
async function assertHtmlDelivery(workspace){
 for(const artifact of workspace.run.artifacts.filter(a=>/\.html?$/i.test(a.path))){
  const event=await checkArtifact(workspace,artifact);resolveFailure(workspace,artifact,event);
 }
}
module.exports={assertHtmlDelivery,assertLayout,assertPageHealth,assertRepair,recordObservation,rememberFailure};

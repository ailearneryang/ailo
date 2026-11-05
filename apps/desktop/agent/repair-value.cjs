// Repair activity is not the same as repair value. Read/writes cannot reset
// this window: only a fresh closure, accepted requirement, or a new managed
// runtime checkpoint (once per closure generation) can do that.
const {hash}=require('./evidence.cjs');
function markers(run){
 const problems=require('./problem-state.cjs').rows(run),closed=problems.filter(p=>['resolved','dismissed'].includes(p.status));
 const out=closed.map(p=>'problem:'+p.id+':'+p.status);
 for(const r of require('./acceptance.cjs').criteria(run))if(r.check?.status==='passed'&&(run.freshAcceptanceIds||[]).includes(r.id))out.push('criterion:'+r.id);
 const old=new Set(run.inputTurn?.eventIds||[]);
 const runtime=(run.events||[]).some(e=>!old.has(e.id)&&e.type==='android_device'&&e.detail.operation==='screenshot'&&e.detail.result?.apkSha256&&e.detail.result?.pixelSize&&e.detail.result?.sources?.some(s=>s.path===e.detail.result.apkPath&&s.sha256===e.detail.result.apkSha256));
 if(runtime)out.push('runtime-generation:'+hash(JSON.stringify(closed.map(p=>p.id).sort())));
 return out;
}
function pendingTargetChange(run){
 const baseline=new Set(Object.keys(run.inputTurn?.artifacts||{})),old=new Set(run.inputTurn?.eventIds||[]),targets=new Set();
 for(const p of require('./problem-state.cjs').entries(run)){let path=p.raw.scope?.path||p.raw.layout;try{path||=JSON.parse(p.raw.scopeKey||'null')?.[0];}catch{}if(path)targets.add(path);}
 const built=(run.events||[]).findLast(e=>e.type==='build_android'&&e.detail.result?.exitCode===0)?.detail.revision??-1;
 return (run.events||[]).some(e=>{if(old.has(e.id)||(e.detail.revision??-1)<=built)return false;const paths=['write_file','edit_file'].includes(e.type)&&e.detail.result?.changed!==false?[e.detail.path]:e.type==='run_command'&&e.detail.result?.exitCode===0?(e.detail.result.fileChanges||[]).filter(c=>c.after&&c.before!==c.after).map(c=>c.path):[];return paths.some(path=>baseline.has(path)&&targets.has(path));});
}
// A verified correction of the exact design-source prerequisite earns one
// bounded recheck window. Reads, invalid JSON and unrelated edits do not.
async function prepareVerificationPrerequisite(workspace){
 const run=workspace.run;
 if(run.mode!=='task')return false;
 if(require('./recovery-control.cjs').unknown(run))return false;
 const failure=(run.events||[]).findLast(e=>e.type==='validation_failed'&&e.detail?.observation?.code==='MATERIAL_INPUT_PENDING'&&e.detail?.attemptedCheck?.kind==='visual');
 if(!failure||!require('./material-input.cjs').selectedDesign(run).length)return false;
 const state=require('./recovery-control.cjs').repairState(run,{seen:markers(run),stagnant:0,redirected:false});
 if(state.graceGranted||state.prerequisiteEventId===failure.id)return false;
 const index=run.events.indexOf(failure),edit=run.events.slice(index+1).findLast(e=>['write_file','edit_file'].includes(e.type)&&e.detail.path==='android-design.json'&&e.detail.result?.changed!==false&&e.detail.result?.sha256);
 if(!edit)return false;
 try{
  const proof=require('./evidence.cjs');
  if(await proof.hashFile(await require('./workspace.cjs').resolveFile(workspace.files,'android-design.json'))!==edit.detail.result.sha256)return false;
  await require('./material-input.cjs').assertDesign(workspace);
 }catch{return false;}
 state.prerequisiteEventId=failure.id;state.prerequisiteReady=true;
 await workspace.event('verification_prerequisite_ready',{failureEventId:failure.id,editEventId:edit.id,path:'android-design.json',message:'设计来源前置检查已实际通过，保留一次有界复验机会；不代表任务或视觉验收通过。'});
 return true;
}
// At most two source-backed build/run/review chains per closure generation.
// Repeated reads, arbitrary writes, revision bumps and new screenshot names do
// not earn credit. The receipts advance work, never acceptance or issue status.
function workflowMarkers(run,state){
 if(require('./recovery-control.cjs').unknown(run))return [];
 const closed=[...new Set([...(state.workflow?.closed||[]),...markers(run).filter(k=>!k.startsWith('runtime-generation:'))])].sort();
 const generation=hash(JSON.stringify(closed));
 if(state.workflow?.generation!==generation)state.workflow={generation,closed,chains:[]};
 const workflow=state.workflow,old=new Set(run.inputTurn?.eventIds||[]),baseline=new Set(Object.keys(run.inputTurn?.artifacts||{}));
 const events=(run.events||[]).filter(e=>!old.has(e.id)),out=[];
 for(let index=0;index<events.length;index++){
  const build=events[index],r=build.detail?.result;
  if(build.type!=='build_android'||r?.exitCode!==0||r.reused||r.buildInputsChanged||!Array.isArray(r.sources))continue;
  const apk=r.buildArtifacts?.find(a=>/\.apk$/i.test(a.path)&&/^[a-f0-9]{64}$/.test(a.sha256||''));if(!apk)continue;
  const edit=events.slice(0,index).findLast(e=>['write_file','edit_file'].includes(e.type)&&e.detail.result?.changed===true&&baseline.has(e.detail.path)&&/^app\/src\/main\//.test(e.detail.path)&&r.sources.some(s=>s.path===e.detail.path&&s.sha256===e.detail.result.sha256));
  if(!edit)continue;
  let chain=workflow.chains.find(c=>c.apkSha256===apk.sha256);
  if(!chain){if(workflow.chains.length>=2)continue;chain={apkSha256:apk.sha256,buildId:build.id,editId:edit.id};workflow.chains.push(chain);}
  out.push('workflow:'+generation+':'+chain.apkSha256+':built');
  const shot=events.slice(index+1).find(e=>e.type==='android_device'&&e.detail.operation==='screenshot'&&e.detail.result?.apkSha256===apk.sha256&&e.detail.result?.displayCheck?.matches===true&&e.detail.result?.sources?.some(s=>s.path===apk.path&&s.sha256===apk.sha256));
  if(!shot)continue;
  out.push('workflow:'+generation+':'+chain.apkSha256+':running');
  const pair=(run.visualObservations||[]).find(o=>o.delivered&&o.reference&&!o.previewOnly&&o.path===shot.detail.result.path&&o.sources?.some(s=>s.path===apk.path&&s.sha256===apk.sha256));
  if(pair)out.push('workflow:'+generation+':'+chain.apkSha256+':paired');
 }
 return out;
}
function verificationCandidates(run){
 return (run.visualObservations||[]).filter(o=>o.delivered&&o.reference&&!o.previewOnly&&!o.transform?.crop).slice(-2).map(o=>({evidenceId:o.eventId,path:o.path,reference:o.reference,checks:(o.modelReviews||[]).flatMap(r=>r.checks||[]),instruction:'复用当前成对观察，依据真实regions与对应criterionId提交verify；有缺陷先修复，matched只关闭对应问题，不替代整项或整任务验收。'}));
}
function tick(run){
 const problems=require('./problem-state.cjs').rows(run),active=problems.filter(p=>!['resolved','dismissed'].includes(p.status));
 if(run.mode!=='task')return;
 if(!active.length){if(run.repairValue){run.repairValue.seen=[...new Set([...run.repairValue.seen,...markers(run)])];run.repairValue.stagnant=0;run.repairValue.redirected=false;run.repairValue.graceActive=false;}return;}
 const state=require('./recovery-control.cjs').repairState(run,{seen:markers(run),stagnant:0,redirected:false});
 const current=[...markers(run),...workflowMarkers(run,state)],newValue=current.filter(k=>!state.seen.includes(k));
 if(newValue.length){state.seen=[...new Set([...state.seen,...newValue])];state.stagnant=0;state.redirected=false;state.graceActive=false;}else state.stagnant++;
 const work=require('./repair-tickets.cjs').context(run);
 const focused=work.active.map(t=>active.find(p=>p.id===t.id)).filter(Boolean);
 let verificationWindow=false;if(state.stagnant>=16&&!state.graceGranted&&(pendingTargetChange(run)||state.prerequisiteReady)){state.prerequisiteReady=false;state.graceGranted=true;state.graceActive=true;verificationWindow=true;}
 return {stagnant:state.stagnant,verificationWindow,redirect:verificationWindow||state.stagnant>=8&&!state.redirected,exhausted:state.stagnant>=(state.graceActive?32:16),currentWork:work.currentWork,verificationCandidates:verificationCandidates(run),tickets:work.active,backlogCount:work.backlogCount,problemIds:focused.map(p=>p.id),targets:focused.map(p=>({id:p.id,source:p.source,recordId:p.source==='issue'?p.id.slice(6):p.id})),instruction:(work.currentWork?'先完成currentWork及其对应验收；不要让广泛关联的历史工单替代本次要求。':'')+'围绕当前问题取得一个可核对的修复结果。targets中的issue记录用recordId更新progress.issues，visual记录用id提交图像checks，不要把显示ID或旧事件ID编造为新的操作引用。相反的历史要求先回查正确画板的完整规格，再用有来源的误报撤销记录裁决；不要交替添加和删除同一组件。优先把已有修改构建/运行/复验，或完成可独立证明的其他要求。未引用资源、新文件数量、源码说明不是修复结果。视觉路径失败时切换可验证方法，不重复无效分析。'};
}
module.exports={workflowMarkers,verificationCandidates,tick,markers,pendingTargetChange,prepareVerificationPrerequisite};

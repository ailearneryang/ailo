// A repeated decision is an internal scheduling problem, not a user decision.
// Keep the duplicate execution blocked while supplying receipts for reuse.
function begin(run,{kind='repeated_action',action,location,receipt,navigation}={}){
 const key=require('node:crypto').createHash('sha256').update(JSON.stringify([kind==='premature_stop'?'premature_stop':kind,require('./action-identity.cjs').normalize(action||{}),location?.path,location?.inputVersion])).digest('hex');
 run.loopEpisodes ||= [];
 let episode=run.loopEpisodes.find(e=>e.key===key);
 if(!episode){episode={key,attempt:0,location,action:require('./action-identity.cjs').normalize(action||{})};run.loopEpisodes.push(episode);run.loopEpisodes=run.loopEpisodes.slice(-64);}
 const attempt=++episode.attempt;
 const evidence=run.events.filter(e=>['browser','view_image','run_command','acceptance_verified'].includes(e.type)&&(!location?.path||e.detail.path===location.path||e.detail.result?.path===location.path)).slice(-4).map(e=>{
  const image=run.visualObservations?.find(o=>o.eventId===e.id),typed=[...(navigation?.visual?.paired||[]),...(navigation?.visual?.preview||[]),...(navigation?.visual?.standalone||[]),...(navigation?.visual?.awaitingDelivery||[])].find(o=>o.eventId===e.id);
  const kinds=typed?Object.entries(navigation.byKind||{}).filter(([,ids])=>ids.includes(e.id)).map(([kind])=>kind):undefined;
  return {eventId:e.id,action:e.type,path:e.detail.path||e.detail.result?.path,scope:e.detail.result?.scope,...(image?{previewOnly:!!image.previewOnly,delivered:!!image.delivered,reference:image.reference,apkSha256:image.apkSha256||image.designBinding?.apkSha256,fresh:typed?.fresh,allowedKinds:image.previewOnly?[]:kinds,notice:'图像候选不代表通过；view_image不能证明行为，browser行为仍须真实运行记录，新鲜度与完整覆盖由验收复核。'}:{})};
 });
 run.loopRecovery={kind,attempt,key,strategy:attempt>=3?'targeted_repair':attempt>=2?'reuse_and_change':'reuse_receipt',inputKey:run.inputKey,location,blockedAction:action?Object.fromEntries(['action','operation','path','reference','id','entry','pointer','offset','limit','x','y','selector','crop'].filter(k=>action[k]!==undefined).map(k=>[k,action[k]])):undefined,
  previousObservation:receipt,evidence,
  instruction:'当前是内部循环恢复，任务继续执行，不需要用户点击继续。重复动作已阻止且未重放工具，不要仅修改 purpose 或无关参数绕过重复检测。先复用 previousObservation/evidence 和已归档结果，针对当前缺口选择不同的有效动作：纠正参数或方法、读取真正缺失的范围、修复文件、复用有效证据 verify，或完成交付。不要因重复动作而 pause/blocked；只有真实权限缺口或必须由用户补充的信息/选择才请求用户。已完成计划时优先核验和交付，不要重复打开同一页面。若 observationCapabilities.images=false，视觉质量不能由 LLM 验证，应保留为未核验并带限制交付，不能继续截图循环。'};
 if(attempt>=5+(episode.resumeCredits||0))throw Object.assign(Error('针对同一缺口的多次自动调整仍未产生新结果，已停止无效请求并保留原任务、文件和证据。重复动作：'+(location?.path||action?.action||kind)+'。请依据当前缺口继续诊断；任务尚未完成。'),{code:'AGENT_NO_PROGRESS',loop:run.loopRecovery});
 return run.loopRecovery;
}
function progress(run,action,result,{freshProgress=false}={}){
 // Count only distinct effects recognized by decision-recovery, never a plan,
 // summary, repeated read, or identical write. A new repair opens a new loop.
 if(!freshProgress||result?.changed===false||result?.notExecuted||result?.timedOut||result?.exitCode!==undefined&&result.exitCode!==0)return;
 if(!['write_file','edit_file','edit_spreadsheet','build_android','verify'].includes(action.action))return;
 if(action.action==='verify'&&!result.results?.length)return;
 const matched=e=>{
  const path=e.location?.path||e.action?.path;
  if(action.action==='verify')return result.results.some(c=>c.path===path||c.scope?.path===path);
  if(path&&action.path===path)return true;
  if(e.action?.action==='list_files'&&['write_file','edit_file'].includes(action.action))return !path||action.path?.startsWith(path.replace(/\/$/,'')+'/');
  return action.action==='build_android'&&e.action?.action==='build_android';
 };
 const resolved=new Set((run.loopEpisodes||[]).filter(matched).map(e=>e.key));
 run.loopEpisodes=(run.loopEpisodes||[]).filter(e=>!resolved.has(e.key));
 if(resolved.has(run.loopRecovery?.key))delete run.loopRecovery;
}
function resume(run){for(const e of run.loopEpisodes||[])if(e.attempt>=5+(e.resumeCredits||0)){e.resumeCredits=(e.resumeCredits||0)+2;e.resumes=(e.resumes||0)+1;}}
module.exports={begin,progress,resume};

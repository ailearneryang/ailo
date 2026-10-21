// A repeated decision is an internal scheduling problem, not a user decision.
// Keep the duplicate execution blocked while supplying receipts for reuse.
function begin(run,{kind='repeated_action',action,location,receipt}={}){
 const prior=run.loopRecovery?.inputKey===run.inputKey?run.loopRecovery:undefined;
 const attempt=(prior?.attempt||0)+1;
 const evidence=run.events.filter(e=>['browser','view_image','run_command','acceptance_verified'].includes(e.type)&&(!location?.path||e.detail.path===location.path||e.detail.result?.path===location.path)).slice(-4).map(e=>({eventId:e.id,action:e.type,path:e.detail.path||e.detail.result?.path,scope:e.detail.result?.scope}));
 run.loopRecovery={kind,attempt,inputKey:run.inputKey,location,blockedAction:action?Object.fromEntries(['action','operation','path','id','entry','pointer','offset','limit','x','y','selector','crop'].filter(k=>action[k]!==undefined).map(k=>[k,action[k]])):undefined,
  previousObservation:receipt,evidence,
  instruction:'当前是内部循环恢复，任务继续执行，不需要用户点击继续。重复动作已阻止且未重放工具，不要仅修改 purpose 或无关参数绕过重复检测。先复用 previousObservation/evidence 和已归档结果，针对当前缺口选择不同的有效动作：纠正参数或方法、读取真正缺失的范围、修复文件、复用有效证据 verify，或完成交付。不要因重复动作而 pause/blocked；只有真实权限缺口或必须由用户补充的信息/选择才请求用户。已完成计划时优先核验和交付，不要重复打开同一页面。若 observationCapabilities.images=false，视觉质量不能由 LLM 验证，应保留为未核验并带限制交付，不能继续截图循环。'};
 return run.loopRecovery;
}
module.exports={begin};

// A repeated, explicit unfinished obligation is adoption, not a new requirement.
// Use the full user directive; matching a convenient fragment must not erase additions.
const canonical=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/^(?:(?:请|帮我|麻烦你|麻烦|继续)\s*)+/,'').replace(/[\s，。；、,.;！!：:]/g,'');
function targets(run,text,next=require('./requirements.cjs').current({...run}),{materialCount=0}={}){
 if(materialCount)return [];
 const source=canonical(text);if(source.length<4||source.length>300||/[\n\r]/.test(String(text).trim()))return [];
 const old=require('./requirements.cjs').current({...run}),binding=require('./evidence-binding.cjs');
 return old.filter(r=>canonical(r.text).startsWith(source)&&!(/[a-z0-9_-]/.test(source.at(-1))&&/[a-z0-9_-]/.test(canonical(r.text).charAt(source.length)))&&next.some(n=>n.id===r.id&&binding.equal([n.text,n.type,n.scope,n.scopes],[r.text,r.type,r.scope,r.scopes]))&&run.acceptanceResults?.[r.id]?.status!=='passed'&&(run.steps||[]).some(s=>s.status!=='done'&&s.requirementIds?.includes(r.id))).map(r=>r.id);
}
function current(run,next){const entry=run.inputCoverage?.entries?.find(e=>e.inputId===run.inputKey);return targets(run,run.inputTurn?.request||run.currentRequest,next,{materialCount:entry?.materialCount||0});}
function context(run){const ids=current({...run});if(!ids.length)return;return {requirementIds:ids,sourceQuote:run.inputTurn?.request||run.currentRequest,instruction:'当前用户原文完整对应已有未完成要求。可保留原要求与证据，用plan.inputUse将当前inputId映射至这些稳定ID；mode=amend可提交requirements:[]，steps只提交要推进的未完成步骤并保留原requirementIds。不得新增重复要求、改写验收或把输入映射视为执行完成。',steps:(run.steps||[]).filter(s=>s.status!=='done'&&s.requirementIds?.some(id=>ids.includes(id))).map(s=>({id:s.id,title:s.title,status:s.status,requirementIds:s.requirementIds}))};}
module.exports={targets,current,context};

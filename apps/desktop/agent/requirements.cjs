const {scopeSchema,scope}=require('./evidence.cjs');
const types=['presence','content','behavior','visual'];
const binding=require('./evidence-binding.cjs');
const schema={type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,required:['id','text','type'],properties:{id:{type:'string',maxLength:40},text:{type:'string',minLength:1,maxLength:800},type:{type:'string',enum:types},scope:scopeSchema,scopes:{type:'array',minItems:1,maxItems:12,items:scopeSchema},evidenceBinding:binding.schema}}};
function current(run){
 if(!run.requirementsManaged)run.requirements=(run.acceptance||[]).map((text,index)=>({id:require('./acceptance.cjs').criterionId(text),text,type:run.acceptanceTypes?.[index]||'content'}));
 return run.requirements;
}
function update(run,action){
 const old=current(run),sameInput=run.acceptanceInputKey===run.inputKey;
 let next;
 if(action.requirements){
  if(!Array.isArray(action.requirements)||!action.requirements.length||action.requirements.length>12)throw Error('requirements 必须包含1–12条要求');
  const ids=new Set();next=action.requirements.map(r=>{
   if(!r||!/^[a-zA-Z0-9_-]{1,40}$/.test(r.id)||ids.has(r.id)||['__proto__','prototype','constructor'].includes(r.id)||typeof r.text!=='string'||!r.text.trim()||r.text.length>800||!types.includes(r.type))throw Error('要求必须包含唯一稳定 ID、text 和 type');
   const prior=old.find(p=>p.id===r.id);
   const evidenceBinding=r.evidenceBinding===undefined?(sameInput?prior?.evidenceBinding:undefined):sameInput&&binding.equal(r.evidenceBinding,prior?.evidenceBinding)?prior.evidenceBinding:binding.update(run,r.evidenceBinding,r);
   if(sameInput&&prior&&r.evidenceBinding!==undefined&&!binding.equal(evidenceBinding,prior.evidenceBinding)&&r.text!==prior.text)throw Error('纠正技术证据绑定时必须保留原要求文字：'+r.id);
   ids.add(r.id);return {id:r.id,text:r.text,type:r.type,...(r.scope?{scope:scope(r.scope)}:{}),...(r.scopes?{scopes:(()=>{if(!Array.isArray(r.scopes)||!r.scopes.length||r.scopes.length>12)throw Error('scopes 须含1–12个范围');return r.scopes.map(scope);})()}:{} ),...(evidenceBinding?{evidenceBinding}:{})};
  });
 }else{
  // Legacy plan updates may reorder unchanged text. Wording changes require
  // explicit IDs; never infer identity from array position or replace a ledger.
  if(sameInput&&old.some(r=>!action.acceptance.includes(r.text)))throw Error('修改或省略已有要求须在 requirements 保留原 ID，不能通过改写验收文字移除要求');
  next=action.acceptance.map((text,i)=>{const prior=old.find(r=>r.text===text);return {...prior,id:prior?.id||require('./acceptance.cjs').criterionId(text),text,type:action.acceptanceTypes?.[i]||prior?.type||'content'};});
 }
 if(sameInput)for(const prior of old){
  const r=next.find(r=>r.id===prior.id);if(!r)throw Error('不能移除已有要求 ID：'+prior.id+'；需求变更须由用户新输入触发');
  if(r.type!==prior.type)throw Error('已有要求的验证类型不可通过计划更新改变：'+prior.id);
  if(!binding.equal(r.scopes,prior.scopes)&&prior.scopes)throw Error('不能改变已有要求的检查范围集合：'+prior.id);
  if(!binding.equal(r.scope,prior.scope)&&prior.scope)throw Error('不能改变已有要求的检查范围：'+prior.id);
 }
 const results={...run.acceptanceResults};
 for(const r of next){const prior=old.find(p=>p.id===r.id);if(prior&&(prior.text!==r.text||!binding.equal(prior.scope,r.scope)||!binding.equal(prior.scopes,r.scopes)||!binding.equal(prior.evidenceBinding,r.evidenceBinding)))delete results[r.id];}
 return {requirements:next,requirementsManaged:true,acceptanceResults:results};
}
module.exports={schema,current,update};

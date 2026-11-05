// One contract for provider tool schemas and runtime validation.
const limits={goal:1000,items:12,item:800,steps:12,id:40,title:200};
const ledgerLimit=64,compiledPlans=new WeakSet();
const isCompiled=action=>compiledPlans.has(action);
const statuses=['pending','running','waiting_sync','done','blocked'];
const nonempty=max=>({type:'string',minLength:1,maxLength:max,pattern:'\\S'});
const fields={
 mode:{type:'string',enum:['full','amend'],description:'已有计划补充需求优先用amend：requirements/steps只提交新增或明确更新项，运行时保留未列出的旧要求、质量契约、证据和步骤；新要求须由本次非done步骤明确关联。单次增量最多12项，任务累计账本最多64项，超过12项后继续用amend；不能丢弃旧项。初始计划或完整重编用full（默认）。'},
 inputUse:require('./input-coverage.cjs').schema,
 materialUse:require('./material-input.cjs').schema,
 requirements:{...require('./requirements.cjs').schema,minItems:0,description:'完整计划至少1项。amend仅在当前原文完整对应已有未完成要求时允许空数组，结合inputUse引用已有ID并推进未完成步骤；不能借空数组跳过新增要求。'},
 goal:nonempty(limits.goal),
 decisions:{type:'array',maxItems:limits.items,items:nonempty(limits.item)},
 acceptanceTypes:{type:'array',minItems:1,maxItems:limits.items,items:{type:'string',enum:['presence','content','behavior','visual']}},
 acceptance:{type:'array',minItems:1,maxItems:limits.items,items:nonempty(limits.item)},
 steps:{type:'array',minItems:1,maxItems:limits.steps,items:{type:'object',additionalProperties:false,required:['id','title','status'],properties:{
  id:{type:'string',minLength:1,maxLength:limits.id,pattern:'^[a-zA-Z0-9_-]+$'},
  title:nonempty(limits.title),requirementIds:{type:'array',minItems:1,maxItems:12,items:{type:'string',maxLength:40}},detail:nonempty(limits.item),summary:nonempty(160),requiresConfirmation:{type:'boolean'},status:{type:'string',enum:statuses},
 }}},
};
function amendmentFailure(message){return Object.assign(Error('增量计划无效：'+message),{code:'PLAN_VALIDATION',reason:'invalid_amendment'});}
function compile(run,action){
 if(!action||typeof action!=='object'||Array.isArray(action))throw amendmentFailure('必须提供计划对象');
 if(action.mode!==undefined&&!['full','amend'].includes(action.mode))throw amendmentFailure('mode只能为full或amend');
 if(action.mode!=='amend'){const next=structuredClone(action);for(const step of Array.isArray(next.steps)?next.steps:[]){if(!step||typeof step!=='object')continue;const old=run.steps?.find(s=>s.id===step.id);if(step.requirementIds===undefined&&old?.requirementIds)step.requirementIds=structuredClone(old.requirementIds);}return next;}
 const oldRequirements=require('./requirements.cjs').current({...run}),oldSteps=run.steps;
 if(!Array.isArray(oldRequirements)||!oldRequirements.length||!Array.isArray(oldSteps)||!oldSteps.length)throw amendmentFailure('amend需要已有要求与步骤；初始计划使用full');
 const checked=(rows,name,max,properties,strict=true)=>{
  if(!Array.isArray(rows)||!rows.length||rows.length>max)throw amendmentFailure(name+'必须包含1–'+max+'项');
  const seen=new Set();for(const row of rows){
   if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(row.id)||['__proto__','prototype','constructor'].includes(row.id)||seen.has(row.id))throw amendmentFailure(name+'须使用唯一稳定ID及有效对象');
   if(strict&&Object.keys(row).some(key=>!Object.hasOwn(properties,key)))throw amendmentFailure(name+'含未知字段；不能删除或清空继承项');
   seen.add(row.id);
  }
 };
 checked(oldRequirements,'已有要求',ledgerLimit,{},false);checked(oldSteps,'已有步骤',ledgerLimit,{},false);
 const reuse=require('./existing-obligation.cjs').current(run);
 if(action.requirements===undefined&&reuse.length)action={...action,requirements:[]};
 if(!(Array.isArray(action.requirements)&&action.requirements.length===0&&reuse.length))checked(action.requirements,'requirements',limits.items,require('./requirements.cjs').schema.items.properties);
 checked(action.steps,'steps',limits.steps,fields.steps.items.properties);
 const next=structuredClone(action),requirements=structuredClone(oldRequirements),steps=structuredClone(oldSteps),binding=require('./evidence-binding.cjs');
 for(const item of next.requirements){
  if(typeof item.text!=='string'||!item.text.trim()||item.text.length>limits.item||!['presence','content','behavior','visual'].includes(item.type))throw amendmentFailure('requirements仍须包含完整的id、text和type');
  const index=requirements.findIndex(r=>r.id===item.id),prior=requirements[index];
  if(prior){
   if(item.type!==prior.type)throw amendmentFailure('不能改变已有要求的验证类型：'+item.id);
   for(const field of ['scope','scopes'])if(item[field]!==undefined&&!binding.equal(item[field],prior[field]))throw amendmentFailure('不能改变已有要求的检查范围：'+item.id+'；新的检查对象应新增要求');
   if(item.text!==prior.text&&!(run.inputKey&&run.acceptanceInputKey&&run.inputKey!==run.acceptanceInputKey&&run.inputTurn?.followup&&run.inputTurn.requiresPlan))throw amendmentFailure('修改原要求文字须有新的实质用户输入：'+item.id);
   const merged={...prior,...item};for(const field of ['quality','scope','scopes','evidenceBinding'])if(item[field]===undefined&&prior[field]!==undefined)merged[field]=structuredClone(prior[field]);
   requirements[index]=merged;
  }else requirements.push(item);
 }
 for(const item of next.steps){
  if(typeof item.title!=='string'||!item.title.trim()||!statuses.includes(item.status))throw amendmentFailure('提交步骤须包含完整的id、title和status');
  const index=steps.findIndex(s=>s.id===item.id),prior=steps[index];
  if(!prior&&item.status==='done')throw amendmentFailure('新增步骤不能在采用时声明done：'+item.id+'；执行与核验后再更新');
  if(prior){const merged={...prior,...item};if(item.requirementIds===undefined&&prior.requirementIds!==undefined)merged.requirementIds=structuredClone(prior.requirementIds);steps[index]=merged;}
  else steps.push(item);
 }
 if(requirements.length>ledgerLimit||steps.length>ledgerLimit)throw amendmentFailure('任务累计账本最多64条要求、64个步骤；单次增量仍最多12项，不能丢弃旧项绕过上限');
 if(!next.requirements.length&&!next.steps.some(s=>s.status!=='done'&&(s.requirementIds||oldSteps.find(p=>p.id===s.id)?.requirementIds||[]).some(id=>reuse.includes(id))))throw amendmentFailure('保留要求的续办计划须提交关联本次已有要求的未完成步骤');
 const changed=requirements.filter(r=>{const old=oldRequirements.find(p=>p.id===r.id);return !old||!binding.equal([r.text,r.type,r.scope,r.scopes],[old.text,old.type,old.scope,old.scopes]);});
 for(const r of changed){const linked=next.steps.filter(s=>steps.find(row=>row.id===s.id)?.requirementIds?.includes(r.id));if(!linked.length||linked.some(s=>s.status==='done'))throw amendmentFailure('新增或修改要求须关联本次提交的未完成步骤：'+r.id);}
 if(next.steps.some(s=>s.status==='running')){const explicit=new Set(next.steps.map(s=>s.id));for(const step of steps)if(step.status==='running'&&!explicit.has(step.id))step.status='waiting_sync';}
 next.requirements=requirements;next.steps=steps;next.acceptance=requirements.map(r=>r.text);next.acceptanceTypes=requirements.map(r=>r.type);
 compiledPlans.add(next);validatePlan(next);validateStepQuality(run,next.steps,next.requirements);
 return next;
}
function validatePlan(action,{ledger=false}={}) {
 const errors=[],itemLimit=isCompiled(action)||ledger?ledgerLimit:limits.items,stepLimit=isCompiled(action)||ledger?ledgerLimit:limits.steps;
 const checkText=(value,field,max)=>{
  if(typeof value!=='string'||!value.trim())errors.push(`${field} 必须是非空字符串`);
  else if(value.length>max)errors.push(`${field} 长度为 ${value.length}，最多 ${max} 字符`);
 };
 checkText(action.goal,'goal',limits.goal);
 for(const field of ['decisions','acceptance']) {
  const list=action[field],min=field==='acceptance'?1:0;
  if(!Array.isArray(list)||list.length<min||list.length>itemLimit)errors.push(`${field} 必须是含 ${min}–${itemLimit} 项的数组`);
  else list.forEach((v,i)=>checkText(v,`${field}[${i}]`,limits.item));
 }
 if(action.acceptanceTypes!==undefined&&(!Array.isArray(action.acceptanceTypes)||action.acceptanceTypes.length!==action.acceptance?.length||action.acceptanceTypes.some(v=>!['presence','content','behavior','visual'].includes(v))))errors.push('acceptanceTypes 必须与 acceptance 一一对应，使用 presence/content/behavior/visual');
 if(!Array.isArray(action.steps)||!action.steps.length||action.steps.length>stepLimit)errors.push(`steps 必须包含 1–${stepLimit} 个步骤`);
 else {
  const ids=new Set();
  if(action.steps.filter(s=>s?.status==='running').length>1)errors.push('步骤按顺序执行，只能有一个 running；等待后续同步的步骤使用 waiting_sync，不能据此标记 done');
  action.steps.forEach((s,i)=>{
   const field=`steps[${i}]（第 ${i+1} 步）`;
   if(!s||typeof s!=='object'||Array.isArray(s)){errors.push(`${field} 必须是步骤对象`);return;}
   if(typeof s.id!=='string'||!new RegExp(`^[a-zA-Z0-9_-]{1,${limits.id}}$`).test(s.id))errors.push(`${field}.id 必须是 1–${limits.id} 位字母、数字、下划线或连字符`);
   else if(ids.has(s.id))errors.push(`${field}.id 重复，步骤 id 必须唯一`);
   ids.add(s.id);
   checkText(s.title,`${field}.title`,limits.title);
   if(s.requirementIds!==undefined&&(!Array.isArray(s.requirementIds)||!s.requirementIds.length||s.requirementIds.length>12||new Set(s.requirementIds).size!==s.requirementIds.length||s.requirementIds.some(id=>typeof id!=='string'||!id||id.length>40||Array.isArray(action.requirements)&&!action.requirements.some(r=>r.id===id))))errors.push(`${field}.requirementIds 必须引用当前要求的稳定ID且不能重复`);
   if(s.summary!==undefined)checkText(s.summary,`${field}.summary`,160);
   if(s.detail!==undefined)checkText(s.detail,`${field}.detail`,limits.item);
   if(s.requiresConfirmation!==undefined&&typeof s.requiresConfirmation!=='boolean')errors.push(`${field}.requiresConfirmation 必须是布尔值`);
   if(!statuses.includes(s.status))errors.push(`${field}.status 必须是 ${statuses.join(' / ')}`);
  });
 }
 if(errors.length)throw Object.assign(Error(`计划校验失败：${errors.slice(0,8).join('；')}。仅修正列出的字段后重新提交完整 plan，保留其他步骤和实际状态；标题请精简，执行细节可保存到 checkpoint，不要反复提交相同错误。`),{code:'PLAN_VALIDATION'});
}
function optionalStep(run,step,requirements=require('./requirements.cjs').current(run)){return !!step.requirementIds?.length&&step.requirementIds.every(id=>{const r=requirements.find(r=>r.id===id);return !!r&&require('./quality-contract.cjs').optional(r);});}
function validateStepQuality(run,steps,next){for(const step of steps||[]){const old=run.steps?.find(s=>s.id===step.id);if(old&&!optionalStep(run,old)&&optionalStep(run,step,next))throw Error('已有必须或未映射步骤不能改挂可选要求：'+step.id);if(old?.requirementIds?.some(id=>{const r=require('./requirements.cjs').current(run).find(r=>r.id===id);return !require('./quality-contract.cjs').optional(r)&&!step.requirementIds?.includes(id);}))throw Error('已有步骤不能解除与必须要求的关联：'+step.id+'；请保留requirementIds：'+old.requirementIds.join('、'));}}
module.exports={fields,limits,ledgerLimit,isCompiled,compile,validatePlan,optionalStep,validateStepQuality};

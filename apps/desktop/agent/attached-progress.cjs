const {fields,validatePlan}=require('./plan.cjs');
const schema={type:'object',additionalProperties:false,properties:{executionState:require('./execution-state.cjs').schema,issues:require('./issues.cjs').schema,steps:{type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,required:['id','status'],properties:Object.fromEntries(['id','status','summary','detail'].map(key=>[key,fields.steps.items.properties[key]]))}},memory:require('./working-memory.cjs').schema}};
const stepIds=steps=>[...new Set((Array.isArray(steps)?steps:[]).map(step=>step?.id).filter(id=>typeof id==='string'&&id.length>0))];
function scopedSchema(base,steps,{prospective=false}={}){
 const result=structuredClone(base),ids=stepIds(steps);
 if(!Array.isArray(steps))return result;
 result.description='可省略 progress；没有真实状态变化时不要编造步骤更新。同一ID最多更新一次，memory仍须符合摘要约束。';
 if(!prospective&&!ids.length){result.properties={memory:structuredClone(schema.properties.memory)};return result;}
 if(result.properties.steps){
  result.properties.steps.description=prospective?'仅更新本次plan顶层steps声明的ID，每个ID一次；不能填未声明ID。':`仅更新当前已有步骤，每个ID一次：${ids.join('、')}。无更新可省略progress。`;
  result.properties.steps.maxItems=prospective?12:Math.min(12,ids.length);
  if(!prospective)result.properties.steps.items.properties.id={...result.properties.steps.items.properties.id,enum:ids};
 }
 return result;
}
function invalid(field,issue,steps,value){
 const allowedIds=stepIds(steps),receivedType=value===null?'null':Array.isArray(value)?'array':typeof value;
 return Object.assign(Error(`附带进度参数 ${field} 无效（${issue}）；当前允许步骤 ID：${allowedIds.join('、')||'无，先制定计划'}。同一ID只能出现一次；无更新可省略progress，不会丢弃错误元数据后执行动作。`),{code:'PROGRESS_REQUEST_INVALID',diagnostics:{field,expected:'progress_step_contract',issue,allowedIds,receivedType}});
}
// Shared by the decoder and atomic runtime validation. No mutation or coercion.
function validateStepMetadata(action,steps){
 const ids=stepIds(steps);
 if(action.stepId!==undefined&&(!ids.includes(action.stepId)||typeof action.stepId!=='string'))throw invalid('stepId','unknown_step_id',steps,action.stepId);
 const progress=action.progress;if(progress===undefined)return;
 if(!progress||typeof progress!=='object'||Array.isArray(progress))throw invalid('progress','expected_object',steps,progress);
 if(Object.keys(progress).some(key=>!['steps','memory','executionState','issues'].includes(key)))throw invalid('progress','unknown_progress_field',steps,progress);
 if(!ids.length&&Object.keys(progress).some(key=>key!=='memory'))throw invalid('progress','plan_required',steps,progress);
 if(progress.steps===undefined)return;
 if(!ids.length)throw invalid('progress.steps','plan_required',steps,progress.steps);
 if(!Array.isArray(progress.steps)||!progress.steps.length||progress.steps.length>12)throw invalid('progress.steps','expected_existing_step_array',steps,progress.steps);
 const seen=new Set();for(let i=0;i<progress.steps.length;i++){
  const update=progress.steps[i];if(!update||typeof update!=='object'||Array.isArray(update)||!ids.includes(update.id))throw invalid(`progress.steps[${i}].id`,'unknown_step_id',steps,update?.id);
  if(Object.keys(update).some(key=>!['id','status','summary','detail'].includes(key)))throw invalid(`progress.steps[${i}]`,'unknown_step_field',steps,update);
  if(seen.has(update.id))throw invalid(`progress.steps[${i}].id`,'duplicate_step_id',steps,update.id);seen.add(update.id);
  if(!fields.steps.items.properties.status.enum.includes(update.status))throw invalid(`progress.steps[${i}].status`,'invalid_step_status',steps,update.status);
 }
}
function validate(progress,run){
 if(!progress||typeof progress!=='object'||Array.isArray(progress)||Object.keys(progress).some(k=>!['steps','memory','executionState','issues'].includes(k))||['steps','memory','executionState','issues'].every(k=>progress[k]===undefined))throw Error('progress 须包含 steps 或 memory');
 if(progress.executionState!==undefined)require('./execution-state.cjs').validate(progress.executionState,run);
 if(progress.memory!==undefined)require('./working-memory.cjs').validate(progress.memory,'progress.memory');
 validateStepMetadata({progress},run.steps);
 if(progress.steps!==undefined){
  if(!run.steps.length)throw Error('附带更新前须先制定计划');
  if(!Array.isArray(progress.steps))throw Error('progress.steps 必须是当前步骤状态数组');
  if(!progress.steps.length||progress.steps.length>run.steps.length)throw Error('附带进度只能更新已有步骤');
  const updates=new Map();
  for(const step of progress.steps){
   if(!step||typeof step!=='object'||!run.steps.some(old=>old.id===step.id)||updates.has(step.id))throw Error('附带进度的步骤 ID 必须已存在且不重复；修改计划结构须使用 plan');
   updates.set(step.id,step);
  }
  const steps=run.steps.map(step=>updates.has(step.id)?{...step,...updates.get(step.id)}:{...step});
  validatePlan({goal:run.goal,decisions:run.decisions,acceptance:run.acceptance,steps});
  return {...progress,steps};
 }
 return progress;
}
module.exports={schema,validate,scopedSchema,stepIds,validateStepMetadata};

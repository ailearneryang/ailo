const {fields,validatePlan}=require('./plan.cjs');
const schema={type:'object',additionalProperties:false,properties:{executionState:require('./execution-state.cjs').schema,issues:require('./issues.cjs').schema,steps:{type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,required:['id','status'],properties:Object.fromEntries(['id','status','summary','detail'].map(key=>[key,fields.steps.items.properties[key]]))}},memory:{type:'string',minLength:20,maxLength:10000}}};
function validate(progress,run){
 if(!progress||typeof progress!=='object'||Array.isArray(progress)||Object.keys(progress).some(k=>!['steps','memory','executionState','issues'].includes(k))||['steps','memory','executionState','issues'].every(k=>progress[k]===undefined))throw Error('progress 须包含 steps 或 memory');
 if(progress.executionState!==undefined)require('./execution-state.cjs').validate(progress.executionState,run);
 if(progress.memory!==undefined&&(typeof progress.memory!=='string'||progress.memory.trim().length<20||progress.memory.length>10000))throw Error('progress.memory 须为20–10000字的累计工作记忆');
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
module.exports={schema,validate};

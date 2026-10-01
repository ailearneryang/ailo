// One contract for provider tool schemas and runtime validation.
const limits={goal:1000,items:12,item:800,steps:12,id:40,title:200};
const statuses=['pending','running','done','blocked'];
const nonempty=max=>({type:'string',minLength:1,maxLength:max,pattern:'\\S'});
const fields={
 goal:nonempty(limits.goal),
 decisions:{type:'array',maxItems:limits.items,items:nonempty(limits.item)},
 acceptance:{type:'array',minItems:1,maxItems:limits.items,items:nonempty(limits.item)},
 steps:{type:'array',minItems:1,maxItems:limits.steps,items:{type:'object',additionalProperties:false,required:['id','title','status'],properties:{
  id:{type:'string',minLength:1,maxLength:limits.id,pattern:'^[a-zA-Z0-9_-]+$'},
  title:nonempty(limits.title),status:{type:'string',enum:statuses},
 }}},
};
function validatePlan(action) {
 const errors=[];
 const checkText=(value,field,max)=>{
  if(typeof value!=='string'||!value.trim())errors.push(`${field} 必须是非空字符串`);
  else if(value.length>max)errors.push(`${field} 长度为 ${value.length}，最多 ${max} 字符`);
 };
 checkText(action.goal,'goal',limits.goal);
 for(const field of ['decisions','acceptance']) {
  const list=action[field],min=field==='acceptance'?1:0;
  if(!Array.isArray(list)||list.length<min||list.length>limits.items)errors.push(`${field} 必须是含 ${min}–${limits.items} 项的数组`);
  else list.forEach((v,i)=>checkText(v,`${field}[${i}]`,limits.item));
 }
 if(!Array.isArray(action.steps)||!action.steps.length||action.steps.length>limits.steps)errors.push(`steps 必须包含 1–${limits.steps} 个步骤`);
 else {
  const ids=new Set();
  action.steps.forEach((s,i)=>{
   const field=`steps[${i}]（第 ${i+1} 步）`;
   if(!s||typeof s!=='object'||Array.isArray(s)){errors.push(`${field} 必须是步骤对象`);return;}
   if(typeof s.id!=='string'||!new RegExp(`^[a-zA-Z0-9_-]{1,${limits.id}}$`).test(s.id))errors.push(`${field}.id 必须是 1–${limits.id} 位字母、数字、下划线或连字符`);
   else if(ids.has(s.id))errors.push(`${field}.id 重复，步骤 id 必须唯一`);
   ids.add(s.id);
   checkText(s.title,`${field}.title`,limits.title);
   if(!statuses.includes(s.status))errors.push(`${field}.status 必须是 ${statuses.join(' / ')}`);
  });
 }
 if(errors.length)throw Object.assign(Error(`计划校验失败：${errors.slice(0,8).join('；')}。仅修正列出的字段后重新提交完整 plan，保留其他步骤和实际状态；标题请精简，执行细节可保存到 checkpoint，不要反复提交相同错误。`),{code:'PLAN_VALIDATION'});
}
module.exports={fields,limits,validatePlan};

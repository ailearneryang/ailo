// Quality boundaries are declared before evidence is collected. Defaults stay
// mandatory; optional polish never replaces a user's original requirement.
const nonempty={type:'string',minLength:1,maxLength:800};
const schema={type:'object',additionalProperties:false,required:['level','origin'],properties:{level:{type:'string',enum:['must','optional']},origin:{type:'string',enum:['user','agent_polish']},sourceQuote:nonempty,polishOf:{type:'string',maxLength:40},tolerance:{type:'object',additionalProperties:false,required:['metric','unit','min','max','sourceQuote'],properties:{metric:{type:'string',minLength:1,maxLength:120},unit:{type:'string',minLength:1,maxLength:40},min:{type:'number'},max:{type:'number'},sourceQuote:nonempty}}},allOf:[{if:{properties:{origin:{const:'agent_polish'}},required:['origin']},then:{properties:{level:{const:'optional'}},required:['polishOf'],not:{required:['tolerance']}}}]};
function optional(requirement){return requirement?.quality?.level==='optional';}
const normalize=text=>String(text||'').replace(/[\s\p{P}]/gu,'');
function directive(run){return String(run.currentRequest||run.inputTurn?.request||'').replace(/```[\s\S]*?```/g,'').split('\n').filter(s=>!/^\s*>/.test(s)).join('\n');}
function sourceQuote(run,quote){return typeof quote==='string'&&!!quote.trim()&&quote.length<=800&&directive(run).includes(quote);}
const policy=({level,origin,polishOf,tolerance})=>({level,origin,polishOf,tolerance});
function prepare(run,r,prior,old){
 if(r.quality===undefined)return prior?.quality?structuredClone(prior.quality):undefined;
 const q=r.quality;
 if(!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).some(k=>!Object.hasOwn(schema.properties,k))||!['must','optional'].includes(q.level)||!['user','agent_polish'].includes(q.origin))throw Error('quality 须使用明确的 level 与 origin');
 if(q.sourceQuote!==undefined&&(typeof q.sourceQuote!=='string'||!q.sourceQuote.trim()||q.sourceQuote.length>800)||q.polishOf!==undefined&&(typeof q.polishOf!=='string'||!q.polishOf||q.polishOf.length>40))throw Error('quality 来源引用或关联ID无效');
 if(prior&&optional(prior)!==(q.level==='optional'))throw Error('已有要求的必须/可选边界不可在执行中更改：'+r.id);
 if(q.level==='must'&&q.origin==='agent_polish')throw Error('模型新增润色不能成为硬性必做要求');
 // A literal source citation is provenance, not a new quality boundary. A
 // follow-up can add a genuine source without lowering an existing obligation.
 if(q.sourceQuote!==undefined&&q.sourceQuote!==prior?.quality?.sourceQuote&&!sourceQuote(run,q.sourceQuote))throw Error('quality 来源引用须逐字来自当前用户指令，不能伪造或借用无关材料');
 if(prior){
  const baseline=prior.quality||{level:'must',origin:'user'};
  if(!require('./evidence-binding.cjs').equal(policy(q),policy(baseline)))throw Error('已有质量契约不可在执行中改变，尤其不能事后增加容差：'+r.id);
  return {...structuredClone(baseline),...(q.sourceQuote!==undefined?{sourceQuote:q.sourceQuote}:{})};
 }
 if(!prior&&q.level==='optional'){
  if(q.origin==='user'){
   if(!sourceQuote(run,q.sourceQuote)||!/(?:可选|非必须|不必|optional|nice\s+to\s+have)/i.test(q.sourceQuote))throw Error('用户可选要求须引用当前用户明确的可选指令');
  }else{
   const parent=old.find(p=>p.id===q.polishOf&&!optional(p));
   if(!run.acceptanceInputKey||!parent||old.some(p=>normalize(p.text)===normalize(r.text)))throw Error('模型可选润色须关联已登记的必须要求，不能替换或重建原用户要求');
  }
 }
 if(q.tolerance){
  const t=q.tolerance;
  if(q.origin!=='user'||!t||Object.keys(t).some(k=>!Object.hasOwn(schema.properties.tolerance.properties,k))||typeof t.metric!=='string'||!t.metric.trim()||t.metric.length>120||typeof t.unit!=='string'||!t.unit.trim()||t.unit.length>40||!Number.isFinite(t.min)||!Number.isFinite(t.max)||t.min>t.max||!sourceQuote(run,t.sourceQuote))throw Error('容差须事先引用用户的明确范围，使用有限的 min/max、metric 与 unit');
  // Every bound must occur in the source. Semantic metric/unit association is
  // still reviewed by the user; the runtime never invents an 80% threshold.
  if(![t.min,t.max].every(n=>new RegExp('(?:^|[^0-9.])'+String(n).replace(/\./g,'\\.')+'(?:$|[^0-9.])').test(t.sourceQuote)))throw Error('容差上下限必须出现在用户的原始指令中');
  if(!prior&&(run.events||[]).some(e=>!['route','plan','checkpoint','material_input_adopted','task_change_adopted'].includes(e.type)&&(run.inputTurn?.eventIds||[]).includes(e.id)===false))throw Error('容差必须在本次执行与核验前约定，不能为失败结果事后放宽');
 }
 return structuredClone(q);
}
function measured(event,metric,unit){
 const r=event.detail?.result||{},health=r.dom?.layoutHealth;
 // These values come from the actual observer, never a model's check payload.
 const values={
  'image.width':{unit:'px',value:r.pixelSize?.width||r.original?.width},
  'image.height':{unit:'px',value:r.pixelSize?.height||r.original?.height},
  'layout.clippedTextRatio':{unit:'ratio',value:health?.textNodes>0?health.clippedTextNodes/health.textNodes:undefined},
  'page.missingImages':{unit:'count',value:Array.isArray(r.dom?.missingImages)?r.dom.missingImages.length:undefined},
 };
 const m=values[metric];return m&&m.unit===unit&&Number.isFinite(m.value)?{metric,unit,value:m.value}:undefined;
}
async function evaluate(workspace,requirement,evidenceId){
 const t=requirement.quality?.tolerance;if(!t)return {applicable:false};
 const event=await require('./evidence.cjs').event(workspace,evidenceId),m=measured(event,t.metric,t.unit);
 if(!m)throw Error('约定容差须有当前真实工具回执的 measurement，模型估计或文字相似不能替代测量；可测规则为 image.width/image.height(px)、layout.clippedTextRatio(ratio)、page.missingImages(count)');
 return {applicable:true,passed:m.value>=t.min&&m.value<=t.max,measurement:{...m,evidenceId:event.id},bounds:{min:t.min,max:t.max},sourceQuote:t.sourceQuote};
}
function context(run){if(!require('./requirements.cjs').current(run).length)return;return {requirements:require('./requirements.cjs').current(run).map(r=>({id:r.id,level:optional(r)?'optional':'must',origin:r.quality?.origin||'user',sourceQuote:r.quality?.sourceQuote,polishOf:r.quality?.polishOf,tolerance:r.quality?.tolerance})),instruction:'默认原用户要求全部必须；执行中不得降格或事后增加容差。已有quality可省略并由执行器继承；sourceQuote仅为来源元数据，补充或更新须逐字来自当前用户指令，省略会保留既有引用，不能借来源变更level/origin/polishOf/tolerance。模型润色仅可optional，不得新增验收硬阻塞。容差只适用于用户事先明确约定且由当前真实工具回执measurement测量的规则，不代表整体任务完成比例。'};}
module.exports={schema,prepare,optional,evaluate,measured,context};

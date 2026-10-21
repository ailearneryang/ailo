const text={type:'string',maxLength:1200};
const schema={type:'object',additionalProperties:false,required:['goal','facts','gaps','nextAction','expectedResult'],properties:{goal:text,facts:{type:'array',maxItems:16,items:{type:'object',additionalProperties:false,required:['text','sourceIds'],properties:{text,sourceIds:{type:'array',maxItems:8,items:{type:'string'}}}}},gaps:{type:'array',maxItems:12,items:text},nextAction:{type:'string',maxLength:80},expectedResult:text}};
function validate(state,run){
 if(!state||typeof state!=='object'||!['goal','nextAction','expectedResult'].every(k=>typeof state[k]==='string'&&state[k].trim()&&state[k].length<=(k==='nextAction'?80:1200))||!Array.isArray(state.gaps)||state.gaps.length>12||state.gaps.some(t=>typeof t!=='string'||t.length>1200)||!Array.isArray(state.facts)||state.facts.length>16)throw Error('executionState 需要目标、事实来源、缺口、下一动作和预期结果');
 const ids=new Set([...(run.events||[]).map(e=>e.id),...(run.observationIndex||[]).flatMap(o=>[o.id,o.eventId])].filter(id=>typeof id==='string'));
 const facts=state.facts.map((fact,index)=>{
  if(!fact||typeof fact.text!=='string'||!fact.text.trim()||fact.text.length>1200||!Array.isArray(fact.sourceIds)||!fact.sourceIds.length||fact.sourceIds.length>8)throw Error('已确认事实须绑定有效工具记录 ID；未确认内容保留在 gaps');
  const sourceIds=fact.sourceIds.map(id=>{
   if(ids.has(id))return id;
   const matches=typeof id==='string'&&/^[a-f0-9-]{8,}$/i.test(id)?[...ids].filter(full=>full.startsWith(id)):[];
   if(matches.length===1)return matches[0];
   throw Object.assign(Error(`facts[${index}].sourceIds 中的 ${String(id).slice(0,80)} ${matches.length>1?'匹配多条记录':'未匹配任何记录'}；已确认事实须绑定有效工具记录 ID。请使用 externalMemory.recent 或 toolResults 中的完整 observationId/eventId；较早记录用 read_execution(id=observations) 回查。未确认内容保留在 gaps，不要重复提交原引用。`),{code:'EXECUTION_STATE_SOURCE'});
  });
  return {...structuredClone(fact),sourceIds};
 });
 return {...structuredClone(state),facts,updatedAt:new Date().toISOString()};
}
module.exports={schema,validate};

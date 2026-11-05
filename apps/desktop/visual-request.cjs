const {createOutputBudget}=require('./agent/output-budget.cjs');
// Per model and phase, learn within this process; no credentials or pixels retained.
const budgets=new Map();
async function requestBounded(model,request,messages,{signal,stage='review'}={}){
 const key=JSON.stringify([stage,model.id,model.baseUrl,model.model,model.maxOutputTokens,model.contextWindow]);
 const cap=Math.min(model.maxOutputTokens||32768,32768);
 const policy=createOutputBudget(model,cap,budgets.get(key));
 let budget=policy.budget(cap,stage),format={response_format:{type:'json_object'}};
 for(let attempt=0;attempt<3;attempt++){
  signal?.throwIfAborted();
  const current=attempt?[...messages,{role:'user',content:stage==='summary'?'上次摘要被截断且未采用。优先回答本次新要求，只使用所给来源，减少条目并返回完整 JSON；不得把旧成果或未核验内容说成新完成。':'上次视觉响应被截断且未采用。仅回答当前问题，优先给出最关键的组件、颜色和布局差异，控制观察项数量，返回完整 JSON；不能据此判定验收通过。'}]:messages;
  try{
   let result;try{result=await request(current,budget,format);}catch(error){if(error.code!=='MODEL_FORMAT_UNSUPPORTED')throw error;format={};result=await request(current,budget,format);}
   policy.succeeded(result.providerUsage,stage);budgets.set(key,policy.snapshot());return result;
  }catch(error){
   signal?.throwIfAborted();
   if(error.code!=='MODEL_OUTPUT_LIMIT')throw error;
   policy.limited(budget,error.diagnostics,stage);budgets.set(key,policy.snapshot());
   const next=policy.budget(cap,stage);if(attempt===2||next<=budget)throw error;budget=next;
  }
 }
}
const requestVisual=(model,request,messages,options)=>requestBounded(model,request,messages,options);
const requestSummary=(model,request,messages,options)=>requestBounded(model,request,messages,{...options,stage:'summary'});
module.exports={requestVisual,requestSummary};

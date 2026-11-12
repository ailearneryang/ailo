function createReplyUsage(){
 const requests=new Map();
 return {record(id,usage,model){requests.set(id,{usage,model:Object.fromEntries(Object.entries({id:model.id,name:model.name,model:model.model,lane:model.lane}).filter(([,value])=>value!==undefined))});},capture(){
  let inputTokens=0,outputTokens=0,reasoningTokens=0,reportedRequests=0;const models=[];
  const valid=n=>Number.isSafeInteger(n)&&n>=0;
  for(const {usage:u,model} of requests.values()){
   if(!models.some(m=>m.id===model.id&&m.model===model.model&&m.lane===model.lane))models.push(model);
   if(u&&valid(u.inputTokens)&&valid(u.outputTokens)&&Number.isSafeInteger(inputTokens+outputTokens+u.inputTokens+u.outputTokens)){
    inputTokens+=u.inputTokens;outputTokens+=u.outputTokens;reportedRequests++;
    if(valid(u.reasoningTokens)&&Number.isSafeInteger(reasoningTokens+u.reasoningTokens))reasoningTokens+=u.reasoningTokens;
   }
  }
  return {inputTokens,outputTokens,reasoningTokens,totalTokens:inputTokens+outputTokens,reportedRequests,requestCount:requests.size,models};
 }};
}
module.exports={createReplyUsage};

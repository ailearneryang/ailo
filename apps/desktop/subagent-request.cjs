const {randomUUID}=require('node:crypto');
const {abortable,cancelBody}=require('./model-request.cjs');
const scheduler=require('./chat-scheduler.cjs').createScheduler(3);

function createSubagentRequest({fetchImpl,model,signal,onUsage=()=>{},recordRequest=async()=>{}}){
 if(!model||typeof model.baseUrl!=='string'||typeof model.model!=='string')throw Error('子 Agent 模型未配置');
 const url=new URL(model.baseUrl);
 if(url.username||url.password||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw Error('子 Agent 模型地址无效');
 if(!url.pathname.replace(/\/$/,'').endsWith('/chat/completions'))url.pathname=url.pathname.replace(/\/$/,'')+'/chat/completions';
 return async(messages,{agent,turn,deadlineAt}={})=>{
  signal.throwIfAborted();
  const id=randomUUID(),release=await scheduler.acquire(id,signal),started=Date.now(),controller=new AbortController();
  const cancel=()=>controller.abort(signal.reason);signal.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>controller.abort(Object.assign(Error('子 Agent 模型请求超时'),{code:'SUBAGENT_TIMEOUT'})),Math.max(1,Math.min(120000,Number.isFinite(deadlineAt)?deadlineAt-Date.now():120000)));
  let response,result,failure;
  try{
   for(let includeUsage=true;;){
    response=await abortable(fetchImpl(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json','X-Ailo-Request-Id':id,...(model.apiKey?{Authorization:`Bearer ${model.apiKey}`}:{})},body:JSON.stringify({model:model.model,stream:true,max_tokens:Math.min(4096,model.maxOutputTokens||4096),messages,...require('./reasoning.cjs').decisionReasoningParameters(model,'operation'),...(includeUsage?{stream_options:{include_usage:true}}:{})})}),controller.signal,r=>cancelBody(r.body));
    if(includeUsage&&[400,422].includes(response.status)){
     const reason=(await response.text()).slice(0,3000);
     if(/stream_options|include_usage/i.test(reason)&&/not.support|unsupported|not.allowed|unknown|unrecognized|unexpected|not.permitted|不支持/i.test(reason)){includeUsage=false;continue;}
    }
    break;
   }
   if(!response.ok){await cancelBody(response.body);throw Object.assign(Error(`子 Agent 模型请求失败（HTTP ${response.status}）`),{code:'SUBAGENT_HTTP_ERROR'});}
   result=await require('./chat-response.cjs').readCompletion(response,{signal:controller.signal,onActivity:()=>{},onText:content=>{if(content.length>12000)throw Error('子 Agent 输出过长');}});
   if(result.finishReason==='length')throw Error('子 Agent 输出达到上限，未返回完整动作');
   return result;
  }catch(error){failure=error;throw error;
  }finally{
   clearTimeout(timer);signal.removeEventListener('abort',cancel);release();
   try{onUsage(id,result?.providerUsage||failure?.providerUsage,{...model,lane:'subagent'});}catch{}
   await Promise.resolve(recordRequest({metricsVersion:1,id,modelId:model.id,phase:'子 Agent 分析',action:'subagent',outcome:failure?'failed':'completed',errorCode:failure?.code,subagentId:agent?.id,turn,startedAt:new Date(started).toISOString(),durationMs:Date.now()-started,httpStatus:response?.status,providerUsage:result?.providerUsage||failure?.providerUsage,promptTokens:result?.providerUsage?.inputTokens,completionTokens:result?.providerUsage?.outputTokens})).catch(()=>{});
  }
 };
}
module.exports={createSubagentRequest};

const processActions=new Set(['route','plan','checkpoint','verify','finish']);
function init(run){
 const p=run.performance ||= {version:1,wallMs:0,modelMs:0,modelRequests:0,failedModelRequests:0,processModelMs:0,processModelRequests:0,noActionMs:0,noActionRequests:0,toolMs:0,toolCalls:0,batchItems:0,attachedUpdates:0,reportedUsageRequests:0,inputTokens:0,outputTokens:0,reasoningTokens:0};
 if(!p.runtimeCountersSince){p.runtimeCountersSince=new Date().toISOString();p.toolErrors=0;p.validationFailures=0;p.successfulTools=0;}
 return p;
}
function request(run,record){
 const p=init(run),duration=Number.isFinite(record.durationMs)?Math.max(0,record.durationMs):0;
 p.modelRequests++;p.modelMs+=duration;
 if(Number.isFinite(record.firstActionMs)&&record.firstActionMs>=0&&record.firstActionMs<=duration){p.beforeActionMs=(p.beforeActionMs||0)+record.firstActionMs;p.timedActionMs=(p.timedActionMs||0)+duration;p.timedActionRequests=(p.timedActionRequests||0)+1;}
 if(record.outcome==='failed')p.failedModelRequests++;
 if(processActions.has(record.action)){p.processModelMs+=duration;p.processModelRequests++;}
 if(record.errorCode==='MODEL_NO_ACTION_TIMEOUT'||record.errorCode==='MODEL_EMPTY_RESPONSE'||record.errorCode==='MODEL_OUTPUT_LIMIT'&&record.contentChars===0&&!(record.toolArgumentChars>0)&&(record.reasoningTokens>0||record.reasoningChars>0)){p.noActionRequests++;p.noActionMs+=duration;}
 const usage=record.providerUsage||{};if(Number.isSafeInteger(usage.inputTokens)&&Number.isSafeInteger(usage.outputTokens)){p.reportedUsageRequests++;p.inputTokens+=usage.inputTokens;p.outputTokens+=usage.outputTokens;}
 if(Number.isSafeInteger(usage.reasoningTokens))p.reasoningTokens+=usage.reasoningTokens;
}
module.exports={init,request};

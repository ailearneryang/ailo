const {summarizeRequests}=require('../apps/desktop/request-metrics.cjs');
function trialEfficiency(result,requests){
 const requestMetrics=summarizeRequests(requests,{expectedRequests:Number.isSafeInteger(result.actualModelRequests)?result.actualModelRequests:requests.length});
 // The evaluator records every complete() turn, including failed turns. Do not
 // label the last reply's latency as the first turn's, or as cumulative resume.
 const timings=Array.isArray(result.responseTimings)?result.responseTimings:[];
 const first=timings[0];
 return {...requestMetrics,firstReplyMs:Number.isFinite(first?.firstReplyMs)&&first.firstReplyMs>=0?first.firstReplyMs:null,
  firstStreamTextMs:Number.isFinite(first?.firstStreamTextMs)&&first.firstStreamTextMs>=0?first.firstStreamTextMs:null,
  timingScope:'evaluation_complete_call_to_reply_available',segmentOnly:true,turns:timings.length};
}
module.exports={trialEfficiency};

// Numeric, content-free telemetry. Process requests are a classification, not
// proof that planning or verification was unnecessary. Never infer old TTFT.
const processActions=new Set(['route','plan','checkpoint','verify','finish','request_tools']);
const finite=value=>Number.isFinite(value)&&value>=0;
function summarizeRequests(records,{expectedRequests=records.length}={}){
 const complete=records.length>0&&records.length===expectedRequests&&records.every(r=>r.metricsVersion===1);
 const timed=complete&&records.every(r=>finite(r.durationMs));
 const process=records.filter(r=>processActions.has(r.action));
 const modelMs=timed?records.reduce((n,r)=>n+r.durationMs,0):null;
 const processMs=timed?process.reduce((n,r)=>n+r.durationMs,0):null;
 return {metricsVersion:1,modelRequests:records.length,expectedRequests,coverageComplete:complete,
  processModelRequests:complete?process.length:null,processRequestRatio:complete?process.length/records.length:null,
  modelMs,processModelMs:processMs,processTimeRatio:timed&&modelMs>0?processMs/modelMs:null,
  protocolErrorRequests:complete?records.filter(r=>r.protocolErrorReason||r.errorCode==='AGENT_PROTOCOL').length:null,
  failedModelRequests:complete?records.filter(r=>r.outcome==='failed').length:null};
}
function createReplyMetrics({now=Date.now,startedAt=now()}={}){
 const records=new Map();let firstReplyMs=null,firstStreamTextMs=null,firstReplySource=null;
 function text(content,source='stream'){
  if(typeof content!=='string'||!content.trim())return;
  const elapsed=Math.max(0,now()-startedAt);
  if(firstReplyMs===null){firstReplyMs=elapsed;firstReplySource=source;}
  if(source==='stream'&&firstStreamTextMs===null)firstStreamTextMs=elapsed;
 }
 return {text,record(record){if(!record.id)return;records.set(record.id,{metricsVersion:record.metricsVersion,durationMs:record.durationMs,action:record.action,outcome:record.outcome,errorCode:record.errorCode,protocolErrorReason:record.protocolErrorReason});},
  capture(){return {...summarizeRequests([...records.values()]),firstReplyMs,firstStreamTextMs,firstReplySource,timingScope:'complete_received_to_reply_available'};}};
}
module.exports={processActions,summarizeRequests,createReplyMetrics};

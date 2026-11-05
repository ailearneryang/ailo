const defaults={segmentSteps:120,segmentDurationMs:30*60*1000,maxSegments:4,maxTotalDurationMs:2*60*60*1000};
function evaluationPolicy(input,stored){
 if(input.executionOrigin!=='evaluation'||input.evaluationPolicy===undefined)return stored;
 const policy=input.evaluationPolicy;
 if(!policy||typeof policy!=='object'||Array.isArray(policy)||Object.keys(policy).some(key=>key!=='maxDecisions')||!Number.isSafeInteger(policy.maxDecisions)||policy.maxDecisions<1||policy.maxDecisions>120)throw Error('诊断执行预算必须是1–120次决策，不能扩展运行权限或其他上限');
 const base={...defaults,...stored};
 return {...base,segmentSteps:Math.min(base.segmentSteps,policy.maxDecisions),maxSegments:1};
}
async function runSegments(execute,{signal,onContinue,policy={},now=Date.now}={}){
 const limits={...defaults,...policy};
 for(const [key,value] of Object.entries(limits))if(!Number.isSafeInteger(value)||value<=0)throw Error('任务执行预算无效：'+key);
 const started=now();let result;
 for(let segment=0;segment<limits.maxSegments;segment++){
  signal?.throwIfAborted();
  const remaining=limits.maxTotalDurationMs-(now()-started);
  if(remaining<=0)break;
  result=await execute({maxSteps:limits.segmentSteps,maxDurationMs:Math.min(limits.segmentDurationMs,remaining),
   continuationReason:segment?'segment':'user',segmentIndex:segment,finalizeOnBudget:segment+1>=limits.maxSegments||remaining<=limits.segmentDurationMs});
  signal?.throwIfAborted();
  const next=require('./segment-progress.cjs').decision(result,{segmentsRemaining:segment+1<limits.maxSegments,timeRemaining:now()-started<limits.maxTotalDurationMs});
  if(result?.agentRun?.segmentState)result.agentRun.segmentState.continuationDecision=next;
  if(next!=='continue'){if(result?.continuation)delete result.continuation;return result;}
  try{onContinue?.('已保存当前阶段的成果，正在继续下一阶段…');}catch{}
 }
 // This is a real task budget, not another automatically renewed segment.
 if(result?.continuation)delete result.continuation;
 return result;
}
module.exports={defaults,runSegments,evaluationPolicy};

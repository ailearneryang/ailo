const {createHash}=require('node:crypto');
const hash=text=>createHash('sha256').update(text).digest('hex');
async function archive(workspace,name,value){
 const run=workspace.run,text=JSON.stringify(value),sha256=hash(text);
 run.contextArchives ||= {};
 const prior=run.contextArchives[name];
 if(prior?.executionId===run.executionId&&prior.sha256===sha256){
  try{const record=await workspace.observationRecord(prior.observationId,{archiveOnly:true});if(hash(record.response.result.text)===sha256)return prior.observationId;}catch(error){if(!['ENOENT','EXECUTION_RECORD_NOT_FOUND'].includes(error.code))throw error;}
 }
 const action={action:name+'_details'},response={result:{kind:'derived_context',text}},observationId=await workspace.archiveObservation(action,response);
 run.observationIndex ||= [];
 run.observationIndex.push({id:observationId,action:action.action,contextOnly:true});
 run.contextArchives[name]={executionId:run.executionId,observationId,sha256,chars:text.length};
 return observationId;
}
module.exports={archive};

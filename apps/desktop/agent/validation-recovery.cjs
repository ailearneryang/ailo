// Validation failures are repair targets, not inferred diagnoses. Keep the
// original requirement and observation available after previews are compacted.
const requirements=run=>require('./requirements.cjs').current(run);
function pending(run){
 const ids=new Set(requirements(run).map(r=>r.id));
 return Object.values(run.validationRepairs||{}).filter(r=>r.status==='open'&&ids.has(r.criterionId));
}
async function failed(workspace,check,error){
 const run=workspace.run,requirement=requirements(run).find(r=>r.id===check?.criterionId);
 if(!requirement)return;
 const proof=require('./evidence.cjs'),evidenceId=check.evidenceId&&proof.resolveId(run,check.evidenceId);
 const evidence=run.events.find(e=>e.id===evidenceId);
 const target={criterionId:requirement.id,requirement:requirement.text,type:requirement.type,
  path:check.path||evidence?.detail.result?.scope?.path,
  scope:requirement.scope,scopes:requirement.scopes,
  attemptedCheck:{kind:check.kind,path:check.path,contains:check.contains,scope:check.scope,evidenceId},
  observation:{code:error.code||'VALIDATION_FAILED',message:error.message.slice(0,2400)},
  revision:run.revision};
 await workspace.event('validation_failed',target);
 const failureEventId=run.events.at(-1).id;
 const failureObservationId=await workspace.archiveObservation({action:'verify',checks:[target.attemptedCheck]},
  {eventId:failureEventId,criterionId:requirement.id,error:target.observation.message,code:target.observation.code});
 run.validationRepairs ||= {};
 const old=run.validationRepairs[requirement.id],failure={eventId:failureEventId,observationId:failureObservationId,observation:target.observation,revision:run.revision};
 run.validationRepairs[requirement.id]={...target,status:'open',failureEventId,failureObservationId,
  attempts:(old?.attempts||0)+1,history:[...(old?.history||[]),failure].slice(-8)};
 // A newer failed check must not leave an earlier pass available for finish.
 if(run.acceptanceResults)delete run.acceptanceResults[requirement.id];
 await workspace.save();
}
function passed(run,results,eventId){
 for(const result of results){
  const target=run.validationRepairs?.[result.criterionId];
  if(target?.status==='open')Object.assign(target,{status:'verified',verifiedEventId:eventId,verifiedRevision:run.revision});
 }
}
module.exports={pending,failed,passed};

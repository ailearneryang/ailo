// The persisted problemState is authoritative. Legacy collections are views of
// the same records, retained only for old snapshots and extension compatibility.
const sources=['visual','region','issue'];
function idFor(source,c){return source==='visual'?c.id:source==='region'?'region_'+(c.key||c.regionId):'issue_'+c.id;}
function legacy(run,source){return source==='visual'?run.visualQuality?.constraints||[]:source==='region'?Object.values(run.designRegionIssues||{}):run.issues||[];}
function write(run,source,values){
 if(source==='visual'){run.visualQuality||={version:1,rejectedAssets:[],reviews:[]};run.visualQuality.constraints=values;}
 else if(source==='region')run.designRegionIssues=Object.fromEntries(values.map(c=>[c.key||c.regionId,c]));
 else run.issues=values;
}
function ensure(run){
 if(!run.problemState||run.problemState.version!==1||!run.problemState.records||Array.isArray(run.problemState.records)){
  const initial=sources.flatMap(source=>legacy(run,source).map(data=>({source,data})));
  run.problemState={version:1,records:{},evidence:{},migratedAt:new Date().toISOString()};
  for(const {source,data} of initial)put(run,source,data,{migration:true});
 }
 // Loaded legacy mirrors may contain newly added old-extension records. Import
 // only previously unknown identities; mirror edits cannot overwrite a saved
 // canonical record. All built-in writers use upsert/transition below.
 for(const source of sources)for(const c of legacy(run,source))if(c&&idFor(source,c)&&!run.problemState.records[idFor(source,c)])put(run,source,c,{migration:true});
 sync(run);return run.problemState;
}
function dependencies(c,verified=false){return (verified?(c.verifiedSources||c.sources):(c.findingSources||c.sources))||[];}
function indexEvidence(state,c){
 for(const [kind,eventId,version,rows] of [['finding',c.evidenceId||c.eventId,c.findingVersion,dependencies(c)],['verification',c.verifiedEvidenceId||c.verifiedEventId||(c.status==='resolved'?c.evidenceId:undefined),c.verifiedVersion,dependencies(c,true)]]){
  if(!eventId)continue;
  const old=state.evidence[eventId]||{};
  state.evidence[eventId]={...old,id:eventId,...(version?{version}:{}),sources:rows.length?structuredClone(rows):old.sources||[],roles:[...new Set([...(old.roles||[]),kind])]};
 }
}
function put(run,source,c,{migration=false,reason}={}){
 if(!sources.includes(source)||!c||typeof c!=='object')throw Error('问题来源或记录无效');
 const id=idFor(source,c);if(!id||id.endsWith('undefined')||['__proto__','constructor','prototype'].includes(id))throw Error('问题必须有稳定标识');
 const state=run.problemState,prior=state.records[id],previousStatus=prior?prior.lastStatus:undefined;
 const proofSignature=JSON.stringify([c.evidenceId,c.eventId,c.verifiedEvidenceId,c.verifiedEventId,c.verifiedRevision,c.findingSources,c.sources,c.verifiedSources,c.sourceReview]);
 const proofChanged=prior&&prior.proofSignature!==undefined&&prior.proofSignature!==proofSignature;
 // Keep the shared canonical object identity for legacy readers holding a ref.
 const data=prior?.data||c;if(prior&&data!==c){const requirementIds=[...new Set([...(data.requirementIds||[]),...(c.requirementIds||[])])],confirmed=data.hasConfirmedFinding;Object.assign(data,c);if(requirementIds.length)data.requirementIds=requirementIds;if(confirmed)data.hasConfirmedFinding=true;}
 const record=prior||{id,source,recordId:source==='region'?c.key||c.regionId:c.id,data,transitions:[]};
 if(!prior||previousStatus!==data.status){record.transitions=[...(record.transitions||[]),{from:previousStatus,to:data.status,reason:reason|| (migration?'legacy_migration':'detector_update'),evidenceId:data.verifiedEvidenceId||data.verifiedEventId||data.evidenceId||data.eventId,at:new Date().toISOString()}].slice(-64);delete record.validation;}
 record.lastStatus=data.status;record.proofSignature=proofSignature;if(proofChanged){record.validation={valid:false,reason:'proof_changed_requires_refresh'};run.problemFreshIds=(run.problemFreshIds||[]).filter(key=>key!==id);}
 state.records[id]=record;indexEvidence(state,data);for(const evidenceId of [data.evidenceId,data.eventId,data.verifiedEventId,data.verifiedEvidenceId,data.detectedBy]){const receipt=(run.events||[]).find(e=>e.id===evidenceId);if(receipt)recordEvidence(run,receipt);}return data;
}
function recordEvidence(run,event){if(!event?.id)return;const r=event.detail?.result||{},state=run.problemState,old=state.evidence[event.id]||{};state.evidence[event.id]={...old,id:event.id,eventType:event.type,revision:event.detail?.revision,at:event.at,sources:structuredClone(r.sources||old.sources||[]),roles:old.roles||[]};}
function sync(run){const state=run.problemState;if(!state?.records)return;for(const source of sources)write(run,source,Object.values(state.records).filter(r=>r.source===source).map(r=>r.data));}
function upsert(run,source,value,options){ensure(run);const data=put(run,source,value,options);sync(run);return data;}
function transition(run,id,patch,reason){ensure(run);const r=run.problemState.records[id];if(!r)throw Error('不存在的问题：'+id);return upsert(run,r.source,{...r.data,...patch},{reason:reason||'verified_transition'});}
function replaceSource(run,source,values){ensure(run);for(const c of values||[])put(run,source,c);sync(run);return legacy(run,source);}
function clear(run){delete run.problemState;delete run.problemFreshIds;delete run.problemChangedIds;}
function entries(run){ensure(run);return Object.values(run.problemState.records).filter(r=>!(r.source==='visual'&&r.data.assetOnly)).map(r=>({id:r.id,source:r.source,description:r.source==='region'?r.data.region+'：'+r.data.reason:r.data.description,raw:r.data,requirementIds:r.data.requirementIds}));}
function linkedRequirements(run,p){const all=require('./requirements.cjs').current(run);return p.requirementIds?.length?all.filter(r=>p.requirementIds.includes(r.id)):all.filter(r=>r.type==='visual');}
function rows(run){const fresh=new Set(run.problemFreshIds||[]),changed=new Set(run.problemChangedIds||[]);return entries(run).map(({raw:c,...p})=>{
 const verified=c.status==='verified'||['resolved','dismissed'].includes(c.status),record=run.problemState.records[p.id],isFresh=!record.requiresVerificationAfter&&(record.validation?record.validation.valid:fresh.has(p.id));
 const status=c.status==='limitation'?'limitation':verified?(isFresh?(c.status==='dismissed'?'dismissed':'resolved'):'pending_check'):c.regressions>0?'regressed':c.certainty==='suspected'||c.finding==='unverified'?'uncertain':changed.has(p.id)?'pending_check':'open';
 const investigation=p.source==='visual'&&c.certainty==='suspected'&&!c.hasConfirmedFinding;
 const linked=linkedRequirements(run,p),optional=linked.length>0&&linked.every(r=>require('./quality-contract.cjs').optional(r));
 return {...p,status,blocking:!investigation&&!optional&&!['resolved','dismissed'].includes(status),optional,previouslyResolved:verified&&c.status!=='dismissed',requiresRecheck:verified&&!isFresh,forcedRecheck:!!record.requiresVerificationAfter,detectedRevision:c.revision,verifiedRevision:c.verifiedRevision,detectedAt:c.firstSeenAt||c.history?.[0]?.at||c.at,verifiedAt:c.verifiedAt,evidenceId:c.status==='dismissed'?c.sourceReview?.evidenceId:c.verifiedEvidenceId||c.verifiedEventId||c.evidenceId||c.eventId,reason:status==='dismissed'?(c.dismissalReason||c.reason):status==='pending_check'?'已有后续变更或旧证据失效，需核对当前版本；不代表已修复':status==='regressed'?'此前通过后再次发现，需重新修复并复验':c.reason,regressions:c.regressions||0,findingVersion:c.findingVersion,verifiedVersion:c.verifiedVersion};
 });}
async function refresh(workspace){const run=workspace.run,fresh=[],changed=[],proof=require('./evidence.cjs'),cache=new Map();
 const once=async(key,check)=>{if(!cache.has(key))cache.set(key,check());return cache.get(key);};
 for(const p of entries(run)){
  const c=p.raw,verified=['resolved','verified','dismissed'].includes(c.status);let valid=true,change;
  try{
   if(verified){
    if(c.status==='dismissed')await require('./source-review.cjs').assertFresh(workspace,c.sourceReview);
    else if(p.source==='issue')recordEvidence(run,await once(c.evidenceId,()=>proof.event(workspace,c.evidenceId)));
    else if(p.source==='region'&&c.verifiedEventId)recordEvidence(run,await once(c.verifiedEventId,()=>proof.event(workspace,c.verifiedEventId)));
    else await once(JSON.stringify([c.verifiedRevision,dependencies(c,true)]),()=>proof.assertFresh(workspace,{revision:c.verifiedRevision,sources:dependencies(c,true)}));
    const marker=run.problemState.records[p.id].requiresVerificationAfter;
    if(marker){const id=c.status==='dismissed'?c.sourceReview?.evidenceId:c.verifiedEvidenceId||c.verifiedEventId||c.evidenceId,receipt=await proof.lookup(workspace,id);if(!id||marker.existingEventIds.includes(id)||marker.previousEvidenceIds.includes(id)||!receipt||!receipt.at||receipt.at<marker.at)throw Error('候选恢复后需新事件复验，旧字节和旧验收不能自动关闭问题');delete run.problemState.records[p.id].requiresVerificationAfter;}
    fresh.push(p.id);
   }else if(dependencies(c).length)await once(JSON.stringify([c.revision,dependencies(c)]),()=>proof.assertFresh(workspace,{revision:c.revision,sources:dependencies(c)}));
   else if(Number.isSafeInteger(c.revision)&&c.revision!==run.revision){changed.push(p.id);valid=false;}
  }catch(error){if(error.code==='ERR_ASSERTION')throw error;valid=false;change=error.evidenceChange;if(!verified)changed.push(p.id);}
  run.problemState.records[p.id].validation={valid,at:new Date().toISOString(),...(change?{change}:{}),dependencies:dependencies(c,verified).map(s=>s.path)};
 }
 // Compatibility caches are always rebuilt from canonical evidence validation.
 run.problemFreshIds=fresh;run.problemChangedIds=changed;sync(run);
}
function invalidate(run,changedPaths,{transactionId,revision}={}){
 ensure(run);const changed=new Set(changedPaths||[]),invalidated=[];
 for(const record of Object.values(run.problemState.records)){
  const c=record.data;if(!['resolved','verified','dismissed'].includes(c.status))continue;
  const ids=[c.verifiedEvidenceId,c.verifiedEventId,c.evidenceId,c.sourceReview?.evidenceId].filter(Boolean);
  const refs=[...dependencies(c,true),...(c.sourceReview?.sources||[]),...ids.flatMap(id=>run.problemState.evidence[id]?.sources||(run.events||[]).find(e=>e.id===id)?.detail?.result?.sources||[])];
  if(!refs.length&&c.scope?.path)refs.push({path:c.scope.path});
  const affected=[...new Set(refs.map(s=>s.path).filter(p=>changed.has(p)))];if(!affected.length)continue;
  record.requiresVerificationAfter={transactionId,revision,at:new Date().toISOString(),changedPaths:affected,previousEvidenceIds:ids,existingEventIds:[...(run.events||[]).map(e=>e.id),...(run.observationIndex||[]).flatMap(o=>[o.id,o.eventId]).filter(Boolean)]};
  record.validation={valid:false,reason:'candidate_restore_requires_new_verification',at:new Date().toISOString(),dependencies:refs.map(s=>s.path)};invalidated.push(record.id);
 }
 run.problemFreshIds=(run.problemFreshIds||[]).filter(id=>!invalidated.includes(id));return invalidated;
}
function blocks(run,requirement){const optional=require('./quality-contract.cjs').optional(require('./requirements.cjs').current(run).find(r=>r.id===requirement.id));return rows(run).filter(p=>(p.blocking||optional&&p.optional&&p.status!=='uncertain'&&!['resolved','dismissed'].includes(p.status))&&(p.requirementIds?.length?p.requirementIds.includes(requirement.id):requirement.type==='visual'));}
module.exports={recordEvidence,invalidate,ensure,upsert,transition,replaceSource,clear,entries,rows,refresh,blocks,idFor,dependencies};

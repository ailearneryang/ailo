// Restoring familiar bytes is a new write, not a new verification. Invalidate
// affected proof before any write so a crash cannot revive historical passes.
function dependencies(check){return (check?.parts||[check]).flatMap(p=>[p?.path,p?.scope?.path,...(p?.sources||[]).map(s=>s.path),...(p?.buildInputs||[])]).filter(Boolean);}
function affected(requirement,check,changed){const paths=dependencies(check),scopes=[requirement?.scope?.path,...(requirement?.scopes||[]).map(s=>s.path)].filter(Boolean);if(paths.length||scopes.length)return [...paths,...scopes].some(p=>changed.has(p));return !!check;}
async function invalidate(workspace,changedPaths,receipt={}){
 const run=workspace.run,paths=[...new Set(changedPaths.map(p=>require('./workspace.cjs').normalizeProjectPath(p)))],changed=new Set(paths),requirements=require('./requirements.cjs').current(run),ids=[];
 for(const r of requirements)if(affected(r,run.acceptanceResults?.[r.id],changed))ids.push(r.id);
 const marker=run.candidateRecovery||{};Object.assign(marker,{version:1,transactionId:receipt.transactionId||marker.transactionId,candidateId:receipt.candidateId||marker.candidateId,requiresReverification:true,changedPaths:paths,affectedRequirementIds:[...new Set([...(marker.affectedRequirementIds||[]),...ids])],existingEventIds:[...new Set([...(marker.existingEventIds||[]),...(run.events||[]).map(e=>e.id),...(run.observationIndex||[]).flatMap(e=>[e.id,e.eventId])].filter(Boolean))],requiredAfter:marker.requiredAfter||new Date().toISOString()});run.candidateRecovery=marker;
 for(const id of ids)if(run.acceptanceResults)delete run.acceptanceResults[id];
 run.freshAcceptanceIds=(run.freshAcceptanceIds||[]).filter(id=>!ids.includes(id));
 for(const [file,check]of Object.entries(run.htmlDocumentChecks||{}))if(changed.has(file)||(check.sources||[]).some(s=>changed.has(s.path)))delete run.htmlDocumentChecks[file];
 run.pendingArtifactUpdates=[...new Set([...(run.pendingArtifactUpdates||[]),...(run.artifacts||[]).filter(a=>changed.has(a.path)).map(a=>a.path)])];
 require('./problem-state.cjs').invalidate(run,paths,{transactionId:marker.transactionId,revision:run.revision});
 await workspace.save();return {affectedRequirementIds:ids,changedPaths:paths};
}
module.exports={dependencies,affected,invalidate};

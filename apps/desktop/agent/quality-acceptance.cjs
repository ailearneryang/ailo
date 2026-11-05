// Shared completion accounting. Optional work is visible without changing a
// mandatory criterion or reporting an unverified option as passed.
const {hash}=require('./evidence.cjs');
function marker(run){const m=run.candidateRecovery;return m?.requiresReverification&&(!m.executionId||m.executionId===run.executionId)?m:undefined;}
function affected(run,criterion,check){
 const m=marker(run);if(!m)return false;
 if(m.affectedRequirementIds?.includes(criterion.id))return true;
 const parts=check?.parts|| (check?[check]:[]),sources=parts.flatMap(p=>p.sources||[]),paths=new Set(m.changedPaths||[]);
 if(sources.length)return sources.some(s=>paths.has(s.path));
 const ranges=[criterion.scope,...(criterion.scopes||[])].filter(Boolean);if(ranges.length)return ranges.some(s=>paths.has(s.path));
 // Without dependency coverage, a legacy proof cannot establish independence.
 return !!check||!!m.affectedRequirementIds?.includes(criterion.id);
}
const signature=check=>hash(JSON.stringify((check?.parts||[check]).map(p=>p&&({evidenceId:p.evidenceId,sources:p.sources,kind:p.kind,path:p.path,scope:p.scope,verifiedAt:p.verifiedAt}))));
function pending(run,criterion,check){
 const m=marker(run);if(!m||!affected(run,criterion,check))return false;
 const record=m.verifiedRequirements?.[criterion.id];return !record||record.transactionId!==m.transactionId||!check||record.proofHash!==signature(check);
}
async function assertNewEvidence(workspace,criterion,{evidenceId,sources}){
 const m=marker(workspace.run);if(!m||!affected(workspace.run,criterion,{sources}))return;
 if(!evidenceId)return; // The verify action itself performs a fresh file read.
 const receipt=await require('./evidence.cjs').event(workspace,evidenceId);
 if(!receipt.at||!m.requiredAfter||receipt.at<m.requiredAfter||(m.existingEventIds||[]).includes(receipt.id))throw Object.assign(Error('恢复候选版本后须取得新的实际观察或运行证据，不能重新提交旧事件沿用历史通过'),{code:'CANDIDATE_REVERIFICATION_REQUIRED'});
}
function verified(run,updates,eventId){
 const m=marker(run);if(!m)return;
 m.verifiedRequirements||={};
 for(const [id,check]of Object.entries(updates))m.verifiedRequirements[id]={transactionId:m.transactionId,verifiedAt:new Date().toISOString(),verificationEventId:eventId,evidenceIds:(check.parts||[check]).map(p=>p.evidenceId).filter(Boolean),proofHash:signature(check)};
 const all=require('./requirements.cjs').current(run),affectedIds=[...new Set([...(m.affectedRequirementIds||[]),...all.filter(r=>affected(run,r,run.acceptanceResults?.[r.id])).map(r=>r.id)])];
 m.affectedRequirementIds=affectedIds;m.pendingRequirementIds=affectedIds.filter(id=>!m.verifiedRequirements[id]||m.verifiedRequirements[id].transactionId!==m.transactionId);
 if(!m.pendingRequirementIds.length){m.requiresReverification=false;m.reverifiedAt=new Date().toISOString();}
}
function summary(run,criteria,{freshIds}={}){
 const knownFresh=new Set(freshIds||run.freshAcceptanceIds||[]),must=[],optional=[];
 for(const c of criteria)(require('./quality-contract.cjs').optional(c)?optional:must).push(c);
 const part=list=>({total:list.length,passed:list.filter(c=>c.check?.status==='passed'&&knownFresh.has(c.id)).length,pendingIds:list.filter(c=>c.check?.status!=='passed'||!knownFresh.has(c.id)).map(c=>c.id)});
 const result={must:part(must),optional:part(optional),optionalPending:optional.filter(c=>c.check?.status!=='passed'||!knownFresh.has(c.id)).map(({id,text,type})=>({id,text,type}))};return {...result,mandatoryComplete:result.must.total>0&&!result.must.pendingIds.length};
}
function notice(summary){return summary.optionalPending.length?`另有 ${summary.optionalPending.length} 项可选优化尚未完成或核验：${summary.optionalPending.slice(0,3).map(r=>r.text).join('；')}。`:'';}
module.exports={affected,pending,assertNewEvidence,verified,summary,notice};

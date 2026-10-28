const acceptance=require('./acceptance.cjs');
// Compatibility entrypoint for saved tasks; live and restored failures share one policy.
function internal(error){return typeof error?.code==='string'&&!!error.code&&require('./exit-policy.cjs').classify(error,{})==='internal';}
function unknown(run){return (run.actionJournal||[]).some(e=>['unknown','running'].includes(e.status)||e.status==='interrupted'&&!e.readOnly);}
function begin(run,error){
 if(unknown(run))return false;
 if(!run.resultRecovery||run.resultRecovery.executionId!==run.executionId)run.resultRecovery={version:1,executionId:run.executionId,stage:'remaining',turns:0,maxTurns:12,failures:[]};
 const state=run.resultRecovery;state.stage='remaining';
 state.failures.push({code:error.code||'TOOL_FAILURE',message:String(error.message||error).slice(0,1200)});
 state.failures=state.failures.slice(-8);
 return state;
}
function context(run){
 const state=run.resultRecovery;
 if(!state||state.stage!=='remaining')return;
 return {...state,instruction:'部分问题的恢复已耗尽。不要重复同一失败方法，继续完成不受影响的要求、修复可修复的问题、登记真实成果并核验。原要求、未通过检查与已知缺陷全部保留；不得改为可选或伪造通过。能满足全部要求则正常finish；已无其他可行工作时用blocked结束，运行时将整理已有成果与具体缺口。只有真正需要用户决定、必要信息或权限才clarify。'};
}
async function inventory(workspace,{signal}={}){
 signal?.throwIfAborted();
 const run=workspace.run;
 const {files,unavailable}=await require('./result-sources.cjs').files(workspace,{signal});
 const criteria=acceptance.criteria(run),passed=[],pending=[];
 for(const criterion of criteria){
  let fresh=false;
  if(criterion.check?.status==='passed')try{await require('./evidence.cjs').assertFresh(workspace,criterion.check);fresh=true;}catch{}
  (fresh?passed:pending).push({id:criterion.id,text:criterion.text});
 }
 return {files,unavailable,passed,pending,total:criteria.length};
}
async function settle(workspace,error,{signal,summarize}={}){
 signal?.throwIfAborted();
 const run=workspace.run;
 if(unknown(run))return null;
 const found=await inventory(workspace,{signal}),at=new Date().toISOString();
 signal?.throwIfAborted();
 const sources=await require('./result-sources.cjs').findings(workspace,{signal});
 let analysis=[];
 if(summarize&&sources.length){
  try{const value=await summarize({goal:run.goal||run.currentRequest,sources,pending:found.pending},signal);
   if(Array.isArray(value?.findings))analysis=value.findings.filter(f=>typeof f.text==='string'&&f.text.trim()&&f.text.length<=2000&&Array.isArray(f.sourceIds)&&f.sourceIds.length&&f.sourceIds.every(id=>sources.some(s=>s.id===id))).slice(0,8);
  }catch(error){signal?.throwIfAborted();if(error.code==='ERR_ASSERTION')throw error;}
 }
 if(!analysis.length)analysis=sources.map(s=>({text:s.text.slice(0,800),sourceIds:[s.id],excerpt:true}));
 signal?.throwIfAborted();
 const state=run.resultRecovery||{version:1,executionId:run.executionId,turns:0,failures:[]};
 run.resultRecovery={...state,stage:'settled',at};
 // This is explicitly NOT the finish path. Never mark steps/checks complete,
 // resolve issues, or turn missing implementations into accepted limitations.
 run.status=found.files.length||analysis.length?'partial':'blocked';run.currentOutcome='settled';
 run.delivery={outcome:found.files.length||analysis.length?'partial':'blocked',status:'settled',at,
  availableArtifacts:found.files,findings:analysis,unverified:found.pending.map(c=>c.id),unavailableArtifacts:found.unavailable,
  coverage:{passed:found.passed.length,total:found.total},reasonCode:error.code||'RECOVERY_EXHAUSTED'};
 run.completionReview={summary:'已结束本轮尝试并整理当前成果；未满足或未核验的要求继续保留，不计完整完成。',issues:(run.issues||[]).filter(i=>i.status!=='resolved').map(i=>i.id),unverified:found.pending.map(c=>c.id),revision:run.revision,at};
 run.taskContinuation={...run.taskContinuation,version:1,state:'settled',taskOpen:false,at,code:error.code||'RECOVERY_EXHAUSTED',question:'',gap:String(error.message||error).slice(0,1200),retained:{requirements:found.total,pendingIds:found.pending.map(c=>c.id),steps:run.steps.length,artifacts:run.artifacts.map(({path,label})=>({path,label})),unknownActions:0,revision:run.revision}};
 const lines=[found.files.length?`已整理 ${found.files.length} 项当前成果，可直接查看；原任务尚未全部完成。`:analysis.length?'已整理已有材料中的阶段性结果；原任务尚未全部完成。':'本轮尝试已结束，尚未形成可交付成果。'];
 if(analysis.length)lines.push('\n'+(analysis.every(f=>f.excerpt)?'已取得的材料与操作结果摘录（不代表最终结论）：':'阶段性分析（尚未完成全部核验）：'),...analysis.map(f=>'- '+f.text+'〔来源：'+f.sourceIds.map(id=>{const s=sources.find(s=>s.id===id);return s?.path||s?.label||'本轮操作记录';}).join('、')+'〕'));
 if(found.files.length)lines.push('\n已有成果：',...found.files.slice(0,24).map(f=>`- ${f.label||f.path}（${f.path}）`));
 if(found.files.length>24)lines.push(`其余 ${found.files.length-24} 项成果已保留，可在成果区查看全部文件。`);
 if(found.total)lines.push(`\n原要求检查：${found.passed.length}/${found.total} 项有当前有效的通过证据。`);
 if(found.pending.length)lines.push('尚未完成或未核验：',...found.pending.map(c=>'- '+c.text));
 const open=(run.issues||[]).filter(i=>i.status!=='resolved');
 if(open.length)lines.push('\n已知问题：',...open.map(i=>'- '+i.description));
 if(found.unavailable.length)lines.push('\n以下文件缺失、为空或无法核对，未作为本次可交付成果：',...found.unavailable.map(p=>'- '+p));
 lines.push('\n本轮未能解决的问题：'+String(error.message||error).slice(0,1200));
 lines.push('已有要求、文件和证据已保留。需要时可在原任务继续。');
 run.delivery.summary=lines.join('\n');
 await workspace.event('result_settled',{code:error.code||'RECOVERY_EXHAUSTED',availableArtifacts:found.files.map(f=>f.path),unverified:found.pending.map(c=>c.id),coverage:run.delivery.coverage});
 return {content:lines.join('\n')};
}
module.exports={internal,unknown,begin,context,inventory,settle};

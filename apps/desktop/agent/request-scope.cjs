// A new user goal is separate from historical quality debt. This classifier is
// deliberately conservative: amendments and ambiguous references keep the work.
const {createHash}=require('node:crypto');
const schema={type:'object',additionalProperties:false,required:['inputId','parentExecutionId','relation','sourceQuote','reason'],properties:{inputId:{type:'string',minLength:1,maxLength:160},parentExecutionId:{type:'string',minLength:1,maxLength:160},relation:{type:'string',enum:['independent','amendment']},sourceQuote:{type:'string',minLength:1,maxLength:1000},reason:{type:'string',minLength:1,maxLength:800}}};
const fingerprint=rows=>createHash('sha256').update(JSON.stringify((rows||[]).map(({id,text,type,scope,scopes})=>({id,text,type,scope,scopes})).sort((a,b)=>String(a.id).localeCompare(String(b.id))))).digest('hex');
const currentId=input=>require('./execution-rounds.cjs').inputKey(input);
const unknown=run=>require('./result-settlement.cjs').unknown(run);
function replacementGoal(text){
 const pivot=/(?:改做|转做|换做|另做|改为|改成|转为|换成|开始(?:一个)?新任务)/.exec(text);
 if(!pivot)return false;
 const before=text.slice(0,pivot.index),after=text.slice(pivot.index+pivot[0].length).trim();
 if(!after)return false;
 const cancel=/(?:不要|不用|别|不再|停止|取消|结束|暂不|先不|先停|先放下)(?:再|继续)?\s*([^，。；;\n]+)/g;
 let cancelled=false;
 for(const match of before.matchAll(cancel)){
  const target=match[1].trim().replace(/(?:了|吧|即可|就行)\s*$/,'');
  const wholeGoal=/^(?:(?:之前|原来|原先|上一个|当前|这个|旧|原)(?:的)?).{0,24}(?:任务|目标|项目|需求)$/.test(target)||/^(?:任务|目标|项目|需求)$/.test(target);
  const method=/^(?:(?:重复|反复|重新|再次|多次|继续|先)\s*)*(?:读取|阅读|查看|回看|重试|截图|构建|安装|运行|核验|验证|检查|比对|比较|调用|等待|分析(?:日志|错误|截图|堆栈|源码))/.test(target);
  const business=/^(?:开发|制作|实现|修(?:复)?|编写|写|生成|撰写|设计|整理|总结|翻译|迁移|部署|分析)/.test(target);
  if((wholeGoal||business)&&!method)cancelled=true;
 }
 // Also accept a goal named before its withdrawal, e.g. "原来的项目先不做了".
 cancelled ||= /(?:原来|之前|原先|当前|这个|旧).{0,24}(?:任务|目标|项目|需求|界面|应用|报告).{0,8}(?:先不做|不再做|暂停|取消|停止|先放下)/.test(before);
 // Replacing a repair action with another diagnostic is an amendment, not a
 // new task. A genuinely new goal must not be inferred from a tool-method pivot.
 const nextMethod=/^(?:(?:先|只|仅|重新|再次|帮我|请)\s*)*(?:读取|阅读|查看|回看|重试|截图|构建|安装|运行|核验|验证|检查|比对|比较|调用|等待)/.test(after);
 return cancelled&&!nextMethod;
}
function relation(run,input){
 const text=String(input?.content||'').trim(),continuation=require('./input-turn.cjs').continuationOnly(text)&&!input?.materials?.length;
 if(continuation)return {kind:'continuation',reason:'explicit_continue_preserves_execution_and_budgets'};
 const unresolved=unknown(run);
 const replaced=replacementGoal(text);
 const explicit=/^(?:新任务[：:]|另一个任务[：:]|另起(?:一个)?任务|开始一个新任务)/.test(text)||replaced;
 const related=/保留原|继续|原任务|上述|这个|(?:当前|现有)(?:任务|目标|项目)|修复|修正|调整|优化|补充|增加|更新|改为|按.*(?:稿|附件)/.test(text);
 // This compatibility inference uses deliverable contracts, not business names,
 // filenames or artifact extensions. Ambiguous same-family goals are resolved
 // by the existing route call's source-backed taskChange proposal below.
 const describe=require('./request-contract.cjs').describe,prior=run.requestContract?.kind||describe(run.goal||'').kind,next=describe(text);
 const family=kind=>['design','application'].includes(kind)?'application':kind==='document'?'document':null;
 const differentContract=next.newGoal&&!!family(prior)&&!!family(next.kind)&&family(prior)!==family(next.kind);
 const settled=run.delivery?.status==='settled'||['completed','idle'].includes(run.status);
 const independent=!unresolved&&(explicit||settled&&differentContract&&!related&&!input?.materials?.length);
 return {kind:independent?'independent':'amendment',reason:unresolved?'unknown_effects_preserve_original_scope':independent?(explicit?(replaced?'explicit_goal_replacement':'explicit_new_goal'):'settled_request_to_independent_deliverable_contract'):'current_goal_amendment_or_relationship_not_proven'};
}
function archive(run){return structuredClone(Object.fromEntries(['executionRecovery','executionId','inputKey','inputCoverage','goal','status','requirements','requirementsManaged','acceptance','acceptanceTypes','acceptanceResults','steps','issues','problemState','visualQuality','designRegionIssues','designRegionReviews','designRegionChecks','visualObservations','visualComparisons','artifacts','resultPreview','pendingArtifactUpdates','resultRecovery','repairValue','requestScope','requestContract','taskChangeAdoptions','executionState','delivery','completionReview','actionJournal','decisionRecovery','failureEpisodes','readAttempts','readReceipts','workingMemory','progressEvidence','runtimeContinuation','androidDesignSourceBaseline','materialInput'].filter(k=>run[k]!==undefined).map(k=>[k,run[k]])));}
function suspendRecovery(run,nextInput){
 if(!nextInput||require('./input-turn.cjs').continuationOnly(nextInput.content)&&!nextInput.materials?.length)return;
 const inputId=currentId(nextInput);if(!run.inputKey||inputId===run.inputKey||run.pendingTaskChange?.inputId===inputId)return;
 // Receiving a message is not proof that new requirements were adopted. The
 // controller may temporarily defer old limits, but these objects stay intact.
 if(run.resultRecovery||run.repairValue)run.inputRecoveryHistory=[...(run.inputRecoveryHistory||[]),{inputId:run.inputKey,resultRecovery:structuredClone(run.resultRecovery),repairValue:structuredClone(run.repairValue),at:new Date().toISOString(),reason:'new_user_input_requires_reinterpretation'}].slice(-24);
 run.pendingTaskChange={inputId,executionId:run.executionId,parentInputId:run.inputKey,requirementsFingerprint:fingerprint(require('./requirements.cjs').current(run)),at:new Date().toISOString()};
}
function pending(run){return !!run.pendingTaskChange&&run.pendingTaskChange.inputId===run.inputKey&&run.pendingTaskChange.executionId===run.executionId&&!unknown(run);}
function failure(message){return Object.assign(Error('任务变更提案无效：'+message+'；保留原任务、要求与证据，仅修正本次理解。'),{code:'TASK_CHANGE_INVALID'});}
function validate(run,task,proposal){
 if(!proposal||typeof proposal!=='object'||Array.isArray(proposal)||Object.keys(proposal).some(k=>!Object.hasOwn(schema.properties,k)))throw failure('字段不符合taskChange契约');
 for(const key of ['inputId','parentExecutionId','sourceQuote','reason'])if(typeof proposal[key]!=='string'||!proposal[key].trim()||proposal[key].length>schema.properties[key].maxLength)throw failure(key+'必须是当前来源的有界字符串');
 if(!['independent','amendment'].includes(proposal.relation))throw failure('relation仅允许independent/amendment');
 const input=(task.messages||[]).findLast(m=>m.role==='user'&&currentId(m)===run.inputKey);
 if(!input||proposal.inputId!==run.inputKey)throw failure('inputId不属于当前用户输入；当前inputId='+run.inputKey+'，parentExecutionId='+(run.requestScope?.inputId===run.inputKey?run.requestScope.parentExecutionId||run.executionId:run.executionId));
 const parent=run.requestScope?.inputId===run.inputKey?run.requestScope.parentExecutionId||run.executionId:run.executionId;
 if(proposal.parentExecutionId!==parent)throw failure('parentExecutionId与当前任务来源不一致');
 const directive=String(input.content||'').replace(/```[\s\S]*?```/g,'').split('\n').filter(line=>!/^\s*>/.test(line)).join('\n');
 if(!directive.includes(proposal.sourceQuote)||!proposal.sourceQuote.trim())throw failure('sourceQuote必须逐字引用当前用户指令，不能引用历史、代码块或引用资料中的目标');
 const continuing=require('./input-turn.cjs').continuationOnly(input.content)&&!input.materials?.length;
 if(proposal.relation==='independent'&&(unknown(run)||continuing))throw failure(continuing?'纯继续不能变成新任务':'尚有结果未知的外部操作，先核对实际结果');
 const text=String(input.content||'').trim(),explicit=/^(?:新任务[：:]|另一个任务[：:]|另起(?:一个)?任务|开始一个新任务)/.test(text)||replacementGoal(text);
 const controls=/保留原|继续原|上述|这个(?:任务|目标|项目|应用|页面|网站|界面|报告)|(?:当前|现有)(?:任务|目标|项目)|仍(?:按|然|需|要)|^(?:(?:请|帮我)\s*)*(?:修复|修改|修正|调整|补充|增加|更新|删除|替换)/.test(text);
 const changeOnly=!require('./request-contract.cjs').describe(text).newGoal&&/(?:改成|改为|缩短|改小|改大|移到|换成)/.test(text);
 if(proposal.relation==='independent'&&!explicit&&(controls||changeOnly))throw failure('当前原文是沿用或调整原任务的控制指令，不能声明独立目标以移除原验收');
 return {kind:continuing?'continuation':proposal.relation,reason:'source_backed_task_change',source:{inputId:proposal.inputId,parentExecutionId:proposal.parentExecutionId,quote:proposal.sourceQuote,reason:proposal.reason}};
}
function adopt(run,task,proposal,snapshot){
 const resolved=validate(run,task,proposal),before=run.executionId;
 if(run.requestScope?.kind==='independent'&&resolved.kind!=='independent')throw failure('已由明确用户目标建立独立范围，不能重新挂回历史未完成任务');
 if(resolved.kind==='independent'&&run.requestScope?.kind!=='independent')require('./execution-rounds.cjs').beginRound(run,task,snapshot,{relationOverride:resolved,forceCurrentInput:true});
 else run.requestScope={...run.requestScope,...resolved,inputId:run.inputKey,executionId:run.executionId};
 return {changedExecution:before!==run.executionId,relation:run.requestScope};
}
function adoptPlan(run,action){
 if(!pending(run)||action?.action!=='plan'||run.acceptanceInputKey!==run.inputKey)return;
 const p=run.pendingTaskChange,requirements=require('./requirements.cjs').current(run),changedRequirements=p.requirementsFingerprint!==fingerprint(requirements),m=run.materialInput;
 const adoptedMaterial=m?.inputId===run.inputKey&&m.status==='adopted'&&m.uses?.some(u=>u.role!=='irrelevant'&&u.requirementIds?.length);
 const receipt={version:1,inputId:run.inputKey,executionId:run.executionId,sourceInputId:p.inputId,changedRequirements,adoptedMaterial:!!adoptedMaterial,opensRepairWindow:changedRequirements||!!adoptedMaterial,at:new Date().toISOString()};
 run.taskChangeAdoptions=[...(run.taskChangeAdoptions||[]),receipt].slice(-12);delete run.pendingTaskChange;return receipt;
}
function adoptReply(run,action){
 if(!pending(run)||run.currentIntent!=='chat'||action?.action!=='reply'||typeof action.text!=='string'||!action.text.trim())return;
 const receipt={version:1,inputId:run.inputKey,executionId:run.executionId,sourceInputId:run.pendingTaskChange.inputId,resolution:'answered',changedRequirements:false,adoptedMaterial:false,opensRepairWindow:false,at:new Date().toISOString()};
 run.taskChangeAdoptions=[...(run.taskChangeAdoptions||[]),receipt].slice(-12);delete run.pendingTaskChange;return receipt;
}
module.exports={schema,relation,archive,suspendRecovery,pending,validate,adopt,adoptPlan,adoptReply,fingerprint};

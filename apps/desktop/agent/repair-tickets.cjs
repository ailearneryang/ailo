// A bounded working set turns a defect observation into an executable repair.
// Hypotheses stay unproven; only real tool receipts advance the work stage.
function pathFor(problem){
 const c=problem.raw;let path=c.scope?.path||c.layout;
 try{path||=JSON.parse(c.scopeKey||'null')?.[0];}catch{}
 return path;
}
function changedPaths(event){
 if(['write_file','edit_file'].includes(event.type)&&event.detail?.result?.changed!==false)return [event.detail.path];
 if(event.type==='run_command'&&event.detail?.result?.exitCode===0)return (event.detail.result.fileChanges||[]).filter(f=>f.after&&f.before!==f.after).map(f=>f.path);
 return [];
}
// Advisory scheduling only. Legacy defects often link every visual criterion;
// those broad links must not make an old icon outrank explicit background work.
// Text overlap never changes requirements, permissions or acceptance results.
function terms(value){const text=String(value||'').toLowerCase();return new Set([...(text.match(/[a-z][a-z0-9_]{2,}/g)||[]),...[...text.matchAll(/[\p{Script=Han}]{2,}/gu)].flatMap(m=>Array.from({length:m[0].length-1},(_,i)=>m[0].slice(i,i+2)))]);}
function context(run,{limit=2}={}){
 const problems=require('./problem-state.cjs'),rows=new Map(problems.rows(run).map(p=>[p.id,p]));
 const active=problems.entries(run).filter(p=>!['resolved','dismissed'].includes(rows.get(p.id)?.status));
 const requirements=require('./requirements.cjs').current(run),ranked=new Map();
 // Followups keep the original backlog, but that backlog must not take over
 // the newly adopted work. Use explicit input/requirement links, not keywords.
 const inputs=(run.inputCoverage?.entries||[]).filter(e=>e.status==='planned');
 const currentInputs=inputs.filter(e=>e.inputId===run.inputKey||e.inputId===run.requestContract?.sourceMessageId);
 const focusInputs=currentInputs.length?currentInputs:inputs.slice(-1);
 const focusedRequirements=new Set(focusInputs.flatMap(e=>e.requirementIds||[]));
 const focusTerms=terms(focusInputs.map(e=>e.text||'').join(' '));
 const currentWork=focusInputs.length?{inputIds:focusInputs.map(e=>e.inputId),request:focusInputs.map(e=>e.text).join(' '),requirements:requirements.filter(r=>focusedRequirements.has(r.id)).map(({id,text,type,scope,scopes})=>({id,text,type,scope,scopes})),instruction:'优先完成本次已采用的要求及其复验；历史工单保留，但不能以覆盖多个旧要求为由替代当前工作。'}:undefined;
 for(const p of active){
  const row=rows.get(p.id),path=pathFor(p),linked=p.requirementIds?.length?requirements.filter(r=>p.requirementIds.includes(r.id)):requirements.filter(r=>r.type==='visual');
  const must=linked.filter(r=>!require('./quality-contract.cjs').optional(r)),dependencies=(p.raw.dependsOn||[]).filter(id=>rows.has(id)),pendingDependencies=dependencies.filter(id=>!['resolved','dismissed'].includes(rows.get(id).status));
  const references=new Set([p.raw.evidenceId,p.raw.eventId,p.raw.verifiedEventId,p.raw.verifiedEvidenceId].filter(Boolean));
  const actualEvents=(run.events||[]).filter(e=>references.has(e.id)||path&&changedPaths(e).includes(path));
  const timed=actualEvents.filter(e=>Number.isFinite(e.detail?.durationMs)&&e.detail.durationMs>=0);
  const descriptionTerms=terms(p.description),inputOverlap=[...descriptionTerms].filter(t=>focusTerms.has(t)).length;
  ranked.set(p.id,{dependencyIds:dependencies,pendingDependencyIds:pendingDependencies,ready:!pendingDependencies.length,currentInput:!!p.requirementIds?.some(id=>focusedRequirements.has(id))&&(p.requirementIds.every(id=>focusedRequirements.has(id))||inputOverlap>0),inputOverlap,
   benefit:{requiredIds:must.map(r=>r.id),count:must.length,regression:row.status==='regressed',basis:'current_linked_mandatory_requirements'},
   cost:{basis:'observed_tool_receipts_only',elapsedMs:timed.reduce((n,e)=>n+e.detail.durationMs,0),timedEventIds:timed.map(e=>e.id),eventCount:actualEvents.length,estimateMs:null,attribution:'events touching the same source may be shared by multiple repairs'},
   reasons:[pendingDependencies.length?'先处理依赖问题：'+pendingDependencies.join('、'):'当前无未解决的显式前置问题',row.status==='regressed'?'优先防止已通过能力回退':row.blocking?'阻止对应必须要求通过':'非阻塞调查或可选润色',must.length?'覆盖 '+must.length+' 条原必须要求':'不新增必须要求',timed.length?'成本仅来自 '+timed.length+' 次有计时的真实工具回执':'暂无可比较的真实耗时，不虚构成本预测']});
 }
 const priority=p=>{const row=rows.get(p.id);return row.status==='regressed'?0:row.blocking&&row.status==='open'?1:row.blocking?2:3;};
 active.sort((a,b)=>{
  const x=ranked.get(a.id),y=ranked.get(b.id);
  return Number(y.ready)-Number(x.ready)||Number(y.currentInput)-Number(x.currentInput)||(x.currentInput&&y.currentInput?y.inputOverlap-x.inputOverlap:0)||priority(a)-priority(b)||y.benefit.count-x.benefit.count||
   // Cost breaks equal-benefit ties only when both have actual timed samples.
   (x.cost.timedEventIds.length&&y.cost.timedEventIds.length?x.cost.elapsedMs-y.cost.elapsedMs:0)||
   String(a.raw.firstSeenAt||a.raw.at||'').localeCompare(String(b.raw.firstSeenAt||b.raw.at||''))||a.id.localeCompare(b.id);
 });
 const known=new Set(run.inputTurn?.eventIds||[]),events=(run.events||[]).filter(e=>!known.has(e.id));
 const scheduled=currentWork?active.filter(p=>ranked.get(p.id).currentInput):active;
 const tickets=scheduled.slice(0,Math.max(1,Math.min(2,limit))).map(problem=>{
  const c=problem.raw,row=rows.get(problem.id),path=pathFor(problem),html=/\.html?$/i.test(path||'');
  const dependencies=new Set([path,...(html?[...(c.findingSources||[]),...(c.sources||[])].map(s=>s.path):[])]);
  const edit=path&&events.findLast(e=>changedPaths(e).some(p=>dependencies.has(p)));
  const android=!html&&(/^app\/src\/main\//.test(path||'')||/(?:^|\/)AndroidManifest\.xml$/.test(path||'')||(run.artifacts||[]).some(a=>/\.apk$/i.test(a.path))||(run.events||[]).some(e=>e.type==='build_android')||!!c.findingVersion?.apk);
  const build=android?events.findLast(e=>e.type==='build_android'&&e.detail?.result?.exitCode===0&&(!edit||(e.detail.revision??-1)>=(edit.detail.revision??0))):undefined;
  const apk=(build?.detail.result.buildArtifacts||[]).find(a=>/\.apk$/i.test(a.path));
  const shot=apk&&events.findLast(e=>e.type==='android_device'&&e.detail?.operation==='screenshot'&&e.detail.result?.apkSha256===apk.sha256&&e.detail.result?.pixelSize);
  const page=html&&(run.events||[]).findLast(e=>e.type==='browser'&&e.detail?.result?.path===path);
  const pageResult=page?.detail?.result,artifact=html&&(run.artifacts||[]).find(a=>a.path===path);
  const afterEdit=!edit||(run.events||[]).indexOf(page)>(run.events||[]).indexOf(edit);
  const pageSources=pageResult?.sources||[];
  const expected=edit?changedPaths(edit).filter(p=>dependencies.has(p)).map(p=>({path:p,sha256:['write_file','edit_file'].includes(edit.type)?edit.detail.result?.sha256:edit.detail.result?.fileChanges?.find(f=>f.path===p)?.after})):[];
  const browser=page&&afterEdit&&pageResult?.dom&&!pageResult.errors?.length&&!pageResult.dom?.missingImages?.length&&pageResult.scope?.kind==='viewport'&&pageResult.dom.layoutHealth?.scope==='document'&&pageSources.some(s=>s.path===path&&(!artifact||s.sha256===artifact.sha256))&&expected.every(s=>s.sha256&&pageSources.some(p=>p.path===s.path&&p.sha256===s.sha256))?page:undefined;
  const investigation=row.status==='uncertain'&&!row.blocking;
  const stage=investigation?'investigate':html?(browser?'verify':'run'):row.status==='pending_check'&&!edit?'verify':android?(edit&&!build?'build':build&&!shot?'run':shot?'verify':'locate'):edit?'run':'locate';
  const linked=problem.requirementIds?.length?requirements.filter(r=>problem.requirementIds.includes(r.id)):requirements.filter(r=>r.type==='visual');
  return {id:problem.id,source:problem.source,recordId:problem.source==='issue'?problem.id.slice(6):problem.id,stage,blocking:row.blocking,schedule:ranked.get(problem.id),
   finding:{description:problem.description,certainty:investigation?'suspected':'confirmed',evidenceId:c.evidenceId||c.eventId,revision:c.revision},
   target:{path,regionId:c.regionId,targetId:c.targetId,facet:c.facet,reference:c.reference},
   requirements:linked.map(({id,text,type,scope,scopes})=>({id,text,type,scope,scopes})),
   hypothesis:{status:'unproven',instruction:investigation?'先用真实来源、控件树或交互确认观察，不把未见当不存在；未确认前不修改正确实现。':'先定位该组件对应源码与实际资源引用，提出可由工具证据确认的原因，再作最小修改。'},
   implementation:{platform:html?'web':android?'android':'document',editEvidenceId:edit?.id,buildEvidenceId:build?.id,apkPath:apk?.path,apkSha256:apk?.sha256,screenshotEvidenceId:shot?.id,browserEvidenceId:browser?.id},
   expectedResult:investigation?'确认该观察是否违反当前用户要求；不成立时保留有来源的撤销依据。':'对应差异在当前交付版本消失，同时保留同区已满足的内容和原要求。',
   verification:{kind:investigation?'source_or_interaction':problem.source==='region'?'fresh_region_review':problem.source==='visual'?'fresh_paired_image':'original_requirement',instruction:row.previouslyResolved?'历史修复事实保留；当前版本证据过期时先复验，不能仅因旧证据过期再改一次源码。':html?'HTML修改后先取得当前源码的真实浏览器运行回执，再按原视觉或行为要求复验；不需要Android构建，运行回执本身不代表视觉已通过。':android?'改动须进入当前构建和运行产物，再用对应真实证据复验；同图改口、解释原因、写入文件均不能关闭已确认缺陷。':'按成果格式生成并运行或渲染当前版本，再用对应真实证据复验；文件写入不代表缺陷关闭。'},
   priorRepair:row.previouslyResolved?{verifiedRevision:c.verifiedRevision,verifiedEvidenceId:c.verifiedEvidenceId||c.verifiedEventId,verifiedAt:c.verifiedAt}:undefined};
 });
 const decision={at:new Date().toISOString(),selectedIds:tickets.map(t=>t.id),ranking:active.map(p=>({id:p.id,...ranked.get(p.id)}))};
 const state=problems.ensure(run),signature=JSON.stringify(decision.ranking);if(state.lastScheduleSignature!==signature){state.lastScheduleSignature=signature;state.scheduleHistory=[...(state.scheduleHistory||[]),decision].slice(-24);}
 return {currentWork,active:tickets,backlogCount:Math.max(0,active.length-tickets.length),instruction:(currentWork?'先推进currentWork的本次要求；active为空表示没有准确关联的历史工单，仍须实现并验证本次要求，不是停止工作。':'')+'同时只推进active中的至多两项，先完成定位→最小修改→按成果格式作必要构建或渲染→运行→对应复验。其他历史项保留在backlog，不因新描述继续扩充在制工作。调查项不是新增硬性验收条件；用户原要求和确认缺陷继续按真实证据验收。'};
}
module.exports={context,pathFor,changedPaths};

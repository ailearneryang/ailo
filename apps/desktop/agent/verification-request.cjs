// Validate request fields before examining artifacts or revoking any proof.
// Never guess an ID from wording/index, discard duplicate evidence, or infer a pass.
const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]))):value;
const safeId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,40}$/.test(value)?value:undefined;
const nonempty={type:'string',minLength:1,pattern:'\\S'};
const kinds=['command','file_exists','text_contains','json_valid','visual','observation','operation'];
const schema={type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,required:['criterionId','kind','reason'],properties:{criterionId:{type:'string'},kind:{type:'string',enum:kinds},reason:{...nonempty,maxLength:800,description:'说明此证据如何覆盖该验收要求及范围，建议20–120字符。'},path:nonempty,contains:{type:'array',minItems:1,maxItems:24,items:{type:'string',minLength:1,maxLength:800}},evidenceId:nonempty,scope:require('./evidence.cjs').scopeSchema,regions:require('./design-regions.cjs').schema}}};
function valueInfo(value){return {receivedType:value===null?'null':Array.isArray(value)?'array':typeof value,...(typeof value==='string'?{receivedLength:value.length,trimmedLength:value.trim().length}:{})};}
function hint(d){
 if(d.issue==='paired_evidence_selection')return '所选 evidenceId 是未配对预览；逐字复制 verificationEvidence.visual.paired 中匹配当前图像、APK、原稿及范围的 eventId，不要重复看图或将预览升级为验收通过。'+(d.candidateIds?.length?' 已记录候选：'+d.candidateIds.join('、')+'。':'');
 if(d.issue==='native_binding_required')return 'operation仅用于原要求明确绑定的native文件过程。先按nativeFileOperations的真实读取回执/原actionId补plan.requirements.evidenceBinding，保留原ID、文字、type和scope；不能自动把历史读取转为当前状态或业务成功。';
 if(d.issue==='native_operation_selection')return `verify.checks 第${d.index||1}条引用的是native文件回执，不是浏览器/设备运行观察。`+(d.nativeCandidate&&d.criterionType!=='visual'?' nativeFileOperations已给出有界真实链候选；仅在原用户明确要求纯文件过程时，回查before/after完整read_file归档，以原actionId核对write_file，先plan只补evidenceBinding(kind=operation)，保持原ID/text/type/scope，再用对应phase的operation核验。候选不代表通过。':' read_file不能证明一般业务功能或视觉；按原要求选择当前内容检查或真实运行证据，不为文件读取强行调用浏览器。');
 if(d.issue==='evidence_kind')return '所选证据类型不适合本项检查；行为观察须用真实 browser/android_device 操作事件，图片只用于视觉核对。按 verificationEvidence.byKind 选择覆盖原要求的事件，不改变原要求或自动猜测证据。';
 if(d.issue==='invalid_reason')return `verify.checks 第${d.index}条 reason ${Number.isInteger(d.receivedLength)?'收到 '+d.receivedLength+' 字符（去除首尾空白后 '+d.trimmedLength+' 字符）':'收到类型 '+d.receivedType}，必须为1–800字符的非空说明。建议20–120字符，写清用哪项真实证据核对哪条要求及范围；不要粘贴完整日志或源码。保留 criterionId、kind、证据与范围，仅修正 reason，不机械补字或编造执行结果。`;
 if(d.issue==='invalid_kind')return `verify.checks 第${d.index}条 kind 无效；必须为 ${kinds.join(' / ')}，按原验收类型选择，不降低要求。`;
 if(d.issue==='missing_path'||d.issue==='missing_evidence')return `verify.checks 第${d.index}条 ${d.checkField} 必须为非空字符串；文件检查填写真实项目内相对路径，command/visual/observation 填写已记录的 evidenceId；operation仅使用原要求显式绑定phase对应的完整native回执或原actionId，不编造证据。`;
 if(d.issue==='invalid_contains')return `verify.checks 第${d.index}条 contains 必须为1–24个非空字符串，每项最多800字符；填写原要求中需核对的实际文本，不降低验收要求。`;
 if(d.issue==='invalid_scope')return `verify.checks 第${d.index}条 scope 格式无效；保留原验收范围，使用合法项目相对路径及观察范围，不把请求格式问题当成果缺陷。`;
 if(d.issue==='invalid_regions')return `verify.checks 第${d.index}条 regions${d.regionIndex?' 第'+d.regionIndex+'个区域':''}格式无效；逐字复制原稿区域与重复组ID，填写合法 status、非空 reason、nodeIds 和计数，不修改成果来迎合参数。`;
 if(d.issue==='checks_count')return 'verify.checks 必须包含1–12条检查；每条 criterionId 逐字复制当前 acceptanceCriteria.id。';
 if(d.issue==='duplicate_check')return `verify.checks 第${d.index}条与第${d.duplicateOf}条重复使用同一验收项及证据。请合并该证据的检查内容；同一 criterionId 可提交不同证据或范围，不得按 ID 删除其他必要检查。`;
 return `verify.checks 第${d.index}条 criterionId ${d.receivedId?'“'+d.receivedId+'”':'缺失或类型/格式无效'}${d.issue==='unknown_id'?'不在当前 acceptanceCriteria 中':''}。${d.allowedIds?'当前可用 ID：'+d.allowedIds.join('、')+'。':''}请逐字复制 acceptanceCriteria.id，保留原要求、验证类型、范围与证据，不要用序号、验收文字、步骤ID或自行编造ID。`;
}
function validate(action,criteria,resolveEvidenceId=id=>id,nativeNavigation){
 const allowedIds=Array.isArray(criteria)?criteria.map(c=>c.id):undefined;
 function fail(detail){const diagnostics={field:'checks',expected:'verification_checks',...detail};throw Object.assign(Error(hint(diagnostics)),{code:'VERIFY_REQUEST_INVALID',diagnostics});}
 if(!Array.isArray(action.checks)||!action.checks.length||action.checks.length>12)fail({issue:'checks_count'});
 const checks=action.checks.map(check=>require('./evidence-binding.cjs').select(check,criteria?.find(c=>c.id===check?.criterionId)));
 const seen=new Map();
 for(const [i,check] of checks.entries()){
  const id=check&&typeof check==='object'&&!Array.isArray(check)?safeId(check.criterionId):undefined;
  if(!id||allowedIds&&!allowedIds.includes(id))fail({issue:id?'unknown_id':'invalid_id',index:i+1,...(id?{receivedId:id}:{}),...(allowedIds?{allowedIds}:{} )});
  const key=JSON.stringify(stable([id,check.kind,check.path,check.evidenceId?resolveEvidenceId(check.evidenceId):undefined,check.scope,check.contains]));
  if(seen.has(key))fail({issue:'duplicate_check',index:i+1,duplicateOf:seen.get(key),receivedId:id});
  seen.set(key,i+1);
 }
 // Validate the whole request before the first file/evidence check, including
 // later rows. A bad description must not invalidate an existing artifact pass.
 for(const [i,check] of checks.entries()){
  const invalid=(issue,checkField)=>fail({issue,index:i+1,checkField,...valueInfo(check[checkField])});
  if(typeof check.reason!=='string'||!check.reason.trim()||check.reason.length>schema.items.properties.reason.maxLength)invalid('invalid_reason','reason');
  if(!kinds.includes(check.kind))invalid('invalid_kind','kind');
  if(check.kind==='operation'&&Array.isArray(criteria)&&criteria.find(c=>c.id===check.criterionId)?.evidenceBinding?.kind!=='operation')fail({issue:'native_binding_required',index:i+1,checkField:'kind'});
  if(['observation','command','visual'].includes(check.kind)&&nativeNavigation){
   const target=check.evidenceId&&resolveEvidenceId(check.evidenceId),candidate=(nativeNavigation.writes||[]).find(w=>[w.actionId,...(w.reads||[]).flatMap(r=>[r.observationId,r.eventId])].some(id=>id===check.evidenceId||id===target));
   if(candidate)fail({issue:'native_operation_selection',index:i+1,checkField:'kind',nativeCandidate:true,criterionType:criteria?.find(c=>c.id===check.criterionId)?.type});
  }
  if(['file_exists','text_contains','json_valid'].includes(check.kind)&&(typeof check.path!=='string'||!check.path.trim()))invalid('missing_path','path');
  if(['command','visual','observation','operation'].includes(check.kind)&&(typeof check.evidenceId!=='string'||!check.evidenceId.trim()))invalid('missing_evidence','evidenceId');
  if(check.kind==='text_contains'&&(!Array.isArray(check.contains)||!check.contains.length||check.contains.length>24||check.contains.some(s=>typeof s!=='string'||!s||s.length>800)))invalid('invalid_contains','contains');
  if(check.scope!==undefined)try{require('./evidence.cjs').scope(check.scope);}catch{invalid('invalid_scope','scope');}
  if(check.regions!==undefined){
   const reports=check.regions,validText=value=>typeof value==='string'&&!!value.trim()&&value.length<=800;
   const validIds=ids=>ids===undefined||Array.isArray(ids)&&ids.length<=128&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&!!id.trim()&&id.length<=200);
   if(!Array.isArray(reports)||!reports.length||reports.length>32)invalid('invalid_regions','regions');
   for(const [j,report]of reports.entries()){
    const bad=()=>fail({issue:'invalid_regions',index:i+1,regionIndex:j+1,checkField:'regions'});
    if(!report||typeof report!=='object'||Array.isArray(report)||!validText(report.id)||!['matched','mismatch','unverified'].includes(report.status)||!validText(report.reason)||!validIds(report.nodeIds))bad();
    if(report.repeats!==undefined&&(!Array.isArray(report.repeats)||report.repeats.length>64))bad();
    for(const repeat of report.repeats||[])if(!repeat||typeof repeat!=='object'||!validText(repeat.id)||!['hierarchy','image'].includes(repeat.basis)||!['observedCount','rows','columns'].every(k=>Number.isInteger(repeat[k])&&repeat[k]>=0&&repeat[k]<=1000)||!validIds(repeat.nodeIds)||repeat.reason!==undefined&&!validText(repeat.reason))bad();
   }
  }
 }
 // Apply only deterministic binding defaults after the entire request is valid.
 // This changes no run state and grants no approval; the selected proof is
 // checked for identity, type, freshness and complete scope by acceptance.
 if(checks.some((check,i)=>check!==action.checks[i]))action.checks=checks;
}
function constrain(schema,criteria,navigation){
 if(!schema.properties.checks)return;
 // Menus share field definitions. Clone before applying task/evidence-specific
 // choices so concurrent conversations cannot contaminate one another.
 const checks=schema.properties.checks=structuredClone(schema.properties.checks),item=checks.items;
 if(Array.isArray(criteria)&&criteria.length)item.properties.criterionId={type:'string',enum:criteria.map(c=>c.id)};
 // Static-only check menus (attached to writes) carry no evidence fields.
 if(!navigation||!item.properties.evidenceId)return;
 const constraints=[];
 for(const kind of ['visual','observation','command']){
  const allowed=navigation.byKind?.[kind]||[],excluded=kind==='visual'?navigation.constraints?.excludedVisualIds||[]:[];
  const evidence={...item.properties.evidenceId,description:kind==='visual'?'使用当前已送达且新鲜的配对/视觉证据eventId；preview与原稿单图不是视觉验收。候选不等于通过。':'使用该kind真实成功事件ID；结构可用仍须覆盖原要求与范围。'};
  if(navigation.constraints?.complete?.[kind]&&allowed.length)evidence.enum=[...allowed];
  else if(excluded.length)evidence.not={enum:[...excluded]};
  constraints.push({if:{required:['kind'],properties:{kind:{const:kind}}},then:{properties:{evidenceId:evidence}}});
 }
 for(const candidate of navigation.visual?.paired||[]){
  const nodes=candidate.nodes;if(!nodes?.items?.length)continue;
  const regions=structuredClone(item.properties.regions),ids=nodes.items.map(n=>n.id),nodeSchema={type:'string',...(nodes.complete?{enum:ids}:{}),description:nodes.complete?'仅使用此证据控件树的真实nodeId，resourceId/text不能代替。':'节点索引是有界样本，未列节点可能存在；从完整控件树取得真实ID，不猜测或排除未列节点。'};
  regions.items.properties.nodeIds.items=nodeSchema;
  regions.items.properties.repeats.items.properties.nodeIds.items=structuredClone(nodeSchema);
  constraints.push({if:{required:['kind','evidenceId'],properties:{kind:{const:'visual'},evidenceId:{const:candidate.eventId}}},then:{properties:{regions}}});
 }
 item.allOf=[...(item.allOf||[]),...constraints];
}
module.exports={schema,validate,hint,constrain};

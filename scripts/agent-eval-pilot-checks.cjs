// Diagnostic evidence only. These counters never approve product acceptance,
// alter requirements, or contribute a full-task success to evaluation reports.
const fs=require('node:fs/promises'),path=require('node:path'),{constants}=require('node:fs'),{createHash}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]))):value;
const fingerprint=value=>hash(JSON.stringify(stable(value))),sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),unknown=reason=>({status:'unknown',reason});
async function regularHash(file,maximum){const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await fd.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>maximum)throw Error('unbounded_or_nonregular_file');const digest=createHash('sha256');for await(const chunk of fd.createReadStream({autoClose:false}))digest.update(chunk);return {sha256:digest.digest('hex'),size:stat.size};}finally{await fd.close();}}
async function appSources(filesRoot){
 const entries=[];let bytes=0;
 async function walk(relative){const directory=path.join(filesRoot,relative),stat=await fs.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('source_directory_is_not_regular');for(const item of await fs.readdir(directory,{withFileTypes:true})){
  const name=path.posix.join(relative,item.name),file=path.join(filesRoot,name),stat=await fs.lstat(file);if(item.name==='.DS_Store'&&stat.isFile()&&stat.nlink===1)continue;
  if(stat.isDirectory()&&!stat.isSymbolicLink())await walk(name);else if(stat.isFile()&&!stat.isSymbolicLink()){const entry=await regularHash(file,64*1024**2);bytes+=entry.size;if(entries.length>=10000||bytes>256*1024**2)throw Error('bounded_source_inventory_exceeded');entries.push({path:name,sha256:entry.sha256});}else throw Error('source_inventory_contains_nonregular_file');
 }}
 try{for(const directory of ['app','app/src']){const stat=await fs.lstat(path.join(filesRoot,directory));if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('app_directory_is_not_regular');}}catch(error){return error.code==='ENOENT'?{known:true,entries:[]}:{known:false,reason:'app_source_inventory_unavailable'};}
 try{await walk('app/src');return {known:true,entries};}catch{return {known:false,reason:'app_source_inventory_unavailable'};}
}
function requirementCheck(sourceRun,run){
 if(!sourceRun||!run)return unknown('source_or_current_requirements_missing');
 if(!sourceRun.inputKey||!sourceRun.executionId||run.inputKey!==sourceRun.inputKey||run.executionId!==sourceRun.executionId||run.currentRequest!==sourceRun.currentRequest)return {status:'failed',reason:'original_input_or_execution_changed'};
 const original=sourceRun.requirements,current=run.requirements;
 if(!Array.isArray(original)||!original.length||!Array.isArray(current))return unknown('stable_requirement_ledger_unavailable');
 const semantics=r=>Object.fromEntries(['id','text','type','scope','scopes'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
 const mismatches=original.filter(prior=>{const matches=current.filter(r=>r.id===prior.id);return matches.length!==1||fingerprint(semantics(matches[0]))!==fingerprint(semantics(prior));}).length;
 return {status:mismatches?'failed':'passed',reason:mismatches?'original_requirement_semantics_changed':'original_input_and_requirement_semantics_preserved',originalCount:original.length,currentCount:current.length,mismatches};
}
function imageCheck(requests,target=2){
 if(target!==2&&target!==null)throw Error('Image diagnostic target must be the declared default 2 or explicit null');
 const valid=r=>Number.isSafeInteger(r.imageInputs)&&r.imageInputs>=0,known=requests.filter(valid),successful=r=>r.outcome==='completed'&&(r.httpStatus===undefined||r.httpStatus>=200&&r.httpStatus<300),firstWire=requests.findIndex(r=>valid(r)&&r.imageInputs>0),firstSuccess=requests.findIndex(r=>valid(r)&&r.imageInputs>0&&successful(r));
 const earlierUnknown=firstSuccess<0?requests.some(r=>successful(r)&&!known.includes(r)):requests.slice(0,firstSuccess).some(r=>successful(r)&&!known.includes(r));
 const values={targetMaxRequest:target,imageGoal:target===null?'new_device_inspection':'early_image_delivery',wireDelivery:firstWire>=0?'images_sent':known.length===requests.length&&requests.length?'none_sent':'unknown',firstKnownWireImageRequest:firstWire<0?null:firstWire+1,firstWireImageRequest:firstWire<0||requests.slice(0,firstWire).some(r=>!valid(r))?null:firstWire+1,firstKnownSuccessfulImageRequest:firstSuccess<0?null:firstSuccess+1,firstSuccessfulImageRequest:earlierUnknown?null:firstSuccess<0?null:firstSuccess+1,newRequests:requests.length,knownWireCounts:known.length,unknownWireCounts:requests.length-known.length,totalKnownImageInputs:known.reduce((n,r)=>n+r.imageInputs,0)};
 if(target===null)return {status:known.length===requests.length?'observed':'unknown',reason:known.length===requests.length?'predeclared_new_device_inspection_no_early_image_target':'image_wire_count_missing_cannot_infer_first_image',...values};
 if(firstSuccess>=0&&firstSuccess<2)return {status:'passed',reason:'successful_image_request_within_target',...values};
 if(earlierUnknown||known.length!==requests.length&&firstSuccess<0)return {...unknown('image_wire_count_missing_cannot_infer_first_image'),...values};
 return {status:'failed',reason:firstSuccess<0?'no_successful_image_request_observed':'first_successful_image_request_after_target',...values};
}
function sourceChanges(sourceInventory,current){
 if(!Array.isArray(sourceInventory?.entries)||!current?.known)return unknown('source_or_current_app_source_hashes_unavailable');
 const before=new Map(sourceInventory.entries.filter(e=>e.type==='file').flatMap(e=>{const m=/^workspace\/projects\/[a-f0-9]{64}\/files\/(app\/src\/.*)$/.exec(e.path);return m&&path.posix.basename(m[1])!=='.DS_Store'?[[m[1],e.sha256]]:[];})),after=new Map(current.entries.map(e=>[e.path,e.sha256]));
 let added=0,modified=0,removed=0;for(const [file,version]of after)if(!before.has(file))added++;else if(before.get(file)!==version)modified++;for(const file of before.keys())if(!after.has(file))removed++;
 return {status:'observed',reason:added+modified+removed?'net_app_source_hash_changes_observed':'no_net_app_source_change',added,modified,removed,changedFiles:added+modified+removed,beforeFiles:before.size,afterFiles:after.size};
}
function summarize({requests=[],events=[],run,sourceRun,resumeMetadata,sourceInventory,currentAppSources,currentApkSha256,policy,timeoutMs,timedOut,elapsedMs,agentAndVerificationMs,imageTarget=2,evaluationPurpose='bounded_diagnostic'}={}){
 if(evaluationPurpose!=='bounded_diagnostic')throw Error('Pilot checks are only available for bounded_diagnostic trials');
 const expected=resumeMetadata?.sourceTrialFingerprint,index=typeof expected==='string'?events.findLastIndex(e=>e.type==='evaluation_resume'&&e.detail?.sourceTrialFingerprint===expected):-1,boundary=index>=0?events[index]:null;
 // Archive order is authoritative. Never infer a boundary from delivered=true,
 // timestamps alone, or the last twelve public progress events.
 const fresh=boundary?events.slice(index+1):null,newIds=new Set(fresh?.map(e=>e.id)||[]);
 const builds=fresh?.filter(e=>e.type==='build_android'&&e.detail?.result?.exitCode===0&&!e.detail.result.timedOut&&!e.detail.result.error)||[];
 const screenshots=fresh?.filter(e=>e.type==='android_device'&&e.detail?.operation==='screenshot'&&e.detail.result?.path&&e.detail.result.pixelSize?.width>0&&e.detail.result.pixelSize?.height>0)||[];
 const sessions=new Set(fresh?.filter(e=>e.type==='android_device'&&['start','install'].includes(e.detail?.operation)&&e.detail.result?.sessionId).map(e=>e.detail.result.sessionId)||[]);
 const currentScreens=screenshots.filter(e=>sha(currentApkSha256)&&e.detail.result.apkSha256===currentApkSha256&&sessions.has(e.detail.result.sessionId));
 const pairs=fresh?.filter(e=>e.type==='view_image'&&!e.detail.result?.historicalReplay&&e.detail.result?.reference?.path&&sha(e.detail.result.reference.sha256)&&sha(e.detail.result.sha256)&&e.detail.result.path!==e.detail.result.reference.path)||[];
 const deliveredIds=new Set(run?.visualObservations?.filter(o=>newIds.has(o.eventId)&&o.delivered===true&&!o.historicalReplay).map(o=>o.eventId)||[]);
 const budgetEvents=fresh?.filter(e=>e.type==='execution_budget'&&Number.isSafeInteger(e.detail?.turns)&&e.detail.turns>=0)||[],decisions=budgetEvents.length?budgetEvents.reduce((n,e)=>n+e.detail.turns,0):null,cancelled=requests.filter(r=>r.outcome==='cancelled').length;
 const eventUnknown=unknown('matching_current_evaluation_resume_boundary_missing');
 return {schemaVersion:1,kind:'bounded_diagnostic_checks',notice:'短诊断进展指标，不是功能、视觉或整项任务验收；试验结束不代表交付完成。',boundary:boundary?{status:'passed',eventId:boundary.id,sourceTrialFingerprint:expected,newEvents:fresh.length}:eventUnknown,
  originalRequirements:requirementCheck(sourceRun,run),images:imageCheck(requests,imageTarget),appSourceChanges:fresh?sourceChanges(sourceInventory,currentAppSources):eventUnknown,
  builds:fresh?{status:'observed',reason:'new_successful_build_records_only',count:builds.length,freshExecutions:builds.filter(e=>e.detail.result.reused!==true).length,reused:builds.filter(e=>e.detail.result.reused===true).length}:eventUnknown,
  currentApkScreenshots:!fresh?eventUnknown:!sha(currentApkSha256)?unknown('current_apk_hash_unavailable'):{status:'observed',reason:currentScreens.length?'new_session_screenshots_match_current_apk':'no_new_session_screenshot_matches_current_apk',count:currentScreens.length,newScreenshotEvents:screenshots.length,missingApkOrSessionBindings:screenshots.filter(e=>!sha(e.detail.result.apkSha256)||!e.detail.result.sessionId).length},
  pairedObservations:fresh?{status:'observed',reason:'new_paired_image_observations_only_not_visual_acceptance',count:pairs.length,delivered:pairs.filter(e=>deliveredIds.has(e.id)).length,currentApk:pairs.filter(e=>sha(currentApkSha256)&&e.detail.result.designBinding?.apkSha256===currentApkSha256).length}:eventUnknown,
  limits:{status:'observed',maxDecisions:policy?.maxDecisions??null,configuredTimeoutMs:timeoutMs??null,actualNewRequests:requests.length,actualDecisions:decisions,decisionLimitStatus:decisions===null?'unknown':Number.isSafeInteger(policy?.maxDecisions)&&decisions<=policy.maxDecisions?'passed':'failed',decisionCountBasis:decisions===null?'no_explicit_execution_budget_counter':'new_execution_budget_turns',elapsedMs:elapsedMs??null,agentAndVerificationMs:agentAndVerificationMs??null,timedOut:typeof timedOut==='boolean'?timedOut:null,cancelledRequests:cancelled,automaticSegmentContinuations:fresh?fresh.filter(e=>e.type==='segment_continue').length:null,reason:'model_requests_include_discovery_and_http_retries_and_are_distinct_from_outer_decisions'}
 };
}
function summary(checks){const status=x=>x.status==='unknown'?'未知':x.status==='passed'?'通过':x.status==='failed'?'未达目标':'已观测',count=x=>x.status==='unknown'?'未知':x.count,first=checks.images.firstSuccessfulImageRequest??(checks.images.firstKnownSuccessfulImageRequest?`最迟第${checks.images.firstKnownSuccessfulImageRequest}次，此前记录未知`:checks.images.wireDelivery==='none_sent'?'未送图':'未知/未观测');
 return `短诊断：原要求${status(checks.originalRequirements)}；首个成功图像请求 ${first}（${checks.images.targetMaxRequest===null?'新设备检查，记录时序，无前两次请求目标':'目标≤2'}，${status(checks.images)}）；app/src净改动 ${checks.appSourceChanges.changedFiles??'未知'}；成功构建 ${count(checks.builds)}；当前APK新截图 ${count(checks.currentApkScreenshots)}；成对观察 ${count(checks.pairedObservations)}。新增请求 ${checks.limits.actualNewRequests}，决策 ${checks.limits.actualDecisions??'未知'}/${checks.limits.maxDecisions??'未知'}，时限 ${checks.limits.configuredTimeoutMs??'未知'}ms，超时 ${checks.limits.timedOut===null?'未知':checks.limits.timedOut?'是':'否'}，取消 ${checks.limits.cancelledRequests}。这些指标不代表功能、视觉或整项任务通过。`;
}
async function persist(trial,input){
 let currentAppSources=input.currentAppSources,currentApkSha256=input.currentApkSha256;
 if(input.filesRoot){currentAppSources??=await appSources(input.filesRoot);if(!currentApkSha256)try{for(const dir of ['app','app/build','app/build/outputs','app/build/outputs/apk','app/build/outputs/apk/debug']){const stat=await fs.lstat(path.join(input.filesRoot,dir));if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('APK path is not regular');}currentApkSha256=(await regularHash(path.join(input.filesRoot,'app/build/outputs/apk/debug/app-debug.apk'),256*1024**2)).sha256;}catch{}}
 const checks=summarize({...input,currentAppSources,currentApkSha256}),file=path.join(trial,'pilot-checks.json');await fs.writeFile(file,JSON.stringify(checks,null,2),{mode:0o600,flag:'wx'});return {checks,file,summary:summary(checks)};
}
module.exports={summarize,persist,summary,appSources};

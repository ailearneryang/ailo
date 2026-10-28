// Explicit assisted continuation. Reads ended trials only; source workspaces,
// evidence and private material are never edited or imported into source control.
const fs=require('node:fs/promises'),path=require('node:path'),{constants}=require('node:fs'),{createHash,randomUUID}=require('node:crypto');
const config=require('./agent-eval-config.cjs'),digest=value=>config.hash(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));
const EXCLUDED_RUNTIME_DIRECTORIES=Object.freeze(['android-sdk','tmp','npm-cache','npm-prefix','ailo-command-bin','ailo-command-config']);
const within=(root,file)=>file===root||file.startsWith(root+path.sep);
const fail=message=>Object.assign(Error('Assisted resume rejected: '+message),{code:'EVAL_RESUME_INVALID'});
async function readRegular(file,maximum=50*1024*1024){const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await fd.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>maximum)throw fail('invalid metadata file');return await fd.readFile('utf8');}finally{await fd.close();}}
async function json(file){return JSON.parse(await readRegular(file));}
async function fileHash(file){const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await fd.stat();if(!stat.isFile()||stat.nlink!==1)throw fail('non-regular or hard-linked source file');const hash=createHash('sha256');for await(const chunk of fd.createReadStream({autoClose:false}))hash.update(chunk);return {sha256:hash.digest('hex'),size:stat.size,mode:stat.mode&0o700};}finally{await fd.close();}}
async function inventory(root){
 const entries=[],excluded=[];let totalBytes=0;const cacheRoot=path.posix.join('workspace/projects',digest('eval'),'files/.runtime');
 async function walk(relative){const dir=path.join(root,relative);for(const item of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=path.posix.join(relative,item.name),file=path.join(root,name),stat=await fs.lstat(file);if(item.name==='.DS_Store'){if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw fail('Finder metadata exclusion requires a regular single-link file');excluded.push({path:name,type:'finder_metadata',reason:'Regenerable Finder view metadata; excluded explicitly, never project source, material, APK or execution evidence'});continue;}if(relative===cacheRoot&&EXCLUDED_RUNTIME_DIRECTORIES.includes(item.name)){if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('excluded cache path is not a regular directory');excluded.push({path:name,type:'directory',reason:'Regenerable isolated command/build cache; excluded from project/evidence/skill reuse without following its contents'});continue;}if(entries.length>=60000)throw fail('source inventory exceeds bounded file count');
  if(stat.isSymbolicLink()){const target=await fs.readlink(file);if(path.isAbsolute(target)||!within(root,path.resolve(path.dirname(file),target)))throw fail('escaping or absolute symbolic link');let actual;try{actual=await fs.realpath(file);}catch{throw fail('dangling symbolic link');}if(!['workspace','skill-packages'].some(dir=>within(path.join(root,dir),actual)))throw fail('symbolic link chain escapes copied source trees');entries.push({path:name,type:'symlink',target});}
  else if(stat.isDirectory()){entries.push({path:name,type:'directory'});await walk(name);}
  else if(stat.isFile()){const info=await fileHash(file);totalBytes+=info.size;if(totalBytes>12*1024**3)throw fail('source inventory exceeds bounded total size');entries.push({path:name,type:'file',...info});}
  else throw fail('socket, device, FIFO or other special file in source');
 }}
 for(const name of ['workspace','skill-packages']){const file=path.join(root,name);try{const stat=await fs.lstat(file);if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('workspace/skill roots must be real directories');entries.push({path:name,type:'directory'});await walk(name);}catch(error){if(error.code==='ENOENT'&&name==='skill-packages')continue;throw error;}}
 return {scope:'project_evidence_and_skill_reuse_excluding_regenerable_cache_and_finder_metadata',entries,excluded,copiedBytes:totalBytes,totalBytes,fingerprint:digest(entries)};
}
function safeCounters(result,requests){
 const prior=result.resumeAccounting;
 return {elapsedMs:Number.isFinite(prior?.cumulativeElapsedMs)?prior.cumulativeElapsedMs:result.elapsedMs,modelRequests:Number.isSafeInteger(prior?.cumulativeModelRequests)?prior.cumulativeModelRequests:requests.length,inputTokens:Number.isSafeInteger(prior?.cumulativeInputTokens)?prior.cumulativeInputTokens:requests.reduce((n,r)=>n+(r.providerUsage?.inputTokens||0),0),outputTokens:Number.isSafeInteger(prior?.cumulativeOutputTokens)?prior.cumulativeOutputTokens:requests.reduce((n,r)=>n+(r.providerUsage?.outputTokens||0),0)};
}
async function sdkAdjustment(source,sourceRoot,hostEnvironment){
 const files=path.join(source,'workspace/projects',digest('eval'),'files'),relative=path.posix.join('workspace/projects',digest('eval'),'files/local.properties'),file=path.join(source,relative);let bytes;
 try{const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await fd.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>65536)throw fail('invalid local.properties');bytes=await fd.readFile();}finally{await fd.close();}}catch(error){if(error.code==='ENOENT')return;throw error;}
 const text=bytes.toString('utf8'),matches=[...text.matchAll(/^\s*sdk\.dir\s*=\s*(.*?)\s*$/gm)];if(matches.length!==1)throw fail('local.properties SDK binding is ambiguous');
 const oldValue=matches[0][1].replace(/\\([ :\\])/g,'$1');if(await config.canonicalPath(path.resolve(files,oldValue))!==await config.canonicalPath(path.join(files,'.runtime/android-sdk')))return;
 let build;for(const name of ['app/build.gradle.kts','app/build.gradle'])try{const value=await readRegular(path.join(files,name),2*1024*1024);if(build!==undefined)throw fail('multiple app build configurations');build=value;}catch(error){if(error.code!=='ENOENT')throw error;}
 const clean=String(build||'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,''),compile=[...clean.matchAll(/\bcompileSdk(?:Version)?\s*(?:=\s*)?(\d+)\b/g)],tools=[...clean.matchAll(/\bbuildToolsVersion\s*(?:=\s*)?["'](\d+\.\d+\.\d+)["']/g)];
 if(compile.length!==1||tools.length!==1)throw fail('SDK replacement requires explicit compileSdk and buildToolsVersion pins; no version is guessed');
 const requiredApi=compile[0][1],requiredTools=tools[0][1];
 if(!hostEnvironment){if(!sourceRoot)throw fail('selected runtime or explicit host SDK is required for SDK replacement');hostEnvironment=await require(path.join(sourceRoot,'apps/desktop/agent/android-environment.cjs')).androidEnvironment({required:true});}
 if(typeof hostEnvironment.sdk!=='string'||!path.isAbsolute(hostEnvironment.sdk)||/[\r\n\0]/.test(hostEnvironment.sdk))throw fail('selected runtime did not provide a valid host SDK');const sdk=await fs.realpath(hostEnvironment.sdk);
 const platform=path.join(sdk,'platforms/android-'+requiredApi),toolRoot=path.join(sdk,'build-tools',requiredTools);
 for(const required of [path.join(platform,'android.jar'),...['aapt2','d8','apksigner','zipalign'].map(name=>path.join(toolRoot,name))])if(!(await fs.stat(required)).isFile())throw fail('host SDK does not satisfy the exact pinned build requirements');
 const platformProperties=await fs.readFile(path.join(platform,'source.properties'),'utf8'),toolProperties=await fs.readFile(path.join(toolRoot,'source.properties'),'utf8');
 if(!new RegExp('^AndroidVersion\\.ApiLevel\\s*=\\s*'+requiredApi+'\\s*$','m').test(platformProperties)||!new RegExp('^Pkg\\.Revision\\s*=\\s*'+requiredTools.replace(/\./g,'\\.')+'\\s*$','m').test(toolProperties))throw fail('host SDK metadata does not match exact pins');
 const value=sdk.replace(/\\/g,'\\\\').replace(/ /g,'\\ '),replacement=Buffer.from(text.replace(/^\s*sdk\.dir\s*=\s*.*?\s*$/m,'sdk.dir='+value));
 return {path:relative,reason:'Assisted technical SDK rebinding to the selected runtime read-only host SDK; old build evidence must be revalidated',oldSha256:digest(bytes),newSha256:digest(replacement),newSize:replacement.length,compileSdk:Number(requiredApi),buildToolsVersion:requiredTools,hostSdkMetadataFingerprint:digest(platformProperties+'\n'+toolProperties),replacement};
}
function controls(value){const result={};for(const key of ['reasoningControlSent','enableThinking'])if(typeof value?.[key]==='boolean')result[key]=value[key];if(typeof value?.reasoningEffort==='string')result.reasoningEffort=value.reasoningEffort;return result;}
// Relearn only recorded pressure, never actions or successful responses. Model,
// stage and the actual provider-control profile must all be reconstructable.
function relearnBudget({requests,events=[],model,configuration,savedBudget,configuredLimit,budgetModule=require('../apps/desktop/agent/output-budget.cjs'),reasoningModule=require('../apps/desktop/reasoning.cjs')}={}){
 if(config.publicModel(model).configurationFingerprint!==configuration.model?.configurationFingerprint)throw fail('budget relearning model/configuration differs from source');
 const limit=configuredLimit??(Number.isInteger(model.maxOutputTokens)&&model.maxOutputTokens>=256&&model.maxOutputTokens<=2000000?model.maxOutputTokens:8192),policy=budgetModule.createOutputBudget(model,limit,savedBudget);
 if(policy.snapshot().version!==3||typeof policy.pressured!=='function')return {supported:false,samples:0,reason:'selected_runtime_has_no_durable_profile_budget'};
 const base=reasoningModule.reasoningParameters(model,configuration.reasoningEffort),samples=[],skipped={};
 const skip=reason=>{skipped[reason]=(skipped[reason]||0)+1;};
 const invalidJson=new Set();for(const event of events.filter(e=>e.type==='protocol_error'&&e.detail?.reason==='invalid_json')){
  const matches=requests.filter(r=>r.outcome==='completed'&&!r.action&&Number.isFinite(r.durationMs)&&Date.parse(event.at)-Date.parse(r.startedAt)-r.durationMs>=0&&Date.parse(event.at)-Date.parse(r.startedAt)-r.durationMs<=2000);
  if(matches.length===1)invalidJson.add(matches[0]);
 }
 for(const r of requests){
  const limited=r.outcome==='failed'&&r.errorCode==='MODEL_OUTPUT_LIMIT',invalid=invalidJson.has(r);if(!limited&&!invalid)continue;
  if(r.modelId!==model.id||r.contextWindow!==model.contextWindow||!Number.isSafeInteger(r.requestedOutputTokens)||r.requestedOutputTokens<256||r.requestedOutputTokens>limit){skip('model_or_limit_unconfirmed');continue;}
  const stage={route:'route',checkpoint:'summary',plan_update:'review',task:'action',chat:'action'}[r.toolMenuStage];if(!stage){skip('stage_unconfirmed');continue;}
  if(typeof r.reasoningControlSent!=='boolean'||r.reasoningControlSent&&(typeof r.enableThinking!=='boolean'||typeof r.reasoningEffort!=='string')||['reasoningControlSent','enableThinking'].some(k=>r.parameters?.[k]!==undefined&&r.parameters[k]!==r[k])){skip('controls_unconfirmed');continue;}
  if(r.recoveryMode===true&&!['small_action','refocus','direct_action'].includes(r.recoveryStage)){skip('recovery_profile_unconfirmed');continue;}
  const profile=controls(r),allowed=['route','state','operation','action'].map(decisionStage=>{
   const sent={...base,...reasoningModule.decisionReasoningParameters(model,decisionStage),...(r.recoveryMode===true?reasoningModule.recoveryReasoningParameters(model,r.recoveryStage):{})};
   return controls({...reasoningModule.parameterDiagnostics(model,sent),reasoningEffort:sent.reasoning_effort});
  });
  if(!allowed.some(candidate=>digest(candidate)===digest(profile))){skip('controls_differ_from_selected_runtime');continue;}
  const diagnostics=Object.fromEntries(['contentChars','reasoningChars','toolArgumentChars','toolCalls','reasoningTokens'].filter(k=>Number.isFinite(r[k])).map(k=>[k,r[k]]));let pressure;
  if(limited)policy.limited(r.requestedOutputTokens,{...diagnostics,finishReason:'length',completionTokens:r.providerUsage?.outputTokens},stage,profile);
  else {pressure=policy.pressured(r.requestedOutputTokens,r.providerUsage,diagnostics,stage,profile);if(!pressure.pressured){skip('invalid_json_without_budget_pressure');continue;}}
  samples.push({requestIdHash:digest(r.id||JSON.stringify([r.startedAt,r.durationMs])),stage,kind:limited?'confirmed_output_limit':'invalid_json_usage_pressure',controlFingerprint:digest(profile),requestedOutputTokens:r.requestedOutputTokens});
 }
 return {supported:true,samples:samples.length,sampleFingerprint:digest(samples),samplesByKind:samples.reduce((out,s)=>(out[s.kind]=(out[s.kind]||0)+1,out),{}),skipped,snapshot:policy.snapshot()};
}
function endedTimeout(result,requests,run,progress){
 if(result.result!==undefined||result.timedOut!==true||result.error?.code!=='MODEL_CANCELLED'||result.phase==='setup_or_harness'||requests.length===0)return false;
 if(requests.at(-1).outcome!=='cancelled'||requests.at(-1).errorCode!=='MODEL_CANCELLED'||requests.slice(0,-1).some(r=>!['completed','failed'].includes(r.outcome)))return false;
 if(run.status!=='paused'||progress?.status!=='paused'||progress.executionId!==run.executionId||progress.currentInputId!==run.inputKey||progress.inFlight||progress.recoverySummary?.unknown>0)return false;
 const last=run.events?.at(-1),observed=progress.events?.at(-1);
 const requestEnd=Date.parse(requests.at(-1).startedAt)+requests.at(-1).durationMs;
 return last?.type==='interrupted'&&observed?.type==='interrupted'&&typeof last.id==='string'&&last.id.length>0&&last.id===observed.id&&last.at===observed.at&&Number.isFinite(requestEnd)&&Date.parse(last.at)>=requestEnd&&run.updatedAt===progress.updatedAt&&Date.parse(progress.updatedAt)>=Date.parse(last.at)&&!run.actionJournal?.some(entry=>['unknown','running','started','interrupted','pending'].includes(entry.status));
}
async function inspect({sourceTrial,model,reasoningEffort,environmentDirectory,sourceRoot,hostEnvironment}={}){
 const source=await fs.realpath(path.resolve(sourceTrial)),resultFile=path.join(source,'result.json'),result=await json(resultFile),requests=await json(path.join(source,'requests.json'));
 if(!Array.isArray(requests)||requests.some(r=>!['completed','failed','cancelled'].includes(r.outcome)||!Number.isFinite(r.durationMs)||r.durationMs<0)||result.phase==='setup_or_harness')throw fail('source is not a known ended incomplete trial');
 const experiment=path.dirname(path.dirname(source)),configuration=await json(path.join(experiment,'configuration.json'));
 if(configuration.schemaVersion!==2||result.configurationFingerprint!==configuration.configurationFingerprint)throw fail('source experiment provenance is missing or inconsistent');
 if(model&&config.publicModel(model).configurationFingerprint!==configuration.model?.configurationFingerprint)throw fail('model or endpoint configuration differs from the source trial');
 if(reasoningEffort&&reasoningEffort!==configuration.reasoningEffort)throw fail('reasoning setting differs from the source trial');
 const key=digest('eval'),runRelative=path.join('workspace/projects',key,'runs',key+'.json'),run=await json(path.join(source,runRelative));
 let progress,timeoutEnded=false;if(result.result===undefined&&result.timedOut===true&&result.error?.code==='MODEL_CANCELLED')try{progress=await json(path.join(source,'progress.json'));timeoutEnded=endedTimeout(result,requests,run,progress);}catch(error){if(error.code!=='ENOENT')throw error;}
 const ordinaryEnded=requests.every(r=>['completed','failed'].includes(r.outcome))&&['blocked','paused','failed'].includes(result.result?.agentRun?.status)&&run.status===result.result.agentRun.status;
 if(!ordinaryEnded&&!timeoutEnded)throw fail('source is not a known ended incomplete trial; timeout cancellation requires matching paused progress and run');
 if(run.taskId!=='eval'||run.projectId!=='eval'||run.inFlight||run.actionJournal?.some(entry=>['unknown','running','started','interrupted','pending'].includes(entry.status)&&!['read_file','read_material','read_source','inspect_source','read_execution','list_files','search_materials','read_history'].includes(entry.action)))throw fail('active execution or unknown side effect must be reconciled before cloning');
 const originalCase=configuration.cases.find(c=>c.id===result.case);if(!originalCase||digest(run.currentRequest||'')!==originalCase.requestHash||!run.inputKey||!run.executionId)throw fail('exact original input/state cannot be reconstructed');
 if(!Array.isArray(result.rubric)||!result.rubric.length||JSON.stringify(result.rubric)!==JSON.stringify(originalCase.rubric))throw fail('acceptance rubric differs from frozen source');
 const environment=await config.canonicalPath(environmentDirectory);if(within(source,environment)||within(environment,source))throw fail('new device environment must be separate from source');
 const adjustment=await sdkAdjustment(source,sourceRoot,hostEnvironment),state=await inventory(source),counter=safeCounters(result,requests);if(!Number.isFinite(counter.elapsedMs)||counter.elapsedMs<0)throw fail('prior elapsed time is missing');
 const sourceEvidence=Object.fromEntries(await Promise.all([resultFile,path.join(source,'requests.json'),path.join(experiment,'configuration.json'),...(timeoutEnded?[path.join(source,'progress.json')]:[])].map(async file=>[file,await fileHash(file)])));
 const sourceTrialFingerprint=digest({sourceMetadata:Object.values(sourceEvidence),configuration:configuration.configurationFingerprint,workspace:{scope:state.scope,fingerprint:state.fingerprint,excluded:state.excluded}});
 let sourceTrialStartedAt=result.runtimeContinuation?.sourceTrialStartedAt;
 if(!sourceTrialStartedAt)try{const fd=await fs.open(path.join(source,'.started'),constants.O_RDONLY|constants.O_NOFOLLOW);try{sourceTrialStartedAt=(await fd.readFile('utf8')).trim();}finally{await fd.close();}}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!Number.isFinite(Date.parse(sourceTrialStartedAt)))sourceTrialStartedAt=requests[0]?.startedAt;
 let learning,budgetAdjustment;if(model){let events=run.events||[];try{events=(await readRegular(path.join(source,runRelative)+'.jsonl')).split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code!=='ENOENT')throw error;}
  let configuredLimit;if(sourceRoot)configuredLimit=(await import(require('node:url').pathToFileURL(path.join(sourceRoot,'apps/desktop/context.mjs')).href)).outputLimit(model);
  learning=relearnBudget({requests,events,model,configuration,savedBudget:run.outputBudget,configuredLimit,...(sourceRoot?{budgetModule:require(path.join(sourceRoot,'apps/desktop/agent/output-budget.cjs')),reasoningModule:require(path.join(sourceRoot,'apps/desktop/reasoning.cjs'))}:{})});
  if(learning.samples){const replacement=Buffer.from(JSON.stringify({...run,outputBudget:learning.snapshot}));budgetAdjustment={path:runRelative,reason:'Assisted replay of confirmed recorded budget pressure in the same model/configuration and actual control profiles; no source action is executed',oldSha256:digest(await readRegular(path.join(source,runRelative))),newSha256:digest(replacement),newSize:replacement.length,replacement,learningSamples:learning.samples,sampleFingerprint:learning.sampleFingerprint};}
 }
 const technicalAdjustments=[adjustment,budgetAdjustment].filter(Boolean).map(a=>Object.fromEntries(Object.entries(a).filter(([key])=>key!=='replacement')));
 const metadata={kind:'assisted_resume',reuseScope:state.scope,copiedBytes:state.copiedBytes,excludedPaths:state.excluded.map(e=>e.path),technicalAdjustments,...(learning?{budgetLearning:Object.fromEntries(Object.entries(learning).filter(([key])=>key!=='snapshot'))}:{}),sourceTermination:timeoutEnded?'verified_timeout_paused':'ended_incomplete',sourceTrialStartedAt:Number.isFinite(Date.parse(sourceTrialStartedAt))?sourceTrialStartedAt:undefined,sourceTrialFingerprint,sourceRuntimeFingerprint:result.runtimeFingerprint,sourceConfigurationFingerprint:result.configurationFingerprint,sourceModelConfigurationFingerprint:configuration.model.configurationFingerprint,sourceMaterialFingerprint:originalCase.materialFingerprint,sourceExecutionId:run.executionId,sourceTaskId:run.taskId,sourceInputId:run.inputKey,sourceRequestHash:originalCase.requestHash,priorElapsedMs:counter.elapsedMs,priorModelRequests:counter.modelRequests,priorInputTokens:counter.inputTokens,priorOutputTokens:counter.outputTokens,deviceState:'new_environment'};
 const inspected={source,experiment,result,configuration,runRelative,run,state,adjustment,budgetAdjustment,sourceEvidence,metadata,fixture:{id:result.case,category:'weather',request:run.currentRequest,rubric:result.rubric,materialFingerprint:originalCase.materialFingerprint,environmentFingerprint:'assisted-clone-'+state.fingerprint,environment,outputs:['app/build/outputs/apk/debug/app-debug.apk'],resume:metadata}};
 await task(source,inspected);return inspected;
}
async function copyRegular(source,destination,expected){
 await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});const input=await fs.open(source,constants.O_RDONLY|constants.O_NOFOLLOW),output=await fs.open(destination,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,expected.mode||0o600);
 try{const stat=await input.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==expected.size)throw fail('source changed while cloning');const hash=createHash('sha256');for await(const chunk of input.createReadStream({autoClose:false})){hash.update(chunk);let offset=0;while(offset<chunk.length){const written=await output.write(chunk,offset,chunk.length-offset);if(!written.bytesWritten)throw fail('clone write made no progress');offset+=written.bytesWritten;}}if(hash.digest('hex')!==expected.sha256)throw fail('source contents changed while cloning');}finally{await Promise.all([input.close(),output.close()]);}
}
async function clone(inspected,destination){
 const target=await config.canonicalPath(destination);if(within(inspected.experiment,target)||within(target,inspected.experiment))throw fail('output overlaps the source experiment');
 try{await fs.lstat(target);throw fail('output already exists; never overwrite an ended trial');}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const [file,expected]of Object.entries(inspected.sourceEvidence))if(digest(await fileHash(file))!==digest(expected))throw fail('source metadata changed after resume preflight');
 if((await inventory(inspected.source)).fingerprint!==inspected.state.fingerprint)throw fail('source changed after resume preflight');
 await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});const staging=path.join(path.dirname(target),'.resume-staging-'+randomUUID());await fs.mkdir(staging,{mode:0o700});
 try{
  for(const entry of inspected.state.entries){const src=path.join(inspected.source,entry.path),dst=path.join(staging,entry.path);if(entry.type==='directory')await fs.mkdir(dst,{recursive:true,mode:0o700});else if(entry.type==='symlink'){if(await fs.readlink(src)!==entry.target)throw fail('source link changed during cloning');await fs.symlink(entry.target,dst);}else await copyRegular(src,dst,entry);}
  const expected=inspected.state.entries.map(entry=>({...entry}));
  for(const a of [inspected.adjustment,inspected.budgetAdjustment].filter(Boolean)){const target=path.join(staging,a.path),old=await fileHash(target);if(old.sha256!==a.oldSha256)throw fail('explicit adjustment source changed');await fs.writeFile(target,a.replacement,{flag:constants.O_WRONLY|constants.O_TRUNC|constants.O_NOFOLLOW,mode:old.mode});const entry=expected.find(e=>e.path===a.path);entry.sha256=a.newSha256;entry.size=a.newSize;}
  const actual=await inventory(staging);
  if(actual.fingerprint!==digest(expected)){const expectedMap=new Map(expected.map(e=>[e.path,e])),actualMap=new Map(actual.entries.map(e=>[e.path,e])),differences=[];for(const name of new Set([...expectedMap.keys(),...actualMap.keys()])){const a=expectedMap.get(name),b=actualMap.get(name);if(JSON.stringify(a)!==JSON.stringify(b))differences.push({path:name,expected:a,actual:b});}throw Object.assign(fail('cloned evidence does not match the source manifest plus explicit SDK adjustment'),{diagnostics:{differenceCount:differences.length,differences:differences.slice(0,20),orderOnly:differences.length===0}});}
  await fs.writeFile(path.join(staging,'resume-manifest.json'),JSON.stringify({version:1,...inspected.metadata,sourceInventory:inspected.state},null,2),{mode:0o600,flag:'wx'});
  await fs.rename(staging,target);return target;
 }catch(error){await fs.rm(staging,{recursive:true,force:true});throw error;}
}
async function task(trial,inspected){
 const catalog=await json(path.join(trial,'workspace/projects',digest('eval'),'materials.json')),materials=[];
 for(const m of catalog){const parsed=await json(path.join(trial,'workspace/projects',digest('eval'),'materials',m.id+'.json'));materials.push({name:m.name,sourceId:m.sourceId,text:parsed.text,summary:m.summary});}
 const extensions=[],packages=path.join(trial,'skill-packages');let packageIds=[];try{packageIds=(await fs.readdir(packages)).filter(id=>/^[a-f0-9]{64}$/.test(id));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(inspected.run.loadedExtensions?.length){if(inspected.run.loadedExtensions.length!==1||packageIds.length!==1)throw fail('source skill bindings cannot be reconstructed exactly without an extension snapshot');
  for(const [index,loaded]of inspected.run.loadedExtensions.entries()){if(loaded.kind!=='skill')throw fail('non-skill source extension requires an explicit saved extension snapshot');const id=packageIds[index],manifest=await json(path.join(packages,id,'manifest.json')),entry=manifest.files.find(f=>path.basename(f.path).toLowerCase()==='skill.md');if(!entry)throw fail('source skill entry is missing');const bytes=await fs.readFile(path.join(packages,id,'files',entry.path));if(digest(bytes)!==entry.sha256)throw fail('source skill entry does not match its manifest');const parsed=await require('../apps/desktop/skill-packages.cjs').createSkillPackages(packages).importSkill({name:'SKILL.md',buffer:bytes});extensions.push({...parsed,id:loaded.id,kind:'skill',name:loaded.name,enabled:true,package:{id,files:manifest.files.length}});}
 }
 return {task:{id:inspected.run.taskId,projectId:inspected.run.projectId,request:inspected.fixture.request,materials,extensionIds:extensions.map(e=>e.id),messages:[{id:inspected.run.inputKey,role:'user',content:inspected.fixture.request,materials}]},extensions};
}
function accounting(metadata,elapsedMs,requests,finishedAt=Date.now()){const input=requests.reduce((n,r)=>n+(r.providerUsage?.inputTokens||0),0),output=requests.reduce((n,r)=>n+(r.providerUsage?.outputTokens||0),0),start=Date.parse(metadata.sourceTrialStartedAt);return {kind:'assisted_resume',elapsedBasis:'sum_of_observed_trial_durations_excludes_between_trial_waits',calendarElapsedMs:Number.isFinite(start)&&finishedAt>=start?finishedAt-start:null,priorElapsedMs:metadata.priorElapsedMs,priorModelRequests:metadata.priorModelRequests,priorInputTokens:metadata.priorInputTokens,priorOutputTokens:metadata.priorOutputTokens,segmentElapsedMs:elapsedMs,segmentModelRequests:requests.length,segmentInputTokens:input,segmentOutputTokens:output,cumulativeElapsedMs:metadata.priorElapsedMs+elapsedMs,cumulativeModelRequests:metadata.priorModelRequests+requests.length,cumulativeInputTokens:metadata.priorInputTokens+input,cumulativeOutputTokens:metadata.priorOutputTokens+output};}
module.exports={inspect,inventory,clone,task,accounting,relearnBudget,EXCLUDED_RUNTIME_DIRECTORIES};

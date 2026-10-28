// Explicit, isolated live evaluation. Preflight never decrypts credentials,
// calls a model, builds an app, or starts a device. Historical runs stay intact.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib'),{randomUUID}=require('node:crypto');
const config=require('./agent-eval-config.cjs'),{cases:microCases,records}=require('./agent-eval-cases.cjs'),{serviceFailure}=require('./agent-eval-service.cjs');
let options;try{options=config.args(process.argv.slice(2));}catch(e){console.error(e.message);process.exit(1);}
const {app,protocol,BrowserWindow,session,nativeImage,safeStorage,net}=require('electron');
const root=path.resolve(__dirname,'..'),directory=options.directory,source=options.source;
protocol.registerSchemesAsPrivileged([{scheme:'ailo-project',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);app.on('window-all-closed',()=>{});app.setName('Ailo');
// An OS temporary profile is deliberately separate from the selected user's
// storage. Only model metadata/credentials are read from that storage.
const profile=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'ailo-eval-profile-'));app.setPath('userData',profile);
app.whenReady().then(async()=>{
 try{
  const dataDirectory=await config.canonicalPath(options.dataDirectory||path.join(os.homedir(),'Library/Application Support/Ailo')),physicalSource=await config.canonicalPath(source);
  for(const selectedTarget of [directory,options.environmentDirectory].filter(Boolean)){
   const target=await config.canonicalPath(selectedTarget);
   if(target===dataDirectory||target.startsWith(dataDirectory+path.sep)||target===physicalSource||target.startsWith(physicalSource+path.sep)&&!target.startsWith(path.join(physicalSource,'.local')+path.sep))throw Error('Evaluation output/environment must be isolated from user data and runtime source');
  }
  const live=require(path.join(root,'apps/desktop/storage.cjs')).createStorage(dataDirectory,safeStorage),state=await live.readWorkspace();
  const selected=state.models?.find(m=>m.id===options.modelId);if(!selected)throw Error('The explicitly selected model ID is not configured');
  const diagnosticBudget=await config.verifyDiagnosticBudget(source,options.evaluationPolicy);
  let resumed;
  if(options.resumeFrom){resumed=await require('./agent-eval-resume.cjs').inspect({sourceTrial:options.resumeFrom,sourceRoot:source,model:selected,reasoningEffort:options.reasoningEffort,environmentDirectory:options.environmentDirectory});const output=await config.canonicalPath(directory);if(output===resumed.experiment||output.startsWith(resumed.experiment+path.sep)||resumed.experiment.startsWith(output+path.sep))throw Error('Resume output must not overlap the source experiment');options.resumeMetadata=resumed.metadata;}
  let reviewNote;if(options.reviewNote){const notes=require('./agent-eval-review-note.cjs');reviewNote=await notes.inspect(options.reviewNote);options.reviewNoteMetadata=reviewNote.metadata;resumed.metadata.assistance=notes.assistance(reviewNote.metadata);}
  let allCases=resumed?[resumed.fixture]:options.suite==='weather'?[await require('./weather-benchmark.cjs').fixture(options.materialsDirectory,options.environmentDirectory,options.stratum)]:microCases;
  const cases=allCases.filter(c=>!options.filter||c.id===options.filter);if(!cases.length)throw Error('No matching evaluation cases');
  const configuration=config.configuration(options,selected,cases),runtimeFingerprint=await config.fingerprint(source);
  await config.assertConfiguration(directory,configuration);
  let environmentPreflight;
  if(options.suite==='weather'){
   // This gate precedes credential decryption and every possible model call.
   // It executes the exact selected runtime, including legacy behavior.
   const preflight=require('./agent-eval-preflight.cjs');environmentPreflight=await preflight.weatherEnvironment({source});
   const preflightFile=await preflight.persist(directory,{preflight:true,modelRequests:0,model:configuration.model.model,modelConfigurationFingerprint:configuration.model.configurationFingerprint,runtimeFingerprint,environment:environmentPreflight,...(diagnosticBudget?{diagnosticBudget}:{}),...(resumed?{resumeSource:resumed.metadata}:{}),...(reviewNote?{assistance:configuration.assistance}:{})});
   console.log(require('./agent-eval-output.cjs').preflightSummary(environmentPreflight,preflightFile));
   if(!environmentPreflight.passed){app.exit(4);return;}
  }
  if(options.preflight){if(!environmentPreflight)console.log('材料与配置预检通过；未调用模型。');console.log(`所选模型：${configuration.model.model}；试验 ${cases.length} 项×${options.repeats} 次，运行并发 ${options.concurrency}。`);if(options.evaluationPolicy)console.log(`本次为有界诊断：最多 ${options.maxDecisions} 次决策 / ${Math.round(options.timeoutMs/60000)} 分钟；不作为完整任务成功样本。`);if(resumed){console.log('来源状态与证据已验证；本次没有复制来源，也没有启动续跑。实际执行将单列为受辅助续跑。');console.log(`工程/证据/技能复用计划：${(resumed.state.copiedBytes/1024**2).toFixed(1)} MiB，明确排除 ${resumed.state.excluded.length} 项可再生目录/元信息。`);}if(reviewNote)console.log(`新增助理外部审查反馈已核验：${reviewNote.metadata.bytes} bytes，SHA-256 ${reviewNote.metadata.sha256}；预检未导入，实际输入含明确辅助变化，不作为同输入或冷启动样本。`);console.log('本次仅预检，未执行交付试验；无baseline不构成对照。');app.exit(0);return;}
  const model=await live.modelCredentials(options.modelId);
  if(config.publicModel(model).configurationFingerprint!==configuration.model.configurationFingerprint)throw Error('Model configuration changed during evaluation setup');
  await config.assertConfiguration(directory,configuration,{write:true});
  const runtimeFile=path.join(directory,'runtime-'+options.version+'.json');let frozen;try{frozen=JSON.parse(await fs.readFile(runtimeFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(frozen&&frozen.runtimeFingerprint!==runtimeFingerprint)throw Error('Runtime differs from this version’s frozen evaluation source; select a new output directory');
  if(!frozen)await fs.writeFile(runtimeFile,JSON.stringify({runtimeFingerprint,configurationFingerprint:configuration.configurationFingerprint},null,2),{flag:'wx',mode:0o600});
  const queue=[];for(let repeat=1;repeat<=options.repeats;repeat++)for(const fixture of cases)queue.push({fixture,repeat});let serviceBlocked=false,sourceChanged=false;
  async function worker(){for(;;){
   if(serviceBlocked||sourceChanged)return;if(await config.fingerprint(source)!==runtimeFingerprint)throw Error('Evaluation runtime source changed; stop rather than mix versions');const job=queue.shift();if(!job)return;const {fixture,repeat}=job,trial=path.join(directory,options.version,fixture.id+'-'+repeat),resultFile=path.join(trial,'result.json');
   let existing;try{existing=JSON.parse(await fs.readFile(resultFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(existing){let oldRequests=[];try{oldRequests=JSON.parse(await fs.readFile(path.join(trial,'requests.json'),'utf8'));}catch{}if(!options.retryService||!serviceFailure(oldRequests,existing.error)){console.log('跳过已有记录：'+options.version+'/'+fixture.id+' 第'+repeat+'次。');continue;}const archive=path.join(directory,options.version,'service-blocked',fixture.id+'-'+repeat+'-'+Date.now());await fs.mkdir(path.dirname(archive),{recursive:true});await fs.rename(trial,archive);}
   const trialStarted=Date.now(),trialRequests=[];
   if(resumed)await require('./agent-eval-resume.cjs').clone(resumed,trial);else await fs.mkdir(trial,{recursive:true,mode:0o700});
   // A marker prevents silently replaying an interrupted trial with unknown
   // side effects. Reruns use a new experiment, or explicit service retry above.
   await fs.writeFile(path.join(trial,'.started'),new Date().toISOString(),{flag:'wx',mode:0o600});
   try{
   const base=path.join(trial,'workspace');let task={id:'eval',projectId:'eval',request:fixture.request,messages:[]},extensions=[];
   const skillPackages=require(path.join(source,'apps/desktop/skill-packages.cjs')).createSkillPackages(path.join(trial,'skill-packages'));
   if(resumed){const restored=await require('./agent-eval-resume.cjs').task(trial,resumed);task=restored.task;extensions=restored.extensions;}
   else if(fixture.skill){const extension=await skillPackages.importSkill({name:path.basename(fixture.skill.file),buffer:await fs.readFile(fixture.skill.file)});extensions.push(extension);}
   if(reviewNote){const appended=await require('./agent-eval-review-note.cjs').append(reviewNote,{trial,base,task,inputId:resumed.metadata.sourceInputId,readMaterial:require(path.join(source,'apps/desktop/materials.cjs')).readMaterial});task=appended.task;}
   const materials=[];
   for(const material of fixture.privateMaterials||[]){const parsed=await require(path.join(source,'apps/desktop/materials.cjs')).readMaterial(material.file),sourceId=randomUUID();await fs.mkdir(path.join(base,'imports'),{recursive:true,mode:0o700});await fs.copyFile(material.file,path.join(base,'imports',sourceId));materials.push({...parsed,sourceId});}
   if(!resumed){task.materials=materials;task.extensionIds=extensions.map(e=>e.id);task.messages=[{id:'input',role:'user',content:fixture.request,materials}];}
   const w=await require(path.join(source,'apps/desktop/agent/workspace.cjs')).createWorkspace(base,task);
   for(const [name,content]of Object.entries(fixture.files||{}))await fs.writeFile(path.join(w.files,name),content);
   if(fixture.bundle)await fs.writeFile(path.join(w.files,'sample.bundle'),zlib.gzipSync(JSON.stringify({records})));
   if(fixture.seed)await require('./weather-benchmark.cjs').seedCache(fixture.seed,path.join(w.files,'.runtime/gradle'),fixture.environmentFingerprint);
   let android;
   if(fixture.category==='weather'){
    const environment=path.join(fixture.environment,options.version+'-'+fixture.id+'-'+repeat+'-'+path.basename(directory));
    await fs.mkdir(path.dirname(environment),{recursive:true,mode:0o700});await fs.mkdir(environment,{mode:0o700});await fs.writeFile(path.join(environment,'.ailo-benchmark-environment'),configuration.configurationFingerprint,{flag:'wx',mode:0o600});
    android=require(path.join(source,'apps/desktop/agent/android-device.cjs')).createAndroidManager({directory:path.join(environment,'android-runtime'),authorize:async()=>true});
   }
   const browser=require(path.join(source,'apps/desktop/agent/browser-observer.cjs')).createBrowserObserver({BrowserWindow,session}),requests=trialRequests;
   const storage={agentDirectory:base,skillPackages,androidManager:android,authorizeBuild:fixture.category==='weather'?async()=>true:undefined,modelCredentials:async()=>model,readWorkspace:async()=>({tasks:[task],projects:[{id:'eval'}],extensions}),imageObserver:require(path.join(source,'apps/desktop/agent/image-observer.cjs')).createImageObserver(nativeImage),browserObserver:browser,recordModelRequest:async record=>{const {providerRequestId,...safe}=record;requests.push(safe);await fs.writeFile(path.join(trial,'requests.json'),JSON.stringify(requests,null,2),{mode:0o600});}};
   const chat=require(path.join(source,'apps/desktop/chat.cjs')).createChat(storage,(url,input)=>net.fetch(url,input));const started=Date.now();let result,error,timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;chat.cancel('trial');},options.timeoutMs);console.log('开始试验：'+options.version+'/'+fixture.id+' 第'+repeat+'次。');
   try{result=await chat.complete({id:'trial',taskId:'eval',executionOrigin:'evaluation',...(options.evaluationPolicy?{evaluationPolicy:options.evaluationPolicy}:{}),...(resumed?{runtimeContinuation:resumed.metadata}:{}),modelId:model.id,messages:task.messages,extensionIds:task.extensionIds,reasoningEffort:options.reasoningEffort,onRun:async run=>fs.writeFile(path.join(trial,'progress.json'),JSON.stringify(run),{mode:0o600})});}
   catch(e){error={code:e.code,message:e.message};}
   finally{clearTimeout(timer);browser.dispose();await android?.dispose();}
   if(await config.fingerprint(source)!==runtimeFingerprint){sourceChanged=true;error={code:'EVAL_RUNTIME_CHANGED',message:'Runtime source changed while this trial was running; result cannot establish a frozen-version comparison'};}
   const blocked=serviceFailure(requests,error);if(blocked)serviceBlocked=true;
   const checks=[];for(const name of fixture.outputs){try{checks.push({check:'nonempty '+name,passed:(await fs.stat(path.join(w.files,name))).size>0});}catch{checks.push({check:'nonempty '+name,passed:false});}}
   if(fixture.expected){try{checks.push({check:'exact data result',passed:require('node:util').isDeepStrictEqual(JSON.parse(await fs.readFile(path.join(w.files,'result.json'),'utf8')),fixture.expected)});}catch{checks.push({check:'exact data result',passed:false});}}
   if(fixture.category==='code')try{const r=await require(path.join(source,'apps/desktop/agent/tools.cjs')).runCommand(w.files,'python3 test_ranges.py',new AbortController().signal,10000,{networkOutbound:false});checks.push({check:'independent code regression',passed:r.exitCode===0,output:r.output});}catch(e){checks.push({check:'independent code regression',passed:false,error:e.message});}
   if(fixture.bundle)try{const r=await require(path.join(source,'apps/desktop/agent/tools.cjs')).runCommand(w.files,'python3 -c \'import csv,json; r=list(csv.DictReader(open("records.csv"))); assert len(r)==2 and r[0]=={"id":"1","name":"甲,乙","note":"第一行\\n第二行"} and r[1]=={"id":"2","name":"丙","note":"正常"}\'',new AbortController().signal,10000,{networkOutbound:false});checks.push({check:'CSV roundtrip',passed:r.exitCode===0});}catch(e){checks.push({check:'CSV roundtrip',passed:false,error:e.message});}
   let interventionEvidence={complete:false,events:[]};
   try{const runFile=path.join(w.project,'runs',config.hash('eval')+'.json'),savedRun=JSON.parse(await fs.readFile(runFile,'utf8')),events=(await fs.readFile(runFile+'.jsonl','utf8')).split('\n').filter(Boolean).map(JSON.parse);interventionEvidence={complete:savedRun.interventionTracking?.complete===true,source:'full_event_archive_with_runtime_tracking',events:events.filter(e=>['steering','user_intervention','user_continuation','user_resume'].includes(e.type)).map(e=>({id:e.id,type:e.type,at:e.at,origin:e.detail?.origin}))};}catch{}
   await fs.writeFile(resultFile,JSON.stringify({schemaVersion:2,version:options.version,case:fixture.id,repeat,stratum:options.stratum,...(reviewNote?{assistance:configuration.assistance,pilotCheckPolicy:configuration.pilotCheckPolicy}:{}),...(options.evaluationPolicy?{evaluationPurpose:'bounded_diagnostic',evaluationPolicy:options.evaluationPolicy}:{}),...(resumed?{runtimeContinuation:resumed.metadata,resumeAccounting:require('./agent-eval-resume.cjs').accounting(resumed.metadata,Date.now()-trialStarted,trialRequests)}:{}),configurationFingerprint:configuration.configurationFingerprint,runtimeFingerprint,elapsedMs:Date.now()-trialStarted,setupMs:started-trialStarted,agentAndVerificationMs:Date.now()-started,timedOut,error,serviceBlocked:blocked,result,checks,interventionEvidence,humanAcceptance:'pending',rubric:fixture.rubric},null,2),{mode:0o600});console.log('试验记录已保存：'+options.version+'/'+fixture.id+'，状态 '+(result?.agentRun?.status||error?.code||'未知')+'。');
   }catch(setupError){await fs.writeFile(resultFile,JSON.stringify({schemaVersion:2,version:options.version,case:fixture.id,repeat,stratum:options.stratum,...(reviewNote?{assistance:configuration.assistance,pilotCheckPolicy:configuration.pilotCheckPolicy}:{}),...(options.evaluationPolicy?{evaluationPurpose:'bounded_diagnostic',evaluationPolicy:options.evaluationPolicy}:{}),...(resumed?{runtimeContinuation:resumed.metadata,resumeAccounting:require('./agent-eval-resume.cjs').accounting(resumed.metadata,Date.now()-trialStarted,trialRequests)}:{}),configurationFingerprint:configuration.configurationFingerprint,runtimeFingerprint,elapsedMs:Date.now()-trialStarted,phase:'setup_or_harness',error:{code:setupError.code||'EVAL_SETUP_FAILED',message:setupError.message},checks:[{check:'isolated benchmark setup completed',passed:false}],externalChecks:[],humanAcceptance:'pending',interventionEvidence:{complete:false,events:[]},rubric:fixture.rubric},null,2),{mode:0o600});console.log('试验准备失败：'+options.version+'/'+fixture.id+' 第'+repeat+'次，原因见完整记录。');}
   if(options.evaluationPurpose==='bounded_diagnostic')try{
    const record=JSON.parse(await fs.readFile(resultFile,'utf8')),project=path.join(trial,'workspace/projects',config.hash('eval')),runFile=path.join(project,'runs',config.hash('eval')+'.json');let run,events=[];
    try{run=JSON.parse(await fs.readFile(runFile,'utf8'));events=(await fs.readFile(runFile+'.jsonl','utf8')).split('\n').filter(Boolean).map(JSON.parse);}catch{}
    const pilot=await require('./agent-eval-pilot-checks.cjs').persist(trial,{evaluationPurpose:options.evaluationPurpose,imageTarget:configuration.pilotCheckPolicy?.firstImageRequestTarget,requests:trialRequests,events,run,sourceRun:resumed?.run,resumeMetadata:resumed?.metadata,sourceInventory:resumed?.state,filesRoot:path.join(project,'files'),policy:options.evaluationPolicy,timeoutMs:options.timeoutMs,timedOut:record.timedOut,elapsedMs:record.elapsedMs,agentAndVerificationMs:record.agentAndVerificationMs});console.log(pilot.summary);
   }catch{console.log('短诊断摘要未能生成，相关进展标为未知；原试验记录保留，不能据此判断通过。');}
  }}
  await Promise.all(Array.from({length:options.concurrency},()=>worker()));
  await require('./agent-eval-report.cjs').summarize(directory);
  app.exit(sourceChanged?3:serviceBlocked?2:0);
 }catch(e){console.error(e.message);app.exit(1);}
});

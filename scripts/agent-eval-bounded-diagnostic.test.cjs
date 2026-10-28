const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const config=require('./agent-eval-config.cjs'),resume=require('./agent-eval-resume.cjs'),{createOutputBudget}=require('../apps/desktop/agent/output-budget.cjs');
const model={id:'company',name:'Fixed GLM',model:'glm-5.2',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',contextWindow:1048576,maxOutputTokens:131072,imageInput:'auto'};
const medium={reasoningControlSent:true,enableThinking:true,reasoningEffort:'medium'},low={...medium,reasoningEffort:'low'};
const argv=['--model-id','company','--output','/tmp/new-output','--resume-from','/tmp/source/candidate/weather','--environment-dir','/tmp/new-environment'];
function request(overrides={}){return {id:'request-1',modelId:model.id,contextWindow:model.contextWindow,toolMenuStage:'task',startedAt:'2026-10-25T10:00:00.000Z',durationMs:1000,requestedOutputTokens:8192,outcome:'failed',errorCode:'MODEL_OUTPUT_LIMIT',contentChars:2,reasoningChars:28607,providerUsage:{outputTokens:8192,reasoningTokens:8190},...medium,parameters:{reasoningControlSent:true,enableThinking:true},...overrides};}
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-bounded-eval-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const experiment=path.join(root,'source'),source=path.join(experiment,'candidate/weather-app-raw-1'),environment=path.join(root,'new-environment'),key=config.hash('eval'),project=path.join(source,'workspace/projects',key),runFile=path.join(project,'runs',key+'.json'),originalRequest='Preserve this complete original weather request and every acceptance requirement',event={id:'interrupted-event',type:'interrupted',at:'2026-10-25T10:01:01.010Z',detail:{message:'Evaluation timed out'}};
 for(const name of ['runs','files'])await fs.mkdir(path.join(project,name),{recursive:true});await fs.writeFile(path.join(project,'materials.json'),'[]');await fs.writeFile(path.join(project,'files/app.apk'),'preserved-apk');
 const run={taskId:'eval',projectId:'eval',status:'paused',inputKey:'original-input',executionId:'original-execution',currentRequest:originalRequest,requirements:[{id:'ui',type:'visual',text:'Original full UI'}],steps:[{id:'verify',status:'running'}],loadedExtensions:[],actionJournal:[],events:[event],updatedAt:'2026-10-25T10:01:01.020Z'};
 const progress={status:'paused',executionId:run.executionId,currentInputId:run.inputKey,updatedAt:run.updatedAt,events:[event],recoverySummary:{unknown:0}},configuration={schemaVersion:2,configurationFingerprint:'source-configuration',model:config.publicModel(model),reasoningEffort:'medium',stratum:'assisted_resume',cases:[{id:'weather-app-raw',requestHash:config.hash(originalRequest),materialFingerprint:'original-material',rubric:['Full original acceptance']}]};
 const requests=[request(),request({id:'request-2',startedAt:'2026-10-25T10:01:00.000Z',outcome:'cancelled',errorCode:'MODEL_CANCELLED',providerUsage:undefined})],result={schemaVersion:2,case:'weather-app-raw',configurationFingerprint:configuration.configurationFingerprint,runtimeFingerprint:'source-runtime',elapsedMs:61020,timedOut:true,error:{code:'MODEL_CANCELLED'},rubric:configuration.cases[0].rubric,resumeAccounting:{cumulativeElapsedMs:8114442,cumulativeModelRequests:256,cumulativeInputTokens:9354143,cumulativeOutputTokens:429577}};
 await fs.writeFile(runFile,JSON.stringify(run));await fs.writeFile(path.join(source,'progress.json'),JSON.stringify(progress));await fs.writeFile(path.join(source,'requests.json'),JSON.stringify(requests));await fs.writeFile(path.join(source,'result.json'),JSON.stringify(result));await fs.writeFile(path.join(experiment,'configuration.json'),JSON.stringify(configuration));return {root,experiment,source,environment,runFile,project,run,progress,requests,result,configuration};}
const inspect=f=>resume.inspect({sourceTrial:f.source,model,reasoningEffort:'medium',environmentDirectory:f.environment});

test('bounded CLI requires explicit time and 1..120 decisions without altering assisted timing or task acceptance',()=>{
 for(const n of ['0','121','1.5','NaN'])assert.throws(()=>config.args([...argv,'--timeout-ms','480000','--max-decisions',n],{}),/maxDecisions/);
 assert.throws(()=>config.args([...argv,'--max-decisions','8'],{}),/explicit --timeout-ms/);
 const options=config.args([...argv,'--timeout-ms','480000','--max-decisions','8'],{});
 assert.deepEqual(options.evaluationPolicy,{maxDecisions:8});assert.equal(options.evaluationPurpose,'bounded_diagnostic');assert.equal(options.stratum,'assisted_resume');assert.equal(options.timeoutMs,480000);
 const c=config.configuration(options,model,[{id:'weather',request:'Original request',rubric:['Original acceptance']}]);assert.equal(c.evaluationPurpose,'bounded_diagnostic');assert.deepEqual(c.evaluationPolicy,{maxDecisions:8});assert.equal(c.cases[0].requestHash,config.hash('Original request'));assert.deepEqual(c.cases[0].rubric,['Original acceptance']);
 const normal=config.args(argv,{});assert.equal(normal.maxDecisions,undefined);assert.equal(config.configuration(normal,model,[]).evaluationPurpose,undefined);
});

test('only fully ended timed-out cancellation with matching paused progress may be cloned and relearned',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.runFile),state=await inspect(f);assert.equal(state.metadata.sourceTermination,'verified_timeout_paused');assert.equal(state.metadata.priorElapsedMs,8114442);assert.equal(state.metadata.priorModelRequests,256);assert.equal(state.metadata.budgetLearning.samples,1);
 assert.deepEqual(await fs.readFile(f.runFile),before);await assert.rejects(fs.stat(f.environment),e=>e.code==='ENOENT');
 const target=path.join(f.root,'new/candidate/weather-app-raw-1');await resume.clone(state,target);const copied=JSON.parse(await fs.readFile(path.join(target,state.runRelative)));
 assert.equal(copied.executionId,f.run.executionId);assert.equal(copied.inputKey,f.run.inputKey);assert.equal(copied.currentRequest,f.run.currentRequest);assert.deepEqual(copied.requirements,f.run.requirements);assert.equal(createOutputBudget(model,131072,copied.outputBudget).budget(100000,'action',medium),16384);assert.deepEqual(await fs.readFile(f.runFile),before);
 const manifest=JSON.parse(await fs.readFile(path.join(target,'resume-manifest.json')));assert.equal(manifest.technicalAdjustments[0].learningSamples,1);assert.match(manifest.technicalAdjustments[0].reason,/no source action is executed/);
 const accounting=resume.accounting(state.metadata,1000,[{}]);assert.equal(accounting.cumulativeElapsedMs,8115442);assert.equal(accounting.cumulativeModelRequests,257);
});

test('missing result alone, external cancellation, earlier cancelled requests and unresolved side effects stay rejected',async t=>{
 const cases=[
  async f=>{f.result.timedOut=false;},async f=>{f.result.error.code='USER_CANCELLED';},async f=>{delete f.result.error;},
  async f=>{f.requests[0].outcome='cancelled';},async f=>{f.requests.at(-1).outcome='running';},async f=>{f.requests.at(-1).errorCode='USER_CANCELLED';},
  async f=>{f.run.actionJournal=[{action:'write_file',status:'unknown'}];},async f=>{f.run.inFlight={action:'android_device'};},
  async f=>{f.progress.status='running';},async f=>{f.progress.executionId='different';},async f=>{f.progress.currentInputId='new-input';},
  async f=>{f.progress.events=[];},async f=>{f.progress.updatedAt='2026-10-25T09:00:00.000Z';},async f=>{f.progress.recoverySummary.unknown=1;},
  async f=>{f.progress.inFlight={action:'run_command'};},async f=>{f.result.result={agentRun:{status:'completed'}};}
 ];
 for(const change of cases){const f=await fixture(t);await change(f);for(const [file,value]of [[f.runFile,f.run],[path.join(f.source,'progress.json'),f.progress],[path.join(f.source,'result.json'),f.result],[path.join(f.source,'requests.json'),f.requests]])await fs.writeFile(file,JSON.stringify(value));await assert.rejects(inspect(f),/ended|active|unknown/);}
 const f=await fixture(t);await fs.unlink(path.join(f.source,'progress.json'));await assert.rejects(inspect(f),/ended/);
});

test('timeout source progress, requests and result remain immutable between inspection and clone',async t=>{
 for(const file of ['progress.json','requests.json','result.json']){
  const f=await fixture(t),state=await inspect(f),target=path.join(f.root,'new/candidate/trial');await fs.appendFile(path.join(f.source,file),'\n');await assert.rejects(resume.clone(state,target),/metadata changed/);await assert.rejects(fs.stat(target),e=>e.code==='ENOENT');
 }
});

test('pressure replay uses actual profile and known stage, never success/no-action/cancelled samples',()=>{
 const configuration={model:config.publicModel(model),reasoningEffort:'medium'},requests=[request(),request({id:'ok',outcome:'completed',errorCode:undefined,action:'build_android'}),request({id:'timeout',errorCode:'MODEL_NO_ACTION_TIMEOUT'}),request({id:'cancel',outcome:'cancelled',errorCode:'MODEL_CANCELLED'})];
 const learned=resume.relearnBudget({requests,model,configuration});assert.equal(learned.samples,1);const p=createOutputBudget(model,131072,learned.snapshot);assert.equal(p.budget(100000,'action',medium),16384);assert.equal(p.budget(100000,'action',low),8192);assert.equal(p.budget(100000,'route',medium),4096);
 for(const change of [{modelId:'wrong'},{contextWindow:32768},{toolMenuStage:'unknown'},{reasoningEffort:'high'},{enableThinking:false},{reasoningControlSent:undefined},{parameters:{reasoningControlSent:false}},{recoveryMode:true,recoveryStage:'unknown'},{requestedOutputTokens:2000000}])assert.equal(resume.relearnBudget({requests:[request(change)],model,configuration}).samples,0);
 assert.throws(()=>resume.relearnBudget({requests,model:{...model,baseUrl:'https://other.example/v1'},configuration}),/model\/configuration/);
});

test('only uniquely paired invalid JSON near the usage ceiling learns pressure without any action',()=>{
 const configuration={model:config.publicModel(model),reasoningEffort:'medium'},r=request({outcome:'completed',errorCode:undefined}),event={type:'protocol_error',at:'2026-10-25T10:00:01.007Z',detail:{reason:'invalid_json'}};
 const learned=resume.relearnBudget({requests:[r],events:[event],model,configuration});assert.equal(learned.samples,1);assert.equal(learned.samplesByKind.invalid_json_usage_pressure,1);assert.equal(createOutputBudget(model,131072,learned.snapshot).budget(100000,'action',medium),16384);
 for(const [requests,events]of [[[r],[]],[[{...r,providerUsage:{outputTokens:3000}}],[event]],[[r,{...r,id:'duplicate'}],[event]],[[r],[{...event,detail:{reason:'invalid_parameter'}}]]])assert.equal(resume.relearnBudget({requests,events,model,configuration}).samples,0);
 assert.ok(!JSON.stringify(learned).includes('action":"'));assert.ok(!JSON.stringify(learned).includes(model.baseUrl));
});

test('legacy selected runtime explicitly reports unsupported learning and never claims a retained floor',()=>{
 const learned=resume.relearnBudget({requests:[request()],model,configuration:{model:config.publicModel(model),reasoningEffort:'medium'},budgetModule:{createOutputBudget:()=>({snapshot:()=>({version:2})})}});assert.equal(learned.supported,false);assert.equal(learned.samples,0);assert.equal(learned.snapshot,undefined);
});

test('selected old runtime or a claimed policy that does not actually constrain execution is rejected before live work',async()=>{
 const unsupported={code:'EVAL_DIAGNOSTIC_POLICY_UNSUPPORTED'};
 await assert.rejects(config.verifyDiagnosticBudget('/selected-old',{maxDecisions:8},{loadModule:()=>({runSegments:async()=>{assert.fail('old runtime must reject before probe');}})}),unsupported);
 await assert.rejects(config.verifyDiagnosticBudget('/selected-old',{maxDecisions:8},{loadModule:()=>({evaluationPolicy:()=>({segmentSteps:120,maxSegments:4}),runSegments:async()=>assert.fail('unbounded policy must reject before probe')})}),unsupported);
 await assert.rejects(config.verifyDiagnosticBudget('/selected-broken',{maxDecisions:8},{loadModule:()=>({evaluationPolicy:()=>({segmentSteps:8,maxSegments:1}),runSegments:async execute=>execute({maxSteps:120})})}),unsupported);
 await assert.rejects(config.verifyDiagnosticBudget('/selected-broken',{maxDecisions:8},{loadModule:()=>({evaluationPolicy:()=>({segmentSteps:8,maxSegments:1}),runSegments:async execute=>{await execute({maxSteps:8});await execute({maxSteps:8});}})}),unsupported);
});

test('the selected actual budget API enforces one bounded segment using a pure callback and normal runs need no capability',async()=>{
 const selected=require('../apps/desktop/agent/execution-segments.cjs'),paths=[];
 const evidence=await config.verifyDiagnosticBudget('/selected-runtime',{maxDecisions:8},{loadModule:file=>{paths.push(file);return selected;}});
 assert.deepEqual(paths,['/selected-runtime/apps/desktop/agent/execution-segments.cjs']);assert.deepEqual(evidence,{supported:true,maxDecisions:8,effectiveMaxDecisions:8,maxSegments:1,verification:'selected_runtime_pure_api_probe'});
 assert.equal(await config.verifyDiagnosticBudget('/old-runtime',undefined,{loadModule:()=>assert.fail('ordinary evaluations retain compatibility')}),undefined);
 const live=await fs.readFile(path.join(__dirname,'agent-live-eval.cjs'),'utf8');assert.ok(live.indexOf('config.verifyDiagnosticBudget(')<live.indexOf('await live.modelCredentials('));assert.ok(live.indexOf('config.verifyDiagnosticBudget(')<live.indexOf('if(options.preflight)'));
});

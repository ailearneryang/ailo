const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const recovery=require('../apps/desktop/agent/decision-recovery.cjs'),context=require('../apps/desktop/agent/working-context.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),proof=require('../apps/desktop/agent/evidence.cjs');
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-efficiency-cycle-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'t',request:'检查APK'},w=await createWorkspace(base,task);return {base,task,w};}
test('the 3525-character incident log remains complete in every recovery stage, without artificial paging',()=>{
 const value={action:'read_execution',result:{offset:0,total:3525,text:'x'.repeat(3525),next:null},arguments:{progress:{memory:'y'.repeat(8000)}}};
 for(const stage of ['small_action','refocus','direct_action']){
  const out=recovery.compact({decisionRecovery:{stage},toolResults:[context.toolPreview(value)]},context.preview).toolResults[0];
  assert.equal(out.result.text,value.result.text);assert.equal(out.result.next,null);assert.equal(out.arguments.progress,undefined);
 }
 const large=context.toolPreview({result:{text:'x'.repeat(30000),offset:0,total:30000,next:null}},1600);
 assert.ok(large.result.text.length<30000);assert.equal(large.result.next,large.result.text.length);
});
test('screenshots and viewing identical pixels are one observation across recovery windows and restarts',()=>{
 let run={inputKey:'u',steps:[{id:'s',status:'running'}]};
 const shot={path:'a.png',apkSha256:'apk',sources:[{path:'a.png',sha256:'pixels'}]};
 recovery.begin(run,'MODEL_NO_ACTION_TIMEOUT');run.decisionRecovery.noActionFailures=3;
 recovery.progress(run,{action:'android_device',operation:'screenshot'},shot);
 recovery.progress(run,{action:'view_image',path:'a.png'},{sha256:'pixels'});
 assert.equal(run.decisionRecovery.noActionFailures,3);assert.equal(run.decisionRecovery.progressKeys.length,1);
 run=JSON.parse(JSON.stringify(run));delete run.decisionRecovery;recovery.begin(run,'MODEL_NO_ACTION_TIMEOUT');
 recovery.progress(run,{action:'android_device',operation:'screenshot'},shot);
 recovery.progress(run,{action:'view_image',path:'renamed.png'},{sha256:'pixels'});
 assert.equal(run.decisionRecovery.progressKeys.length,0);
 recovery.progress(run,{action:'edit_file',path:'main.kt'},{changed:true,sha256:'new-source'});
 recovery.progress(run,{action:'verify'},{results:[{criterionId:'r',kind:'command',sources:[{path:'main.kt',sha256:'new-source'}]}]});
 assert.equal(run.decisionRecovery,undefined);
});
test('build evidence binds only requested variant and invalidates changed or added build inputs',async t=>{
 const {w}=await fixture(t),build=require('../apps/desktop/agent/android-build.cjs');
 await fs.mkdir(path.join(w.files,'app/src'),{recursive:true});await fs.writeFile(path.join(w.files,'app/src/Main.kt'),'source');
 const before=await build.sourceSnapshot(w.files);
 for(const variant of ['debug','release']){
  const dir=path.join(w.files,'app/build/outputs/apk',variant);await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'output-metadata.json'),JSON.stringify({variantName:variant,elements:[{outputFile:'app-'+variant+'.apk'}]}));
  await fs.writeFile(path.join(dir,'app-'+variant+'.apk'),variant);
 }
 const result={exitCode:0,...await build.buildEvidence(w.files,[':app:assembleDebug'],before)};
 assert.equal(result.buildArtifacts.length,1);assert.match(result.buildArtifacts[0].path,/debug/);
 w.run.requirementsManaged=true;w.run.requirements=[{id:'apk',text:'Gradle构建APK',type:'presence',scope:{kind:'file',path:result.buildArtifacts[0].path}}];
 await w.event('build_android',{revision:w.run.revision,result});const id=w.run.events.at(-1).id;
 const acceptance=require('../apps/desktop/agent/acceptance.cjs');
 await acceptance.verify(w,{checks:[{criterionId:'apk',kind:'command',evidenceId:id,reason:'标准Gradle构建与APK哈希'}]});
 await acceptance.assertAccepted(w);
 await fs.mkdir(path.join(w.files,'verification'));await fs.writeFile(path.join(w.files,'verification/shot.png'),'runtime evidence');
 await acceptance.assertAccepted(w);
 await fs.writeFile(path.join(w.files,'app/src/New.kt'),'new');
 await assert.rejects(acceptance.assertAccepted(w),/构建输入文件集合/);
 assert.equal((await build.buildEvidence(w.files,[':app:testDebugUnitTest'],before)).buildArtifacts.length,0);
 const changed={exitCode:0,...await build.buildEvidence(w.files,[':app:assembleDebug'],before)};
 await w.event('build_android',{revision:w.run.revision,result:changed});await assert.rejects(proof.event(w,w.run.events.at(-1).id),/构建期间输入/);
});
async function deviceFixture(t){
 const result=await fixture(t),{w}=result;await fs.writeFile(path.join(w.files,'app.apk'),'apk');
 const hash=await proof.hashFile(path.join(w.files,'app.apk')),calls=[];
 let running=false,installedHash,busy=false;
 const android={execute:async(_root,a)=>{
  calls.push(a.operation);
  if(a.operation==='status')return {running,busy,sessionId:'session',apkSha256:installedHash};
  if(a.operation==='start'){running=true;return {running:true,sessionId:'session'};}
  const base={apkPath:'app.apk',apkSha256:hash,sources:[{path:'app.apk',sha256:hash}],scope:{kind:'file',path:'app.apk'}};
  if(a.operation==='install'){installedHash=hash;return {...base,installed:true};}
  if(a.operation==='launch')return {...base,output:'Status: ok'};
  if(a.operation==='logs')return {...base,running:true,output:'No errors'};
  await fs.writeFile(path.join(w.files,'shot.png'),'image');
  return {...base,path:'shot.png',pixelSize:{width:1280,height:720},displayCheck:{matches:true},sources:[...base.sources,{path:'shot.png',sha256:proof.hash(Buffer.from('image'))}]};
 }};
 return {...result,android,calls,setInstalledHash:value=>{installedHash=value;},setBusy:value=>{busy=value;}};
}
test('one bounded Android check records five child events and reuses known completed work',async t=>{
 const {w,android,calls}=await deviceFixture(t),check=require('../apps/desktop/agent/android-check.cjs').execute;
 const signal=new AbortController().signal,action={action:'android_device',operation:'check',path:'app.apk'},permissions=[];
 const options={android,permissions:{before:async a=>permissions.push(a.operation)}};
 const result=await check(w,action,signal,options);assert.equal(result.checks.length,5);assert.equal(result.path,'shot.png');
 assert.deepEqual(permissions,['start','install','launch','logs','screenshot']);
 for(const c of result.checks.filter(c=>c.operation!=='start'))await proof.event(w,c.eventId);
 await check(w,action,signal,options);assert.equal(calls.filter(c=>c==='install').length,1);assert.equal(calls.filter(c=>c==='launch').length,1);
 assert.ok(w.run.actionJournal.every(e=>e.status==='succeeded'));
});
test('composite runtime effects advance recovery and returning the cached check does not reset failures again',async t=>{
 const {w,android,calls}=await deviceFixture(t),check=require('../apps/desktop/agent/android-check.cjs').execute;
 Object.assign(w.run,{inputKey:'u',steps:[{id:'s',status:'running'}]});
 recovery.begin(w.run,'MODEL_NO_ACTION_TIMEOUT',3);w.run.decisionRecovery.noActionFailures=3;
 await check(w,{path:'app.apk'},new AbortController().signal,{android});assert.equal(w.run.decisionRecovery,undefined);
 recovery.begin(w.run,'MODEL_NO_ACTION_TIMEOUT',3);w.run.decisionRecovery.noActionFailures=3;
 await check(w,{path:'app.apk'},new AbortController().signal,{android});assert.equal(w.run.decisionRecovery.noActionFailures,3);assert.equal(w.run.decisionRecovery.progressKeys.length,0);
 assert.equal(calls.filter(c=>c==='install').length,1);
});
test('a cached check is refreshed after another APK is installed in the same emulator session',async t=>{
 const {w,android,calls,setInstalledHash}=await deviceFixture(t),check=require('../apps/desktop/agent/android-check.cjs').execute;
 await check(w,{path:'app.apk'},new AbortController().signal,{android});
 setInstalledHash('different installed version');
 await check(w,{path:'app.apk'},new AbortController().signal,{android});
 assert.equal(calls.filter(c=>c==='install').length,2);assert.equal(calls.filter(c=>c==='screenshot').length,2);
});
test('a completed check refreshes runtime observations and cannot conceal a stopped app behind old logs',async t=>{
 const {w,android,calls}=await deviceFixture(t),check=require('../apps/desktop/agent/android-check.cjs').execute;
 await check(w,{path:'app.apk'},new AbortController().signal,{android});
 const execute=android.execute;android.execute=async(...args)=>{const result=await execute(...args);return args[1].operation==='logs'?{...result,running:false}:result;};
 await assert.rejects(check(w,{path:'app.apk'},new AbortController().signal,{android}),/有效成功结果/);
 assert.equal(calls.filter(c=>c==='logs').length,2);assert.equal(calls.filter(c=>c==='install').length,1);assert.equal(calls.filter(c=>c==='launch').length,1);
});
test('cached observations are not reused while the device is busy or a separate installation is unknown',async t=>{
 const {w,android,calls,setBusy}=await deviceFixture(t),check=require('../apps/desktop/agent/android-check.cjs').execute;
 await check(w,{path:'app.apk'},new AbortController().signal,{android});const count=calls.length;
 setBusy(true);await assert.rejects(check(w,{path:'app.apk'},new AbortController().signal,{android}),/其他操作/);assert.equal(calls.length,count+1);
 setBusy(false);const unknown=require('../apps/desktop/agent/action-journal.cjs').begin(w.run,{action:'android_device',operation:'install',path:'another.apk'});unknown.status='unknown';
 await assert.rejects(check(w,{path:'app.apk'},new AbortController().signal,{android}),e=>e.code==='ACTION_RESULT_UNKNOWN');assert.equal(calls.length,count+1);
});
test('invalid APKs are rejected before device authorization or startup',async t=>{
 const {w,android,calls}=await deviceFixture(t),check=require('../apps/desktop/agent/android-check.cjs').execute;
 await fs.writeFile(path.join(w.files,'empty.apk'),'');
 await assert.rejects(check(w,{path:'empty.apk'},new AbortController().signal,{android}),/非空/);
 await fs.writeFile(path.join(w.files,'big.apk'),'');await fs.truncate(path.join(w.files,'big.apk'),151*1024*1024);
 await assert.rejects(check(w,{path:'big.apk'},new AbortController().signal,{android}),/150MB/);assert.deepEqual(calls,[]);
});
test('unknown installation is never replayed by a composite retry or continuation',async t=>{
 const {w,android,calls}=await deviceFixture(t),check=require('../apps/desktop/agent/android-check.cjs').execute,original=android.execute;
 android.execute=async(...args)=>{if(args[1].operation==='install'){calls.push('install');throw Object.assign(Error('connection lost after install'),{code:'ETIMEDOUT'});}return original(...args);};
 const action={action:'android_device',operation:'check',path:'app.apk'},signal=new AbortController().signal;
 await assert.rejects(check(w,action,signal,{android}),/connection lost/);
 await require('../apps/desktop/agent/action-journal.cjs').reconcile(w);
 await assert.rejects(check(w,action,signal,{android}),e=>e.code==='ACTION_RESULT_UNKNOWN');
 assert.equal(calls.filter(c=>c==='install').length,1);
});
test('device checks stop before launching when permission is denied',async t=>{
 const {w,android,calls}=await deviceFixture(t);
 await assert.rejects(require('../apps/desktop/agent/android-check.cjs').execute(w,{path:'app.apk'},new AbortController().signal,{android,permissions:{before:async()=>{throw Object.assign(Error('denied'),{code:'PERMISSION_DENIED'});}}}),/denied/);
 assert.deepEqual(calls,['status']);
});
test('a failed log read resumes from logs and never repeats the completed install or launch',async t=>{
 const {base,task,w,android,calls}=await deviceFixture(t),check=require('../apps/desktop/agent/android-check.cjs').execute,original=android.execute;
 let fail=true;android.execute=async(...args)=>{if(args[1].operation==='logs'&&fail){fail=false;throw Error('log unavailable');}return original(...args);};
 const action={path:'app.apk'},signal=new AbortController().signal;
 await assert.rejects(check(w,action,signal,{android}),/log unavailable/);
 const restored=await createWorkspace(base,task);await check(restored,action,signal,{android});
 assert.equal(calls.filter(c=>c==='install').length,1);assert.equal(calls.filter(c=>c==='launch').length,1);
});
test('a succeeded side effect without a saved receipt is not replayed after a crash',async t=>{
 const {w,android}=await deviceFixture(t),journal=require('../apps/desktop/agent/action-journal.cjs');
 const entry=journal.begin(w.run,{action:'android_device',operation:'install',path:'app.apk'});entry.status='succeeded';
 const apkSha256=await proof.hashFile(path.join(w.files,'app.apk'));
 const key=createHash('sha256').update(JSON.stringify(['app.apk',apkSha256,undefined])).digest('hex');
 w.run.androidCheck={key,pending:entry.id,steps:[]};
 await assert.rejects(require('../apps/desktop/agent/android-check.cjs').execute(w,{path:'app.apk'},new AbortController().signal,{android}),e=>e.code==='ACTION_RESULT_UNKNOWN');
});
test('a known failed read permits a new check configuration, while a missing journal receipt blocks replay',async t=>{
 const {base,task,w,android,calls}=await deviceFixture(t),check=require('../apps/desktop/agent/android-check.cjs').execute,original=android.execute;
 let fail=true;android.execute=async(...args)=>{if(args[1].operation==='logs'&&fail){fail=false;throw Error('log unavailable');}return original(...args);};
 const signal=new AbortController().signal;
 await assert.rejects(check(w,{path:'app.apk'},signal,{android}),/log unavailable/);
 const restored=await createWorkspace(base,task);
 await check(restored,{path:'app.apk',display:{width:1280,height:720,density:160}},signal,{android});
 assert.equal(restored.run.androidCheck.steps.length,5);
 const count=calls.length;restored.run.androidCheck.pending='missing-receipt';
 await assert.rejects(check(restored,{path:'app.apk'},signal,{android}),e=>e.code==='ACTION_RESULT_UNKNOWN');assert.equal(calls.length,count);
});
test('the same five device operations need eight separate decisions or four composite decisions',async t=>{
 const counts=[];
 for(const combined of [false,true]){
  const {base,task,android,calls}=await deviceFixture(t);
  const actions=[{action:'route',kind:'task'},{action:'plan',goal:'安装启动并观察APK',decisions:[],acceptance:['运行截图可用于后续核验'],steps:[{id:'runtime',title:'观察运行',status:'running'}]},
   ...(combined?[{action:'android_device',operation:'check',path:'app.apk'}]:['start','install','launch','logs','screenshot'].map(operation=>({action:'android_device',operation,...(operation==='install'?{path:'app.apk'}:{})}))),{action:'pause',text:'运行观察已保存，视觉与交互尚待核验'}];
  let n=0;
  const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task,android,model:{contextWindow:65536},signal:new AbortController().signal,ask:async()=>{assert.ok(n<actions.length);return {content:JSON.stringify(actions[n++])};}});
  assert.equal(result.agentRun.status,'paused');assert.equal(calls.filter(c=>c!=='status').length,5);counts.push(n);
 }
 assert.deepEqual(counts,[8,4]);
});
test('per-task telemetry outlives global retention, remains bounded and excludes prompts and secrets',async t=>{
 const {base}=await fixture(t),{createStorage}=require('../apps/desktop/storage.cjs'),storage=createStorage(base,{});
 const key=createHash('sha256').update('task').digest('hex'),dir=path.join(base,'model-request-history');await fs.mkdir(dir);
 await fs.writeFile(path.join(dir,key+'.json'),JSON.stringify(Array.from({length:2000},(_,i)=>({id:String(i)}))));
 await storage.recordModelRequest({taskId:'task',id:'latest',durationMs:500,action:'read_file',prompt:'private prompt',apiKey:'secret',providerUsage:{inputTokens:10,outputTokens:2}});
 const saved=JSON.parse(await fs.readFile(path.join(dir,key+'.json'),'utf8'));assert.equal(saved.length,2000);assert.equal(saved[0].id,'1');assert.equal(saved.at(-1).action,'read_file');assert.ok(!JSON.stringify(saved).includes('private prompt'));assert.ok(!JSON.stringify(saved).includes('secret'));
});
test('operational reasoning is provider-scoped and never applied to repair or visual judgment',()=>{
 const r=require('../apps/desktop/reasoning.cjs'),model={baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'glm-5.2'};
 assert.equal(r.decisionStage({executionState:{nextAction:'read_execution'}}),'operation');
 assert.equal(r.decisionReasoningParameters(model,'operation').reasoning_effort,'low');
 assert.deepEqual(r.decisionReasoningParameters({baseUrl:'https://company.example/v1',model:'glm-5.2'},'operation'),{});
 for(const nextAction of ['edit_file','verify','view_image'])assert.equal(r.decisionStage({executionState:{nextAction}}),'action');
 assert.equal(r.decisionStage({executionState:{nextAction:'read_file',blocker:{message:'compile failed'}}}),'action');
});
test('performance UI separates completed steps, passed acceptance, visual checks and measured runtime counters',async()=>{
 const Module=require('node:module'),app=path.resolve(__dirname,'../apps/desktop'),deps=Module.createRequire(path.join(app,'package.json')),React=deps('react'),{renderToStaticMarkup}=deps('react-dom/server');
 const {build}=await import(require('node:url').pathToFileURL(deps.resolve('rolldown')).href);
 const input=path.join(app,'src/task-progress.tsx'),bundle=await build({input,platform:'node',external:['react','react/jsx-runtime'],write:false,output:{format:'cjs'}});
 const compiled=new Module(input,module);compiled.paths=Module._nodeModulePaths(path.dirname(input));compiled._compile(bundle.output.find(o=>o.type==='chunk').code,input);
  const {TaskProgress,executionEventText}=compiled.exports;
  const run={executionId:'run',status:'running',mode:'task',goal:'实现页面',steps:[{id:'s',title:'写入页面',status:'done'}],decisions:[],acceptance:['文件存在','视觉一致'],artifacts:[],events:[],acceptanceCriteria:[{id:'file',text:'文件存在',type:'presence',status:'passed'},{id:'ui',text:'视觉一致',type:'visual',status:'pending'}]};
  require('../apps/desktop/agent/performance.cjs').init(run);
  const html=renderToStaticMarkup(React.createElement(TaskProgress,{task:{id:'t',messages:[],agentRun:run},busy:false,onContinue(){},onOpenArtifacts(){}}));
  assert.match(html,/验收 1\/2 项/);assert.match(html,/视觉 0\/1 项/);assert.match(html,/步骤完成不代表验收通过/);assert.match(html,/工具成功不代表验收通过/);
  const withRegion=renderToStaticMarkup(React.createElement(TaskProgress,{task:{id:'t',messages:[],agentRun:{...run,designRegionIssues:[{regionId:'grid',region:'数据卡片',reason:'卡片缺失'}]}},busy:false,onContinue(){},onOpenArtifacts(){}}));
  assert.match(withRegion,/视觉验收未通过/);assert.match(withRegion,/数据卡片：卡片缺失/);
  assert.equal(executionEventText({type:'android_device',detail:{operation:'logs'}}),'读取运行日志');
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {runSegments}=require('../apps/desktop/agent/execution-segments.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const taskState=require('../apps/desktop/agent/task-state.cjs');
test('runtime identity matches source and packaged layouts and ignores build-only configuration',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-runtime-provenance-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),packed=path.join(root,'packed');
 for(const dir of [source,packed]){await fs.mkdir(path.join(dir,'agent'),{recursive:true});await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({version:'0.1.65'}));await fs.writeFile(path.join(dir,'chat.cjs'),'module.exports={}');await fs.writeFile(path.join(dir,'agent/runner.cjs'),'module.exports={}');}
 await fs.writeFile(path.join(source,'vite.config.mjs'),'development-only');await fs.writeFile(path.join(source,'forge.config.cjs'),'packaging-only');
 const {capture}=require('../apps/desktop/runtime-provenance.cjs'),a=capture(source),b=capture(packed);assert.equal(a.runtimeFingerprint,b.runtimeFingerprint);assert.equal(a.appVersion,'0.1.65');
 await fs.writeFile(path.join(packed,'agent/runner.cjs'),'module.exports={changed:true}');assert.notEqual(capture(packed).runtimeFingerprint,a.runtimeFingerprint);
});
const model={id:'offline',contextWindow:131072},response=action=>({content:JSON.stringify(action)});
const plan={action:'plan',goal:'生成可核验的天气说明',decisions:['保留中文'],requirements:[{id:'weather',type:'content',text:'说明包含天气主页面'}],steps:[{id:'make',title:'生成并核验说明',status:'running'}]};
async function fixture(t,id){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-segments-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return {base,task:{id,request:plan.goal,messages:[{id:'original',role:'user',content:plan.goal}]}};}
test('a productive task crosses a segment without rerouting, replaying work or changing its evidence',async t=>{
 const data=await fixture(t,'productive'),signal=new AbortController().signal;let routes=0,writes=0,continues=0,calls=0;
 const ask=async messages=>{calls++;const s=JSON.parse(messages.at(-1).content);
  if(s.phase==='route'){routes++;return response({action:'route',kind:'task'});}
  if(!s.steps.length)return response(plan);
  if(!s.artifacts.length){if(!writes++){return response({action:'write_file',path:'weather.txt',content:'天气主页面'});}return response({action:'artifact',path:'weather.txt',label:'天气说明'});}
  if(!s.acceptanceCriteria[0].check)return response({action:'verify',checks:[{criterionId:'weather',kind:'text_contains',path:'weather.txt',contains:['天气主页面'],reason:'核对原始文字要求'}],progress:{steps:[{id:'make',status:'done'}]}});
  return response({action:'finish',text:'天气说明已完成',review:{summary:'当前文件内容与原始要求逐项核验通过',issues:[],unverified:[]}});
 };
 const result=await runSegments(options=>runAgent({...data,model,signal,ask,...options}),{signal,policy:{segmentSteps:4},onContinue:()=>continues++});
 assert.equal(result.agentRun.status,'completed');assert.equal(routes,1);assert.equal(calls,5);assert.equal(continues,1);
 const w=await createWorkspace(data.base,data.task);assert.equal(w.run.performance.automaticContinuations,1);assert.equal(w.run.events.filter(e=>e.type==='write_file').length,1);assert.equal(w.run.acceptanceResults.weather.status,'passed');assert.ok(w.run.observationIndex.length>=3);
 assert.equal(w.run.runtimeIdentity.runtimeFingerprint.length,64);assert.equal(w.run.runtimeHistory.length,1);
});
test('bookkeeping without actual progress cannot renew a task segment',async t=>{
 const data=await fixture(t,'bookkeeping'),signal=new AbortController().signal;let executions=0;
 const result=await runSegments(options=>{executions++;return runAgent({...data,model,signal,...options,ask:async messages=>{const s=JSON.parse(messages.at(-1).content);return response(s.phase==='route'?{action:'route',kind:'task'}:!s.steps.length?plan:{action:'checkpoint',text:'原始要求、来源与计划仍保留；下一步需要生成天气说明，当前尚无真实成果。'});}});},{signal,policy:{segmentSteps:3}});
 assert.equal(executions,1);assert.equal(result.agentRun.status,'blocked');assert.equal(result.agentRun.delivery.status,'settled');assert.equal(result.continuation,undefined);
});
test('an explicit user pause or missing authorization never starts another segment',async t=>{
 for(const permission of [false,true]){
  const data=await fixture(t,'stop-'+permission),signal=new AbortController().signal;let executions=0;
  const result=await runSegments(options=>{executions++;return runAgent({...data,model,signal,...options,executeTool:async()=>{throw Object.assign(Error('需要授权'),{code:'PERMISSION_REQUIRED'});},ask:async messages=>{const s=JSON.parse(messages.at(-1).content);return response(s.phase==='route'?{action:'route',kind:'task'}:!s.steps.length?plan:permission?{action:'write_file',path:'weather.txt',content:'天气'}:{action:'pause',text:'按用户要求暂停'});}});},{signal});
  assert.equal(executions,1);assert.equal(result.agentRun.status,permission?'waiting_permission':'paused');assert.equal(result.continuation,undefined);
 }
});
test('the overall time budget and cancellation bound automatic continuation',async()=>{
 const controller=new AbortController();let now=0,calls=0;const durations=[];
 const execute=async options=>{calls++;durations.push(options.maxDurationMs);now+=10;return {agentRun:{mode:'task',status:'paused'},continuation:{safe:true}};};
 const result=await runSegments(execute,{signal:controller.signal,now:()=>now,policy:{segmentDurationMs:10,maxTotalDurationMs:15}});
 assert.deepEqual(durations,[10,5]);assert.equal(calls,2);assert.equal(result.continuation,undefined);
 calls=0;now=0;await assert.rejects(runSegments(execute,{signal:controller.signal,now:()=>now,onContinue:()=>controller.abort(),policy:{segmentDurationMs:10,maxTotalDurationMs:100}}),e=>e.name==='AbortError');assert.equal(calls,1);
});
test('user corrections survive short conversation windows and replacing working summaries',()=>{
 const task={request:'生成天气页面',messages:[{id:'u1',role:'user',content:'生成天气页面'},{id:'u2',role:'user',content:'更正：单位必须使用摄氏度，主页面保持横屏。'},...Array.from({length:12},(_,i)=>({id:'c'+i,role:'user',content:i%2?'继续任务':'继续'}))]};
 const run={executionId:'same',workingMemory:'简短工作记忆',requirements:[{id:'weather',text:'生成天气页面',type:'content'}],decisions:[]};
 const first=taskState.context(run,task);assert.ok(first.userInstructions.some(row=>row.text.includes('摄氏度')));assert.equal(first.userInstructions.length,2);
 run.workingMemory='摘要重写后也不得丢失用户更正';const second=taskState.context(run,task);assert.equal(second.inputFingerprint,first.inputFingerprint);assert.ok(second.userInstructions.some(row=>row.id==='u2'&&row.text.includes('横屏')));
 run.executionInputStart=task.messages.length;task.messages.push({id:'new',role:'user',content:'新任务只生成摘要'});assert.equal(taskState.context(run,task).userInstructions.length,1);assert.equal(run.taskState.userInputs[0].id,'new');
});
test('large user instructions are explicitly marked as incomplete while original text remains recoverable',()=>{
 const text='原始约束'.repeat(8000),run={executionId:'large',decisions:[]},task={messages:[{id:'large',role:'user',content:text}]};
 const context=taskState.context(run,task);assert.equal(context.userInstructions[0].truncated,true);assert.equal(context.userInstructions[0].totalChars,text.length);assert.equal(run.taskState.userInputs[0].text,text);assert.match(context.notice,/read_history/);
});
test('the runner preserves pending-review classification without inventing a product failure target',async t=>{
 const data=await fixture(t,'pending-review'),acceptance=require('../apps/desktop/agent/acceptance.cjs'),original=acceptance.verify;
 acceptance.verify=async()=>{throw Object.assign(Error('区域需要补齐核验证据'),{code:'VISUAL_REVIEW_PENDING',criterionId:'weather'});};
 try{
  let asked=false;
  const result=await runAgent({...data,model,signal:new AbortController().signal,ask:async messages=>{const s=JSON.parse(messages.at(-1).content);
   if(s.phase==='route')return response({action:'route',kind:'task'});if(!s.steps.length)return response(plan);
   if(!asked){asked=true;return response({action:'verify',checks:[{criterionId:'weather',kind:'text_contains',path:'weather.txt',contains:['天气'],reason:'检查原要求'}]});}
   assert.equal(s.executionState.blocker.code,'VISUAL_REVIEW_PENDING');assert.equal(s.repairTargets.length,0);return response({action:'blocked',text:'当前仅缺核验证据，未声明完成'});
  }});
  assert.equal(result.agentRun.status,'blocked');assert.equal(result.agentRun.performance.validationFailures,0);
 }finally{acceptance.verify=original;}
});
test('chat keeps a browser session across automatic segments and closes it once at the final boundary',async t=>{
 const data=await fixture(t,'browser-lifecycle');
 const storage=require('../apps/desktop/storage.cjs').createStorage(data.base,{});
 storage.agentDirectory=path.join(data.base,'agent');storage.agentExecutionPolicy={segmentSteps:4};
 storage.modelCredentials=async()=>({...model,id:'offline',model:'company-fixture',baseUrl:'https://company.example/v1',imageInput:'disabled'});
 const task=await storage.patchTask(data.task.id,{request:plan.goal,materials:[]},data.task.messages);
 let active=false,closed=0,inspected=false;
 storage.browserObserver={close(){active=false;closed++;},async execute(w,a){
  if(a.operation==='open')active=true;
  else {assert.equal(active,true,'automatic segment must keep the actual browser page');inspected=true;}
  return {path:'weather.txt',dom:{missingImages:[],layoutHealth:{scope:'document',textNodes:1,clippedTextNodes:0}},errors:[],sources:[{path:'weather.txt',sha256:require('node:crypto').createHash('sha256').update('天气主页面').digest('hex')}],scope:{kind:'viewport',path:'weather.txt'}};
 }};
 const actions=[{action:'route',kind:'task'},plan,{action:'write_file',path:'weather.txt',content:'天气主页面'},{action:'browser',operation:'open',path:'weather.txt'},{action:'browser',operation:'inspect'},{action:'artifact',path:'weather.txt',label:'天气说明'},{action:'verify',checks:[{criterionId:'weather',kind:'text_contains',path:'weather.txt',contains:['天气主页面'],reason:'检查实际文件正文'}],progress:{steps:[{id:'make',status:'done'}]}},{action:'finish',text:'已完成天气说明',review:{summary:'文件与原要求已核验',issues:[],unverified:[]}}];
 const chat=require('../apps/desktop/chat.cjs').createChat(storage,async()=>Response.json({choices:[{message:{tool_calls:[{id:'call',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(actions.shift())}}]},finish_reason:'tool_calls'}]}));
 const result=await chat.complete({id:'request',taskId:task.id,modelId:'offline',executionOrigin:'evaluation',messages:data.task.messages});
 assert.equal(result.agentRun.status,'completed');assert.equal(inspected,true);assert.equal(closed,1);assert.equal(active,false);assert.equal(result.agentRun.performance.automaticContinuations,1);assert.equal(result.agentRun.interventionTracking.complete,true);
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {createStorage}=require('../apps/desktop/storage.cjs');
const {createChat}=require('../apps/desktop/chat.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const {actionTools,compactProgress}=require('../apps/desktop/agent/protocol.cjs');
const repair=require('../apps/desktop/agent/repair-context.cjs');
const company={id:'company',baseUrl:'https://company.example/v1',model:'GLM-5.2',contextWindow:131072,maxOutputTokens:65536};
const plan={action:'plan',goal:'修复构建并输出报告',decisions:[],acceptance:['报告包含 BUILD SUCCESSFUL'],steps:[{id:'build',title:'修复并验证',status:'running'}]};
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-portable-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return base;}
const reply=action=>({content:JSON.stringify(action)});
const native=(action,named=false)=>Response.json({choices:[{message:{tool_calls:[{id:'call',type:'function',function:{name:named?action.action:'ailo_action',arguments:JSON.stringify(named?Object.fromEntries(Object.entries(action).filter(([k])=>k!=='action')):action)}}]},finish_reason:'tool_calls'}]});

test('named tools avoid repeated progress schemas while plan retains issue capabilities',()=>{
 const state={phase:'task',decisionRecovery:{stage:'refocus'}};
 const tools=actionTools(state),bytes=JSON.stringify(tools).length;
 const duplicated=tools.map(t=>{const x=structuredClone(t);x.function.parameters.properties.progress=require('../apps/desktop/agent/attached-progress.cjs').schema;return x;});
 assert.ok(bytes<JSON.stringify(duplicated).length*.5);
 assert.deepEqual(tools.find(t=>t.function.name==='edit_file').function.parameters.properties.progress,compactProgress);
 assert.ok(tools.find(t=>t.function.name==='plan').function.parameters.properties.progress.properties.issues);
});

test('company gateway completes recovery without vendor parameters or model switching',async t=>{
 const directory=await fixture(t),storage=createStorage(directory,{});storage.agentDirectory=path.join(directory,'agent');storage.modelCredentials=async()=>company;
 const task=await storage.patchTask('company-task',{request:plan.goal,materials:[]});
 const bodies=[],records=[];let n=0;storage.recordModelRequest=async record=>records.push({...record});
 const chat=createChat(storage,async(url,options)=>{
  assert.equal(url.hostname,'company.example');const body=JSON.parse(options.body);bodies.push(body);n++;
  assert.equal(body.model,company.model);assert.equal(body.reasoning_effort,undefined);assert.equal(body.enable_thinking,undefined);assert.equal(body.thinking,undefined);
  const s=JSON.parse(body.messages.at(-1).content);
  if(n>8)assert.fail(JSON.stringify({n,required:s.requiredAction,failures:s.failureMemory,results:s.toolResults}));
  if(n===1)return native({action:'route',kind:'task'});
  if(n===2)return native(plan);
  if(n===3||n===4)return Response.json({usage:{prompt_tokens:100,completion_tokens:body.max_tokens},choices:[{message:{content:null,reasoning_content:'thinking'},finish_reason:'length'}]});
  if(s.decisionRecovery)assert.ok(body.messages[0].content.length<bodies[2].messages[0].content.length/2);
  if(n===5){assert.equal(s.decisionRecovery.stage,'refocus');assert.equal(body.max_tokens,32768);assert.ok(JSON.stringify(body.tools).length<40000);return native({action:'write_file',path:'report.txt',content:'BUILD SUCCESSFUL'},true);}
  if(n===6)return native({action:'artifact',path:'report.txt',label:'报告'},true);
  if(n===7)return native({action:'verify',checks:[{criterionId:s.acceptanceCriteria[0].id,kind:'text_contains',path:'report.txt',contains:['BUILD SUCCESSFUL'],reason:'报告内容核验'}],progress:{steps:[{id:'build',status:'done'}]}},true);
  return native({action:'finish',text:'完成',review:{summary:'已核验实际文件',issues:[],unverified:[]}},true);
 });
 const result=await chat.complete({id:'request',taskId:task.id,modelId:'company',messages:[{role:'user',content:plan.goal}]});
 assert.equal(result.agentRun.status,'completed',JSON.stringify({content:result.content,n,events:result.agentRun.events}));assert.equal(n,8);
 assert.deepEqual(bodies.slice(2,5).map(b=>b.max_tokens),[8192,16384,32768]);
 assert.deepEqual(records.filter(r=>r.recoveryMode).slice(0,2).map(r=>r.noActionTimeoutMs),[180000,240000]);
});

test('repair context supplies fresh source, layout and versions, rejecting foreign paths and links',async t=>{
 const base=await fixture(t),w=await createWorkspace(base,{id:'sources',request:plan.goal});
 const sourcePath='app/src/main/java/MainActivity.kt',layoutPath='app/src/main/res/layout/activity_main.xml';
 await fs.mkdir(path.dirname(path.join(w.files,sourcePath)),{recursive:true});await fs.mkdir(path.dirname(path.join(w.files,layoutPath)),{recursive:true});
 await fs.writeFile(path.join(w.files,sourcePath),'setContentView(R.layout.activity_main)\nval view = R.id.rvDailyForecast');
 await fs.writeFile(path.join(w.files,layoutPath),'<FrameLayout/>');
 const output='e: '+pathToFileURL(path.join(w.files,sourcePath)).href+':2:14 Unresolved reference: rvDailyForecast';
 const build={id:'build-event',detail:{revision:0,result:{exitCode:1,output}}};
 const first=await repair.collect(w,build);assert.deepEqual(first.files.map(f=>f.path),[sourcePath,layoutPath]);assert.equal(first.files[0].excerpts[0].text,'setContentView(R.layout.activity_main)\nval view = R.id.rvDailyForecast');
 await fs.writeFile(path.join(w.files,sourcePath),'changed');const second=await repair.collect(w,build);assert.notEqual(first.files[0].sha256,second.files[0].sha256);
 const secret=path.join(base,'outside.kt');await fs.writeFile(secret,'private');await fs.symlink(secret,path.join(w.files,'linked.kt'));
 const bad=await repair.collect(w,{...build,detail:{result:{exitCode:1,output:'e: '+pathToFileURL(secret).href+':1:1 error\ne: '+pathToFileURL(path.join(w.files,'linked.kt')).href+':1:1 error'}}});assert.deepEqual(bad.files,[]);
});

test('failed build recovers through real edits and verification without rereading archived logs',async t=>{
 const base=await fixture(t),task={id:'compile',request:plan.goal},w=await createWorkspace(base,task);
 const sourcePath='app/src/main/java/MainActivity.kt',layoutPath='app/src/main/res/layout/activity_main.xml';
 await fs.mkdir(path.dirname(path.join(w.files,sourcePath)),{recursive:true});await fs.mkdir(path.dirname(path.join(w.files,layoutPath)),{recursive:true});
 await fs.writeFile(path.join(w.files,sourcePath),'setContentView(R.layout.activity_main)\nval view = R.id.oldId');await fs.writeFile(path.join(w.files,layoutPath),'<FrameLayout/>');
 let n=0,builds=0;const actions=[],budgets=[];
 const result=await runAgent({base,task,model:company,extensions:[{id:'skill',kind:'skill',name:'original skill',enabled:true,instructions:'KEEP_SKILL_IN_RECOVERY'}],signal:new AbortController().signal,
 executeTool:async(workspace,a,signal,options)=>{
  actions.push(a.action);
  if(a.action!=='build_android')return execute(workspace,a,signal,options);
  builds++;const source=await fs.readFile(path.join(w.files,sourcePath),'utf8'),layout=await fs.readFile(path.join(w.files,layoutPath),'utf8');
  if(source.includes('oldId')||!layout.includes('newId'))return {exitCode:1,output:'e: '+pathToFileURL(path.join(w.files,sourcePath)).href+':2:14 Unresolved reference: oldId'};
  await fs.writeFile(path.join(w.files,'report.txt'),'BUILD SUCCESSFUL');return {exitCode:0,output:'BUILD SUCCESSFUL'};
 },ask:async(messages,budget)=>{
  n++;const s=JSON.parse(messages.at(-1).content);budgets.push(budget);assert.match(messages[0].content,/KEEP_SKILL_IN_RECOVERY/);
  if(n===1)return reply({action:'route',kind:'task'});
  if(n===2)return reply(plan);
  if(n===3)return reply({action:'build_android',tasks:[':app:assembleDebug']});
  if(n===4||n===5)throw Object.assign(Error('thinking'),{code:'MODEL_OUTPUT_LIMIT',diagnostics:{contentChars:0,reasoningChars:30000}});
  if(n===6||n===7){
   const relative=n===6?sourcePath:layoutPath,current=s.repairContext.files.find(f=>f.path===relative);assert.ok(current);
   return reply({action:'edit_file',path:relative,version:current.sha256,edits:[{oldText:n===6?'R.id.oldId':'<FrameLayout/>',newText:n===6?'R.id.newId':'<FrameLayout android:id="@+id/newId"/>'}]});
  }
  if(n===8)return reply({action:'build_android',tasks:[':app:assembleDebug'],progress:{memory:'已依据当前源码与布局修复资源引用，继续构建验证，不重复读取旧日志。'}});
  if(n===9)return reply({action:'artifact',path:'report.txt',label:'构建报告'});
  if(n===10)return reply({action:'verify',checks:[{criterionId:s.acceptanceCriteria[0].id,kind:'text_contains',path:'report.txt',contains:['BUILD SUCCESSFUL'],reason:'核对本次构建结果'}],progress:{steps:[{id:'build',status:'done'}]}});
  return reply({action:'finish',text:'完成',review:{summary:'修复后构建验证完成',issues:[],unverified:[]}});
 }});
 assert.equal(result.agentRun.status,'completed');assert.equal(builds,2);assert.equal(n,11);assert.deepEqual(budgets.slice(3,6),[8192,16384,32768]);
 assert.ok(!actions.includes('read_execution'));assert.ok(!actions.includes('read_file'));assert.equal(actions.filter(a=>a==='edit_file').length,2);
});

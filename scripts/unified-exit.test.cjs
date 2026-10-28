const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {runAgent}=require('../apps/desktop/agent/runner.cjs'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const sources=require('../apps/desktop/agent/result-sources.cjs'),settlement=require('../apps/desktop/agent/result-settlement.cjs'),policy=require('../apps/desktop/agent/exit-policy.cjs');
const response=action=>({content:JSON.stringify(action)}),hash=text=>createHash('sha256').update(text).digest('hex');
const plan={action:'plan',goal:'生成正文和补充文件',decisions:[],requirements:[{id:'body',text:'正文包含已核对正文',type:'content'},{id:'extra',text:'补充包含已核对补充',type:'content'}],steps:[{id:'s',title:'制作与核验',status:'running'}]};
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-unified-exit-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'t',request:plan.goal,messages:[{id:'u',role:'user',content:plan.goal}]};return {base,task,model:{contextWindow:131072},signal:new AbortController().signal};}
test('an early model-written blocker goes back to execution; real repair can fully finish',async t=>{
 const f=await fixture(t);let step=0,noticed=false;
 const actions=[plan,{action:'blocked',text:'没有办法生成文件。'},{action:'write_file',path:'body.txt',content:'已核对正文'},{action:'artifact',path:'body.txt',label:'正文'},{action:'write_file',path:'extra.txt',content:'已核对补充'},{action:'artifact',path:'extra.txt',label:'补充'},
  {action:'verify',checks:[{criterionId:'body',kind:'text_contains',path:'body.txt',contains:['已核对正文'],reason:'正文已读回核对'},{criterionId:'extra',kind:'text_contains',path:'extra.txt',contains:['已核对补充'],reason:'补充已读回核对'}],progress:{steps:[{id:'s',status:'done'}]}},
  {action:'finish',text:'已交付两份文件。',review:{summary:'两份文件均满足原始要求并已检查',issues:[],unverified:[]}}];
 const result=await runAgent({...f,ask:async messages=>{const state=JSON.parse(messages.at(-1).content);if(state.resultRecovery)noticed=true;return response(state.phase==='route'?{action:'route',kind:'task'}:actions[step++]);}});
 assert.equal(noticed,true);assert.equal(result.agentRun.status,'completed');assert.ok(result.agentRun.acceptanceCriteria.every(c=>c.status==='passed'));const w=await createWorkspace(f.base,f.task);assert.equal(w.run.events.filter(e=>e.type==='write_file').length,2);assert.ok(w.run.events.some(e=>e.type==='result_recovery'));
});
test('a repeating early blocker ends in a truthful result rather than renewing its recovery forever',async t=>{
 const f=await fixture(t);let calls=0;
 const result=await runAgent({...f,ask:async messages=>{calls++;const s=JSON.parse(messages.at(-1).content);return response(s.phase==='route'?{action:'route',kind:'task'}:!s.steps.length?plan:{action:'blocked',text:'没有可行方法。'});}});
 assert.equal(calls,4);assert.equal(result.agentRun.delivery.status,'settled');assert.equal(result.agentRun.delivery.outcome,'blocked');assert.ok(result.agentRun.acceptanceCriteria.every(c=>c.status==='pending'));assert.equal(result.agentRun.taskContinuation.taskOpen,false);
});
test('an unavailable optional search tool does not prevent independent file creation',async t=>{
 const f=await fixture(t);let step=0;
 const actions=[plan,{action:'web_search',query:'补充资料',purpose:'查补充材料'},{action:'write_file',path:'body.txt',content:'已核对正文'},{action:'artifact',path:'body.txt',label:'正文'}, {action:'blocked',text:'已生成正文，搜索不可用，补充资料缺口保留。'}];
 const result=await runAgent({...f,ask:async messages=>response(JSON.parse(messages.at(-1).content).phase==='route'?{action:'route',kind:'task'}:actions[step++]),webSearch:{execute:async()=>{throw Object.assign(Error('搜索当前不可用'),{code:'SEARCH_UNAVAILABLE'});}}});
 assert.equal(result.agentRun.status,'partial');assert.equal(result.agentRun.delivery.availableArtifacts[0].path,'body.txt');assert.deepEqual(result.agentRun.delivery.unverified,['body','extra']);assert.equal(result.agentRun.taskContinuation.taskOpen,false);
});
test('only confirmed external conditions interrupt; unknown internal error names do not ask for service recovery',async t=>{
 for(const code of ['SOME_NEW_INTERNAL_FAILURE','MODEL_CONTEXT_LIMIT','MODEL_FORMAT_UNSUPPORTED','EXECUTION_STATE_SOURCE',''])assert.equal(policy.classify({code},{}),'internal');
 for(const code of ['MCP_RESULT_UNKNOWN','ACTION_RESULT_UNKNOWN'])assert.equal(policy.classify({code},{}),'unknown_result');
 for(const code of ['MCP_AUTH_REQUIRED','PERMISSION_DIRECTORY','FEISHU_DECLINED'])assert.equal(policy.classify({code},{}),'permission');
 assert.equal(policy.classify({code:'MCP_ERROR',notExecuted:true},{}),'component');assert.equal(policy.classify({code:'MODEL_PROVIDER_ERROR'},{}),'service');
 const f=await fixture(t);let n=0;
 const actions=[plan,{action:'write_file',path:'body.txt',content:'已核对正文'}];
 const result=await runAgent({...f,ask:async messages=>{const state=JSON.parse(messages.at(-1).content);if(state.phase==='route')return response({action:'route',kind:'task'});if(n<actions.length)return response(actions[n++]);throw Object.assign(Error('本地上下文适配失败'),{code:'SOME_NEW_INTERNAL_FAILURE'});}});
 assert.equal(result.agentRun.status,'partial');assert.equal(result.agentRun.delivery.reasonCode,'SOME_NEW_INTERNAL_FAILURE');assert.doesNotMatch(result.content,/服务已恢复|请补充.*诊断/);assert.equal(result.agentRun.delivery.availableArtifacts[0].path,'body.txt');
});
test('all generated files are reconciled alongside existing registrations, including archived command outputs',async t=>{
 const f=await fixture(t),w=await createWorkspace(f.base,f.task);w.run.executionId='same';
 await fs.writeFile(path.join(w.files,'registered.txt'),'registered');w.run.artifacts=[{path:'registered.txt',label:'已有成果',sha256:hash('registered')}];
 const changes=[];for(let i=0;i<16;i++){const name='output-'+i+'.txt',text='真实输出 '+i;await fs.writeFile(path.join(w.files,name),text);changes.push({path:name,after:hash(text),kind:'created'});}
 const observation=await w.archiveObservation({action:'run_command'},{result:{exitCode:0,fileChanges:changes}});w.run.observationIndex=[{id:observation,action:'run_command'}];
 for(let i=0;i<105;i++)await w.event('checkpoint',{text:'仅为淘汰最近事件的记录'});
 const result=await sources.files(w);assert.equal(result.files.length,17);assert.equal(w.run.artifacts.length,17);assert.ok(result.files.some(f=>f.path==='output-0.txt'));assert.ok(result.files.some(f=>f.path==='output-15.txt'));assert.ok(!w.run.acceptanceResults||!Object.keys(w.run.acceptanceResults).length);
});
test('refreshing a changed file cannot refresh its old acceptance evidence',async t=>{
 const f=await fixture(t),w=await createWorkspace(f.base,f.task);
 Object.assign(w.run,{acceptance:['正文包含旧文字'],steps:plan.steps,mode:'task'});await fs.writeFile(path.join(w.files,'body.txt'),'旧文字');w.run.artifacts=[{path:'body.txt',label:'正文',sha256:hash('旧文字')}];
 const id=require('../apps/desktop/agent/acceptance.cjs').criterionId('正文包含旧文字');await require('../apps/desktop/agent/acceptance.cjs').verify(w,{checks:[{criterionId:id,kind:'text_contains',path:'body.txt',contains:['旧文字'],reason:'核对旧版本'}]});
 await fs.writeFile(path.join(w.files,'body.txt'),'新的实际内容');const result=await settlement.settle(w,{code:'ARTIFACT_CHANGED',message:'登记已过期'});
 assert.equal(w.run.delivery.availableArtifacts[0].sha256,hash('新的实际内容'));assert.equal(w.run.delivery.coverage.passed,0);assert.deepEqual(w.run.delivery.unverified,[id]);assert.equal(w.run.acceptanceResults[id].status,'passed');assert.match(result.content,/尚未完成或未核验/);
});
test('source-bound analysis is returned without a file, and invalid summary citations fall back to actual excerpts',async t=>{
 const f=await fixture(t),w=await createWorkspace(f.base,f.task);Object.assign(w.run,{steps:plan.steps,mode:'task'});
 await fs.writeFile(path.join(w.files,'input.txt'),'A组20人成功16人；B组10人成功9人。');const record=await w.archiveObservation({action:'read_file',path:'input.txt'},{result:{path:'input.txt',sha256:hash('A组20人成功16人；B组10人成功9人。'),text:'A组20人成功16人；B组10人成功9人。'}});w.run.observationIndex=[{id:record,action:'read_file'}];
 let summaryCalls=0;const first=await settlement.settle(w,{code:'AGENT_NO_PROGRESS',message:'无法继续'},{summarize:async state=>{summaryCalls++;return {findings:[{text:'A组样本成功率为80%，B组为90%；样本有限。',sourceIds:[state.sources[0].id]}]};}});
 assert.equal(summaryCalls,1);assert.equal(w.run.status,'partial');assert.match(first.content,/80%/);assert.match(first.content,/阶段性分析/);assert.equal(w.run.delivery.availableArtifacts.length,0);assert.equal(w.run.delivery.coverage.passed,0);
 const second=await settlement.settle(w,{code:'AGENT_NO_PROGRESS',message:'无法继续'},{summarize:async()=>({findings:[{text:'编造的结果',sourceIds:['fake']}]})});
 assert.doesNotMatch(second.content,/编造的结果/);assert.match(second.content,/A组20人/);assert.ok(w.run.delivery.findings.every(f=>f.excerpt));
});
test('a broken finish format cannot prevent complete delivery when all normal evidence gates pass',async t=>{
 const f=await fixture(t);let step=0;
 const actions=[plan,{action:'write_file',path:'body.txt',content:'已核对正文'},{action:'artifact',path:'body.txt',label:'正文'},{action:'write_file',path:'extra.txt',content:'已核对补充'},{action:'artifact',path:'extra.txt',label:'补充'},
  {action:'verify',checks:[{criterionId:'body',kind:'text_contains',path:'body.txt',contains:['已核对正文'],reason:'核对正文'},{criterionId:'extra',kind:'text_contains',path:'extra.txt',contains:['已核对补充'],reason:'核对补充'}],progress:{steps:[{id:'s',status:'done'}]}}];
 const result=await runAgent({...f,ask:async messages=>{const s=JSON.parse(messages.at(-1).content);return s.phase==='route'?response({action:'route',kind:'task'}):step<actions.length?response(actions[step++]):{content:'invalid finish'};}}).catch(e=>{assert.equal(e.code,'AGENT_PROTOCOL');return {content:e.taskMessage,agentRun:e.agentRun};});
 assert.equal(result.agentRun.status,'completed');assert.equal(result.agentRun.delivery.outcome,'complete');assert.ok(result.agentRun.acceptanceCriteria.every(c=>c.status==='passed'));assert.match(result.content,/两|2 项原要求/);const w=await createWorkspace(f.base,f.task);assert.ok(w.run.events.some(e=>e.type==='finish'&&e.detail.origin==='runtime_evidence'));
});
test('automatic full delivery still rejects known defects and unverified requirements',async t=>{
 const f=await fixture(t),w=await createWorkspace(f.base,f.task);await fs.writeFile(path.join(w.files,'body.txt'),'已核对正文');Object.assign(w.run,{mode:'task',inputKey:'u',acceptanceInputKey:'u',requirementsManaged:true,requirements:[plan.requirements[0]],steps:[{id:'s',title:'制作',status:'done'}],artifacts:[{path:'body.txt',sha256:hash('已核对正文')}],issues:[{id:'defect',status:'open',description:'仍缺少核心实现'}]});
 const completion=require('../apps/desktop/agent/completion-policy.cjs');assert.equal(await completion.completeFromEvidence(w),null);
 await require('../apps/desktop/agent/acceptance.cjs').verify(w,{checks:[{criterionId:'body',kind:'text_contains',path:'body.txt',contains:['已核对正文'],reason:'检查正文'}]});assert.equal(await completion.completeFromEvidence(w),null);assert.equal(w.run.issues[0].status,'open');
 w.run.issues=[];await fs.writeFile(path.join(w.files,'body.txt'),'changed');assert.equal(await completion.completeFromEvidence(w),null);
});
test('an MCP call known not to have been sent can fail locally while other work proceeds',async t=>{
 const f=await fixture(t);let n=0,remoteCalls=0;
 const actions=[plan,{action:'mcp',operation:'call',id:'notes',query:'lookup',params:{}},{action:'write_file',path:'body.txt',content:'已核对正文'}, {action:'blocked',text:'正文可交付，外部笔记暂不可用。'}];
 const result=await runAgent({...f,mcp:{catalog:async()=>[{id:'notes'}],execute:async()=>{remoteCalls++;throw Object.assign(Error('连接尚未就绪，未发送工具调用'),{code:'MCP_ERROR',notExecuted:true});}},ask:async messages=>response(JSON.parse(messages.at(-1).content).phase==='route'?{action:'route',kind:'task'}:actions[Math.min(n++,actions.length-1)])});
 assert.equal(remoteCalls,1);assert.equal(result.agentRun.status,'partial');assert.ok(result.agentRun.delivery.availableArtifacts.some(f=>f.path==='body.txt'));const w=await createWorkspace(f.base,f.task);assert.ok(!w.run.actionJournal.some(e=>e.status==='unknown'));
});
test('a sent MCP operation with unknown results still prevents replay and automatic settlement',async t=>{
 const f=await fixture(t);let n=0,remoteCalls=0;
 const actions=[plan,{action:'mcp',operation:'call',id:'notes',query:'send',params:{}}];
 const result=await runAgent({...f,mcp:{catalog:async()=>[{id:'notes'}],execute:async()=>{remoteCalls++;throw Object.assign(Error('已发出，结果未知'),{code:'MCP_RESULT_UNKNOWN'});}},ask:async messages=>response(JSON.parse(messages.at(-1).content).phase==='route'?{action:'route',kind:'task'}:actions[n++])});
 assert.equal(remoteCalls,1);assert.equal(result.agentRun.status,'blocked');assert.notEqual(result.agentRun.delivery?.status,'settled');const w=await createWorkspace(f.base,f.task);assert.ok(w.run.actionJournal.some(e=>e.status==='unknown'));assert.equal(w.run.taskContinuation.state,'waiting_result_check');
});
test('the desktop summary deadline is local to its request and falls back to real excerpts',async t=>{
 const f=await fixture(t),w=await createWorkspace(f.base,f.task);await fs.writeFile(path.join(w.files,'input.txt'),'原始数据：总数20，成功16。');
 const records=[],storage={agentDirectory:f.base,readWorkspace:async()=>({tasks:[f.task]}),modelCredentials:async()=>({id:'company',baseUrl:'https://company.example/v1',model:'fixture',contextWindow:131072}),recordModelRequest:async r=>records.push({...r})};let step=0,summaryCalls=0;
 const actions=[plan,{action:'read_file',path:'input.txt'},{action:'blocked',text:'无法继续计算，保留已取得数据。'}];
 const native=action=>Response.json({choices:[{message:{tool_calls:[{id:'c',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},finish_reason:'tool_calls'}]});
 const chat=require('../apps/desktop/chat.cjs').createChat(storage,async(_url,options)=>{
  const state=JSON.parse(JSON.parse(options.body).messages.at(-1).content);
  if(state.sources){summaryCalls++;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled summary'),{name:'AbortError'})),{once:true}));}
  return native(state.phase==='route'?{action:'route',kind:'task'}:actions[Math.min(step++,actions.length-1)]);
 },{text:30,total:1000,retries:0,retryDelay:0});
 const result=await chat.complete({id:'r',taskId:f.task.id,modelId:'company',messages:f.task.messages,executionOrigin:'user'});
 assert.equal(summaryCalls,1);assert.equal(result.agentRun.status,'partial');assert.match(result.content,/总数20/);assert.ok(result.agentRun.delivery.findings.every(f=>f.excerpt));assert.equal(records.filter(r=>r.phase==='成果收尾'&&r.outcome==='failed').length,1);assert.deepEqual(chat.sessions(),[]);
});
test('an unexpected initialization failure also preserves deliverable results without asking for model service recovery',async t=>{
 const f=await fixture(t),w=await createWorkspace(f.base,f.task);await fs.writeFile(path.join(w.files,'body.txt'),'已核对正文');
 Object.assign(w.run,{mode:'task',status:'running',inputKey:'u',goal:plan.goal,steps:plan.steps,artifacts:[{path:'body.txt',sha256:hash('已核对正文'),label:'已生成正文'}]});await w.save();
 const result=await runAgent({...f,onWorkspace:()=>{throw Object.assign(Error('本地执行上下文初始化失败'),{code:'NEW_CONTEXT_ERROR'});},ask:async()=>assert.fail('initialization failed before model execution')});
 assert.equal(result.agentRun.status,'partial');assert.equal(result.agentRun.delivery.availableArtifacts[0].path,'body.txt');assert.equal(result.agentRun.delivery.reasonCode,'NEW_CONTEXT_ERROR');assert.doesNotMatch(result.content,/服务已恢复/);
});
test('an optional catalog failure and a broken progress observer cannot cancel independent work',async t=>{
 const f=await fixture(t);let n=0;
 const actions=[plan,{action:'write_file',path:'body.txt',content:'已核对正文'},{action:'blocked',text:'正文已生成，应用列表故障不影响已有文件。'}];
 const result=await runAgent({...f,mcp:{catalog:async()=>{throw Error('本地连接目录暂不可读');}},onRun:async()=>{throw Error('界面观察者暂不可用');},ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);assert.deepEqual(state.mcpConnections,[]);assert.ok(state.optionalContextFailures['应用连接']);return response(state.phase==='route'?{action:'route',kind:'task'}:actions[n++]);
 }});
 assert.equal(result.agentRun.status,'partial');assert.equal(result.agentRun.delivery.availableArtifacts[0].path,'body.txt');const w=await createWorkspace(f.base,f.task);assert.equal(w.run.events.filter(e=>e.type==='optional_context_failed').length,1);assert.ok(!w.run.actionJournal.some(e=>e.status==='unknown'));
});
test('a skill failure belongs to the new execution rather than contaminating its completed predecessor',async t=>{
 const f=await fixture(t),w=await createWorkspace(f.base,f.task);Object.assign(w.run,{mode:'task',status:'completed',inputKey:'old',executionId:'old-execution',goal:'此前已完成的任务'});await w.save();
 let count=0;
 const result=await runAgent({...f,extensions:[{id:'ref',name:'参考模板',kind:'skill',enabled:true}],skillPackages:{prepare:async()=>{throw Error('模板包缺失');}},ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);assert.deepEqual(state.extensionPreparationFailure.names,['参考模板']);return response(count++?{action:'reply',text:'已记录参考模板尚未取得，未声称使用模板。'}:{action:'route',kind:'chat'});
 }});
 const saved=await createWorkspace(f.base,f.task);assert.notEqual(result.agentRun.executionId,'old-execution');assert.equal(saved.run.events.filter(e=>e.type==='extension_prepare_failed').length,1);assert.ok(saved.run.history.every(h=>!h.events.some(e=>e.type==='extension_prepare_failed')));assert.deepEqual(result.agentRun.loadedExtensions,[]);
});

const test=require('node:test'),assert=require('node:assert/strict');
const {buildDecisionRequest}=require('../apps/desktop/agent/decision-request.cjs');
const protocol=require('../apps/desktop/agent/protocol.cjs');
const messages=state=>[{role:'system',content:'Stable safety instructions'},{role:'user',content:JSON.stringify(state)}];
test('default request is named, deterministic and does not mutate input or expose task tools while routing',async()=>{
 const state={phase:'route',currentRequest:'你好'},before=structuredClone(state),input=messages(state);
 const a=await buildDecisionRequest({state,messages:input}),b=await buildDecisionRequest({state,messages:input});
 assert.deepEqual(a,b);assert.deepEqual(state,before);assert.deepEqual(input,messages(state));
 assert.equal(a.format.tool_choice,'required');assert.equal(a.format.parallel_tool_calls,false);
 assert.deepEqual(a.format.tools.map(t=>t.function.name),['route','reply']);
 assert.ok(a.format.tools.every(t=>!t.function.parameters.properties.action));
 assert.equal(a.discoveryEnabled,false);
});
test('discovery and recovery preserve permissions, semantic contracts and current evidence',async()=>{
 const state={phase:'task',steps:[{id:'s',status:'running'}],acceptanceCriteria:[{id:'r',type:'content'}],protocolRecovery:{reason:'invalid_parameter',field:'path'},permissions:{mode:'ask'},actionRecovery:[{id:'unknown',status:'unknown'}]};
 const a=await buildDecisionRequest({state,messages:messages(state),discoveredActions:['shell','write_file']});
 assert.ok(!a.format.tools.some(t=>t.function.name==='shell'));
 const wire=JSON.parse(a.wireMessages.at(-1).content);
 assert.deepEqual(wire.actionRecovery,state.actionRecovery);assert.deepEqual(wire.permissions,state.permissions);
 const write=a.format.tools.find(t=>t.function.name==='write_file');assert.ok(write.function.parameters.required.includes('path'));
 assert.throws(()=>protocol.decodeAction({toolCalls:[{function:{name:'write_file',arguments:'{"content":"x"}'}}]},{boundActionContract:true}),e=>e.code==='AGENT_PROTOCOL');
 const exhausted=await buildDecisionRequest({state,messages:messages(state),discoveryCount:2});
 assert.equal(exhausted.discoveryEnabled,false);assert.ok(!exhausted.format.tools.some(t=>t.function.name==='request_tools'));
});
test('JSON and text compatibility requests retain the same action catalogue and original context',async()=>{
 const state={phase:'chat',protocolRecovery:{reason:'invalid_json'}};
 for(const formatMode of ['json','text']){
  const a=await buildDecisionRequest({state,messages:messages(state),formatMode});
  assert.equal(a.format.tools,undefined);assert.equal(a.format.response_format?.type,formatMode==='json'?'json_object':undefined);
  const contract=JSON.parse(a.wireMessages.at(-1).content).responseContract;
  assert.deepEqual(contract.allowedActions,protocol.allowedActions(state));assert.ok(contract.parametersSchema);
  assert.ok(a.wireMessages[0].content.startsWith('Stable safety instructions'));
 }
});
test('desktop named-tool single-file delivery needs three requests and no format recovery',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-named-floor-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'task',request:'写一个 lesson.md，介绍注意力机制',messages:[{id:'input',role:'user',content:'写一个 lesson.md，介绍注意力机制'}]},records=[];
 const storage={agentDirectory:base,autonomousTasks:true,readWorkspace:async()=>({tasks:[task]}),modelCredentials:async()=>({id:'m',name:'mock',model:'mock',baseUrl:'https://example.invalid/v1',contextWindow:131072}),recordModelRequest:async record=>records.push(record)};
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:'写入 lesson.md',decisions:[],requirements:[{id:'r',text:'lesson.md 包含注意力机制介绍',type:'content'}],steps:[{id:'s',title:'写入并核验',status:'running'}]},{action:'write_file',path:'lesson.md',content:'# 注意力机制\n按相关性对输入加权。',artifact:{label:'课程文档'},checks:[{criterionId:'r',kind:'text_contains',path:'lesson.md',contains:['注意力机制'],reason:'课程文档包含用户要求的注意力机制介绍'}],progress:{steps:[{id:'s',status:'done'}]}}];
 let calls=0;
 const chat=require('../apps/desktop/chat.cjs').createChat(storage,async(_url,options)=>{
  const body=JSON.parse(options.body);assert.equal(body.tool_choice,'required');
  assert.ok(calls<3,'不得新增流程请求');const {action,...args}=actions[calls++];assert.ok(body.tools.some(t=>t.function.name===action));
  return Response.json({choices:[{message:{tool_calls:[{id:'call-'+calls,type:'function',function:{name:action,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]});
 });
 const result=await chat.complete({id:'r',taskId:task.id,modelId:'m',messages:task.messages});
 assert.equal(calls,3);assert.equal(result.agentRun.status,'completed');
 const p=result.replyDetails.performance;assert.equal(p.modelRequests,3);assert.equal(p.processRequestRatio,2/3);assert.equal(p.protocolErrorRequests,0);
 assert.equal(p.firstReplySource,'final');assert.equal(p.firstStreamTextMs,null);
 assert.ok(records.every(r=>r.metricsVersion===1));
 const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(base,task);
 assert.equal(await fs.readFile(path.join(w.files,'lesson.md'),'utf8'),actions[2].content);
 assert.ok(w.run.events.some(e=>e.type==='acceptance_verified'));assert.equal(w.run.events.at(-1).detail.origin,'runtime_evidence');
});
test('shared schema descriptions are sent once without altering any validation constraints',()=>{
 const {compactToolDescriptions}=require('../apps/desktop/agent/tool-descriptions.cjs');
 const state={phase:'task',steps:[{id:'s',status:'running'}],acceptanceCriteria:[{id:'r',type:'content'}]};
 const tools=protocol.actionTools(state,['write_file','edit_file','read_file','run_command','verify','artifact']);
 const before=structuredClone(tools),compact=compactToolDescriptions(tools);
 function constraints(value){if(Array.isArray(value))return value.map(constraints);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='description').map(([key,v])=>[key,constraints(v)]));return value;}
 assert.deepEqual(tools,before);assert.deepEqual(constraints(compact.tools),constraints(tools));
 assert.match(compact.guidance,/progress/);
 assert.ok(Buffer.byteLength(JSON.stringify(compact.tools)+compact.guidance)<Buffer.byteLength(JSON.stringify(tools)),'词汇表计入总量后仍须减少重复开销');
 assert.deepEqual(compact,compactToolDescriptions(tools));
});
test('route progress-format incident is counted in diagnostics and recovers without executing malformed actions',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-route-progress-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'t',request:'检查项目',messages:[{id:'u',role:'user',content:'检查项目'}]},records=[];let calls=0;
 const storage={agentDirectory:base,readWorkspace:async()=>({tasks:[task]}),modelCredentials:async()=>({id:'m',model:'mock',name:'mock',baseUrl:'https://fixture.invalid/v1',contextWindow:131072}),recordModelRequest:async r=>records.push(r)};
 const actions=[{action:'route',kind:'task',progress:null},{action:'route',kind:'chat'},{action:'reply',text:'离线测试停止点'}];
 const chat=require('../apps/desktop/chat.cjs').createChat(storage,async()=>{const {action,...args}=actions[calls++];return Response.json({choices:[{message:{tool_calls:[{id:'c'+calls,type:'function',function:{name:action,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]});});
 const result=await chat.complete({id:'r',taskId:'t',modelId:'m',messages:task.messages});assert.equal(calls,3);assert.equal(result.replyDetails.performance.protocolErrorRequests,1);assert.equal(records[0].protocolErrorReason,'invalid_parameter');assert.ok(records.every(r=>r.stateBytes>0&&r.toolSchemaBytes>0));assert.ok(result.replyDetails.events.some(e=>e.type==='protocol_error'));assert.ok(!result.replyDetails.events.some(e=>e.type==='run_command'));
});

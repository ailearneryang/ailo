const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createChat}=require('../apps/desktop/chat.cjs');
const protocol=require('../apps/desktop/agent/protocol.cjs');
const menu=require('../apps/desktop/agent/tool-menu.cjs');
const native=action=>Response.json({choices:[{message:{content:null,tool_calls:[{id:'c',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},finish_reason:'tool_calls'}]});
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-request-budget-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'t',projectId:'p',request:'分析资料',messages:[{role:'user',content:'分析资料'}],materials:[]};return {agentDirectory:base,modelCredentials:async()=>({baseUrl:'https://company.invalid/v1',model:'glm-company',contextWindow:65536,maxOutputTokens:16384}),readWorkspace:async()=>({tasks:[task]})};}
const input={id:'r',taskId:'t',modelId:'m',messages:[{role:'user',content:'分析资料'}]};
test('a unified recovery menu keeps the same complete plan progress contract as named tools',()=>{
 const state={phase:'task',steps:[{id:'s',status:'running'}],decisionRecovery:{stage:'small_action'}},selected=['plan','read_file'];
 const parameters=protocol.menuTool(state,selected).function.parameters,unified=parameters.properties.progress;
 const named=protocol.actionTools(state).find(t=>t.function.name==='plan').function.parameters.properties.progress;
 assert.ok(unified.properties.executionState);assert.ok(unified.properties.issues);
 const planBranch=parameters.allOf.find(branch=>branch.if?.properties?.action?.const==='plan');
 assert.deepEqual(planBranch.then.properties.progress,named);assert.deepEqual(unified.properties,named.properties);
 assert.deepEqual(planBranch.else.properties.progress.properties.steps.items.properties.id.enum,['s']);assert.equal(planBranch.then.properties.progress.properties.steps.items.properties.id.enum,undefined);
 assert.ok(!protocol.menuTool(state,['read_file']).function.parameters.properties.progress.properties.executionState);
});

test('final wire schemas are budgeted after native, named, JSON and plain fallbacks',async()=>{
 const {prepareRequestBudget}=await import('../apps/desktop/context.mjs');
 const state={phase:'task',steps:[{id:'s',status:'running'}]},messages=[{role:'system',content:'x'.repeat(8000)},{role:'user',content:JSON.stringify(state)}],model={contextWindow:16384,maxOutputTokens:16000};
 const formats=[{tools:[protocol.tool]},{tools:protocol.actionTools(state)},{response_format:{type:'json_object'}},{}];
 for(const format of formats){
  try{const prepared=prepareRequestBudget(messages,format,model,16000);assert.ok(prepared.stats.used+prepared.budget+prepared.stats.guardTokens<=model.contextWindow);assert.equal(prepared.stats.reserve,prepared.budget);assert.ok(prepared.budget<16000);}
  catch(error){assert.equal(error.code,'MODEL_CONTEXT_LIMIT');assert.ok(error.diagnostics.availableOutputTokens<256);}
 }
 assert.throws(()=>prepareRequestBudget([{role:'system',content:'中'.repeat(15000)}],{},model,8192),error=>error.code==='MODEL_CONTEXT_LIMIT');
});

test('stage prompts and menus reduce fixed context while preserving lifecycle and discovery',async()=>{
 const {AGENT_PROMPT,promptForState}=await import('../apps/desktop/agent/prompt.mjs');
 assert.ok(promptForState({phase:'route'}).length<1000);
 const state={phase:'task',steps:[{id:'s',status:'running'}]},authorized=protocol.allowedActions(state),selected=menu.select(state,authorized);
 assert.ok(selected.length<authorized.length);assert.ok(promptForState(state,selected).length<AGENT_PROMPT.length*.65);
 const tool=protocol.menuTool(state,selected);assert.ok(tool.function.parameters.properties.action.enum.includes('request_tools'));assert.ok(tool.function.parameters.properties.names.items.enum.includes('android_device'));
 assert.deepEqual(menu.select(state,authorized,['memory','mcp']).filter(n=>['memory','mcp'].includes(n)),[]);
 assert.match(promptForState(state),/未知副作用/);assert.match(promptForState(state),/不能擅自弱化/);
});

test('bounded discovery exposes authorized tools without executing them and counts every model request',async t=>{
 const storage=await fixture(t),records=[];storage.recordModelRequest=async r=>records.push(r);let calls=0;
 const chat=createChat(storage,async(_,options)=>{const body=JSON.parse(options.body),state=JSON.parse(body.messages.at(-1).content);calls++;
  if(calls===1)return native({action:'route',kind:'chat'});
  if(calls===2){assert.ok(!state.responseContract.advertisedActions.includes('read_execution'));return native({action:'request_tools',names:['read_execution']});}
  if(calls===3){assert.ok(state.responseContract.advertisedActions.includes('read_execution'));assert.equal(state.responseContract.toolDiscoveryCount,1);return native({action:'request_tools',names:['read_history']});}
  assert.equal(state.responseContract.toolDiscoveryCount,2);assert.equal(state.responseContract.toolDiscovery,undefined);assert.ok(state.responseContract.advertisedActions.includes('read_history'));return native({action:'reply',text:'目录已补齐'});
 });
 const result=await chat.complete(input);assert.equal(result.content,'目录已补齐');assert.equal(calls,4);assert.equal(result.agentRun.performance.modelRequests,4);assert.equal(records.filter(r=>r.action==='request_tools').length,2);assert.equal(result.agentRun.performance.toolCalls,0);
 assert.ok(records.every(r=>r.parameters.capabilitySource==='unconfirmed_endpoint'));assert.ok(records.every(r=>r.parameters.reasoningControlSent===false));assert.ok(!JSON.stringify(records).includes('apiKey'));
});

test('discovery cannot add a task-only action to a chat authorization scope',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async()=>{calls++;if(calls===1)return native({action:'route',kind:'chat'});if(calls===2)return native({action:'request_tools',names:['write_file']});return native({action:'reply',text:'保留原问答范围'});});
 const result=await chat.complete(input);assert.equal(result.content,'保留原问答范围');assert.equal(result.agentRun.performance.toolCalls,0);assert.equal(calls,3);
});

test('real format fallback recompiles the final wire budget and reports the actual reserve',async t=>{
 const {requestContextUsage}=await import('../apps/desktop/context.mjs');
 for(const mode of ['named','json']){
  const storage=await fixture(t),records=[];storage.recordModelRequest=async r=>records.push(r);const model={baseUrl:'https://company.invalid/v1',model:'glm-company',contextWindow:12288,maxOutputTokens:8192};storage.modelCredentials=async()=>model;let calls=0;
  const chat=createChat(storage,async(_,options)=>{const body=JSON.parse(options.body);calls++;const {tools,tool_choice,parallel_tool_calls,response_format}=body;
   const format=tools?{tools,tool_choice,parallel_tool_calls}:response_format?{response_format}:{};
   const usage=requestContextUsage(body.messages,format,model,body.max_tokens);assert.ok(usage.used+body.max_tokens+128<=model.contextWindow);
   if(mode==='json'&&calls===1)return new Response('{"error":"tools not supported"}',{status:400});
   if(mode==='named'&&calls===1)return native({action:'route',kind:'chat'});
   if(mode==='named'&&calls===2)return Response.json({choices:[{message:{content:'先解释一下，但没有可执行动作'}}]});
   const state=JSON.parse(body.messages.at(-1).content);
   if(mode==='json'){assert.equal(body.tools,undefined);assert.equal(body.response_format.type,'json_object');return Response.json({choices:[{message:{content:JSON.stringify(state.phase==='route'?{action:'route',kind:'chat'}:{action:'reply',text:'JSON已适配'})}}]});}
   assert.equal(body.tool_choice,'required');assert.ok(body.tools.some(item=>item.function.name==='reply'));return Response.json({choices:[{message:{tool_calls:[{id:'r',type:'function',function:{name:'reply',arguments:'{"text":"具名已适配"}'}}]},finish_reason:'tool_calls'}]});
  });
  const result=await chat.complete({...input,id:'r-'+mode});assert.match(result.content,/已适配/);assert.equal(calls,3);
  assert.ok(records.some(record=>record.budgetAdjusted));assert.ok(records.every(record=>record.inputEstimate+record.requestedOutputTokens+record.guardTokens<=model.contextWindow));assert.equal(result.agentRun.contextUsage.reserve,records.at(-1).requestedOutputTokens);
 }
});

test('cancellation during tool discovery starts no next model request',async t=>{
 const storage=await fixture(t);let calls=0,chat;
 chat=createChat(storage,async()=>{calls++;return native(calls===1?{action:'route',kind:'chat'}:{action:'request_tools',names:['read_execution']});});
 await assert.rejects(chat.complete({...input,onStatus:status=>{if(status.includes('补充当前步骤所需'))chat.cancel(input.id);}}),error=>error.code==='MODEL_CANCELLED');assert.equal(calls,2);assert.deepEqual(chat.sessions(),[]);
});

function activityStream(first,{args=false}={}){let timer;return new Response(new ReadableStream({start(controller){const send=delta=>controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta}]})+'\n\n'));send(first);timer=setInterval(()=>send(args?{tool_calls:[{index:0,function:{arguments:' '}}]}:{reasoning_content:'r'}),3);},cancel(){clearInterval(timer);}}),{headers:{'content-type':'text/event-stream'}});}
test('prose followed by ongoing reasoning cannot clear the executable-action deadline',async t=>{
 const storage=await fixture(t),records=[];storage.recordModelRequest=async r=>records.push(r);
 const chat=createChat(storage,async()=>activityStream({content:'先检查现有资料。'}),{connect:200,first:200,idle:200,decision:25,total:500,retries:0});
 const result=await chat.complete(input);assert.equal(result.agentRun.status,'blocked');assert.ok(records.length>0&&records.length<=4);assert.ok(records.every(r=>r.timeoutStage==='no_action'));assert.ok(records.every(r=>r.durationMs<400));assert.equal(result.agentRun.performance.toolCalls,0);
});
test('parameter activity has one bounded completion deadline and never executes partial JSON',async t=>{
 const storage=await fixture(t),records=[];storage.recordModelRequest=async r=>records.push(r);
 const chat=createChat(storage,async()=>activityStream({tool_calls:[{index:0,id:'c',type:'function',function:{name:'ailo_action',arguments:'{"action":'}}]},{args:true}),{connect:200,first:200,idle:200,decision:15,action:40,total:500,retries:0});
 const result=await chat.complete(input);assert.equal(result.agentRun.status,'blocked');assert.ok(records.length>0&&records.length<=4);assert.ok(records.every(r=>r.timeoutStage==='action_completion'));assert.ok(records.every(r=>r.actionCompletionTimeoutMs===40));assert.equal(result.agentRun.performance.toolCalls,0);
});

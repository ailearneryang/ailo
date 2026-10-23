const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createChat}=require('../apps/desktop/chat.cjs');
const {readCompletion}=require('../apps/desktop/chat-response.cjs');
const {decodeAction}=require('../apps/desktop/agent/protocol.cjs');
function native(action){return new Response(JSON.stringify({choices:[{message:{content:null,tool_calls:[{id:'call1',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},finish_reason:'tool_calls'}]}));}
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-protocol-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'task',projectId:'project',request:'你好',materials:[],messages:[{role:'user',content:'你好'}]};return {agentDirectory:base,modelCredentials:async()=>({baseUrl:'https://example.com/v1',name:'mock',model:'mock'}),readWorkspace:async()=>({tasks:[task]})};}
const input={id:'r',modelId:'m',taskId:'task',messages:[{role:'user',content:'你好'}]};
test('scheduled chat loads previous run context and can read its saved progress',async t=>{
 const storage=await fixture(t),task={id:'task',scheduledTaskId:'daily-course',request:'继续课程',materials:[],created:new Date().toISOString(),messages:[{role:'user',content:'继续课程'}]},old={...task,id:'yesterday',created:new Date(Date.now()-86400000).toISOString(),messages:[{role:'assistant',content:'Transformer 已完成，下一期 KV Cache'}]};
 storage.readWorkspace=async()=>({tasks:[task,old]});
 const {workspacePath}=require('../apps/desktop/agent/workspace-path.cjs');
 const legacy=path.join(workspacePath(storage.agentDirectory,old),'files');await fs.mkdir(legacy,{recursive:true});await fs.writeFile(path.join(legacy,'progress.md'),'已学 Transformer，下一课 KV Cache');
 let calls=0;
 const chat=createChat(storage,async(url,options)=>{
  const body=JSON.parse(options.body),state=JSON.parse(body.messages.at(-1).content);
  assert.equal(state.scheduledContext.historyStatus,'available');assert.equal(state.scheduledContext.previousRunCount,1);assert.match(state.scheduledContext.recentRuns[0].summary,/Transformer/);
  if(calls++===0)return native({action:'route',kind:'chat'});
  if(calls===2)return native({action:'read_file',path:'progress.md'});
  assert.match(JSON.stringify(state.toolResults),/KV Cache/);
  return native({action:'reply',text:'历史进度已读取，下一课 KV Cache'});
 });
 assert.match((await chat.complete({...input,messages:task.messages})).content,/KV Cache/);
});
test('native streaming tool arguments are assembled without leaking into chat text',async()=>{
 const chunks=[{tool_calls:[{index:0,id:'c',type:'function',function:{name:'ailo_action',arguments:'{"action":"reply",'}}]},{tool_calls:[{index:0,function:{arguments:'"text":"你好"}'}}]}];
 const source=chunks.map(delta=>'data: '+JSON.stringify({choices:[{index:0,delta}]})+'\n\n').join('')+'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n';
 const result=await readCompletion(new Response(source,{headers:{'content-type':'text/event-stream'}}),{signal:new AbortController().signal,onActivity:()=>{},onText:()=>assert.fail('tool arguments are not user text')});
 assert.deepEqual(decodeAction(result),{action:'reply',text:'你好'});
});
test('native-only provider completes agent request with content:null',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.tools[0].function.name,'ailo_action');assert.equal(body.tool_choice.function.name,'ailo_action');return native(calls++?{action:'reply',text:'你好'}:{action:'route',kind:'chat'});});
 assert.equal((await chat.complete({...input,onText:()=>assert.fail('no protocol in UI')})).content,'你好');assert.equal(calls,2);
});
test('explicit tool incompatibility falls back to JSON mode and retains it for the run',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async(url,options)=>{const body=JSON.parse(options.body);calls++;
  if(calls===1)return new Response('{"error":"tools not supported"}',{status:400});
  assert.equal(body.tools,undefined);assert.equal(body.response_format.type,'json_object');
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(calls===2?{action:'route',kind:'chat'}:{action:'reply',text:'兼容回复'})}}]}));
 });assert.equal((await chat.complete(input)).content,'兼容回复');assert.equal(calls,3);
});
test('authentication failure is never retried as formatting incompatibility',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async()=>{calls++;return new Response('secret',{status:401});});
 await assert.rejects(chat.complete(input),/API Key/);assert.equal(calls,1);
});
test('malformed actions get bounded recovery and a user-facing failure',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'我来帮你开发'}}]}));});
 await assert.rejects(chat.complete(input),e=>/任务和材料已保留/.test(e.message)&&!e.message.includes('JSON'));assert.equal(calls,3);
});
test('ambiguous or unknown native tools are rejected even alongside valid-looking content',()=>{
 const call={function:{name:'ailo_action',arguments:'{"action":"route","kind":"chat"}'}};
 assert.throws(()=>decodeAction({toolCalls:[call,call]}),/下一步/);
 assert.throws(()=>decodeAction({toolCalls:[{function:{...call.function,name:'shell'}}],content:call.function.arguments}),/下一步/);
 assert.throws(()=>decodeAction({content:'说明：{"action":"run_command","command":"bad"}'}),/下一步/);
});
test('native calls disable parallel actions and unsupported switch falls back without dropping tools',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async(url,options)=>{
  const body=JSON.parse(options.body);calls++;
  if(calls===1){assert.equal(body.parallel_tool_calls,false);return new Response('{"error":"parallel_tool_calls not supported"}',{status:400});}
  assert.equal(body.parallel_tool_calls,undefined);assert.equal(body.tools[0].function.name,'ailo_action');
  return native(calls===2?{action:'route',kind:'chat'}:{action:'reply',text:'已适配'});
 });assert.equal((await chat.complete(input)).content,'已适配');assert.equal(calls,3);
});
test('native length response preserves phase, increases budget and never executes truncated tool arguments',async t=>{
 const storage=await fixture(t);storage.modelCredentials=async()=>({baseUrl:'https://example.com/v1',name:'mock',model:'mock',contextWindow:100000,maxOutputTokens:20000});
 const budgets=[];let calls=0;
 const chat=createChat(storage,async(url,options)=>{
  const body=JSON.parse(options.body);budgets.push(body.max_tokens);calls++;
  if(calls===1)return native({action:'route',kind:'chat'});
  if(calls===2)return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:8192,completion_tokens_details:{reasoning_tokens:8000}},choices:[{message:{content:null,tool_calls:[{id:'bad',type:'function',function:{name:'ailo_action',arguments:'{"action":"write_file",'}}]},finish_reason:'length'}]}));
  const state=JSON.parse(body.messages.at(-1).content);assert.equal(state.phase,'chat');assert.match(state.recovery,/截断/);assert.ok(!body.tools[0].function.parameters.properties.action.enum.includes('write_file'));
  return native({action:'reply',text:'恢复成功'});
 });assert.equal((await chat.complete(input)).content,'恢复成功');assert.deepEqual(budgets,[4096,8192,16384]);
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');const w=await createWorkspace(storage.agentDirectory,(await storage.readWorkspace()).tasks[0]);
 const event=w.run.events.find(e=>e.type==='output_limit');assert.equal(event.detail.reasoningTokens,8000);assert.equal(event.detail.toolCalls,1);assert.deepEqual(await fs.readdir(w.files),[]);
});
test('last-request telemetry matches wire payload, persists and never reuses previous provider usage',async t=>{
 const storage=await fixture(t);storage.modelCredentials=async()=>({id:'m',baseUrl:'https://example.com/v1',name:'mock',model:'mock',contextWindow:100000});
 const {requestContextUsage}=await import('../apps/desktop/context.mjs');
 const updates=[];let calls=0,expected;
 const chat=createChat(storage,async(url,options)=>{
  const body=JSON.parse(options.body);calls++;
  const {tools,tool_choice,parallel_tool_calls}=body;
  expected=requestContextUsage(body.messages,{tools,tool_choice,parallel_tool_calls},{id:'m',name:'mock',contextWindow:100000},body.max_tokens);
  const latest=updates.at(-1);assert.equal(latest.status,'sending');assert.equal(latest.used,expected.used);assert.equal(latest.providerUsage,undefined);
  if(calls===1)return new Response(JSON.stringify({usage:{prompt_tokens:4321,completion_tokens:100},choices:[{message:{content:JSON.stringify({action:'route',kind:'chat'})},finish_reason:'stop'}]}));
  return native({action:'reply',text:'完成'});
 });
 const result=await chat.complete({...input,onRun:run=>{if(run.contextUsage)updates.push(run.contextUsage);}});
 assert.ok(updates.some(s=>s.providerUsage?.inputTokens===4321));
 const stats=result.agentRun.contextUsage;assert.equal(stats.status,'completed');assert.equal(stats.used,expected.used);assert.equal(stats.providerUsage.inputTokens,undefined);
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');const w=await createWorkspace(storage.agentDirectory,(await storage.readWorkspace()).tasks[0]);assert.deepEqual(w.run.contextUsage,JSON.parse(JSON.stringify(stats)));
 assert.equal(new Set(updates.map(s=>s.requestId)).size,2);
});

test('repeated provider metadata is idempotent while repeated argument fragments are preserved',async()=>{
 const action={action:'reply',text:'abc'.repeat(200)};const args=JSON.stringify(action);
 const chunks=Array.from(args).map(fragment=>'data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'call_1',function:{name:'ailo_action',arguments:fragment}}]}}]})+'\n\n').join('')+'data: [DONE]\n\n';
 const result=await readCompletion(new Response(chunks,{headers:{'content-type':'text/event-stream'}}),{signal:new AbortController().signal,onActivity:()=>{}});
 assert.equal(result.toolCalls[0].id,'call_1');assert.deepEqual(decodeAction(result),action);
});
test('oversized tool arguments report bounded metadata and cancel stream without executing partial JSON',async()=>{
 let cancelled=false;
 const chunk='data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{name:'ailo_action',arguments:'x'.repeat(250001)}}]}}]})+'\n\n';
 const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(chunk));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(readCompletion(response,{signal:new AbortController().signal,onActivity:()=>{}}),e=>e.code==='MODEL_TOOL_ARGUMENT_LIMIT'&&e.diagnostics.toolArgumentChars===250001&&!e.partialContent);
 assert.equal(cancelled,true);
});

test('unambiguous action envelopes normalize without guessing unknown operations',()=>{
 const expected={action:'read_file',path:'app/main.kt'};
 for(const value of [expected,{action:' read_file ',path:'app/main.kt'},{action:expected},{action:'read_file',parameters:{path:'app/main.kt'}},{name:'ailo_action',arguments:JSON.stringify(expected)}])assert.deepEqual(decodeAction({content:JSON.stringify(value)}),expected);
 assert.deepEqual(decodeAction({toolCalls:[{function:{name:'read_file',arguments:'{"path":"app/main.kt"}'}}]}),expected);
 for(const value of [{action:'unknown'},{path:'app/main.kt'},[expected],{action:'read_file',arguments:{action:'write_file',path:'x'}}])assert.throws(()=>decodeAction({content:JSON.stringify(value)}),e=>e.code==='AGENT_PROTOCOL');
 assert.throws(()=>decodeAction({toolCalls:[{function:{name:'read_file',arguments:'{"action":"write_file"}'}}]}),e=>e.reason==='conflicting_action');
});
test('decimal pagination strings normalize across content, wrappers and native tools',()=>{
 const expected={action:'read_execution',id:'record',offset:6000};
 for(const action of ['read_execution','read_history','read_file','read_material','read_source','inspect_source','knowledge']) {
  assert.equal(decodeAction({content:JSON.stringify({action,offset:'0'})}).offset,0);
 }
 for(const value of [{...expected,offset:'6000'},{action:{...expected,offset:'6000'}},{action:'read_execution',arguments:{id:'record',offset:'6000'}}])assert.deepEqual(decodeAction({content:JSON.stringify(value)}),expected);
 for(const name of ['ailo_action','read_execution'])assert.deepEqual(decodeAction({toolCalls:[{function:{name,arguments:JSON.stringify({...expected,offset:'6000'})}}]}),expected);
 assert.deepEqual(decodeAction({content:'{"action":"read_material","id":"m","offset":" 3000 ","limit":"6000"}'}),{action:'read_material',id:'m',offset:3000,limit:6000});
 const mcp={action:'mcp',operation:'call',params:{offset:'6000',limit:'10'}};
 assert.deepEqual(decodeAction({content:JSON.stringify(mcp)}),mcp);
});
test('invalid pagination is rejected before execution without loose coercion',()=>{
 for(const offset of ['', ' ',null,true,{},[], -1,1.5,'-1','1.5','1e3','0x10','Infinity','9007199254740993',9007199254740992]) {
  assert.throws(()=>decodeAction({content:JSON.stringify({action:'read_execution',offset})}),e=>e.code==='AGENT_PROTOCOL'&&e.reason==='invalid_parameter'&&e.diagnostics.field==='offset');
 }
 for(const action of ['read_material','read_file','read_execution','read_history'])for(const limit of [0,'0',12001,'12001',null,false])assert.throws(()=>decodeAction({content:JSON.stringify({action,limit})}),e=>e.reason==='invalid_parameter'&&e.diagnostics.field==='limit');
});
test('invalid action feedback states the actual problem and allowed actions without fake assistant actions',async t=>{
 const storage=await fixture(t);let count=0;
 const chat=createChat(storage,async(url,options)=>{
  const body=JSON.parse(options.body),state=JSON.parse(body.messages.at(-1).content);
  if(count++===0)return native({action:'route',kind:'chat'});
  if(count===2)return native({wrongField:'reply',text:'not executed'});
  assert.equal(state.protocolRecovery.issue,'missing_action');
  assert.ok(state.protocolRecovery.keys.includes('wrongField'));
  assert.ok(state.protocolRecovery.allowedActions.includes('reply'));
  assert.ok(!state.protocolRecovery.allowedActions.includes('write_file'));
  assert.ok(!body.messages.some(m=>m.role==='assistant'&&m.content.includes('protocol_error')));
  return native({action:'reply',arguments:{text:'已恢复'}});
 });
 assert.equal((await chat.complete(input)).content,'已恢复');assert.equal(count,3);
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');const w=await createWorkspace(storage.agentDirectory,(await storage.readWorkspace()).tasks[0]);
 assert.ok(!w.run.observations.some(o=>o.action.action==='protocol_error'));
 assert.equal(w.run.events.find(e=>e.type==='protocol_error').detail.issue,'missing_action');
});

function slowDecision(action,{reasoning=8,delay=10,end=true}={}) {
 let index=0,timer;
 const frames=[...Array(reasoning).fill({reasoning_content:'hidden reasoning'}),{tool_calls:[{index:0,id:'call',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]}];
 return new Response(new ReadableStream({start(c){function tick(){
 if(index<frames.length){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{index:0,delta:frames[index++]}]})+'\n\n'));timer=setTimeout(tick,delay);}
 else if(end){c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));c.close();}
 }tick();},cancel(){clearTimeout(timer);}}),{headers:{'content-type':'text/event-stream'}});
}
test('agent thinking outlives chat deadline, reports activity and accepts tool-only output',async t=>{
 const storage=await fixture(t),statuses=[];let calls=0;
 const chat=createChat(storage,async()=>slowDecision(calls++?{action:'reply',text:'完成思考'}:{action:'route',kind:'chat'}),{first:200,idle:200,text:30,decision:250,total:1000});
 assert.equal((await chat.complete({...input,onStatus:s=>statuses.push(s)})).content,'完成思考');
 assert.ok(statuses.some(s=>s.includes('模型仍在思考')));assert.ok(!statuses.join('').includes('hidden reasoning'));
});
test('two idle decisions recover automatically without requiring a manual retry',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async()=>++calls<=2?slowDecision({}, {reasoning:100}):native(calls===3?{action:'route',kind:'chat'}:{action:'reply',text:'恢复成功'}),{first:200,idle:200,text:20,decision:55,total:1000});
 assert.equal((await chat.complete(input)).content,'恢复成功');assert.equal(calls,4);assert.deepEqual(chat.sessions(),[]);
});
test('agent tool output still obeys idle timeout after decision timer clears',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async()=>{calls++;return slowDecision({action:'route',kind:'chat'},{reasoning:0,end:false});},{first:200,idle:35,text:20,decision:200,total:1000});
 await assert.rejects(chat.complete(input),/模型内容已停止更新.*已自动重试 2 次/);assert.equal(calls,3);assert.deepEqual(chat.sessions(),[]);
});

test('idle decision retries only the interrupted step and discards unfinished tools',async t=>{
 const storage=await fixture(t),statuses=[];let calls=0;const states=[];
 const chat=createChat(storage,async(url,options)=>{
  states.push(JSON.parse(options.body).messages);
  calls++;
  if(calls===1)return native({action:'route',kind:'chat'});
  if(calls===2)return slowDecision({action:'reply',text:'未完成响应不得执行'},{reasoning:0,end:false});
  return native({action:'reply',text:'自动恢复成功'});
 },{first:200,idle:35,text:20,decision:200,total:1000});
 assert.equal((await chat.complete({...input,onStatus:s=>statuses.push(s)})).content,'自动恢复成功');
 assert.equal(calls,3);assert.deepEqual(states[1],states[2]);
 assert.ok(statuses.some(s=>s.includes('自动重试当前决策（1/2）')));assert.deepEqual(chat.sessions(),[]);
});

test('user cancellation during an idle decision never retries',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async()=>{calls++;return slowDecision({action:'route',kind:'chat'},{reasoning:0,end:false});},{first:200,idle:1000,decision:2000,total:3000});
 const result=chat.complete(input);const timer=setTimeout(()=>chat.cancel(input.id),30);
 t.after(()=>clearTimeout(timer));
 await assert.rejects(result,/已停止/);assert.equal(calls,1);assert.deepEqual(chat.sessions(),[]);
});

test('empty agent response retries without replaying tools, preserves diagnostic counts',async t=>{
 const storage=await fixture(t);let calls=0;const statuses=[];
 const chat=createChat(storage,async()=>++calls===1?new Response(JSON.stringify({choices:[{message:{content:null,reasoning_content:'private'},finish_reason:'stop'}]})):native(calls===2?{action:'route',kind:'chat'}:{action:'reply',text:'已恢复'}));
 const result=await chat.complete({...input,onStatus:s=>statuses.push(s)});assert.equal(result.content,'已恢复');assert.equal(calls,3);
 assert.ok(statuses.some(s=>s.includes('正在自动恢复')));
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');const w=await createWorkspace(storage.agentDirectory,(await storage.readWorkspace()).tasks[0]);
 const e=w.run.events.find(e=>e.type==='empty_response');assert.equal(e.detail.reasoningChars,7);assert.ok(!JSON.stringify(e).includes('private'));
});
test('persistent empty responses exhaust staged recovery while filtering is never retried',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:''},finish_reason:'stop'}]}));});
 const paused=await chat.complete(input);assert.equal(paused.agentRun.status,'blocked');assert.match(paused.content,/尚未完成/);assert.equal(calls,4);assert.deepEqual(chat.sessions(),[]);
 calls=0;const filtered=createChat(storage,async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:''},finish_reason:'content_filter'}]}));});
 await assert.rejects(filtered.complete(input),e=>e.code==='MODEL_CONTENT_FILTER');assert.equal(calls,1);
});

test('missing discriminator switches to named tools and recovers without guessing command action',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async(url,options)=>{
  const body=JSON.parse(options.body);calls++;
  if(calls===1)return native({kind:'chat'});
  assert.equal(body.tool_choice,'required');assert.ok(body.tools.every(t=>t.function.name!=='ailo_action'));
  if(calls===2){assert.deepEqual(body.tools.map(t=>t.function.name),['route']);assert.equal(body.tools[0].function.parameters.properties.action,undefined);}
  else {assert.ok(!body.tools.some(t=>t.function.name==='run_command'));}
  return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:calls===2?'route':'reply',arguments:JSON.stringify(calls===2?{kind:'chat'}:{text:'恢复成功'})}}]},finish_reason:'tool_calls'}]}));
 });
 assert.equal((await chat.complete(input)).content,'恢复成功');assert.equal(calls,3);
});
test('named tools still reject conflicts and cannot infer unnamed actions from command fields',()=>{
 assert.deepEqual(decodeAction({toolCalls:[{function:{name:'run_command',arguments:'{"command":"pwd","purpose":"检查"}'}}]}),{action:'run_command',command:'pwd',purpose:'检查'});
 assert.throws(()=>decodeAction({toolCalls:[{function:{name:'run_command',arguments:'{"action":"write_file","path":"x"}'}}]}),e=>e.reason==='conflicting_action');
 assert.throws(()=>decodeAction({content:'{"command":"pwd","purpose":"检查"}'}),e=>e.diagnostics.issue==='missing_action');
});
test('invalid JSON diagnostics identify response channel without retaining model text',()=>{
 assert.throws(()=>decodeAction({content:'{action:"reply",text:"secret"}',finishReason:'stop'}),e=>e.reason==='invalid_json'&&e.diagnostics.jsonIssue==='syntax'&&e.diagnostics.responseChannel==='content'&&e.diagnostics.finishReason==='stop'&&!JSON.stringify(e.diagnostics).includes('secret'));
 assert.throws(()=>decodeAction({toolCalls:[{function:{name:'ailo_action',arguments:'{"action":"reply"'}}],finishReason:'tool_calls'}),e=>e.reason==='invalid_json'&&e.diagnostics.jsonIssue==='incomplete'&&e.diagnostics.responseChannel==='tool_arguments');
});

test('accepted tools with prose responses switch to named tools then JSON, with consistent recovery instructions',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async(url,options)=>{
  const body=JSON.parse(options.body);calls++;
  const state=JSON.parse(body.messages.at(-1).content);
  if(calls===1)return native({action:'route',kind:'chat'});
  if(calls===2)return new Response(JSON.stringify({choices:[{message:{content:'我正在准备下一步，请稍候'}}]}));
  if(calls===3){
   assert.equal(body.tool_choice,'required');assert.equal(state.responseContract.mode,'named_tools');
   assert.match(state.protocolRecovery.instruction,/具名工具/);assert.ok(!state.protocolRecovery.instruction.includes('ailo_action'));
   return new Response(JSON.stringify({choices:[{message:{content:'下一步是回复用户'}}]}));
  }
  assert.equal(body.tools,undefined);assert.equal(body.response_format.type,'json_object');assert.equal(state.responseContract.mode,'json');
  assert.match(state.protocolRecovery.instruction,/包含字符串 action/);
  return new Response(JSON.stringify({choices:[{message:{content:'{"action":"reply","text":"已恢复"}'}}]}));
 });assert.equal((await chat.complete(input)).content,'已恢复');assert.equal(calls,4);
});

test('an image-input rejection retries as text without leaking provider details or switching protocol formats',async t=>{
 const storage=await fixture(t);let calls=0;
 const task=(await storage.readWorkspace()).tasks[0];
 const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(storage.agentDirectory,task);await fs.writeFile(path.join(w.files,'screen.png'),'image');
 storage.imageObserver={async prepare(){return {image:{type:'image_url',image_url:{url:'data:image/png;base64,TEST'}}};}};
 const chat=createChat(storage,async(_url,options)=>{
  calls++;if(calls===1)return native({action:'route',kind:'chat'});if(calls===2)return native({action:'view_image',path:'screen.png'});
  const request=JSON.parse(options.body),hasImage=request.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));
  assert.ok(request.tools);assert.equal(request.response_format,undefined);
  if(calls===3){assert.ok(hasImage);return new Response(JSON.stringify({error:{message:'image input not supported; provider-private-detail'}}),{status:400});}
  assert.equal(hasImage,false);assert.equal(JSON.parse(request.messages.at(-1).content).observationCapabilities.images,false);
  return native({action:'reply',text:'当前接口不支持图像输入，无法判断图片内容。'});
 });
 const result=await chat.complete(input);
 assert.equal(calls,4);assert.equal(result.agentRun.status,'idle');assert.match(result.content,/不支持图像/);assert.ok(!result.content.includes('provider-private-detail'));
});

test('tool name metadata alone cannot evade the no-action deadline',async t=>{
 const storage=await fixture(t);let calls=0,cancelled=0;
 const chat=createChat(storage,async()=>{calls++;let timer;return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'call',type:'function',function:{name:'ailo_action',arguments:''}}]}}]})+'\n\n'));timer=setInterval(()=>controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'r'}}]})+'\n\n')),5);},cancel(){clearInterval(timer);cancelled++;}}),{headers:{'content-type':'text/event-stream'}});},{connect:200,first:200,idle:200,decision:30,total:1000});
 const result=await chat.complete(input);assert.equal(result.agentRun.status,'blocked');assert.equal(calls,4);assert.equal(cancelled,4);assert.equal(result.agentRun.performance.noActionRequests,4);assert.equal(result.agentRun.performance.toolCalls,0);
});

test('GLM routes with low effort, honors selected effort for execution, and recovers with low effort',async t=>{
 const storage=await fixture(t),bodies=[],records=[];
 storage.modelCredentials=async()=>({baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'glm-5.3-flash'});storage.recordModelRequest=async record=>records.push({...record});
 let n=0;const chat=createChat(storage,async(_url,options)=>{const body=JSON.parse(options.body);bodies.push(body);n++;if(n===2)return new Response(JSON.stringify({choices:[{message:{content:null,reasoning_content:'r'},finish_reason:'stop'}]}));return native(n===1?{action:'route',kind:'task'}:{action:'pause',text:'缩小后恢复'});});
 const result=await chat.complete({...input,reasoningEffort:'high'});
 assert.equal(result.content,'缩小后恢复');assert.deepEqual(bodies.map(b=>b.reasoning_effort),['low','max','low']);assert.ok(bodies.every(b=>b.tool_stream===true));assert.equal(records.at(-1).noActionTimeoutMs,180000);assert.equal(records.at(-1).recoveryMode,true);
 const state=JSON.parse(bodies.at(-1).messages.at(-1).content);assert.equal(state.decisionRecovery.maxWriteChars,8000);assert.equal(bodies.at(-1).tools[0].function.parameters.properties.content.maxLength,8000);
});

test('streamed GLM arguments cancel the no-action timer but execute only after complete JSON arrives',async t=>{
 const storage=await fixture(t);storage.modelCredentials=async()=>({baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'glm-5.3-flash'});let calls=0;
 const chat=createChat(storage,async(_url,options)=>{assert.equal(JSON.parse(options.body).tool_stream,true);if(++calls>1)return native({action:'reply',text:'完整参数后执行'});const encoder=new TextEncoder();let timer;
  return new Response(new ReadableStream({start(controller){const send=delta=>controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{index:0,delta}]})+'\n\n'));send({tool_calls:[{index:0,id:'c',type:'function',function:{name:'ailo_action',arguments:'{"action":'}}]});timer=setTimeout(()=>{send({tool_calls:[{index:0,function:{arguments:'"route","kind":"chat"}'}}]});controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n'));controller.close();},60);},cancel(){clearTimeout(timer);}}),{headers:{'content-type':'text/event-stream'}});
 },{connect:200,first:200,idle:200,decision:30,total:1000});
 const result=await chat.complete(input);assert.equal(result.content,'完整参数后执行');assert.equal(calls,2);
});

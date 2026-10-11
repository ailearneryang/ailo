const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createChat}=require('../apps/desktop/chat.cjs');
const {createStorage}=require('../apps/desktop/storage.cjs');
const input={id:'r',modelId:'m',messages:[{role:'user',content:'hello'}]};
const modelCredentials=async()=>({baseUrl:'https://example.com/v1',model:'test',name:'test',apiKey:'private-key'});
const native=action=>Response.json({choices:[{message:{tool_calls:[{id:'a',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},finish_reason:'tool_calls'}]});
const complete=()=>Response.json({choices:[{message:{content:'恢复成功'},finish_reason:'stop'}]});
const limits={connect:20,first:25,idle:25,decision:500,text:500,total:1000,retryDelay:0};
test('header waiting grows on retry to accommodate queued gateways',async()=>{
 const records=[];let calls=0;
 const chat=createChat({modelCredentials,recordModelRequest:async d=>records.push({...d})},async()=>{
  calls++;if(calls===1)return new Promise(()=>{});
  await new Promise(resolve=>setTimeout(resolve,50));return complete();
 },{...limits,connect:30,headerStep:70});
 assert.equal((await chat.complete(input)).content,'恢复成功');
 assert.equal(calls,2);assert.equal(records[0].responseHeadersTimeoutMs,30);assert.equal(records[0].timeoutStage,'response_headers');assert.equal(records[1].responseHeadersTimeoutMs,100);assert.equal(records[1].outcome,'completed');
});
test('request diagnostics correlate each wire attempt without recording payload or credentials',async()=>{
 const records=[],wire=[];
 const chat=createChat({modelCredentials,recordModelRequest:async d=>records.push({...d})},async(_,options)=>{wire.push(options);return complete();},limits);
 await chat.complete(input);
 const record=records[0],body=JSON.parse(wire[0].body);
 assert.equal(wire[0].headers['X-Ailo-Request-Id'],record.id);
 assert.equal(record.requestBytes,Buffer.byteLength(wire[0].body));assert.equal(record.messageCount,body.messages.length);assert.equal(record.requestedOutputTokens,body.max_tokens);
 assert.ok(!JSON.stringify(record).includes('private-key'));assert.equal(record.messages,undefined);assert.equal(record.body,undefined);
});
function stalled(onCancel,heartbeat=true,id='req-123'){
 return new Response(new ReadableStream({start(c){if(heartbeat)c.enqueue(new TextEncoder().encode(': heartbeat\n\n'));},cancel:onCancel}),{headers:{'content-type':'text/event-stream','x-request-id':id}});
}
function interruptedStream(delta){
 let sent=false;
 return new Response(new ReadableStream({pull(controller){if(!sent){sent=true;controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta}]})+'\n\n'));}else controller.error(Error('net::ERR_INCOMPLETE_CHUNKED_ENCODING'));}}),{headers:{'content-type':'text/event-stream'}});
}
test('chunked transport failure preserves visible text without automatic replay',async()=>{
 let calls=0;
 const chat=createChat({modelCredentials},async()=>{calls++;return interruptedStream({content:'已有正文'});},limits);
 await assert.rejects(chat.complete(input),e=>e.code==='MODEL_NETWORK'&&e.networkCode==='ERR_INCOMPLETE_CHUNKED_ENCODING'&&e.partialContent==='已有正文'&&e.hasVisibleOutput===true);
 assert.equal(calls,1);
});
test('chunked transport retry exhaustion is bounded and reports its network category',async()=>{
 let calls=0;
 const chat=createChat({modelCredentials},async()=>{calls++;return interruptedStream({reasoning_content:'仍在思考'});},limits);
 await assert.rejects(chat.complete(input),e=>e.code==='MODEL_NETWORK'&&e.retryCount===2&&e.requestDiagnostics.networkCode==='ERR_INCOMPLETE_CHUNKED_ENCODING');
 assert.equal(calls,3);assert.equal(chat.sessions().length,0);
});
test('zero content timeout cancels old signal and reader before retry; heartbeat bytes are distinct from content',async()=>{
 const diagnostics=[];let calls=0,cancelled=false,firstSignal;
 const chat=createChat({modelCredentials,recordModelRequest:async d=>diagnostics.push({...d})},async(_,options)=>{
  calls++;if(calls===1){firstSignal=options.signal;return stalled(()=>cancelled=true);}
  assert.equal(firstSignal.aborted,true);assert.equal(cancelled,true);return complete();
 },limits);
 assert.equal((await chat.complete(input)).content,'恢复成功');assert.equal(calls,2);
 assert.equal(diagnostics[0].errorCode,'MODEL_FIRST_CONTENT_TIMEOUT');assert.ok(diagnostics[0].bytes>0);assert.equal(diagnostics[0].firstContentMs,undefined);assert.equal(diagnostics[0].streamCancelled,true);
 assert.equal(diagnostics[0].providerRequestId,'req-123');assert.ok(diagnostics[1].firstContentMs>=0);assert.ok(!JSON.stringify(diagnostics).includes('private-key'));
});
test('header stall is bounded even when fetch ignores abort; a late response is discarded',async()=>{
 let calls=0,resolveFirst,lateCancelled=false,signal;const records=[];
 const chat=createChat({modelCredentials,recordModelRequest:async d=>records.push({...d})},async(_,options)=>{
  if(++calls===1){signal=options.signal;return new Promise(resolve=>resolveFirst=resolve);}
  assert.equal(signal.aborted,true);return complete();
 },limits);
 assert.equal((await chat.complete(input)).content,'恢复成功');assert.equal(records[0].errorCode,'MODEL_CONNECT_TIMEOUT');
 resolveFirst(stalled(()=>lateCancelled=true));await new Promise(resolve=>setImmediate(resolve));assert.equal(lateCancelled,true);
 assert.deepEqual(chat.sessions(),[]);
});
test('retry exhaustion preserves error class and safe request id, clears sessions, and never stores failed assistant messages',async()=>{
 let calls=0,cancels=0;const chat=createChat({modelCredentials},async()=>{calls++;return stalled(()=>cancels++);},limits);
 await assert.rejects(chat.complete(input),e=>e.code==='MODEL_FIRST_CONTENT_TIMEOUT'&&e.retryCount===2&&e.message.includes('req-123'));
 assert.equal(calls,3);assert.equal(cancels,3);assert.deepEqual(chat.sessions(),[]);
});
test('user cancellation during backoff prevents retry and releases the session',async()=>{
 let calls=0;const chat=createChat({modelCredentials},async()=>{calls++;return stalled(()=>{});},{...limits,retryDelay:1000});
 await assert.rejects(chat.complete({...input,onStatus:s=>{if(s.includes('自动重试'))chat.cancel(input.id);}}),e=>e.code==='MODEL_CANCELLED');
 assert.equal(calls,1);assert.deepEqual(chat.sessions(),[]);
});
test('partial visible replies are preserved and never silently replayed; permanent auth failures do not retry',async()=>{
 let calls=0;const texts=[];
 const chat=createChat({modelCredentials},async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"已收到的部分"}}]}\n\n'));},cancel(){}}),{headers:{'content-type':'text/event-stream'}});},limits);
 await assert.rejects(chat.complete({...input,onText:t=>texts.push(t)}),e=>e.code==='MODEL_STREAM_IDLE_TIMEOUT'&&e.partialContent==='已收到的部分');
 assert.equal(calls,1);assert.deepEqual(texts,['已收到的部分']);
 calls=0;await assert.rejects(createChat({modelCredentials},async()=>{calls++;return new Response(null,{status:401});},limits).complete(input),e=>e.code==='MODEL_HTTP_ERROR');assert.equal(calls,1);
});
test('decision recovery preserves executed tools and identical request checkpoint without replaying writes',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-recovery-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const storage=createStorage(directory,{});const task=await storage.patchTask('task',{request:'写一个文件',title:'文件任务',materials:[],messages:[{id:'u',role:'user',content:'写一个文件'}]});
 storage.agentDirectory=path.join(directory,'agent');storage.modelCredentials=modelCredentials;
 const requests=[];let calls=0;
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:'写文件',decisions:[],acceptance:['文件存在'],steps:[{id:'write',title:'写文件',status:'pending'}]},{action:'write_file',path:'result.txt',content:'已经写入'}];
 const chat=createChat(storage,async(_,options)=>{
  requests.push(JSON.parse(options.body));calls++;
  if(calls<=3)return native(actions[calls-1]);if(calls===4)return interruptedStream({tool_calls:[{index:0,id:'incomplete',type:'function',function:{name:'ailo_action',arguments:'{"action":"write_file","path":"result.txt","content":"禁止重写'}}]});
  assert.deepEqual(requests[3],requests[4]);return native({action:'blocked',text:'已保留完成的文件，等待下一步'});
 },limits);
 assert.match((await chat.complete({...input,taskId:task.id,messages:task.messages})).content,/已保留/);
 const workspace=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(storage.agentDirectory,task);
 assert.equal(workspace.run.events.filter(e=>e.type==='write_file').length,1);assert.equal(await fs.readFile(path.join(workspace.files,'result.txt'),'utf8'),'已经写入');
 const records=JSON.parse(await fs.readFile(path.join(directory,'model-requests.json'),'utf8'));assert.equal(records.filter(r=>r.networkCode==='ERR_INCOMPLETE_CHUNKED_ENCODING').length,1);
 assert.ok(!JSON.stringify(records).includes('已经写入'));assert.ok(!JSON.stringify(records).includes('private-key'));
});

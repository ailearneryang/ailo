const test=require('node:test'),assert=require('node:assert/strict');
const {networkError}=require('../apps/desktop/network-error.cjs'),{recoverRequest}=require('../apps/desktop/model-request.cjs');
test('suspended network I/O is safely classified and can recover on the original request after wake',async()=>{
 const error=networkError(Error('net::ERR_NETWORK_IO_SUSPENDED https://private.example?key=secret'));assert.equal(error.code,'MODEL_NETWORK');assert.equal(error.networkCode,'ERR_NETWORK_IO_SUSPENDED');assert.doesNotMatch(error.message,/private|secret/);let calls=0;
 const value=await recoverRequest(async()=>{if(++calls===1)throw error;return 'recovered';},{signal:new AbortController().signal,retries:2,retryDelay:0});assert.equal(value,'recovered');assert.equal(calls,2);
});
test('a suspended network keeps the task and requests the actual wake/network condition',()=>{
 const run={status:'blocked',waitingError:{code:'MODEL_NETWORK',networkCode:'ERR_NETWORK_IO_SUSPENDED',message:'网络已暂停'},events:[]};const c=require('../apps/desktop/agent/task-continuation.cjs').update(run);assert.equal(c.state,'waiting_service');assert.equal(c.taskOpen,true);assert.match(c.question,/设备.*唤醒.*网络/);assert.doesNotMatch(c.question,/授权|额度/);
});
test('execution power holds are reference-safe and stop on release or disposal without preventing explicit system sleep',()=>{
 let serial=0;const starts=[],stops=[],power=require('../apps/desktop/execution-power.cjs').createExecutionPower({start:type=>(starts.push(type),++serial),stop:id=>stops.push(id)});const a=power.hold(),b=power.hold();assert.equal(power.active,2);assert.deepEqual(starts,['prevent-app-suspension','prevent-app-suspension']);a();a();assert.equal(power.active,1);assert.deepEqual(stops,[1]);power.dispose();b();assert.equal(power.active,0);assert.deepEqual(stops,[1,2]);
});
test('an unavailable power blocker cannot prevent task execution',()=>{
 const power=require('../apps/desktop/execution-power.cjs').createExecutionPower({start(){throw Error('not supported');},stop(){assert.fail('no acquired hold');}});assert.doesNotThrow(()=>power.hold()());assert.equal(power.active,0);power.dispose();
});

test('legacy suspended-network records are classified without changing task requirements, evidence or budgets',()=>{
 const continuation=require('../apps/desktop/agent/task-continuation.cjs'),{networkRecovery}=require('../apps/desktop/network-recovery.cjs');
 const run={status:'blocked',inputKey:'u',waitingError:{code:'EXECUTION_DIAGNOSIS_REQUIRED',message:'net::ERR_NETWORK_IO_SUSPENDED 请求标识：da7a2a46-c9da-9ab2-ae69-961aead68f34。'},requirementsManaged:true,requirements:Array.from({length:5},(_,i)=>({id:'r'+i,text:'原要求'+i,type:'content'})),steps:Array.from({length:5},(_,i)=>({id:'s'+i,status:i?'pending':'running'})),artifacts:[],events:[],decisionRecovery:{noActionFailures:3},readAttempts:[['same',2]],actionJournal:[]};
 const protectedState=JSON.stringify([run.requirements,run.steps,run.decisionRecovery,run.readAttempts,run.actionJournal,run.waitingError]);
 const c=continuation.update(run);assert.equal(c.state,'waiting_service');assert.equal(c.code,'MODEL_NETWORK');assert.equal(c.networkCode,'ERR_NETWORK_IO_SUSPENDED');assert.equal(c.retained.requirements,5);assert.equal(c.retained.steps,5);assert.equal(c.retained.artifacts.length,0);
 assert.match(c.question,/网络.*恢复.*重试当前步骤/);assert.doesNotMatch(c.question,/补充.*诊断|授权|额度/);assert.equal(continuation.canResume(run,{messages:[{id:'u',role:'user',content:'原任务'}]}),true);assert.ok(networkRecovery(run));
 assert.equal(JSON.stringify([run.requirements,run.steps,run.decisionRecovery,run.readAttempts,run.actionJournal,run.waitingError]),protectedState);
 const legacyUi={status:'blocked',taskContinuation:{...c,code:'EXECUTION_DIAGNOSIS_REQUIRED',networkCode:undefined,state:'waiting_diagnosis',gap:run.waitingError.message}};assert.ok(networkRecovery(legacyUi));
});
test('network retry still refuses unknown effects, explicit pauses, permissions, certificates and non-network failures',()=>{
 const continuation=require('../apps/desktop/agent/task-continuation.cjs'),{networkRecovery}=require('../apps/desktop/network-recovery.cjs');
 const base={status:'blocked',inputKey:'u',waitingError:{code:'MODEL_NETWORK',networkCode:'ERR_NETWORK_IO_SUSPENDED',message:'暂停'},taskContinuation:{taskOpen:true,state:'waiting_service'}};
 for(const patch of [{status:'paused'},{status:'waiting_permission'},{actionJournal:[{status:'unknown'}]},{taskContinuation:{taskOpen:true,state:'waiting_result_check'}},{waitingError:{code:'MODEL_NETWORK',networkCode:'ERR_CERT_AUTHORITY_INVALID'}},{waitingError:{code:'MODEL_PROVIDER_REJECTED',providerCategory:'authentication'}},{waitingError:{code:'AGENT_REPAIR_EXHAUSTED',message:'net::ERR_NETWORK_IO_SUSPENDED'}}]){
  const run={...base,...patch};assert.equal(networkRecovery(run),undefined);
  if(run.status==='blocked')assert.equal(continuation.canResume(run,{messages:[{id:'u',role:'user',content:'继续'}]}),false);
 }
});
test('untyped suspended errors retry only the interrupted request and preserve visible-output and cancellation guards',async()=>{
 let calls=0;assert.equal(await recoverRequest(async()=>{if(++calls===1)throw Error('net::ERR_NETWORK_IO_SUSPENDED');return 'same request';},{signal:new AbortController().signal,retryDelay:0}),'same request');assert.equal(calls,2);
 calls=0;await assert.rejects(recoverRequest(async()=>{calls++;throw Object.assign(Error('net::ERR_NETWORK_IO_SUSPENDED'),{hasVisibleOutput:true,partialContent:'already shown'});},{signal:new AbortController().signal,retryDelay:0}),e=>e.code==='MODEL_NETWORK'&&e.hasVisibleOutput&&e.partialContent==='already shown');assert.equal(calls,1);
 calls=0;await assert.rejects(recoverRequest(async()=>{calls++;throw Error('net::ERR_NETWORK_IO_SUSPENDED');},{signal:new AbortController().signal,retryDelay:0}),e=>e.code==='MODEL_NETWORK'&&e.retryCount===2);assert.equal(calls,3);
 const controller=new AbortController();calls=0;await assert.rejects(recoverRequest(async()=>{calls++;controller.abort();throw Error('net::ERR_NETWORK_IO_SUSPENDED');},{signal:controller.signal,retryDelay:0}));assert.equal(calls,1);
});
test('an explicit network retry resumes the original task with five requirements and no registered artifacts, without replaying prior writes',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{runAgent}=require('../apps/desktop/agent/runner.cjs');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-network-resume-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'network',request:'生成报告并保留全部五项要求',messages:[{id:'u',role:'user',content:'生成报告并保留全部五项要求'}]},model={id:'company',model:'fixture',contextWindow:131072};let calls=0;
 const response=action=>({content:JSON.stringify(action)});
 await assert.rejects(runAgent({base,task,model,signal:new AbortController().signal,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);calls++;
  if(s.phase==='route')return response({action:'route',kind:'task'});
  if(!s.steps.length)return response({action:'plan',goal:task.request,decisions:[],requirements:Array.from({length:5},(_,i)=>({id:'r'+i,text:'报告包含内容'+i,type:'content'})),steps:Array.from({length:5},(_,i)=>({id:'s'+i,title:'核验内容'+i,status:i?'pending':'running'}))});
  if(calls===3)return response({action:'write_file',path:'report.txt',content:'内容0 内容1 内容2 内容3 内容4'});
  throw Error('net::ERR_NETWORK_IO_SUSPENDED https://private.example?key=secret');
 }}),e=>e.code==='MODEL_NETWORK'&&e.agentRun.taskContinuation.state==='waiting_service'&&!e.taskMessage.includes('private'));
 let w=await createWorkspace(base,task);const executionId=w.run.executionId,original=await fs.readFile(path.join(w.files,'report.txt'),'utf8');assert.equal(w.run.artifacts.length,0);assert.equal(w.run.requirements.length,5);assert.equal(w.run.steps.length,5);assert.equal(w.run.events.filter(e=>e.type==='write_file').length,1);
 let attempts=0;
 const result=await runAgent({base,task,model,requestOrigin:'user',signal:new AbortController().signal,executeTool:()=>assert.fail('no tool replay on model request retry'),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(s.phase==='route')return response({action:'route',kind:'task'});
  assert.equal(s.acceptanceCriteria.length,5);assert.equal(s.steps.length,5);
  return recoverRequest(async()=>{if(++attempts===1)throw Error('net::ERR_NETWORK_IO_SUSPENDED');return response({action:'pause',text:'原报告和五项要求已保留，后续继续真实核验。'});},{signal:new AbortController().signal,retryDelay:0});
 }});
 assert.equal(attempts,2);assert.equal(result.agentRun.status,'paused');w=await createWorkspace(base,task);assert.equal(w.run.executionId,executionId);assert.equal(w.run.events.filter(e=>e.type==='write_file').length,1);assert.equal(await fs.readFile(path.join(w.files,'report.txt'),'utf8'),original);assert.equal(w.run.acceptanceResults?.r0,undefined);
});

test('desktop stream suspension exhausts only its request, exposes a network retry, then resumes without replaying a known write',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-suspended-chat-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'suspended',request:'生成说明并逐项核验',materials:[],messages:[{id:'u',role:'user',content:'生成说明并逐项核验'}]},records=[];
 const storage={agentDirectory:base,modelCredentials:async()=>({baseUrl:'https://company.example/v1',name:'fixture',model:'fixture',contextWindow:131072}),readWorkspace:async()=>({tasks:[task]}),recordModelRequest:async r=>records.push({...r})};
 let wrote=false,offline=true,failedRequests=0;
 const native=a=>Response.json({choices:[{message:{tool_calls:[{id:'c',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(a)}}]},finish_reason:'tool_calls'}]});
 const chat=require('../apps/desktop/chat.cjs').createChat(storage,async(_url,options)=>{
  const s=JSON.parse(JSON.parse(options.body).messages.at(-1).content);
  if(s.phase==='route')return native({action:'route',kind:'task'});
  if(!s.steps.length)return native({action:'plan',goal:task.request,decisions:[],requirements:[{id:'r',text:'说明包含已保留',type:'content'}],steps:[{id:'s',title:'生成并核验说明',status:'running'}]});
  if(!wrote){wrote=true;return native({action:'write_file',path:'draft.txt',content:'已保留，尚待核验'});}
  if(!offline)return native({action:'pause',text:'沿原任务保留说明，后续继续核验。'});
  failedRequests++;let sent=false;
  return new Response(new ReadableStream({pull(c){if(!sent){sent=true;c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{name:'ailo_action',arguments:'{"action":"write_file","path":"must-not-exist.txt",'}}]}}]})+'\n\n'));}else c.error(Error('net::ERR_NETWORK_IO_SUSPENDED https://private.example?key=secret'));}}),{headers:{'content-type':'text/event-stream','x-request-id':'da7a2a46-c9da-9ab2-ae69-961aead68f34'}});
 },{retryDelay:0});
 const first=await chat.complete({id:'first',modelId:'m',taskId:task.id,messages:task.messages,executionOrigin:'user'});
 assert.equal(failedRequests,3);assert.equal(first.agentRun.status,'blocked');assert.equal(first.agentRun.waitingError.networkCode,'ERR_NETWORK_IO_SUSPENDED');assert.equal(first.agentRun.taskContinuation.state,'waiting_service');assert.match(first.content,/网络.*恢复.*重试当前步骤/);assert.doesNotMatch(first.content,/private|secret|补充.*诊断/);
 const failures=records.filter(r=>r.networkCode==='ERR_NETWORK_IO_SUSPENDED');assert.equal(failures.length,3);assert.ok(failures.every(r=>r.providerRequestId==='da7a2a46-c9da-9ab2-ae69-961aead68f34'));
 let w=await createWorkspace(base,task);const id=w.run.executionId;assert.equal(w.run.events.filter(e=>e.type==='write_file').length,1);await assert.rejects(fs.stat(path.join(w.files,'must-not-exist.txt')),{code:'ENOENT'});
 offline=false;const second=await chat.complete({id:'second',modelId:'m',taskId:task.id,messages:task.messages,executionOrigin:'user'});assert.equal(second.agentRun.status,'paused');w=await createWorkspace(base,task);assert.equal(w.run.executionId,id);assert.equal(w.run.events.filter(e=>e.type==='write_file').length,1);assert.equal(await fs.readFile(path.join(w.files,'draft.txt'),'utf8'),'已保留，尚待核验');assert.equal(w.run.acceptanceResults?.r,undefined);
});

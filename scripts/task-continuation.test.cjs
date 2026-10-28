const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {providerError}=require('../apps/desktop/provider-error.cjs');
const {recoverRequest}=require('../apps/desktop/model-request.cjs');
const {readCompletion}=require('../apps/desktop/chat-response.cjs');
const continuation=require('../apps/desktop/agent/task-continuation.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const signal=()=>new AbortController().signal,response=action=>({content:JSON.stringify(action)});
test('provider categories are bounded and raw error bodies cannot leak through the message',()=>{
 for(const [payload,category,rejected] of [[{status:503},'transient',false],[{code:'internal_error'},'transient',false],[{code:'invalid_api_key'},'authentication',true],[{code:'insufficient_quota'},'quota',true],[{code:'model_not_found'},'configuration',true],[{},'unknown',false]]){
  const e=providerError({...payload,message:'https://private.example/secret?api_key=sk-secret',request:'sensitive'});assert.equal(e.providerCategory,category);assert.equal(e.code,rejected?'MODEL_PROVIDER_REJECTED':'MODEL_PROVIDER_ERROR');assert.doesNotMatch(e.message,/private|sk-secret|sensitive/);
 }
});
test('a generation error is decoded as a typed provider error before any incomplete tool can execute',async()=>{
 const body='data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,function:{name:'write_file',arguments:'{"path":'}}]}}]})+'\n\n'+'data: '+JSON.stringify({error:{code:'server_error',message:'secret'}})+'\n\n';
 await assert.rejects(readCompletion(new Response(body,{headers:{'content-type':'text/event-stream'}}),{signal:signal(),onActivity(){}}),e=>e.code==='MODEL_PROVIDER_ERROR'&&e.providerCategory==='transient'&&!e.message.includes('secret'));
});
test('a transient provider generation error recovers within the same bounded request',async()=>{
 let calls=0;const result=await recoverRequest(async()=>{if(++calls===1)throw providerError({status:503});return {action:'edit_file'};},{signal:signal(),retries:2,retryDelay:0});assert.equal(calls,2);assert.equal(result.action,'edit_file');
});
test('unknown provider errors are bounded, while permanent errors and visible output are not replayed',async()=>{
 let calls=0;await assert.rejects(recoverRequest(async()=>{calls++;throw providerError({});},{signal:signal(),retries:2,retryDelay:0}),e=>e.code==='MODEL_PROVIDER_ERROR'&&e.retryCount===2);assert.equal(calls,3);
 for(const error of [providerError({code:'invalid_api_key'}),Object.assign(providerError({status:500}),{hasVisibleOutput:true})]){let attempts=0;await assert.rejects(recoverRequest(async()=>{attempts++;throw error;},{signal:signal(),retries:2,retryDelay:0}));assert.equal(attempts,1);}
});
test('cancellation stops provider recovery immediately',async()=>{
 const controller=new AbortController();let calls=0;await assert.rejects(recoverRequest(async()=>{calls++;controller.abort();throw providerError({status:500});},{signal:controller.signal,retries:2,retryDelay:0}));assert.equal(calls,1);
});
test('a durable waiting record retains original state, unknown effects and budgets without declaring completion',()=>{
 const run={mode:'task',status:'blocked',goal:'original',requirementsManaged:true,requirements:[{id:'r',text:'original',type:'content'}],steps:[{id:'s',status:'running'}],revision:2,progressEvidence:['real'],decisionRecovery:{attempt:5},actionJournal:[{id:'unknown',status:'unknown'}],executionState:{blocker:{code:'MODEL_PROVIDER_ERROR',message:'service error'}},artifacts:[{path:'draft.txt',label:'草稿'}],events:[]};
 const protectedState=JSON.stringify([run.requirements,run.steps,run.progressEvidence,run.actionJournal,run.decisionRecovery,run.executionState]);const c=continuation.update(run);
 assert.equal(c.taskOpen,true);assert.equal(c.state,'waiting_result_check');assert.deepEqual(c.retained.pendingIds,['r']);assert.equal(c.retained.unknownActions,1);assert.match(c.question,/不能直接重放/);assert.equal(run.status,'blocked');assert.equal(run.currentOutcome,undefined);assert.equal(JSON.stringify([run.requirements,run.steps,run.progressEvidence,run.actionJournal,run.decisionRecovery,run.executionState]),protectedState);assert.equal(continuation.update(run),c);
});
test('waiting questions distinguish authorization, quota and configuration without changing requirements',()=>{
 for(const [category,word]of [['authentication','授权'],['quota','额度'],['configuration','配置']]){
  const run={mode:'task',status:'blocked',executionState:{blocker:{code:'MODEL_PROVIDER_REJECTED',providerCategory:category}},events:[]};assert.match(continuation.update(run).question,new RegExp(word));assert.equal(run.taskContinuation.taskOpen,true);
 }
});
test('a service outage preserves the same task and file, then a meaningful user reply completes it without replaying the write',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-durable-task-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'durable',request:'生成说明文件并核验内容',messages:[{id:'original',role:'user',content:'生成说明文件并核验内容'}]},model={id:'offline',contextWindow:131072};let writes=0,offline=true,failedAttempts=0;
 const ask=async messages=>{const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return response({action:'route',kind:'task'});if(!s.steps.length)return response({action:'plan',goal:task.request,decisions:['保留原要求'],requirements:[{id:'r',text:'文件包含天气主页面',type:'content'}],steps:[{id:'s',title:'生成并核验文件',status:'running'}]});
  if(!writes){writes++;return response({action:'write_file',path:'weather.txt',content:'天气主页面'});}
  if(offline)return recoverRequest(async()=>{failedAttempts++;throw providerError({status:503});},{signal:signal(),retries:2,retryDelay:0});
  if(!s.artifacts.length)return response({action:'artifact',path:'weather.txt',label:'天气说明'});
  if(!s.acceptanceCriteria[0].check)return response({action:'verify',checks:[{criterionId:'r',kind:'text_contains',path:'weather.txt',contains:['天气主页面'],reason:'原内容已核对'}],progress:{steps:[{id:'s',status:'done'}]}});
  return response({action:'finish',text:'说明已完成',review:{summary:'文件已登记且逐项检查通过',issues:[],unverified:[]}});
 };
 let failure;await assert.rejects(runAgent({base,task,model,signal:signal(),ask}),e=>(failure=e,e.code==='MODEL_PROVIDER_ERROR'));const first={content:failure.taskMessage,agentRun:failure.agentRun};assert.equal(failure.taskContinues,true);assert.equal(first.agentRun.status,'blocked');assert.equal(first.agentRun.taskContinuation.state,'waiting_service');assert.equal(first.agentRun.taskContinuation.taskOpen,true);assert.notEqual(first.agentRun.currentOutcome,'complete');assert.match(first.content,/任务保留/);assert.equal(failedAttempts,3);
 let w=await createWorkspace(base,task);const executionId=w.run.executionId;assert.equal(await fs.readFile(path.join(w.files,'weather.txt'),'utf8'),'天气主页面');assert.equal(w.run.events.filter(e=>e.type==='write_file').length,1);assert.equal(w.run.taskContinuation.retained.requirements,1);
 const blind={...task,messages:[...task.messages,{id:'blind',role:'user',content:'继续'}]};const unchanged=await runAgent({base,task:blind,model,signal:signal(),requestOrigin:'user',ask:async()=>assert.fail('blind continuation must not call the model')});assert.equal(unchanged.agentRun.taskContinuation.taskOpen,true);assert.equal(writes,1);
 offline=false;const resumed={...task,messages:[...task.messages,{id:'service-restored',role:'user',content:'服务已恢复，保留原要求，从已有文件继续检查'}]};
 const second=await runAgent({base,task:resumed,model,signal:signal(),ask});assert.equal(second.agentRun.status,'completed');assert.equal(second.agentRun.taskContinuation.taskOpen,false);assert.equal(writes,1);w=await createWorkspace(base,resumed);assert.equal(w.run.executionId,executionId);assert.equal(w.run.events.filter(e=>e.type==='write_file').length,1);assert.deepEqual(w.run.requirements.map(r=>r.id),['r']);assert.equal(w.run.acceptanceResults.r.status,'passed');
});
test('a waiting task does not turn a bare retry or an empty continuation form into another model call',()=>{
 const run={status:'blocked',inputKey:'old',taskContinuation:{taskOpen:true}};
 for(const content of ['继续','重试','继续任务。','继续原任务。已处理的条件或补充信息：','请从已保存的任务状态继续，先检查已有成果，不重复执行已完成步骤。'])assert.equal(continuation.canResume(run,{messages:[{id:'new',role:'user',content}]}),false);
 assert.equal(continuation.canResume(run,{messages:[{id:'old',role:'user',content:'original'}]}),false);
 assert.equal(continuation.canResume(run,{messages:[{id:'new',role:'user',content:'服务已恢复，请核对现有文件继续'}]}),true);
 assert.equal(continuation.canResume(run,{messages:[{id:'new',role:'user',content:'继续',materials:[{name:'new-error.txt'}]}]}),true);
});
test('the desktop chat adapter returns an actionable saved-task reply after provider recovery is exhausted',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-waiting-chat-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'task',request:'生成天气说明并逐项核验',materials:[],messages:[{id:'original',role:'user',content:'生成天气说明并逐项核验'}]};
 const storage={agentDirectory:base,modelCredentials:async()=>({baseUrl:'https://company.example/v1',name:'fixture',model:'fixture',contextWindow:131072}),readWorkspace:async()=>({tasks:[task]})};
 let powerStarts=0,powerStops=0;storage.executionPower=require('../apps/desktop/execution-power.cjs').createExecutionPower({start:type=>{assert.equal(type,'prevent-app-suspension');return ++powerStarts;},stop:()=>{powerStops++;}});
 let calls=0,wrote=false;const native=action=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'c',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},finish_reason:'tool_calls'}]}));
 const chat=require('../apps/desktop/chat.cjs').createChat(storage,async(_,options)=>{calls++;const s=JSON.parse(JSON.parse(options.body).messages.at(-1).content);
  if(s.phase==='route')return native({action:'route',kind:'task'});
  if(!s.steps.length)return native({action:'plan',goal:task.request,decisions:['保留原要求'],requirements:[{id:'r',text:'天气说明',type:'content'}],steps:[{id:'s',title:'生成并验收说明',status:'running'}]});
  if(!wrote){wrote=true;return native({action:'write_file',path:'draft.txt',content:'天气说明草稿'});}
  return new Response(JSON.stringify({error:{status:503,message:'secret-payload'}}));
 },{retryDelay:0});
 const result=await chat.complete({id:'conversation',modelId:'model',taskId:task.id,messages:task.messages,executionOrigin:'user'});
 assert.equal(calls,6);assert.equal(powerStarts,1);assert.equal(powerStops,1);assert.equal(storage.executionPower.active,0);assert.equal(result.agentRun.status,'blocked');assert.equal(result.agentRun.taskContinuation.state,'waiting_service');assert.equal(result.agentRun.taskContinuation.taskOpen,true);assert.match(result.content,/任务保留/);assert.doesNotMatch(result.content,/secret-payload/);assert.deepEqual(chat.sessions(),[]);
 const w=await createWorkspace(base,task);assert.equal(await fs.readFile(path.join(w.files,'draft.txt'),'utf8'),'天气说明草稿');assert.equal(w.run.events.filter(e=>e.type==='write_file').length,1);assert.equal(w.run.events.some(e=>e.type==='finish'),false);assert.equal(w.run.taskContinuation.taskOpen,true);
});

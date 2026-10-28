const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const protocol=require('../apps/desktop/agent/protocol.cjs');
const menu=require('../apps/desktop/agent/tool-menu.cjs');
const {createChat}=require('../apps/desktop/chat.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {readCompletion}=require('../apps/desktop/chat-response.cjs');
const native=action=>Response.json({choices:[{message:{tool_calls:[{id:'call',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},finish_reason:'tool_calls'}]});
const json=action=>Response.json({choices:[{message:{content:JSON.stringify(action)},finish_reason:'stop'}]});
const resolve=(schema,value)=>value?.$ref?schema.$defs[value.$ref.split('/').at(-1)]:value;
const branch=(schema,name)=>schema.oneOf.find(x=>x.properties.action.const===name);
async function fixture(t,request='分析材料'){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-json-contract-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const material={name:'fixture.txt',text:'OFFLINE_MATERIAL_FACT',summary:'offline fixture'};
 const task={id:'t',projectId:'p',request,materials:[material],messages:[{role:'user',content:request,materials:[material]}]};
 const model={baseUrl:'https://unconfirmed.company.invalid/v1',model:'company-glm',contextWindow:32768,maxOutputTokens:16384};
 return {task,model,storage:{agentDirectory:base,modelCredentials:async()=>model,readWorkspace:async()=>({tasks:[task]})}};
}
const input=task=>({id:'r',taskId:task.id,modelId:'m',messages:task.messages});

test('JSON contracts retain action-specific required fields, scopes and shared parameter schemas',()=>{
 const state={phase:'task',steps:[{id:'s',status:'running'}]},names=[...menu.select(state,protocol.allowedActions(state)),'plan'];
 const contract=protocol.jsonActionContract(state,names),schema=contract.parametersSchema;
 const plan=branch(schema,'plan'),requirements=resolve(schema,plan.properties.requirements);
 assert.ok(requirements.items.properties.evidenceBinding);assert.ok(resolve(schema,plan.properties.progress).properties.executionState);assert.ok(resolve(schema,plan.properties.progress).properties.issues);
 const check=resolve(schema,branch(schema,'verify').properties.checks);assert.ok(check.items.properties.scope);assert.ok(check.items.properties.regions);assert.ok(check.items.required.includes('criterionId'));assert.ok(check.items.required.includes('reason'));
 const items=resolve(schema,branch(schema,'batch_read').properties.items),variants=items.items.allOf[0].oneOf;
 for(const action of ['read_material','read_source','inspect_source'])assert.ok(variants.find(x=>x.properties.action.const===action).required.includes('id'));
 assert.ok(variants.find(x=>x.properties.action.const==='read_file').required.includes('path'));
 assert.ok(variants.find(x=>x.properties.action.const==='search_materials').required.includes('query'));
 assert.deepEqual(contract.batchItemRequiredFields.read_material,['id']);
 const all=protocol.actionTools(state,names);assert.ok(JSON.stringify(contract).length<JSON.stringify(all).length);
});

test('existing plans favor attached progress and remain discoverable when real planning is needed',()=>{
 const ordinary={phase:'task',steps:[{id:'s',status:'running'}]},allowed=protocol.allowedActions(ordinary);
 assert.ok(!menu.select(ordinary,allowed).includes('plan'));
 assert.ok(!menu.select({...ordinary,executionState:{blocker:{code:'BUILD_FAILED'}}},allowed).includes('plan'));
 assert.ok(!menu.select({...ordinary,executionState:{nextAction:'plan'}},allowed).includes('plan'));
 assert.ok(menu.select(ordinary,allowed,['plan']).includes('plan'));
 for(const requiredAction of ['plan_update','finish_review'])assert.ok(menu.select({...ordinary,requiredAction},allowed).includes('plan'));
 assert.ok(menu.select({...ordinary,steps:[]},allowed).includes('plan'));
 const unknownGateway={phase:'chat',steps:[]};assert.ok(!protocol.jsonActionContract(unknownGateway,menu.select(unknownGateway,protocol.allowedActions(unknownGateway))).parametersSchema.oneOf.some(x=>x.properties.action.const==='write_file'));
});

test('before a first plan, read schemas offer only memory progress while top-level plan steps remain intact',async()=>{
 const state={phase:'task',steps:[]},names=menu.select(state,protocol.allowedActions(state));
 for(const name of ['read_material','read_source','batch_read']){
  const params=protocol.actionTools(state,[name])[0].function.parameters;
  assert.deepEqual(Object.keys(params.properties.progress.properties),['memory']);
 }
 const unified=protocol.menuTool(state,names).function.parameters;
 assert.ok(unified.properties.steps);const branch=unified.allOf.find(x=>x.if?.properties?.action?.const==='plan');assert.deepEqual(Object.keys(branch.else.properties.progress.properties),['memory']);
 const plan=protocol.actionTools(state,['plan'])[0].function.parameters.properties;assert.ok(plan.steps);assert.ok(plan.progress.properties.steps);assert.equal(plan.progress.properties.steps.items.properties.id.enum,undefined);assert.match(plan.progress.properties.steps.description,/本次plan顶层steps/);
 const {promptForState}=await import('../apps/desktop/agent/prompt.mjs');assert.match(promptForState(state),/前置读取只能附progress.memory/);
});

test('JSON fallback carries the live parameter contract, avoids the missing-material-ID round trip and budgets it',async t=>{
 const {storage,task,model}=await fixture(t),records=[];storage.recordModelRequest=async r=>records.push(r);let calls=0;
 const {requestContextUsage}=await import('../apps/desktop/context.mjs');
 const chat=createChat(storage,async(_,options)=>{
  const body=JSON.parse(options.body);calls++;
  if(calls===1)return new Response('{"error":"tools not supported"}',{status:400});
  assert.equal(body.tools,undefined);assert.equal(body.response_format.type,'json_object');assert.equal(body.enable_thinking,undefined);assert.equal(body.reasoning_effort,undefined);
  const state=JSON.parse(body.messages.at(-1).content),contract=state.responseContract.parametersSchema;assert.ok(contract);
  const stats=requestContextUsage(body.messages,{response_format:body.response_format},model,body.max_tokens);assert.ok(stats.used+body.max_tokens+128<=model.contextWindow);
  if(state.phase==='route')return json({action:'route',kind:'chat'});
  if(calls===3){const batch=branch(contract,'batch_read');assert.ok(batch);assert.deepEqual(state.responseContract.batchItemRequiredFields.read_material,['id']);assert.equal(resolve(contract,batch.properties.items).items.allOf[0].oneOf.find(x=>x.properties.action.const==='read_material').required.includes('id'),true);return json({action:'batch_read',items:[{action:'read_material',id:state.materials[0].id,limit:100}]});}
  assert.match(JSON.stringify(state.toolResults),/OFFLINE_MATERIAL_FACT/);return json({action:'reply',text:'资料已核对'});
 });
 const result=await chat.complete(input(task));assert.equal(result.content,'资料已核对');assert.equal(calls,4);assert.equal(result.agentRun.performance.toolCalls,1);assert.equal(result.agentRun.performance.batchItems,1);assert.equal(result.agentRun.performance.toolErrors,0);assert.ok(records.every(r=>r.inputEstimate+r.requestedOutputTokens+r.guardTokens<=model.contextWindow));
});

test('authorized legacy mock plans outside the short menu still receive ordinary runtime validation',async t=>{
 const {storage,task}=await fixture(t,'制作报告');let calls=0;
 const plan={action:'plan',goal:'制作报告',decisions:[],acceptance:['报告存在'],steps:[{id:'s',title:'制作报告',status:'running'}]};
 const chat=createChat(storage,async(_,options)=>{const state=JSON.parse(JSON.parse(options.body).messages.at(-1).content);calls++;
  if(calls===1)return native({action:'route',kind:'task'});if(calls===2)return native(plan);
  if(calls===3){assert.ok(!state.responseContract.advertisedActions.includes('plan'));assert.ok(state.responseContract.allowedActions.includes('plan'));return native({...plan,steps:[{...plan.steps[0],detail:'已核对所需产物，继续制作'}]});}
  return native({action:'pause',text:'按测试要求保存当前进度'});
 });
 const result=await chat.complete(input(task));assert.equal(result.agentRun.status,'paused');assert.equal(calls,4);assert.match(result.agentRun.steps[0].detail,/已核对/);
});

test('invalid progress for nonexistent steps is rejected rather than silently discarded before a read',async t=>{
 const {storage,task}=await fixture(t,'制作报告'),workspace=await createWorkspace(storage.agentDirectory,task);await fs.writeFile(path.join(workspace.files,'local.txt'),'MUST_NOT_BE_READ');let calls=0;
 const chat=createChat(storage,async()=>{calls++;if(calls===1)return native({action:'route',kind:'task'});if(calls===2)return native({action:'batch_read',items:[{action:'read_file',path:'local.txt'}],progress:{steps:[{id:'nonexistent',status:'running'}]}});return native({action:'blocked',text:'保留无效步骤更新的诊断'});});
 const result=await chat.complete(input(task));assert.equal(result.agentRun.performance.toolCalls,0);assert.equal(result.agentRun.performance.toolErrors||0,0);assert.equal(calls,4);assert.equal(result.agentRun.delivery.status,'settled');assert.equal(result.agentRun.resultRecovery.turns,1);
 const saved=await createWorkspace(storage.agentDirectory,task);assert.equal(saved.run.events.filter(e=>e.type==='protocol_error'&&e.detail.expected==='progress_step_contract').length,1);assert.equal(saved.run.events.filter(e=>e.type==='tool_error').length,0);assert.ok(!saved.run.observationIndex.some(r=>['read_file','batch_read'].includes(r.action)));
});

test('JSON failure positions and tool delta counters contain no argument text and never guess stream repairs',async()=>{
 const secret='SYNTHETIC_SECRET_MUST_NOT_BE_LOGGED',fragments=['{"action":"reply",','"text" "'+secret+'"}'];
 const frames=fragments.map((arguments_,i)=>'data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,...(i?{}:{id:'c'}),function:{...(i?{}:{name:'ailo_action'}),arguments:arguments_}}]}}]})+'\n\n').join('')+'data: [DONE]\n\n';
 const result=await readCompletion(new Response(frames,{headers:{'content-type':'text/event-stream'}}),{signal:new AbortController().signal,onActivity:()=>{}});assert.equal(result.toolArgumentDeltas,2);assert.equal(result.toolCalls[0].function.arguments,fragments.join(''));
 assert.throws(()=>protocol.decodeAction(result),error=>{assert.equal(error.reason,'invalid_json');assert.ok(Number.isSafeInteger(error.diagnostics.jsonErrorOffset));assert.equal(error.diagnostics.jsonErrorCharacterClass,'quote');assert.equal(error.diagnostics.jsonCleanedChars,fragments.join('').length);assert.equal(error.diagnostics.toolArgumentDeltas,2);assert.ok(!JSON.stringify(error).includes(secret));return true;});
 assert.throws(()=>protocol.parseAction('{"action":'),error=>error.diagnostics.jsonErrorCharacterClass==='end'&&error.diagnostics.jsonErrorOffset===10);
 const duplicate=await readCompletion(new Response('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'c',function:{name:'ailo_action',arguments:'{"action":'}}]}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'{"action":'}}]}}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}),{signal:new AbortController().signal,onActivity:()=>{}});assert.equal(duplicate.toolArgumentDeltas,2);assert.equal(duplicate.toolCalls[0].function.arguments,'{"action":{"action":');
});

test('protocol correction remains bounded to two retries with diagnostic-only capture',async t=>{
 const {storage,task}=await fixture(t),records=[];storage.recordModelRequest=async r=>records.push(r);let calls=0;
 const chat=createChat(storage,async()=>{calls++;return Response.json({choices:[{message:{tool_calls:[{id:'c',type:'function',function:{name:'ailo_action',arguments:'{"kind" "SYNTHETIC_PRIVATE_DATA"}'}}]},finish_reason:'tool_calls'}]});});
 const waiting=await chat.complete(input(task));assert.equal(waiting.agentRun.taskContinuation.code,'AGENT_PROTOCOL');assert.equal(waiting.agentRun.taskContinuation.taskOpen,false);assert.equal(waiting.agentRun.delivery.status,'settled');assert.equal(waiting.agentRun.status,'blocked');assert.equal(calls,3);assert.ok(records.every(r=>r.protocolErrorReason==='invalid_json'));assert.ok(records.every(r=>Number.isSafeInteger(r.jsonErrorOffset)));assert.ok(!JSON.stringify(records).includes('SYNTHETIC_PRIVATE_DATA'));
});

test('tool discovery corrections identify the action-name array rather than inventing a pagination error',()=>{
 let rejected;try{require('../apps/desktop/agent/tool-menu.cjs').discovery({content:'{"action":"request_tools","names":"android_device"}'});}catch(error){rejected=error;}
 assert.equal(rejected?.reason,'invalid_parameter');assert.equal(rejected.diagnostics.expected,'authorized_action_names');
 const hint=protocol.parameterHint(rejected.diagnostics);assert.match(hint,/1–8/);assert.match(hint,/数组/);assert.match(hint,/availableActions/);assert.doesNotMatch(hint,/next|offset|limit/);
});

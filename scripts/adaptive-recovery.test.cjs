const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const protocol=require('../apps/desktop/agent/protocol.cjs');
const recovery=require('../apps/desktop/agent/decision-recovery.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createChat}=require('../apps/desktop/chat.cjs');
const {createStorage}=require('../apps/desktop/storage.cjs');
const bailian={baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'glm-5.2',contextWindow:128000,name:'百炼'};
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-adaptive-recovery-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return base;}
const plan={action:'plan',goal:'整理飞书消息',decisions:[],acceptance:['完整保留消息'],steps:[{id:'read',title:'读取飞书分页',status:'running'}]};
test('every recovery stage retains authorized app tools and does not grant new capabilities',()=>{
 const state={phase:'task',mcpConnections:[{id:'known'}],memoryAvailable:false,personalAssistant:false};
 for(const stage of ['small_action','refocus','direct_action']){
  const allowed=protocol.allowedActions({...state,decisionRecovery:{stage}});
  for(const tool of ['feishu','mcp','amap','knowledge','web_search','read_execution'])assert.ok(allowed.includes(tool),stage+': '+tool);
  for(const tool of ['request_network','memory','assistant'])assert.ok(!allowed.includes(tool));
  assert.equal(allowed.includes('batch_read'),stage==='small_action');
 }
});
test('oversized local batch pages normalize safely and invalid app batches get array-specific guidance',()=>{
 const action=protocol.decodeAction({content:JSON.stringify({action:'batch_read',items:[{action:'read_execution',id:'known',offset:'4000',limit:'12000'}]})});
 assert.equal(action.items[0].limit,4000);assert.equal(action.items[0].offset,4000);
 assert.throws(()=>protocol.decodeAction({content:JSON.stringify({action:'batch_read',items:[{action:'feishu',operation:'search',query:'known'}]})}),e=>{
  const hint=protocol.parameterHint(e.diagnostics);assert.match(hint,/数组/);assert.match(hint,/逐个调用/);assert.doesNotMatch(hint,/items 必须.*整数/);return true;
 });
});
test('recovery leaves small-action mode after distinct successful connector pages',()=>{
 const run={inputKey:'u',steps:plan.steps};recovery.begin(run,'MODEL_NO_ACTION_TIMEOUT');
 recovery.progress(run,{action:'feishu',operation:'search',query:'page1'},{exitCode:0});assert.ok(run.decisionRecovery);
 recovery.progress(run,{action:'feishu',operation:'search',query:'page2'},{exitCode:0});assert.equal(run.decisionRecovery,undefined);
});
test('two failed decisions automatically refocus, continue Feishu and never replay the completed page',async t=>{
 const base=await fixture(t),executed=[];let calls=0,failures=0;
 const result=await runAgent({base,task:{id:'task',request:plan.goal},model:bailian,signal:new AbortController().signal,executeTool:async(w,action,signal,options)=>{if(action.action!=='feishu')return require('../apps/desktop/agent/tools.cjs').execute(w,action,signal,options);executed.push(action.query);return {exitCode:0,output:action.query+' messages'};},ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);
  if(state.requiredAction==='checkpoint')return {content:JSON.stringify({action:'checkpoint',text:'已保存两页飞书消息的读取凭据与总结文件，下一步核验已有总结并完成交付，不重复执行读取。'})};
  calls++;
  if(calls===1)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(calls===2)return {content:JSON.stringify(plan)};
  if(calls===3)return {content:JSON.stringify({action:'feishu',operation:'search',query:'page1',purpose:'读取第一页'})};
  if(failures++<2)throw Object.assign(Error('no action'),{code:'MODEL_NO_ACTION_TIMEOUT'});
  if(calls===6){assert.ok(protocol.allowedActions(state).includes('feishu'));assert.equal(state.decisionRecovery.stage,'refocus');}
  if(calls===6)return {content:JSON.stringify({action:'feishu',operation:'search',query:'page2',purpose:'读取第二页'})};
  if(calls===7)return {content:JSON.stringify({action:'write_file',path:'summary.txt',content:'整理完成：page1 和 page2'})};
  if(calls===8)return {content:JSON.stringify({action:'artifact',path:'summary.txt',label:'消息总结'})};
  if(calls===9)return {content:JSON.stringify({action:'verify',checks:[{criterionId:state.acceptanceCriteria[0].id,kind:'text_contains',path:'summary.txt',contains:['page1','page2'],reason:'核对两页结果'}],progress:{steps:[{id:'read',status:'done'}]}})};
  return {content:JSON.stringify({action:'finish',text:'消息已整理',review:{summary:'已核对两页结果',issues:[],unverified:[]}})};
 }});
 assert.equal(result.agentRun.status,'completed');assert.deepEqual(executed,['page1','page2']);
});
test('wire recovery for Model Studio lowers thinking, then disables it and uses named tools',async t=>{
 const directory=await fixture(t),storage=createStorage(directory,{});storage.agentDirectory=path.join(directory,'agent');storage.modelCredentials=async()=>bailian;
 const task=await storage.patchTask('t',{request:'你好',materials:[]});const stages=[],bodies=[];let failures=0;
 const native=action=>Response.json({choices:[{message:{tool_calls:[{id:'tool',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},finish_reason:'tool_calls'}]});
 const chat=createChat(storage,async(_url,options)=>{
  const body=JSON.parse(options.body);bodies.push(body);
  const state=JSON.parse(body.messages.at(-1).content);stages.push(state.decisionRecovery?.stage||'normal');
  if(failures++<3)return Response.json({choices:[{message:{content:'',reasoning_content:'thinking'},finish_reason:'stop'}]});
  if(state.phase==='route')return native({action:'route',kind:'chat'});
  return native({action:'reply',text:'自动恢复成功'});
 });
 const result=await chat.complete({id:'r',taskId:task.id,modelId:'m',reasoningEffort:'medium',messages:[{role:'user',content:'你好'}]});
 assert.equal(result.content,'自动恢复成功');assert.deepEqual(stages.slice(0,4),['normal','small_action','refocus','direct_action']);
 assert.equal(bodies[1].reasoning_effort,'low');assert.equal(bodies[1].enable_thinking,true);
 for(const body of bodies.slice(2,4)){assert.equal(body.enable_thinking,false);assert.equal(body.reasoning_effort,'none');assert.ok(body.tools.every(t=>t.function.name!=='ailo_action'));}
 assert.deepEqual(chat.sessions(),[]);
});
test('timeouts do not consume truncation retries and truncated actions refocus before succeeding',async t=>{
 const base=await fixture(t),stages=[],budgets=[];let calls=0;
 const result=await runAgent({base,task:{id:'mixed',request:'你好'},model:bailian,signal:new AbortController().signal,ask:async(messages,budget)=>{
  const state=JSON.parse(messages.at(-1).content);stages.push(state.decisionRecovery?.stage||'normal');budgets.push(budget);calls++;
  if(calls<=2)throw Object.assign(Error('no action'),{code:'MODEL_NO_ACTION_TIMEOUT'});
  if(calls<=5)throw Object.assign(Error('truncated'),{code:'MODEL_OUTPUT_LIMIT',diagnostics:{contentChars:100,toolArgumentChars:100}});
  return {content:JSON.stringify(state.phase==='route'?{action:'route',kind:'chat'}:{action:'reply',text:'已自动恢复'})};
 }});
 assert.equal(result.content,'已自动恢复');
 assert.deepEqual(stages.slice(0,6),['normal','small_action','refocus','refocus','refocus','direct_action']);
 assert.ok(budgets.slice(1,6).every(b=>b<=32768));
});
test('three ordinary tool errors trigger internal diagnosis and the conversation continues',async t=>{
 const base=await fixture(t);let calls=0;
 const result=await runAgent({base,task:{id:'tool-repair',request:'读取文件'},model:bailian,signal:new AbortController().signal,ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);calls++;
  if(calls===1)return {content:JSON.stringify({action:'route',kind:'chat'})};
  if(calls<=4)return {content:JSON.stringify({action:'read_file',path:`missing-${calls}.txt`})};
  assert.equal(state.toolRecovery.attempt,1);assert.equal(state.toolRecovery.action,'read_file');
  assert.match(state.toolRecovery.instruction,/不需要用户点击重试/);
  assert.equal(state.decisionRecovery.stage,'refocus');
  return {content:JSON.stringify({action:'reply',text:'目录中的文件不存在，请提供需要读取的文件。'})};
 }});
 assert.equal(result.content,'目录中的文件不存在，请提供需要读取的文件。');assert.equal(calls,5);
});
test('local log pages and shell inspections cannot exit repair recovery',()=>{
 const run={inputKey:'u',steps:plan.steps};recovery.begin(run,'MODEL_NO_ACTION_TIMEOUT');
 for(const action of [{action:'read_file',path:'source.kt'},{action:'batch_read',items:[{action:'read_execution'}]},{action:'run_command',command:'cat build.log'},{action:'read_execution',offset:4000}]){
  recovery.progress(run,action,{exitCode:0,results:[{result:{text:'page'}}],text:'page'});
  assert.ok(run.decisionRecovery);
 }
 recovery.progress(run,{action:'edit_file',path:'source.kt'},{changed:false});assert.ok(run.decisionRecovery);
 recovery.progress(run,{action:'edit_file',path:'source.kt'},{changed:true,sha256:'new'});
 recovery.progress(run,{action:'build_android'},{exitCode:1});assert.ok(run.decisionRecovery);
 recovery.progress(run,{action:'build_android'},{exitCode:0});assert.equal(run.decisionRecovery,undefined);
});
test('interleaved log reads do not reset no-action failure budget',async t=>{
 const base=await fixture(t);let calls=0,failures=0;
 const result=await runAgent({base,task:{id:'log-loop',request:'修复编译'},model:bailian,signal:new AbortController().signal,executeTool:async()=>({text:'same build errors',total:10000,next:100}),ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);calls++;
  if(calls===1)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(calls===2)return {content:JSON.stringify(plan)};
  if(calls%2===1){failures++;throw Object.assign(Error('no action'),{code:'MODEL_NO_ACTION_TIMEOUT'});}
  assert.equal(state.decisionRecovery.attempt,failures);
  return {content:JSON.stringify({action:'read_file',path:'build.log',offset:failures*100,limit:100})};
 }});
 assert.equal(failures,4);assert.equal(result.agentRun.status,'blocked');assert.equal(calls,9);
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {decodeAction,parameterHint,tool,actionTools}=require('../apps/desktop/agent/protocol.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const response=action=>({content:JSON.stringify(action),finishReason:'stop'});
const summary='需求：核对原始材料并交付报告。来源：保留的历史执行记录。已确认：材料仍需核验。缺口：报告尚未完成，下一步写入报告并按原标准验收。';
const oldMemory='用户要求保留原始材料，依据真实结果生成报告；现有记录待核对，不能降低验收标准或预先宣称完成。';
const model={id:'company',baseUrl:'https://company.example/v1',model:'company-model',contextWindow:131072,maxOutputTokens:8192};
const decode=action=>decodeAction(response(action));
const named=(name,args)=>({toolCalls:[{function:{name,arguments:JSON.stringify(args)}}]});
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-checkpoint-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'checkpoint-task',request:'保留原始材料，核验后交付报告',materials:[],messages:[{id:'u1',role:'user',content:'保留原始材料，核验后交付报告'}]},w=await createWorkspace(base,task);
 Object.assign(w.run,{mode:'task',status:'paused',goal:task.request,workingMemory:oldMemory,decisions:['沿用原始材料和验收口径'],acceptance:['报告包含核验结果 OK'],steps:[{id:'report',title:'核验并交付报告',status:'running'}]});
 // Enough archived legacy observations to require a checkpoint on continuation.
 w.run.observations=Array.from({length:24},(_,i)=>({action:{action:'read_file',path:`original-${i}.txt`},response:{result:{text:`原始记录 ${i}，尚待核验`}}}));
 await fs.writeFile(path.join(w.files,'source.txt'),'必须保留的原始材料');await w.save();
 return {base,task,w,model,signal:new AbortController().signal};
}
test('checkpoint schemas and recovery instructions carry the same summary contract',async()=>{
 const schema=actionTools({phase:'task'}).find(t=>t.function.name==='checkpoint').function.parameters;
 assert.equal(schema.properties.text.minLength,20);assert.equal(schema.properties.text.maxLength,10000);assert.ok(schema.required.includes('text'));
 assert.equal(schema.properties.progress.properties.memory.minLength,20);assert.equal(schema.properties.progress.properties.memory.maxLength,10000);
 assert.match(tool.function.parameters.properties.text.description,/checkpoint.*20–10000/);
 assert.match((await import('../apps/desktop/agent/prompt.mjs')).AGENT_PROMPT,/text 必须是20–10000字符/);
 assert.match(require('../apps/desktop/agent/decision-recovery.cjs').prompt,/checkpoint.text/);
});
test('short, missing, wrong-type, padded and oversized summaries are rejected across all response channels without retaining text',()=>{
 for(const text of [undefined,null,42,[],{},'', '已读取',' '.repeat(30),' '.repeat(20)+'摘要','秘密'.repeat(5001)]){
  const action={action:'checkpoint',...(text===undefined?{}:{text})};
  for(const result of [response(action),named('checkpoint',{text}),named('ailo_action',action),response({action:{...action}})]){
   assert.throws(()=>decodeAction(result),e=>{
    assert.equal(e.reason,'invalid_parameter');assert.equal(e.diagnostics.action,'checkpoint');assert.equal(e.diagnostics.field,'text');assert.equal(e.diagnostics.expected,'string_20_10000');
    assert.equal(e.diagnostics.receivedLength,typeof text==='string'?text.length:undefined);assert.ok(!JSON.stringify(e.diagnostics).includes('秘密'));
    assert.match(parameterHint(e.diagnostics),/checkpoint.text.*20–10000/);return true;
   });
  }
 }
 for(const text of ['字'.repeat(20),'字'.repeat(10000),summary])assert.equal(decode({action:'checkpoint',text}).text,text);
});
test('explicit valid progress.memory can supply missing checkpoint text but never masks invalid or conflicting field types',()=>{
 const action={action:'checkpoint',progress:{memory:summary}};
 for(const result of [response(action),named('checkpoint',{progress:action.progress}),named('ailo_action',action)])assert.equal(decodeAction(result).text,summary);
 assert.equal(action.text,undefined);
 for(const text of ['',null,'已读取','字'.repeat(10001)])assert.throws(()=>decode({...action,text}),e=>e.diagnostics.field==='text');
 assert.throws(()=>decode({action:'checkpoint',text:summary,progress:{memory:'已读取'}}),e=>e.diagnostics.field==='progress.memory');
 assert.throws(()=>decode({action:'write_file',path:'bad.txt',content:'bad',progress:{memory:'已读取'}}),e=>e.diagnostics.field==='progress.memory');
});
test('short checkpoint corrects before any memory/step/counter change and real delivery proceeds with original acceptance',async t=>{
 const f=await fixture(t);let calls=0,sourceId;
 const result=await runAgent({...f,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);assert.ok(++calls<15);
  if(s.phase==='route')return response({action:'route',kind:'task'});
  if(calls===2){assert.equal(s.requiredAction,'checkpoint');assert.match(s.instruction,/20–10000/);sourceId=s.externalMemory.recent[0].id;return response({action:'checkpoint',text:'已读取',progress:{memory:summary,steps:[{id:'report',status:'done'}]}});}
  if(calls===3){
   assert.equal(s.workingMemory,oldMemory);assert.equal(s.steps[0].status,'running');assert.equal(s.requiredAction,'checkpoint');
   assert.equal(s.protocolRecovery.receivedLength,3);assert.match(s.protocolRecovery.instruction,/checkpoint.text 收到 3 字符/);
   const saved=await createWorkspace(f.base,f.task);assert.equal(saved.run.checkpointObservationCount,0);assert.equal(saved.run.observationIndex.length,24);assert.equal(saved.run.performance.attachedUpdates,0);
   return named('checkpoint',{text:summary});
  }
  if(calls===4){assert.equal(s.workingMemory,summary);assert.equal(s.requiredAction,undefined);return response({action:'write_file',path:'report.txt',content:'核验结果 OK'});}
  if(calls===5)return response({action:'artifact',path:'report.txt',label:'核验报告'});
  if(calls===6)return response({action:'verify',checks:[{criterionId:s.acceptanceCriteria[0].id,kind:'text_contains',path:'report.txt',contains:['核验结果 OK'],reason:'核对报告验收要求'}],progress:{steps:[{id:'report',status:'done'}]}});
  return response({action:'finish',text:'报告已核验并交付',review:{summary:'依据原验收要求核对报告',issues:[],unverified:[]}});
 }});
 assert.equal(result.agentRun.status,'completed');const saved=await createWorkspace(f.base,f.task);
 assert.equal(saved.run.events.filter(e=>e.type==='protocol_error').length,1);assert.equal(saved.run.events.filter(e=>e.type==='tool_error').length,0);assert.equal(saved.run.events.filter(e=>e.type==='checkpoint').length,1);
 assert.equal(saved.run.workingMemory,summary);assert.equal(saved.run.acceptance[0],'报告包含核验结果 OK');assert.equal(await fs.readFile(path.join(saved.files,'source.txt'),'utf8'),'必须保留的原始材料');
 assert.match((await saved.observation(sourceId)).text,/原始记录/);
});
test('checkpoint with only valid progress.memory saves the supplied summary without asking for it again',async t=>{
 const f=await fixture(t);let calls=0;
 const result=await runAgent({...f,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(++calls===1)return response({action:'route',kind:'task'});
  if(calls===2){assert.equal(s.requiredAction,'checkpoint');return response({action:'checkpoint',progress:{memory:summary}});}
  assert.equal(s.workingMemory,summary);assert.equal(s.requiredAction,undefined);return response({action:'pause',text:'保留核验进度'});
 }});
 assert.equal(calls,3);assert.equal(result.agentRun.status,'paused');assert.equal(result.agentRun.performance.toolErrors||0,0);
 const saved=await createWorkspace(f.base,f.task);assert.equal(saved.run.checkpointObservationCount,24);assert.equal(saved.run.events.filter(e=>e.type==='checkpoint').length,1);
});
test('persistently invalid summaries use a finite correction budget, keep all evidence and can resume the original task',async t=>{
 const f=await fixture(t);let failures=0;
 await assert.rejects(runAgent({...f,executeTool:()=>assert.fail('invalid summary must not execute a tool'),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(s.phase==='route')return response({action:'route',kind:'task'});
  failures++;assert.equal(s.workingMemory,oldMemory);assert.equal(s.requiredAction,'checkpoint');
  return response({action:'checkpoint',text:'已读取'});
 }}),e=>e.code==='AGENT_PROTOCOL'&&e.diagnostics.receivedLength===3&&/checkpoint.text 收到 3 字符/.test(e.message));
 assert.equal(failures,3);let saved=await createWorkspace(f.base,f.task);
 assert.equal(saved.run.status,'partial');assert.equal(saved.run.delivery.outcome,'partial');assert.equal(saved.run.taskContinuation.taskOpen,false);assert.equal(saved.run.taskContinuation.state,'settled');assert.equal(saved.run.checkpointObservationCount,0);assert.equal(saved.run.observationIndex.length,24);assert.equal(saved.run.steps[0].status,'running');assert.equal(saved.run.events.filter(e=>e.type==='tool_error').length,0);
 const oldId=saved.run.observationIndex[0].id;let calls=0;
 await runAgent({...f,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(++calls===1)return response({action:'route',kind:'task'});
  if(calls===2){assert.equal(s.currentRequest,f.task.request);assert.equal(s.workingMemory,oldMemory);assert.equal(s.requiredAction,'checkpoint');return response({action:'checkpoint',text:summary});}
  assert.equal(s.workingMemory,summary);return response({action:'pause',text:'原任务继续核验'});
 }});
 saved=await createWorkspace(f.base,f.task);assert.equal(saved.run.taskId,f.task.id);assert.match((await saved.observation(oldId)).text,/原始记录/);assert.equal(await fs.readFile(path.join(saved.files,'source.txt'),'utf8'),'必须保留的原始材料');
});
test('a corrected attached summary travels with one real action, and an invalid one cannot write or change steps',async t=>{
 const f=await fixture(t);let calls=0,executed=0;
 const result=await runAgent({...f,executeTool:async(...args)=>{executed++;return execute(...args);},ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(++calls===1)return response({action:'route',kind:'task'});
  if(calls===2)return response({action:'write_file',path:'report.txt',content:'核验结果 OK',progress:{memory:'已读取',steps:[{id:'report',status:'done'}]}});
  if(calls===3){assert.equal(executed,0);assert.equal(s.steps[0].status,'running');assert.equal(s.workingMemory,oldMemory);assert.equal(s.protocolRecovery.field,'progress.memory');return response({action:'write_file',path:'report.txt',content:'核验结果 OK',progress:{memory:summary}});}
  assert.equal(s.requiredAction,undefined);assert.equal(s.workingMemory,summary);return response({action:'pause',text:'报告待后续验收'});
 }});
 assert.equal(executed,1);assert.equal(result.agentRun.status,'paused');assert.equal(await fs.readFile(path.join(f.w.files,'report.txt'),'utf8'),'核验结果 OK');
});
test('a valid checkpoint does not reset the no-action recovery budget or count as real task progress',async t=>{
 const f=await fixture(t);let failures=0,checkpointed=false;
 const result=await runAgent({...f,executeTool:()=>assert.fail('no actual tool in this fixture'),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(s.phase==='route')return response({action:'route',kind:'task'});
  if(failures&&!checkpointed){checkpointed=true;assert.equal(s.decisionRecovery.noActionFailures,1);return response({action:'checkpoint',text:summary});}
  if(checkpointed)assert.equal(s.decisionRecovery.noActionFailures,failures);
  failures++;throw Object.assign(Error('empty fixture response'),{code:'MODEL_EMPTY_RESPONSE'});
 }});
 assert.equal(failures,4);assert.equal(result.agentRun.status,'partial');assert.equal(result.agentRun.delivery.outcome,'partial');assert.equal(result.agentRun.delivery.status,'settled');assert.equal(result.agentRun.performance.noActionRequests,4);assert.equal(result.agentRun.performance.toolCalls,0);
 const saved=await createWorkspace(f.base,f.task);assert.equal(saved.run.events.filter(e=>e.type==='checkpoint').length,1);assert.equal(saved.run.steps[0].status,'running');
});

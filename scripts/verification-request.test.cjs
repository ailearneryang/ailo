const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const acceptance=require('../apps/desktop/agent/acceptance.cjs');
const request=require('../apps/desktop/agent/verification-request.cjs');
const {decodeAction,actionTools,parameterHint,tool}=require('../apps/desktop/agent/protocol.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createChat}=require('../apps/desktop/chat.cjs');
const response=action=>({content:JSON.stringify(action),finishReason:'stop'});
const check={criterionId:'report',kind:'text_contains',path:'report.txt',contains:['OK'],reason:'核对原要求中的正文'};
const requirements=[{id:'report',text:'报告包含 OK',type:'content'}];
const model={id:'company',baseUrl:'https://company.example/v1',model:'company-model',contextWindow:131072,maxOutputTokens:8192};
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-verify-request-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'verify-task',request:'生成包含 OK 的报告并核验',materials:[],messages:[{id:'u1',role:'user',content:'生成包含 OK 的报告并核验'}]},w=await createWorkspace(base,task);
 Object.assign(w.run,{mode:'task',status:'paused',goal:task.request,requirementsManaged:true,requirements,acceptance:requirements.map(r=>r.text),acceptanceTypes:['content'],decisions:[],steps:[{id:'make',title:'生成并核验报告',status:'running'}],workingMemory:'保留原始要求，报告尚未验收，下一步核对实际正文和对应证据，不能预先宣称通过。'});
 await fs.writeFile(path.join(w.files,'report.txt'),'OK');await w.save();
 return {base,task,w,model,signal:new AbortController().signal};
}
test('unknown, missing and malformed IDs identify the exact row and current choices without guessing from text or ordinal',()=>{
 for(const id of ['missing','1','报告包含 OK',' report ',undefined,null,1,{}]){
  const action={action:'verify',checks:[{...check,criterionId:id}]};
  for(const result of [response(action),{toolCalls:[{function:{name:'verify',arguments:JSON.stringify({checks:action.checks})}}]}]){
   assert.throws(()=>decodeAction(result,{acceptanceCriteria:requirements}),e=>e.code==='AGENT_PROTOCOL'&&e.diagnostics.index===1&&e.diagnostics.allowedIds[0]==='report'&&/第1条/.test(parameterHint(e.diagnostics)));
  }
 }
 for(const checks of [undefined,[],{},Array(13).fill(check)])assert.throws(()=>request.validate({checks},requirements),e=>e.code==='VERIFY_REQUEST_INVALID'&&e.diagnostics.issue==='checks_count');
 assert.throws(()=>request.validate({checks:[{...check,criterionId:'private material body goes here !'}]},requirements),e=>!JSON.stringify(e.diagnostics).includes('private material'));
});
test('duplicate proof feedback distinguishes repeated evidence from multiple checks for the same requirement',()=>{
 assert.throws(()=>request.validate({checks:[check,{...check,reason:'换个说明仍是同一检查'}]},requirements),e=>e.diagnostics.issue==='duplicate_check'&&e.diagnostics.index===2&&e.diagnostics.duplicateOf===1&&/同一 criterionId 可提交不同证据或范围/.test(e.message));
 request.validate({checks:[check,{...check,path:'second.txt'}]},requirements);
 request.validate({checks:[check,{...check,contains:['另一项内容']}]},requirements);
 request.validate({checks:[{...check,evidenceId:'event-a'},{...check,evidenceId:'event-b'}]},requirements);
 assert.throws(()=>request.validate({checks:[{...check,evidenceId:'event-a'},{...check,evidenceId:'observation-a'}]},requirements,id=>id==='observation-a'?'event-a':id),e=>e.diagnostics.issue==='duplicate_check');
 const scoped={...check,scope:{kind:'file',path:'report.txt'}};
 assert.throws(()=>request.validate({checks:[scoped,{...scoped,scope:{path:'report.txt',kind:'file'}}]},requirements),e=>e.diagnostics.issue==='duplicate_check');
});
test('named and generic tool schemas constrain criterionId to current IDs without mutating the shared schema',()=>{
 const named=actionTools({phase:'task',acceptanceCriteria:requirements}).find(t=>t.function.name==='verify').function.parameters;
 assert.deepEqual(named.properties.checks.items.properties.criterionId.enum,['report']);
 const generic=structuredClone(tool.function.parameters);request.constrain(generic,requirements);assert.deepEqual(generic.properties.checks.items.properties.criterionId.enum,['report']);
 assert.equal(tool.function.parameters.properties.checks.items.properties.criterionId.enum,undefined);
 const changed=actionTools({phase:'task',acceptanceCriteria:[{id:'new-task'}]}).find(t=>t.function.name==='verify').function.parameters;
 assert.deepEqual(changed.properties.checks.items.properties.criterionId.enum,['new-task']);
});
test('all identities validate before any artifact check and malformed batches never revoke prior passes or invent repair targets',async t=>{
 const {w}=await fixture(t);await acceptance.verify(w,{checks:[check]});const old=w.run.acceptanceResults.report,eventCount=w.run.events.length;
 for(const checks of [[{...check,path:'missing.txt'},{...check,criterionId:'unknown'}],[check,check]]){
  await assert.rejects(acceptance.verify(w,{checks}),e=>e.code==='VERIFY_REQUEST_INVALID');
  assert.deepEqual(w.run.acceptanceResults.report,old);assert.equal(w.run.events.length,eventCount);assert.equal(require('../apps/desktop/agent/validation-recovery.cjs').pending(w.run).length,0);
 }
 await acceptance.assertAccepted(w);
 // A preserved old pass is still bound to its actual content; it cannot hide a change.
 await fs.writeFile(path.join(w.files,'report.txt'),'wrong');
 await assert.rejects(acceptance.verify(w,{checks:[check,check]}),e=>e.code==='VERIFY_REQUEST_INVALID');
 await assert.rejects(acceptance.assertAccepted(w),/已变化/);
 await assert.rejects(acceptance.verify(w,{checks:[check]}),e=>e.code==='ACCEPTANCE_TEXT_MISSING');
 assert.equal(w.run.acceptanceResults.report,undefined);assert.equal(require('../apps/desktop/agent/validation-recovery.cjs').pending(w.run).length,1);
});
test('one requirement may bind distinct proofs covering multiple scopes; incomplete coverage still fails',async t=>{
 const {w}=await fixture(t);await fs.writeFile(path.join(w.files,'second.txt'),'OK');
 w.run.requirements=[{...requirements[0],scopes:[{kind:'file',path:'report.txt'},{kind:'file',path:'second.txt'}]}];
 await assert.rejects(acceptance.verify(w,{checks:[check]}),/范围未覆盖/);
 await acceptance.verify(w,{checks:[check,{...check,path:'second.txt'}]});
 assert.equal(w.run.acceptanceResults.report.parts.length,2);await acceptance.assertAccepted(w);
});
test('ID correction precedes attached state changes and proceeds to real verification and delivery',async t=>{
 const f=await fixture(t);let calls=0;
 const result=await runAgent({...f,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);assert.ok(++calls<10);
  if(s.phase==='route')return response({action:'route',kind:'task'});
  if(calls===2)return response({action:'artifact',path:'report.txt',label:'核验报告'});
  if(calls===3)return response({action:'verify',checks:[{...check,criterionId:'s1'}],progress:{steps:[{id:'make',status:'done'}],memory:'这份新的摘要不能在错误验收请求通过校验之前写入任务状态。'}});
  if(calls===4){
   assert.equal(s.steps[0].status,'running');assert.match(s.workingMemory,/报告尚未验收/);assert.equal(s.acceptanceCriteria[0].check,undefined);assert.equal(s.repairTargets.length,0);
   assert.equal(s.protocolRecovery.receivedId,'s1');assert.match(s.protocolRecovery.instruction,/当前可用 ID：report/);
   return response({action:'verify',checks:[check],progress:{steps:[{id:'make',status:'done'}]}});
  }
  assert.equal(s.acceptanceCriteria[0].check.status,'passed');return response({action:'finish',text:'原要求已核验并交付',review:{summary:'实际报告正文包含 OK',issues:[],unverified:[]}});
 }});
 assert.equal(result.agentRun.status,'completed');const saved=await createWorkspace(f.base,f.task);
 assert.equal(saved.run.events.filter(e=>e.type==='protocol_error').length,1);assert.equal(saved.run.events.filter(e=>e.type==='validation_failed').length,0);assert.equal(saved.run.performance.validationFailures||0,0);assert.equal(saved.run.performance.toolErrors||0,0);
 assert.equal(saved.run.acceptanceResults.report.status,'passed');assert.equal(await fs.readFile(path.join(saved.files,'report.txt'),'utf8'),'OK');
});
test('persistent duplicate requests stop after two corrections without reporting an artifact validation failure, and explicit resume retains IDs',async t=>{
 const f=await fixture(t);let failures=0;
 await assert.rejects(runAgent({...f,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(s.phase==='route')return response({action:'route',kind:'task'});
  failures++;return response({action:'verify',checks:[check,check]});
 }}),e=>e.code==='AGENT_PROTOCOL'&&e.diagnostics.issue==='duplicate_check'&&!e.message.includes('最终验收未通过'));
 assert.equal(failures,3);let saved=await createWorkspace(f.base,f.task);
 assert.equal(saved.run.validationRepairs?.report,undefined);assert.equal(saved.run.acceptanceResults?.report,undefined);assert.equal(saved.run.steps[0].status,'running');assert.equal(saved.run.delivery.status,'settled');assert.equal(saved.run.delivery.outcome,'blocked');
 assert.equal(saved.run.events.filter(e=>e.type==='tool_error'||e.type==='validation_failed'||e.type==='acceptance_verified').length,0);
 let calls=0;const resumed=await runAgent({...f,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);assert.ok(++calls<10);assert.equal(s.acceptanceCriteria[0].id,'report');
  if(s.phase==='route')return response({action:'route',kind:'task'});
  if(calls===2)return response({action:'artifact',path:'report.txt',label:'报告'});
  if(calls===3)return response({action:'verify',checks:[check],progress:{steps:[{id:'make',status:'done'}]}});
  return response({action:'finish',text:'继续原任务并完成核验',review:{summary:'按原要求检查实际报告',issues:[],unverified:[]}});
 }});assert.equal(resumed.agentRun.status,'completed');saved=await createWorkspace(f.base,f.task);assert.equal(saved.run.taskId,f.task.id);assert.equal(saved.run.requirements[0].text,requirements[0].text);
});
test('company gateway receives current ID choices and exact correction hints in generic, named and JSON modes',async t=>{
 const f=await fixture(t);const storage={agentDirectory:f.base,modelCredentials:async()=>model,readWorkspace:async()=>({tasks:[f.task]})};let calls=0;
 const native=a=>Response.json({choices:[{message:{tool_calls:[{id:'call',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(a)}}]},finish_reason:'tool_calls'}]});
 const chat=createChat(storage,async(_url,options)=>{
  const body=JSON.parse(options.body),s=JSON.parse(body.messages.at(-1).content);assert.ok(++calls<10);
  if(s.phase==='route')return native({action:'route',kind:'task'});
  if(calls===2){assert.deepEqual(body.tools.find(t=>t.function.name==='verify').function.parameters.properties.checks.items.properties.criterionId.enum,['report']);return native({action:'artifact',path:'report.txt',label:'报告'});}
  if(calls===3)return native({action:'verify',checks:[{...check,criterionId:'s1'}]});
  if(calls===4){assert.equal(s.responseContract.mode,'named_tools');assert.match(s.protocolRecovery.instruction,/当前可用 ID：report/);assert.deepEqual(body.tools.find(t=>t.function.name==='verify').function.parameters.properties.checks.items.properties.criterionId.enum,['report']);return native({action:'verify',checks:[check,check]});}
  if(calls===5){assert.equal(s.responseContract.mode,'json');assert.equal(body.tools,undefined);assert.match(s.protocolRecovery.instruction,/第2条与第1条重复/);return Response.json({choices:[{message:{content:JSON.stringify({action:'verify',checks:[check],progress:{steps:[{id:'make',status:'done'}]}})},finish_reason:'stop'}]});}
  return Response.json({choices:[{message:{content:JSON.stringify({action:'finish',text:'报告已完成验收',review:{summary:'正文核对 OK',issues:[],unverified:[]}})},finish_reason:'stop'}]});
 });
 const result=await chat.complete({id:'r',taskId:f.task.id,modelId:model.id,messages:f.task.messages});assert.equal(result.agentRun.status,'completed');assert.equal(calls,6);
});
test('plan rewording/reordering and checkpoint persistence retain stable requirement IDs without guessing new identities',async t=>{
 const {w,base,task}=await fixture(t),ledger=require('../apps/desktop/agent/requirements.cjs');
 Object.assign(w.run,{inputKey:'u1',acceptanceInputKey:'u1',acceptanceResults:{}});
 const updated=ledger.update(w.run,{requirements:[{...requirements[0],text:'核对报告正文必须含 OK'}]});
 Object.assign(w.run,updated,{acceptance:['核对报告正文必须含 OK']});await w.save();
 const saved=await createWorkspace(base,task);assert.equal(acceptance.criteria(saved.run)[0].id,'report');
 assert.throws(()=>ledger.update(saved.run,{requirements:[{id:'new',text:'只检查文件存在',type:'presence'}]}),/不能移除/);
 assert.throws(()=>ledger.update(saved.run,{requirements:[{id:'report',text:'只检查文件存在',type:'presence'}]}),/验证类型/);
});

test('reason schema and request validator agree on nonempty text and the 800-character boundary across response formats',()=>{
 const schemas=[tool.function.parameters,...actionTools({phase:'task',acceptanceCriteria:requirements}).filter(t=>t.function.name==='verify').map(t=>t.function.parameters)];
 for(const s of schemas){const r=s.properties.checks.items.properties.reason;assert.equal(r.minLength,1);assert.equal(r.maxLength,800);assert.equal(r.pattern,'\\S');}
 for(const reason of [undefined,null,1,false,{},[], '', ' \n\t ', 'private-reason-'.repeat(80)]){
  const bad={...check,reason},a={action:'verify',checks:[bad]};
  for(const result of [response(a),{toolCalls:[{function:{name:'verify',arguments:JSON.stringify({checks:[bad]})}}]},{toolCalls:[{function:{name:'ailo_action',arguments:JSON.stringify(a)}}]}]){
   assert.throws(()=>decodeAction(result,{acceptanceCriteria:requirements}),e=>{
    assert.equal(e.code,'AGENT_PROTOCOL');assert.equal(e.diagnostics.issue,'invalid_reason');assert.equal(e.diagnostics.index,1);assert.equal(e.diagnostics.checkField,'reason');
    assert.equal(e.diagnostics.receivedLength,typeof reason==='string'?reason.length:undefined);assert.ok(!JSON.stringify(e.diagnostics).includes('private-reason'));
    assert.match(parameterHint(e.diagnostics),/第1条 reason.*1–800字符/);return true;
   });
  }
 }
 for(const reason of ['核','字'.repeat(800),'核对 report.txt 正文包含原要求中的 OK；本检查仅覆盖报告内容，不代表运行行为或视觉效果已通过。'])assert.equal(decodeAction(response({action:'verify',checks:[{...check,reason}]}),{acceptanceCriteria:requirements}).checks[0].reason,reason);
});
test('other malformed core verification fields are request errors and do not fall through to artifact validation',()=>{
 for(const [changes,issue] of [[{kind:'unknown'},'invalid_kind'],[{path:undefined},'missing_path'],[{path:[]},'missing_path'],[{contains:[]},'invalid_contains'],[{contains:['x'.repeat(801)]},'invalid_contains'],[{contains:[null]},'invalid_contains'],[{kind:'command',evidenceId:undefined},'missing_evidence'],[{kind:'visual',evidenceId:'  '},'missing_evidence']]){
  assert.throws(()=>request.validate({checks:[{...check,...changes}]},requirements),e=>e.code==='VERIFY_REQUEST_INVALID'&&e.diagnostics.issue===issue);
 }
});
test('an invalid description in a later row preserves old proofs and existing repair targets before any file check',async t=>{
 const {w}=await fixture(t);await acceptance.verify(w,{checks:[check]});const prior=structuredClone(w.run.acceptanceResults),events=w.run.events.length;
 w.run.validationRepairs={unrelated:{criterionId:'unrelated',status:'open',attempts:2}};const repairs=structuredClone(w.run.validationRepairs);
 await assert.rejects(acceptance.verify(w,{checks:[{...check,path:'missing.txt'},{...check,reason:'x'.repeat(801)}]}),e=>e.code==='VERIFY_REQUEST_INVALID'&&e.diagnostics.index===2&&e.diagnostics.receivedLength===801);
 assert.deepEqual(w.run.acceptanceResults,prior);assert.equal(w.run.events.length,events);assert.deepEqual(w.run.validationRepairs,repairs);
 await acceptance.assertAccepted(w);
});
test('correcting a reason retries the original verification without rereading evidence, mutating artifacts or claiming completion early',async t=>{
 const f=await fixture(t);let calls=0;
 const result=await runAgent({...f,executeTool:()=>assert.fail('no extra file reads, commands or writes'),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);assert.ok(++calls<10);
  if(s.phase==='route')return response({action:'route',kind:'task'});
  if(calls===2)return response({action:'artifact',path:'report.txt',label:'原始核验报告'});
  if(calls===3)return response({action:'verify',checks:[{...check,reason:'日志'.repeat(500)}],progress:{steps:[{id:'make',status:'done'}],memory:'这份记忆不应在请求参数验证之前改变原任务状态或触发完成标记。'}});
  if(calls===4){
   assert.equal(s.steps[0].status,'running');assert.match(s.workingMemory,/报告尚未验收/);assert.equal(s.acceptanceCriteria[0].check,undefined);assert.equal(s.repairTargets.length,0);
   assert.equal(s.protocolRecovery.receivedLength,1000);assert.match(s.protocolRecovery.instruction,/reason 收到 1000 字符.*1–800字符/);
   return response({action:'verify',checks:[{...check,reason:'检查原报告正文包含 OK，覆盖报告内容要求；不声明任何未执行的运行或视觉验收。'}],progress:{steps:[{id:'make',status:'done'}]}});
  }
  return response({action:'finish',text:'已核验原报告',review:{summary:'报告正文实际包含 OK',issues:[],unverified:[]}});
 }});
 assert.equal(result.agentRun.status,'completed');const saved=await createWorkspace(f.base,f.task);assert.equal(saved.run.events.filter(e=>e.type==='acceptance_verified').length,1);
 assert.equal(saved.run.performance.validationFailures||0,0);assert.equal(saved.run.performance.toolErrors||0,0);assert.equal(saved.run.events.filter(e=>e.type==='protocol_error').length,1);assert.equal(saved.run.events.filter(e=>e.type==='validation_failed').length,0);
 assert.equal(await fs.readFile(path.join(saved.files,'report.txt'),'utf8'),'OK');
});
test('persistently missing reasons stop after two corrections and preserve the original task for continuation',async t=>{
 const f=await fixture(t);let attempts=0;
 await assert.rejects(runAgent({...f,executeTool:()=>assert.fail('no invalid check executes'),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(s.phase==='route')return response({action:'route',kind:'task'});
  attempts++;return response({action:'verify',checks:[{...check,reason:undefined}]});
 }}),e=>e.code==='AGENT_PROTOCOL'&&e.diagnostics.issue==='invalid_reason'&&e.diagnostics.receivedType==='undefined'&&!e.message.includes('最终验收未通过'));
 assert.equal(attempts,3);let saved=await createWorkspace(f.base,f.task);assert.equal(saved.run.acceptanceResults?.report,undefined);assert.equal(saved.run.validationRepairs?.report,undefined);assert.equal(saved.run.steps[0].status,'running');
 let calls=0;await runAgent({...f,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);assert.ok(++calls<10);assert.equal(s.acceptanceCriteria[0].id,'report');
  if(s.phase==='route')return response({action:'route',kind:'task'});
  if(calls===2)return response({action:'verify',checks:[check]});
  assert.equal(s.acceptanceCriteria[0].check.status,'passed');return response({action:'pause',text:'原任务已核验内容，继续保留进度'});
 }});
 saved=await createWorkspace(f.base,f.task);assert.equal(saved.run.taskId,f.task.id);assert.equal(saved.run.acceptanceResults.report.status,'passed');assert.equal(await fs.readFile(path.join(saved.files,'report.txt'),'utf8'),'OK');
});

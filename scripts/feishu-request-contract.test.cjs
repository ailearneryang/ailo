const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const protocol=require('../apps/desktop/agent/protocol.cjs');
const request=require('../apps/desktop/feishu-request.cjs');
const {createFeishuCli}=require('../apps/desktop/feishu-cli.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const reply=action=>({content:JSON.stringify(action)}),state={phase:'task',steps:[]};
function channels(action){const {action:name,...args}=action;return [reply(action),{toolCalls:[{function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},{toolCalls:[{function:{name,arguments:JSON.stringify(args)}}]}];}
test('Feishu named, merged and JSON contracts only advertise real operations and operation-specific fields',()=>{
 const named=protocol.actionTools(state,['feishu'])[0].function.parameters;
 const merged=protocol.menuTool(state,['feishu','browser'],false).function.parameters;
 const branch=merged.allOf.find(x=>x.if?.properties.action.const==='feishu').then;
 const json=protocol.jsonActionContract(state,['feishu','browser'],false).parametersSchema;
 const jsonBranch=json.oneOf.find(x=>x.properties.action.const==='feishu');
 assert.deepEqual(named.required,['operation']);
 for(const names of [['feishu','android_device'],['browser','feishu']]){const combined=protocol.menuTool(state,names,false).function.parameters;assert.ok(combined.properties.operation.enum.includes('shortcut'));assert.ok(combined.properties.operation.enum.includes(names.includes('browser')?'open':'tap'));}
 for(const schema of [named,branch]){assert.deepEqual(schema.properties.operation.enum,request.operations);assert.deepEqual(schema.allOf[0].then.required,['method','path']);assert.deepEqual(schema.allOf[0].else.required,['query']);}
 assert.deepEqual(json.$defs[jsonBranch.properties.operation.$ref.split('/').at(-1)].enum,request.operations);
 assert.deepEqual(jsonBranch.allOf,named.allOf);
 assert.ok(!protocol.actionTools(state,['browser'])[0].function.parameters.properties.operation.enum.every(x=>request.operations.includes(x)),'other tools keep their own operations');
});
test('invalid Feishu operations and API methods are protocol defects in all response channels',()=>{
 for(const action of [{action:'feishu',operation:'search',query:'今天的消息'},{action:'feishu',operation:'read',query:'known'},{action:'feishu',operation:'api',method:'get',path:'/open-apis/im/v1/messages'},{action:'feishu',operation:'api',path:'/open-apis/im/v1/messages'}]){
  for(const response of channels(action))assert.throws(()=>protocol.decodeAction(response,{boundActionContract:true,steps:[]}),error=>{
   assert.equal(error.code,'AGENT_PROTOCOL');assert.equal(error.diagnostics.expected,'feishu_request');
   const hint=protocol.parameterHint(error.diagnostics);assert.doesNotMatch(hint,/有效整数|offset/);
   assert.match(hint,action.operation==='api'?/GET、POST/:/im \+messages-search/);return true;
  });
 }
});
test('shared request validation preserves arguments and rejects ambiguous coercion or unsafe targets',()=>{
 const valid={action:'feishu',operation:'api',method:'GET',path:'/open-apis/im/v1/messages',params:{container_id:'oc_known'}};
 const before=JSON.stringify(valid);for(const response of channels(valid))assert.deepEqual(protocol.decodeAction(response),valid);assert.equal(JSON.stringify(valid),before);
 for(const invalid of [{...valid,operation:' API '},{...valid,path:'https://outside.invalid'},{...valid,data:{secret:'must-not-be-logged'}},{action:'feishu',operation:'shortcut',query:'im +messages-search',params:{token:'must-not-be-logged'}}])assert.throws(()=>protocol.decodeAction(reply(invalid)),e=>e.code==='AGENT_PROTOCOL'&&!JSON.stringify(e.diagnostics).includes('must-not-be-logged'));
});
async function fixture(t,id){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-feishu-contract-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id,request:'读取飞书消息',materials:[]},w=await createWorkspace(base,task);await fs.writeFile(path.join(w.files,'retained.txt'),'original task evidence');return {base,task,model:{id:'offline',contextWindow:128000},signal:new AbortController().signal};}
async function bridge(t,base){const calls=[],connected={code:0,data:{identities:{user:{status:'ready'}}}};
 const cli=createFeishuCli({directory:path.join(base,'connection'),locate:async()=>'/fake/lark-cli',confirmWrite:()=>assert.fail('read requires no write approval'),run:async(_binary,args)=>{if(args.includes('+messages-search')){calls.push(args);return {code:0,data:{items:[{message_id:'om_known',text:'offline message'}],has_more:false}};}return connected;}});
 t.after(()=>cli.dispose());await cli.begin();for(let i=0;i<50;i++){if((await cli.status()).connected)return {cli,calls};await new Promise(r=>setTimeout(r,2));}assert.fail('fixture did not connect');
}
test('invalid search corrects to real CLI shortcut in the same task without tool-repair charges',async t=>{
 const f=await fixture(t,'corrected'),{cli,calls}=await bridge(t,f.base);let turn=0;
 const result=await runAgent({...f,feishuCli:cli,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return reply({action:'route',kind:'chat'});
  if(turn++===0)return reply({action:'feishu',operation:'search',query:'今天的消息'});
  if(turn===2){assert.equal(s.protocolRecovery.field,'operation');assert.match(s.protocolRecovery.instruction,/shortcut/);return reply({action:'feishu',operation:'shortcut',query:'im +messages-search',params:{'page-size':'10'},purpose:'读取消息'});}
  return reply({action:'reply',text:'已读取返回的消息。'});
 }});
 assert.equal(result.content,'已读取返回的消息。');assert.equal(calls.length,1);
 const w=await createWorkspace(f.base,f.task);assert.equal(w.run.events.filter(e=>e.type==='protocol_error').length,1);assert.equal(w.run.events.filter(e=>e.type==='tool_error').length,0);assert.equal(w.run.performance.toolErrors,0);assert.equal(await fs.readFile(path.join(w.files,'retained.txt'),'utf8'),'original task evidence');
});
test('persistent invalid operations stop after two corrections and explicit resume retains original task and files',async t=>{
 const f=await fixture(t,'bounded'),{cli,calls}=await bridge(t,f.base);let invalid=0;
 await assert.rejects(runAgent({...f,feishuCli:cli,ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return reply({action:'route',kind:'chat'});invalid++;return reply({action:'feishu',operation:'search',query:'today'});}}),e=>e.code==='AGENT_PROTOCOL'&&e.diagnostics.field==='operation');
 assert.equal(invalid,3);assert.equal(calls.length,0);const w=await createWorkspace(f.base,f.task);assert.equal(w.run.taskContinuation.taskOpen,false);assert.equal(w.run.events.filter(e=>e.type==='tool_error').length,0);
 let reads=0;const result=await runAgent({...f,feishuCli:cli,ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return reply({action:'route',kind:'chat'});return reply(reads++===0?{action:'feishu',operation:'shortcut',query:'im +messages-search',params:{'page-size':'10'}}:{action:'reply',text:'沿原任务继续读取成功。'});}});
 assert.equal(result.content,'沿原任务继续读取成功。');assert.equal(calls.length,1);assert.equal(await fs.readFile(path.join(w.files,'retained.txt'),'utf8'),'original task evidence');
});
const {legacyFeishuRecovery}=require('../apps/desktop/legacy-protocol-recovery.cjs');
const continuation=require('../apps/desktop/agent/task-continuation.cjs');
function legacyRun(){return {status:'blocked',mode:'task',inputKey:'old',executionState:{blocker:{code:'AGENT_REPAIR_EXHAUSTED',message:'同一问题的有限恢复仍未成功，已保留任务状态：飞书操作无效'}},taskContinuation:{taskOpen:true,state:'waiting_diagnosis',retained:{unknownActions:0}},events:[],actionJournal:[]};}
test('only the known legacy local rejection permits one user-triggered empty-form retry',()=>{
 const run=legacyRun(),task={messages:[{id:'retry',role:'user',content:'继续原任务。已处理的条件或补充信息：'}]};
 assert.ok(legacyFeishuRecovery(run));assert.equal(continuation.canResume(run,task),true);
 for(const mutate of [r=>r.runtimeRepairs=['feishu-request-contract-v1'],r=>r.actionJournal=[{status:'unknown'}],r=>r.actionJournal=[{status:'running'}],r=>r.inFlight={action:'feishu'},r=>r.taskContinuation.retained.unknownActions=1,r=>r.executionState.blocker.message='飞书操作超时',r=>r.executionState.blocker.code='FEISHU_PERMISSION',r=>r.status='waiting_permission']){
  const blocked=legacyRun();mutate(blocked);assert.equal(legacyFeishuRecovery(blocked),undefined);assert.equal(continuation.canResume(blocked,task),false);
 }
});
test('the actual user empty-form entry resumes a pre-fix 3-requirement 5-step task without rewriting its file',async t=>{
 const f=await fixture(t,'legacy-user-entry'),w=await createWorkspace(f.base,f.task),legacy=legacyRun();
 Object.assign(w.run,legacy,{executionId:require('node:crypto').randomUUID(),goal:'保留原始三项要求',acceptance:['alpha','beta','gamma'],acceptanceTypes:['content','content','content'],decisions:['保留原要求与现有文件'],currentIntent:'task',requirementsManaged:true,requirements:['alpha','beta','gamma'].map((text,i)=>({id:'r'+i,text,type:'content'})),steps:Array.from({length:5},(_,i)=>({id:'s'+i,title:'步骤'+i,status:i===4?'running':'done'}))});
 await fs.writeFile(path.join(w.files,'retained.txt'),'alpha beta gamma');continuation.update(w.run);await w.save();const executionId=w.run.executionId;
 const resumed={...f.task,messages:[{id:'old',role:'user',content:f.task.request},{id:'retry',role:'user',content:'继续原任务。已处理的条件或补充信息：'}]};let calls=0;
 const result=await runAgent({...f,task:resumed,requestOrigin:'user',executeTool:async(...args)=>{assert.notEqual(args[1].action,'write_file','completed write must not replay');return require('../apps/desktop/agent/tools.cjs').execute(...args);},ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);calls++;assert.equal(s.acceptanceCriteria.length,3);assert.equal(s.steps.length,5);
  if(s.phase==='route')return reply({action:'route',kind:'task'});
  if(!s.artifacts.length)return reply({action:'artifact',path:'retained.txt',label:'原文件'});
  if(!s.acceptanceCriteria[0].check)return reply({action:'verify',checks:s.acceptanceCriteria.map((c,i)=>({criterionId:c.id,kind:'text_contains',path:'retained.txt',contains:[['alpha','beta','gamma'][i]],reason:'检查原文件覆盖原要求'})),progress:{steps:[{id:'s4',status:'done'}]}});
  return reply({action:'finish',text:'沿原任务核验完成。',review:{summary:'原三项要求均已核验，文件未重写',issues:[],unverified:[]}});
 }});
 assert.ok(calls>0);assert.equal(result.agentRun.status,'completed',JSON.stringify({content:result.content,events:result.agentRun.events}));const saved=await createWorkspace(f.base,resumed);assert.equal(saved.run.executionId,executionId);assert.deepEqual(saved.run.requirements.map(r=>r.id),['r0','r1','r2']);assert.equal(saved.run.events.filter(e=>e.type==='runtime_repair_resume').length,1);assert.equal(await fs.readFile(path.join(saved.files,'retained.txt'),'utf8'),'alpha beta gamma');assert.deepEqual(saved.run.runtimeRepairs,['feishu-request-contract-v1']);
});
test('a failed migrated retry persists its consumed allowance and empty repeats do not reset budgets',async t=>{
 const f=await fixture(t,'legacy-bounded'),w=await createWorkspace(f.base,f.task);Object.assign(w.run,legacyRun(),{executionId:require('node:crypto').randomUUID()});continuation.update(w.run);await w.save();
 const task={...f.task,messages:[{id:'retry',role:'user',content:'继续原任务。已处理的条件或补充信息：'}]};let calls=0;
 await assert.rejects(runAgent({...f,task,requestOrigin:'user',ask:async()=>{calls++;return reply({action:'feishu',operation:'search',query:'today'});}}),e=>e.code==='AGENT_PROTOCOL');assert.equal(calls,3);
 const failed=await createWorkspace(f.base,task);assert.deepEqual(failed.run.runtimeRepairs,['feishu-request-contract-v1']);const budget=JSON.stringify([failed.run.failureEpisodes,failed.run.decisionRecovery,failed.run.loopRecovery]);
 const blocked=await runAgent({...f,task:{...task,messages:[...task.messages,{id:'retry-again',role:'user',content:'继续'}]},requestOrigin:'user',ask:()=>assert.fail('consumed blind retry must not call model')});assert.equal(blocked.agentRun.taskContinuation.taskOpen,false);assert.equal(blocked.agentRun.delivery.status,'settled');
 const unchanged=await createWorkspace(f.base,task);assert.equal(JSON.stringify([unchanged.run.failureEpisodes,unchanged.run.decisionRecovery,unchanged.run.loopRecovery]),budget);assert.equal(unchanged.run.events.filter(e=>e.type==='runtime_repair_resume').length,1);
});

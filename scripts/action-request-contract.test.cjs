const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const protocol=require('../apps/desktop/agent/protocol.cjs'),contract=require('../apps/desktop/agent/action-request.cjs');
const state={phase:'task',steps:[{id:'s',title:'修改并核验',status:'running'}]},reply=x=>({content:JSON.stringify(x)});
test('named, merged native and JSON tools advertise the same action-specific required fields',()=>{
 const names=['edit_file','write_file','run_command','artifact','plan'];
 const named=protocol.actionTools(state,names),merged=protocol.menuTool(state,names,false).function.parameters,json=protocol.jsonActionContract(state,names,false).parametersSchema;
 for(const tool of named){const name=tool.function.name,expected=contract.required[name];assert.deepEqual(tool.function.parameters.required,expected);const branch=merged.allOf.find(x=>x.if?.properties?.action?.const===name&&x.then?.required);assert.deepEqual(branch.then.required,expected);assert.deepEqual(json.oneOf.find(x=>x.properties.action.const===name).required,['action',...expected]);}
 assert.ok(merged.allOf.some(x=>x.then?.properties?.progress),'progress constraints are retained');
});
test('missing edit paths fail before execution in JSON, merged native and named native channels',()=>{
 const args={version:'a'.repeat(64),edits:[{oldText:'a',newText:'b'}]};
 const values=[reply({action:'edit_file',...args}),{toolCalls:[{function:{name:'ailo_action',arguments:JSON.stringify({action:'edit_file',...args})}}]},{toolCalls:[{function:{name:'edit_file',arguments:JSON.stringify(args)}}]}];
 for(const response of values)assert.throws(()=>protocol.decodeAction(response,{boundActionContract:true,steps:state.steps}),e=>e.code==='AGENT_PROTOCOL'&&e.reason==='invalid_parameter'&&e.diagnostics.field==='path'&&e.diagnostics.expected==='action_required_field');
});
test('required-field checking is pure, retains arguments and never guesses a file path',()=>{
 for(const value of [undefined,null,42,'']){const action={action:'edit_file',path:value,version:'a'.repeat(64),edits:[]},before=JSON.stringify(action);assert.throws(()=>contract.validate(action),e=>e.code==='ACTION_REQUEST_INVALID');assert.equal(JSON.stringify(action),before);}
 const valid={action:'edit_file',path:'app/layout.xml',version:'a'.repeat(64),edits:[{oldText:'old',newText:'new'}]};assert.equal(contract.validate(valid),valid);
});
async function fixture(t,id){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-required-action-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id,request:'修改说明文件并核验内容',messages:[{id:'original',role:'user',content:'修改说明文件并核验内容'}]},w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(base,task);await fs.writeFile(path.join(w.files,'note.txt'),'old');return {base,task,w,version:await require('../apps/desktop/agent/evidence.cjs').hashFile(path.join(w.files,'note.txt')),model:{id:'offline',contextWindow:131072},signal:new AbortController().signal};}
const plan={action:'plan',goal:'修改说明文件并核验内容',decisions:['保留原要求'],requirements:[{id:'r',text:'说明包含new',type:'content'}],steps:[{id:'s',title:'修改并核验说明',status:'running'}]};
test('a missing path is automatically corrected in the same task with one real edit and no product repair charge',async t=>{
 const f=await fixture(t,'corrected');let attempt=0,executed=0;
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({...f,executeTool:async(w,a,s,o)=>{if(a.action==='edit_file')executed++;return require('../apps/desktop/agent/tools.cjs').execute(w,a,s,o);},ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return reply({action:'route',kind:'task'});if(!s.steps.length)return reply(plan);
  if(attempt++===0)return reply({action:'edit_file',version:f.version,edits:[{oldText:'old',newText:'new'}],progress:{steps:[{id:'s',status:'done'}],memory:'缺路径的动作不得修改此累计记忆，也不得提前完成步骤。'}});
  if(attempt===2){assert.equal(s.protocolRecovery.field,'path');assert.equal(s.steps[0].status,'running');assert.doesNotMatch(s.workingMemory,/缺路径的动作/);return reply({action:'edit_file',path:'note.txt',version:f.version,edits:[{oldText:'old',newText:'new'}]});}
  if(!s.artifacts.length)return reply({action:'artifact',path:'note.txt',label:'说明'});
  if(!s.acceptanceCriteria[0].check)return reply({action:'verify',checks:[{criterionId:'r',kind:'text_contains',path:'note.txt',contains:['new'],reason:'按原要求核验实际内容'}],progress:{steps:[{id:'s',status:'done'}]}});
  return reply({action:'finish',text:'说明已修改并核验',review:{summary:'原要求已逐项核验，文件已登记',issues:[],unverified:[]}});
 }});
 assert.equal(result.agentRun.status,'completed');assert.equal(executed,1);const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(f.base,f.task);assert.equal(await fs.readFile(path.join(w.files,'note.txt'),'utf8'),'new');assert.equal(w.run.events.filter(e=>e.type==='protocol_error').length,1);assert.equal(w.run.events.filter(e=>e.type==='tool_error').length,0);assert.equal(w.run.performance.toolErrors,0);assert.deepEqual(w.run.failureEpisodes?.records||[],[]);
});
test('persistent missing paths keep the two-correction bound and preserve a task with zero side effects',async t=>{
 const f=await fixture(t,'bounded');let calls=0;
 await assert.rejects(require('../apps/desktop/agent/runner.cjs').runAgent({...f,executeTool:()=>assert.fail('invalid action executed'),ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return reply({action:'route',kind:'task'});if(!s.steps.length)return reply(plan);calls++;return reply({action:'edit_file',version:f.version,edits:[{oldText:'old',newText:'new'}]});}}),e=>e.code==='AGENT_PROTOCOL'&&e.diagnostics.field==='path');
 assert.equal(calls,3);const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(f.base,f.task);assert.equal(await fs.readFile(path.join(w.files,'note.txt'),'utf8'),'old');assert.equal(w.run.taskContinuation.taskOpen,false);assert.equal(w.run.delivery.status,'settled');assert.equal(w.run.events.filter(e=>e.type==='tool_error').length,0);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {decodeAction}=require('../apps/desktop/agent/protocol.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const batch=require('../apps/desktop/agent/batch-read.cjs');
const plan={action:'plan',goal:'检查资料',decisions:[],acceptance:['资料内容正确'],steps:[{id:'read',title:'读取并核对',status:'running'}]};
async function setup(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-efficiency-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'t',projectId:'p',request:'检查资料'},w=await createWorkspace(base,task);return {base,task,w};}
const reply=action=>({content:JSON.stringify(action)});
const memory='已读取当前资料并保留原始来源记录，下一步依据实际证据继续检查，不能预先宣称完成。';
test('batch validates every item before execution and bounds concurrency, preserving order and partial errors',async()=>{
 let active=0,peak=0,calls=0;
 await assert.rejects(batch.execute([{action:'read_file',path:'a'},{action:'run_command',command:'touch forbidden'}],new AbortController().signal,()=>{calls++;}),/只允许/);assert.equal(calls,0);
 const result=await batch.execute(Array.from({length:6},(_,i)=>({action:'read_file',path:String(i),itemId:'r'+i})),new AbortController().signal,async item=>{active++;peak=Math.max(peak,active);try{await new Promise(r=>setTimeout(r,5));if(item.path==='2')throw Error('missing');return {text:item.path};}finally{active--;}});
 assert.equal(peak,3);assert.deepEqual(result.map(r=>r.itemId),['r0','r1','r2','r3','r4','r5']);assert.equal(result[2].error,'missing');assert.equal(result[5].result.text,'5');
});
test('multiple independent provider reads normalize to one batch; mixed writes remain rejected',()=>{
 const call=a=>({function:{name:'ailo_action',arguments:JSON.stringify(a)}});
 assert.equal(decodeAction({toolCalls:[call({action:'read_file',path:'a'}),call({action:'list_files',path:'.'})]}).action,'batch_read');
 assert.throws(()=>decodeAction({toolCalls:[call({action:'read_file',path:'a'}),call({action:'write_file',path:'b',content:'x'})]}),e=>e.reason==='multiple_tools');
 assert.equal(decodeAction(reply({action:'batch_read',items:[{action:'read_file',path:'a',offset:'0',limit:'100'}]})).items[0].limit,100);
});
test('plan and memory review ride with real work, survive restart, and do not imply acceptance',async t=>{
 const {base,task,w}=await setup(t);Object.assign(w.run,{...plan,mode:'task',status:'paused',actionsSincePlan:6});delete w.run.action;
 w.run.observations=[];for(let i=0;i<24;i++)w.run.observations.push({action:{action:'read_file',path:'old'+i},response:{result:{text:'old'}}});await w.save();
 let calls=0;
 const result=await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(calls++===0)return reply({action:'route',kind:'task'});if(calls===2){assert.equal(s.requiredAction,'checkpoint');return reply({action:'write_file',path:'actual.txt',content:'actual',progress:{memory,steps:plan.steps}});}assert.equal(s.requiredAction,undefined);assert.equal(s.workingMemory,memory);assert.equal(s.steps[0].status,'running');return reply({action:'pause',text:'继续检查'});}});
 assert.equal(calls,3);assert.equal(await fs.readFile(path.join(w.files,'actual.txt'),'utf8'),'actual');assert.equal(result.agentRun.status,'paused');assert.equal(result.agentRun.performance.attachedUpdates,1);
 assert.equal((await createWorkspace(base,task)).run.workingMemory,memory);
});
test('invalid attached memory prevents a simultaneous step change and side effect',async t=>{
 const {base,task,w}=await setup(t);let n=0;const actions=[{action:'route',kind:'task'},plan,{action:'write_file',path:'bad.txt',content:'bad',progress:{steps:[{...plan.steps[0],status:'done'}],memory:'bad'}},{action:'pause',text:'未执行'}];
 await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,ask:async()=>reply(actions[n++])});
 await assert.rejects(fs.stat(path.join(w.files,'bad.txt')));assert.equal((await createWorkspace(base,task)).run.steps[0].status,'running');
});
test('batch archives child results, shares ordinary read repetition guards, and retries only missing items',async t=>{
 const {base,task,w}=await setup(t);await fs.writeFile(path.join(w.files,'a.txt'),'a');let n=0,readCalls=0;
 const actions=[{action:'route',kind:'task'},plan,{action:'batch_read',items:[{action:'read_file',path:'a.txt',limit:100},{action:'read_file',path:'missing.txt'}]},{action:'read_file',path:'a.txt',limit:100},{action:'read_file',path:'a.txt',limit:100},{action:'pause',text:'保存结果'}];
 await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,executeTool:async(...args)=>{readCalls++;return execute(...args);},ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(n===3){assert.ok(s.toolResults.at(-1).result,JSON.stringify(s.toolResults));const rows=s.toolResults.at(-1).result.results;assert.equal(rows.length,2);assert.ok(rows[0].observationId);assert.ok(rows[1].error);}if(n===5)assert.equal(s.toolResults.at(-1).notExecuted,true);return reply(actions[n++]);}});
 assert.equal(readCalls,3);const saved=await createWorkspace(base,task);assert.equal(saved.run.performance.batchItems,2);assert.ok(saved.run.readCoverage.some(r=>r.path==='a.txt'));
});
test('persistent reasoning-only exhaustion has bounded staged recovery and executes no partial tools',async t=>{
 const {base,task}=await setup(t);let n=0;const budgets=[];
 const result=await runAgent({base,task,model:{contextWindow:65536,maxOutputTokens:65536},signal:new AbortController().signal,executeTool:()=>assert.fail('no partial action executes'),ask:async(_messages,budget)=>{if(n++===0)return reply({action:'route',kind:'task'});budgets.push(budget);throw Object.assign(Error('thinking'),{code:'MODEL_OUTPUT_LIMIT',diagnostics:{contentChars:0,toolArgumentChars:0,reasoningTokens:8000}});}});
 assert.deepEqual(budgets,[8192,16384,32768,32768]);assert.equal(result.agentRun.status,'blocked');assert.match(result.content,/尚未完成/);assert.equal(result.agentRun.performance.noActionRequests,4);assert.equal(result.agentRun.performance.toolCalls,0);
});
test('transport telemetry counts real attempts once rather than double counting logical decisions',async t=>{
 const {base,task}=await setup(t);let n=0;
 const result=await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,ask:async(_messages,_budget,_context,onRequest)=>{onRequest({durationMs:10,outcome:'failed',errorCode:'MODEL_CONNECT_TIMEOUT'});onRequest({durationMs:20,outcome:'completed',action:n?'pause':'route',providerUsage:{inputTokens:100,outputTokens:20,reasoningTokens:10}});return reply(n++?{action:'pause',text:'完成统计'}:{action:'route',kind:'task'});}});
 const p=result.agentRun.performance;assert.equal(p.modelRequests,4);assert.equal(p.modelMs,60);assert.equal(p.failedModelRequests,2);assert.equal(p.reportedUsageRequests,2);assert.equal(p.inputTokens,200);assert.equal(p.outputTokens,40);
});

test('the same six independent file reads need nine sequential decisions or four batched decisions',async t=>{
 const counts=[];
 for(const batched of [false,true]){
  const {base,task,w}=await setup(t);for(let i=0;i<6;i++)await fs.writeFile(path.join(w.files,i+'.txt'),'source '+i);
  const reads=Array.from({length:6},(_,i)=>({action:'read_file',path:i+'.txt',limit:100}));
  const actions=[{action:'route',kind:'task'},plan,...(batched?[{action:'batch_read',items:reads,progress:{steps:plan.steps,memory}}]:reads),{action:'pause',text:'已读取，后续检查'}];let n=0;
  const result=await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,ask:async()=>reply(actions[n++])});
  const saved=await createWorkspace(base,task);assert.equal(new Set(saved.run.readCoverage.map(r=>r.path)).size,6);assert.equal(result.agentRun.status,'paused');counts.push(result.agentRun.performance.modelRequests);
 }
 assert.deepEqual(counts,[9,4]);
});

test('a command changing the directory permits the same batched listing again',async t=>{
 const {base,task,w}=await setup(t);let n=0,listings=0;
 const listing={action:'batch_read',items:[{action:'list_files',path:'.'}]};
 const actions=[{action:'route',kind:'task'},plan,listing,listing,{action:'run_command',command:'fixture change',purpose:'改变项目文件'},listing,{action:'pause',text:'目录已更新'}];
 const result=await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,executeTool:async(workspace,action,signal,options)=>{if(action.action==='run_command'){await fs.writeFile(path.join(w.files,'new.txt'),'new');return {exitCode:0,output:'changed'};}listings++;return execute(workspace,action,signal,options);},ask:async()=>reply(actions[n++])});
 assert.equal(listings,3);assert.equal(result.content,'目录已更新');
});

test('partial progress merges by known step ID without dropping other steps or rejecting the real command',async t=>{
 const {base,task,w}=await setup(t);let n=0;
 const twoSteps={...plan,steps:[{id:'first',title:'第一步',status:'done'},{id:'second',title:'第二步',status:'pending'}]};
 const actions=[{action:'route',kind:'task'},twoSteps,{action:'write_file',path:'real.txt',content:'executed',progress:{steps:[{id:'second',status:'running'}]}},{action:'pause',text:'已执行'}];
 await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,ask:async()=>reply(actions[n++])});
 assert.equal(await fs.readFile(path.join(w.files,'real.txt'),'utf8'),'executed');const saved=await createWorkspace(base,task);assert.deepEqual(saved.run.steps.map(s=>[s.id,s.status]),[['first','done'],['second','running']]);
});
test('small-action recovery compacts observations, preserves requirements, persists for the step, and stops repeating retries',async t=>{
 const {base,task,w}=await setup(t);let n=0,observed;
 const withRequirements={...task,request:'保留用户对结果和权限的全部要求，不可降低质量'};
 const result=await runAgent({base,task:withRequirements,model:{contextWindow:100000,maxOutputTokens:65536},signal:new AbortController().signal,ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(n++===0)return reply({action:'route',kind:'task'});if(n===2)return reply(plan);if(n===3)throw Object.assign(Error('waiting'),{code:'MODEL_NO_ACTION_TIMEOUT'});observed=s;assert.equal(s.currentRequest,withRequirements.request);assert.equal(s.acceptance[0],plan.acceptance[0]);assert.equal(s.decisionRecovery.maxWriteChars,8000);assert.ok(s.decisionRecovery.noActionTimeoutMs>=180000&&s.decisionRecovery.noActionTimeoutMs<=300000);throw Object.assign(Error('waiting again'),{code:'MODEL_NO_ACTION_TIMEOUT'});}});
 assert.ok(observed);assert.equal(result.agentRun.status,'blocked');const saved=await createWorkspace(base,withRequirements);const events=saved.run.events;
 assert.equal(events.filter(e=>e.type==='no_action_recovery').length,3);assert.match(events.filter(e=>e.type==='no_action_timeout').at(-1).detail.message,/恢复预算已用尽/);assert.equal(saved.run.decisionRecovery.stepId,'read');
 const recovery=require('../apps/desktop/agent/decision-recovery.cjs');assert.ok(recovery.active(saved.run));saved.run.steps[0].status='done';assert.equal(recovery.active(saved.run),false);
});
test('small-action limits are enforced in runtime, not only suggested in the prompt',async t=>{
 const recovery=require('../apps/desktop/agent/decision-recovery.cjs');
 assert.throws(()=>recovery.validate({action:'write_file',content:'x'.repeat(8001)}),/8000/);
 assert.throws(()=>recovery.validate({action:'run_command',command:'x'.repeat(2001)}),/2000/);
 assert.throws(()=>recovery.validate({action:'batch_read',items:Array(4).fill({})}),/3项/);
 const {base,task,w}=await setup(t);let n=0;
 const actions=[{action:'route',kind:'task'},plan,null,{action:'write_file',path:'too-big.txt',content:'x'.repeat(8001)},{action:'pause',text:'拆分后再继续'}];
 await runAgent({base,task,model:{contextWindow:100000},signal:new AbortController().signal,ask:async()=>{const action=actions[n++];if(action===null)throw Object.assign(Error('waiting'),{code:'MODEL_NO_ACTION_TIMEOUT'});return reply(action);}});
 await assert.rejects(fs.stat(path.join(w.files,'too-big.txt')));
});

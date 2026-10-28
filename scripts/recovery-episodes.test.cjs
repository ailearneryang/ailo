const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const {runSegments}=require('../apps/desktop/agent/execution-segments.cjs');
const model={id:'offline-company-fixture',contextWindow:128000};
const plan={action:'plan',goal:'制作天气说明',decisions:[],requirements:[{id:'weather',text:'说明包含真实天气标题',type:'content'}],steps:[{id:'make',title:'制作天气说明',status:'running'}]};
async function fixture(t,id){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-repair-episodes-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return {base,task:{id,request:plan.goal}};}
function options(fixture,ask,extra={}){return {...fixture,model,signal:new AbortController().signal,maxSteps:40,ask,...extra};}
const response=action=>({content:JSON.stringify(action)});
const summary='保留用户原始要求、已有工具凭据与当前未解决问题；下一步针对实际缺口推进，不把摘要记账视为完成。';
test('independently repaired and accepted steps leave recovery available for a third independent issue',async t=>{
 const fixtureData=await fixture(t,'independent-repairs'),ids=['a','b','c'];
 const multi={...plan,requirements:ids.map(id=>({id,text:'天气说明 '+id+' 包含已核对内容',type:'content'})),steps:ids.map((id,i)=>({id,title:'制作说明 '+id,status:i?'pending':'running'}))};
 const actions=[];
 for(let i=0;i<ids.length;i++){
  const id=ids[i],file='weather-'+id+'.txt';actions.push(...Array(3).fill({action:'read_file',path:file}));
  actions.push({action:'write_file',path:file,content:'已核对天气 '+id},{action:'artifact',path:file,label:'天气说明 '+id});
  actions.push({action:'verify',checks:[{criterionId:id,kind:'text_contains',path:file,contains:['已核对天气 '+id],reason:'检查当前文件确实包含原要求内容'}],progress:{steps:[{id,status:'done'},...(i<2?[{id:ids[i+1],status:'running'}]:[])]}});
 }
 actions.push({action:'finish',text:'三个天气说明均已完成并核验',review:{summary:'分别生成并核对三个要求；每个缺失文件的独立故障均已修复',issues:[],unverified:[]}});
 let calls=0;
 const result=await runAgent(options(fixtureData,async messages=>{calls++;const s=JSON.parse(messages.at(-1).content);return response(s.phase==='route'?{action:'route',kind:'task'}:!s.steps.length?multi:s.requiredAction==='checkpoint'?{action:'checkpoint',text:summary}:actions.shift());}));
 assert.equal(result.agentRun.status,'completed');assert.equal(result.agentRun.artifacts.length,3);assert.ok(calls<30);
 const {run}=await createWorkspace(fixtureData.base,fixtureData.task);assert.equal(run.failureEpisodes.records.length,3);assert.ok(run.failureEpisodes.records.every(episode=>episode.status==='resolved'&&episode.recoveries===1));assert.deepEqual(Object.keys(run.acceptanceResults).sort(),ids);
 assert.equal(run.events.filter(event=>event.type==='tool_error').length,9);assert.equal(run.events.filter(event=>event.type==='tool_recovery').length,3);
});
test('changing progress and checkpoint text cannot reset the same substantive failure budget',async t=>{
 const fixtureData=await fixture(t,'bookkeeping-budget');let calls=0,sequence=0;
 const result=await runAgent(options(fixtureData,async messages=>{calls++;const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return response({action:'route',kind:'task'});if(!s.steps.length)return response(plan);const i=sequence++;return response(i%2?{action:'checkpoint',text:summary+'第'+i+'轮'}:{action:'read_file',path:'always-missing.txt',purpose:'不同展示说明 '+i,progress:{memory:summary+'第'+i+'轮'}});}));
 assert.equal(result.agentRun.status,'blocked');assert.ok(calls<=12,'same error must have a finite decision budget');
 const {run}=await createWorkspace(fixtureData.base,fixtureData.task);assert.equal(run.failureEpisodes.records.length,1);assert.equal(run.failureEpisodes.records[0].status,'open');assert.equal(run.failureEpisodes.records[0].failures,5);assert.equal(run.failureEpisodes.records[0].recoveries,2);
 assert.equal(run.events.filter(event=>event.type==='tool_error').length,5);assert.ok(run.events.some(event=>event.type==='checkpoint'));assert.equal(Object.keys(run.acceptanceResults||{}).length,0);assert.equal(run.currentRequest,fixtureData.task.request);
});
test('a model that only repeats the same successful read stops wasting model requests within a bounded recovery',async t=>{
 const fixtureData=await fixture(t,'bounded-loop');let calls=0,tools=0;
 const result=await runAgent(options(fixtureData,async messages=>{calls++;const s=JSON.parse(messages.at(-1).content);return response(s.phase==='route'?{action:'route',kind:'task'}:!s.steps.length?plan:{action:'list_files',path:'.',purpose:'再次查看 '+calls});},{executeTool:async(...args)=>{tools++;return execute(...args);}}));
 assert.equal(result.agentRun.status,'blocked');assert.ok(calls<=12,'same stalled decision must not consume the 240-turn budget; observed '+calls);assert.equal(tools,2);assert.equal(result.agentRun.artifacts.length,0);
 const {run}=await createWorkspace(fixtureData.base,fixtureData.task);assert.ok(run.events.some(event=>event.type==='loop_recovery'));assert.ok(!run.events.some(event=>event.type==='execution_budget'));
});
test('an unknown side effect is not replayed by another decision or explicit continuation',async t=>{
 const fixtureData=await fixture(t,'unknown-side-effect');let commands=0;
 const ask=async messages=>{const s=JSON.parse(messages.at(-1).content);return response(s.phase==='route'?{action:'route',kind:'task'}:!s.steps.length?plan:{action:'run_command',command:'fixture operation',purpose:'核对当前操作'});};
 const executeTool=async()=>{commands++;return {exitCode:null,timedOut:true,output:'operation may have completed'};};
 const first=await runAgent(options(fixtureData,ask,{executeTool}));assert.equal(first.agentRun.status,'blocked');assert.equal(commands,1);
 const before=await createWorkspace(fixtureData.base,fixtureData.task),executionId=before.run.executionId,receipt=before.run.observationIndex[0].id;
 assert.ok(before.run.actionJournal.some(entry=>entry.status==='unknown'));
 const second=await runAgent(options(fixtureData,ask,{executeTool,continuationReason:'user'}));assert.equal(second.agentRun.status,'blocked');assert.equal(commands,1);
 const after=await createWorkspace(fixtureData.base,fixtureData.task);assert.equal(after.run.executionId,executionId);assert.ok(after.run.observationIndex.some(entry=>entry.id===receipt));assert.ok(after.run.actionJournal.some(entry=>entry.status==='unknown'));
});
test('explicit continuation keeps episode evidence and grants only a finite new window; a real repair can complete it',async t=>{
 const fixtureData=await fixture(t,'continuation-window');let calls=0;
 const failing=async messages=>{calls++;const s=JSON.parse(messages.at(-1).content);return response(s.phase==='route'?{action:'route',kind:'task'}:!s.steps.length?plan:{action:'read_file',path:'weather.txt'});};
 assert.equal((await runAgent(options(fixtureData,failing))).agentRun.status,'blocked');
 let saved=await createWorkspace(fixtureData.base,fixtureData.task);const executionId=saved.run.executionId,episodeId=saved.run.failureEpisodes.records[0].id,oldReceipt=saved.run.observationIndex[0].id;
 assert.equal(saved.run.failureEpisodes.records[0].failures,5);
 const automaticStart=calls;assert.equal((await runAgent(options(fixtureData,failing,{continuationReason:'automatic'}))).agentRun.status,'blocked');assert.ok(calls-automaticStart<=3);
 saved=await createWorkspace(fixtureData.base,fixtureData.task);assert.equal(saved.run.failureEpisodes.records[0].resumes,0);
 const explicitStart=calls;assert.equal((await runAgent(options(fixtureData,failing,{continuationReason:'user'}))).agentRun.status,'blocked');assert.ok(calls-explicitStart<=4);
 saved=await createWorkspace(fixtureData.base,fixtureData.task);assert.equal(saved.run.failureEpisodes.records[0].id,episodeId);assert.equal(saved.run.failureEpisodes.records[0].resumes,1);assert.equal(saved.run.failureEpisodes.records[0].recoveries,3);
 const repaired=[{action:'write_file',path:'weather.txt',content:'已核对真实天气标题'},{action:'artifact',path:'weather.txt',label:'天气说明'},{action:'verify',checks:[{criterionId:'weather',kind:'text_contains',path:'weather.txt',contains:['真实天气标题'],reason:'修复缺失文件后核对原始内容要求'}],progress:{steps:[{id:'make',status:'done'}]}},{action:'finish',text:'天气说明已修复并验收',review:{summary:'缺失文件已生成，原要求已通过当前版本的真实内容检查',issues:[],unverified:[]}}];
 const final=await runAgent(options(fixtureData,async messages=>{const s=JSON.parse(messages.at(-1).content);return response(s.phase==='route'?{action:'route',kind:'task'}:s.requiredAction==='checkpoint'?{action:'checkpoint',text:summary}:repaired.shift());},{continuationReason:'user'}));
 assert.equal(final.agentRun.status,'completed');saved=await createWorkspace(fixtureData.base,fixtureData.task);assert.equal(saved.run.executionId,executionId);assert.equal(saved.run.failureEpisodes.records[0].id,episodeId);assert.equal(saved.run.failureEpisodes.records[0].status,'resolved');assert.ok(saved.run.observationIndex.some(entry=>entry.id===oldReceipt));assert.equal(saved.run.acceptanceResults.weather.status,'passed');
});
async function preparedRun(t,id){
 const fixtureData=await fixture(t,id),w=await createWorkspace(fixtureData.base,fixtureData.task);
 Object.assign(w.run,{mode:'task',status:'paused',goal:plan.goal,steps:structuredClone(plan.steps),decisions:[],acceptance:plan.requirements.map(r=>r.text),requirementsManaged:true,requirements:structuredClone(plan.requirements)});
 await w.save();return {...fixtureData,w};
}
test('automatic segment boundaries preserve the no-action failure budget despite genuine new read coverage',async t=>{
 const fixtureData=await preparedRun(t,'segment-no-action-budget');await fs.writeFile(path.join(fixtureData.w.files,'source.txt'),'source content '.repeat(1000));
 let calls=0,failures=0,nextFailure=true;
 const result=await runSegments(segment=>runAgent(options(fixtureData,async messages=>{
  calls++;const state=JSON.parse(messages.at(-1).content);if(state.phase==='route')return response({action:'route',kind:'task'});
  if(nextFailure){nextFailure=false;failures++;throw Object.assign(Error('no-action fixture'),{code:'MODEL_NO_ACTION_TIMEOUT'});}
  nextFailure=true;return response({action:'read_file',path:'source.txt',offset:failures*100,limit:100});
 },segment)),{policy:{segmentSteps:2,segmentDurationMs:60000,maxSegments:4,maxTotalDurationMs:240000}});
 assert.equal(result.agentRun.status,'partial');assert.equal(result.agentRun.delivery.outcome,'partial');assert.equal(result.agentRun.delivery.status,'settled');assert.equal(failures,4,'automatic segments must not grant a new no-action window');assert.ok(calls<=10);
 const saved=await createWorkspace(fixtureData.base,fixtureData.task);assert.ok(saved.run.performance.automaticContinuations>=1);assert.equal(saved.run.decisionRecovery.noActionFailures,3);assert.ok(saved.run.events.some(event=>event.type==='no_action_budget'));
});
test('a historical interrupted read cannot block safe continuation after real new progress',async t=>{
 const fixtureData=await preparedRun(t,'past-interrupted-read');fixtureData.w.run.actionJournal=[{id:'old-read',action:'read_file',readOnly:true,status:'interrupted',fingerprint:'old-read-fixture'}];await fixtureData.w.save();let calls=0;
 const result=await runAgent(options(fixtureData,async()=>response(calls++?{action:'write_file',path:'weather.txt',content:'actual current progress'}:{action:'route',kind:'task'}),{maxSteps:2}));
 assert.equal(result.agentRun.status,'paused');assert.equal(result.continuation?.safe,true);assert.equal(result.agentRun.segmentState.safe,true);assert.equal(result.agentRun.segmentState.progress,1);
 const saved=await createWorkspace(fixtureData.base,fixtureData.task);assert.equal(saved.run.actionJournal.find(entry=>entry.id==='old-read').status,'interrupted');assert.equal(await fs.readFile(path.join(fixtureData.w.files,'weather.txt'),'utf8'),'actual current progress');
});
test('passing a different batch item or changing batch grouping cannot forgive the actually failed requirement',async t=>{
 const fixtureData=await fixture(t,'batch-partial-pass'),w=await createWorkspace(fixtureData.base,fixtureData.task);
 for(const id of ['a','b','c'])await fs.writeFile(path.join(w.files,id+'.txt'),id==='b'?'missing required weather content':'correct '+id);
 const checks=Object.fromEntries(['a','b','c'].map(id=>[id,{criterionId:id,kind:'text_contains',path:id+'.txt',contains:['correct '+id],reason:'核对原要求 '+id}]));
 const multi={...plan,requirements:['a','b','c'].map(id=>({id,text:'原要求 '+id+' 的正确内容',type:'content'}))};
 let calls=0,sequence=0;
 const result=await runAgent(options(fixtureData,async messages=>{calls++;const state=JSON.parse(messages.at(-1).content);if(state.phase==='route')return response({action:'route',kind:'task'});if(!state.steps.length)return response(multi);
  const step=sequence++,group=Math.floor(step/2)%2===0?'a':'c';return response({action:'verify',checks:step%2?[checks[group]]:group==='a'?[checks.a,checks.b]:[checks.b,checks.c]});
 }));
 assert.equal(result.agentRun.status,'blocked');assert.ok(calls<=14);
 const saved=await createWorkspace(fixtureData.base,fixtureData.task);assert.equal(saved.run.failureEpisodes.records.length,1);assert.deepEqual(saved.run.failureEpisodes.records[0].target.criterionIds,['b']);assert.equal(saved.run.failureEpisodes.records[0].status,'open');assert.equal(saved.run.failureEpisodes.records[0].failures,5);assert.equal(saved.run.validationRepairs.b.status,'open');assert.ok(!saved.run.acceptanceResults.b);assert.ok(saved.run.acceptanceResults.a);assert.ok(saved.run.acceptanceResults.c);
});
test('reusing unchanged successful verification cannot reset the repeated-browser loop budget',async t=>{
 const fixtureData=await fixture(t,'verification-loop-budget'),w=await createWorkspace(fixtureData.base,fixtureData.task);await fs.writeFile(path.join(w.files,'weather.html'),'<h1>Weather</h1>');
 const contentPlan={...plan,requirements:[{id:'page',text:'页面包含Weather标题',type:'content'}]};let calls=0,browsers=0,sequence=0;
 const result=await runAgent(options(fixtureData,async messages=>{calls++;const state=JSON.parse(messages.at(-1).content);if(state.phase==='route')return response({action:'route',kind:'task'});if(!state.steps.length)return response(contentPlan);
  const step=sequence++;return response(step<2||step%2===0?{action:'browser',operation:'open',path:'weather.html',...(state.requiredAction==='plan_update'?{progress:{steps:[{id:'make',status:'running'}]}}:{})}:{action:'verify',checks:[{criterionId:'page',kind:'text_contains',path:'weather.html',contains:['Weather'],reason:'复用当前未变化的内容检查'}]});
 },{model:{...model,imageInput:'disabled'},executeTool:async(workspace,action,...rest)=>{if(action.action==='browser'){browsers++;return {path:'weather.html',dom:{layoutHealth:{textNodes:1,clippedTextNodes:0},missingImages:[]},errors:[],sources:[]};}return execute(workspace,action,...rest);}}));
 assert.equal(result.agentRun.status,'blocked');assert.ok(calls<=18);assert.equal(browsers,2);
 const saved=await createWorkspace(fixtureData.base,fixtureData.task);assert.ok(saved.run.events.filter(event=>event.type==='acceptance_verified').length>1);assert.ok(!saved.run.events.some(event=>event.type==='execution_budget'));assert.ok(saved.run.loopEpisodes.some(episode=>episode.attempt>=5));
});
test('a model repeating only an already passed verification stops without consuming the segment budget',async t=>{
 const fixtureData=await fixture(t,'only-repeat-verification'),w=await createWorkspace(fixtureData.base,fixtureData.task);await fs.writeFile(path.join(w.files,'weather.txt'),'真实天气标题');let calls=0;
 const result=await runAgent(options(fixtureData,async messages=>{calls++;const state=JSON.parse(messages.at(-1).content);return response(state.phase==='route'?{action:'route',kind:'task'}:!state.steps.length?plan:{action:'verify',checks:[{criterionId:'weather',kind:'text_contains',path:'weather.txt',contains:['真实天气标题'],reason:'再次确认同一结果 '+calls}]});}));
 assert.equal(result.agentRun.status,'blocked');assert.ok(calls<=10);assert.equal(result.agentRun.artifacts.length,0);
 const saved=await createWorkspace(fixtureData.base,fixtureData.task);assert.equal(saved.run.acceptanceResults.weather.status,'passed');assert.ok(saved.run.events.filter(event=>event.type==='acceptance_verified').length>1);assert.ok(saved.run.events.some(event=>event.type==='recovery_exhausted'));assert.ok(!saved.run.events.some(event=>event.type==='execution_budget'));
});
test('a new execution clears old repair targets and recovery hints while same-task continuation preserves them',async t=>{
 const fixtureData=await fixture(t,'new-execution-isolation'),w=await createWorkspace(fixtureData.base,fixtureData.task),oldExecution=w.run.executionId;
 Object.assign(w.run,{status:'completed',mode:'task',inputKey:'old-message',goal:'旧天气要求',steps:[{id:'old',title:'旧步骤',status:'done'}],validationRepairs:{weather:{status:'open',criterionId:'weather',requirement:'OLD_REQUIREMENT',type:'content',failureObservationId:'old-proof'}},toolRecovery:{attempt:2,error:'OLD_RECOVERY'}});await w.save();
 const task={...fixtureData.task,messages:[{id:'old-message',role:'user',content:'旧天气要求'},{id:'old-answer',role:'assistant',content:'旧任务已交付'},{id:'new-message',role:'user',content:'制作新的天气说明'}]};let cleanSnapshot=false;
 const result=await runAgent(options({...fixtureData,task},async messages=>{const state=JSON.parse(messages.at(-1).content);if(state.phase==='route')return response({action:'route',kind:'task'});if(!state.steps.length)return response(plan);cleanSnapshot=true;assert.deepEqual(state.repairTargets,[]);assert.equal(state.toolRecovery,undefined);return response({action:'pause',text:'保存新任务的隔离状态'});}));
 assert.equal(result.agentRun.status,'paused');assert.equal(cleanSnapshot,true);let saved=await createWorkspace(fixtureData.base,task);assert.notEqual(saved.run.executionId,oldExecution);assert.deepEqual(saved.run.validationRepairs,{});assert.equal(saved.run.toolRecovery,undefined);
 saved.run.validationRepairs={weather:{status:'open',criterionId:'weather',requirement:'CURRENT_REQUIREMENT',type:'content',failureObservationId:'current-proof'}};saved.run.toolRecovery={attempt:1,error:'CURRENT_RECOVERY'};await saved.save();let preserved=false;
 await runAgent(options({...fixtureData,task},async messages=>{const state=JSON.parse(messages.at(-1).content);if(state.phase==='route')return response({action:'route',kind:'task'});assert.equal(state.repairTargets[0].requirement,'CURRENT_REQUIREMENT');assert.equal(state.toolRecovery.error,'CURRENT_RECOVERY');preserved=true;return response({action:'pause',text:'保留同一任务的真实修复记录'});}));assert.equal(preserved,true);
});

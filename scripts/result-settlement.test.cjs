const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const settlement=require('../apps/desktop/agent/result-settlement.cjs');
const response=action=>({content:JSON.stringify(action)});
const plan={action:'plan',goal:'交付课程与补充材料',decisions:[],requirements:[{id:'course',text:'课程包含课程正文',type:'content'},{id:'extra',text:'补充文件包含补充正文',type:'content'}],steps:[{id:'course',title:'课程',status:'running'},{id:'extra',title:'补充',status:'pending'}]};
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-settlement-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'settlement',request:plan.goal,messages:[{id:'u1',role:'user',content:plan.goal}]};return {base,task,model:{id:'company-fixture',contextWindow:131072},signal:new AbortController().signal};}
test('a failed recovery completes independent work, then delivers real files without accepting the missing requirement',async t=>{
 const f=await fixture(t);let n=0,failures=0,remaining=false;
 const actions=[plan,{action:'write_file',path:'course.txt',content:'课程正文'},{action:'artifact',path:'course.txt',label:'课程草稿'}];
 const result=await runAgent({...f,maxSteps:40,ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);
  if(state.phase==='route')return response({action:'route',kind:'task'});
  if(n<actions.length)return response(actions[n++]);
  if(!state.resultRecovery){failures++;return response({action:'read_file',path:'missing.txt'});}
  remaining=true;
  if(n++===3)return response({action:'write_file',path:'extra.txt',content:'补充正文'});
  if(n===5)return response({action:'artifact',path:'extra.txt',label:'补充材料'});
  if(n===6)return response({action:'verify',checks:[{criterionId:'extra',kind:'text_contains',path:'extra.txt',contains:['补充正文'],reason:'实际补充文件已写入'}]});
  return response({action:'blocked',text:'课程草稿仍未核验，其他可行工作已处理。'});
 }});
 assert.equal(remaining,true);assert.equal(failures,5);assert.equal(result.agentRun.status,'partial');assert.equal(result.agentRun.delivery.outcome,'partial');assert.equal(result.agentRun.delivery.status,'settled');
 assert.deepEqual(result.agentRun.delivery.availableArtifacts.map(f=>f.path).sort(),['course.txt','extra.txt']);assert.deepEqual(result.agentRun.delivery.unverified,['course']);assert.deepEqual(result.agentRun.delivery.coverage,{passed:1,total:2});
 assert.equal(result.agentRun.taskContinuation.taskOpen,false);assert.match(result.content,/课程草稿/);assert.match(result.content,/补充材料/);assert.doesNotMatch(result.content,/服务已恢复|检查.*授权/);
 const w=await createWorkspace(f.base,f.task);assert.equal(w.run.acceptanceResults.course,undefined);assert.equal(w.run.acceptanceResults.extra.status,'passed');assert.equal(w.run.steps[0].status,'running');assert.equal(w.run.events.filter(e=>e.type==='write_file').length,2);assert.ok(w.run.failureEpisodes.records.some(e=>e.failures===5));
});
test('real repair during the remaining-work window still finishes through the full acceptance path',async t=>{
 const f=await fixture(t);let n=0;
 const actions=[plan,{action:'write_file',path:'course.txt',content:'课程正文'},{action:'artifact',path:'course.txt',label:'课程'},...Array(5).fill({action:'read_file',path:'extra.txt'}),{action:'write_file',path:'extra.txt',content:'补充正文'},{action:'artifact',path:'extra.txt',label:'补充'},
  {action:'verify',checks:['course','extra'].map(id=>({criterionId:id,kind:'text_contains',path:id+'.txt',contains:[id==='course'?'课程正文':'补充正文'],reason:'已核对实际文件正文'})),progress:{steps:plan.steps.map(s=>({id:s.id,status:'done'}))}},
  {action:'finish',text:'课程与补充材料均已生成并检查。',review:{summary:'两份文件的原要求均通过当前版本检查',issues:[],unverified:[]}}];
 const result=await runAgent({...f,ask:async messages=>response(JSON.parse(messages.at(-1).content).phase==='route'?{action:'route',kind:'task'}:actions[n++])});
 assert.equal(result.agentRun.status,'completed');assert.equal(result.agentRun.delivery.outcome,'complete');assert.ok(result.agentRun.acceptanceCriteria.every(c=>c.status==='passed'));assert.equal(result.agentRun.resultRecovery.stage,'completed');assert.ok(!result.agentRun.events.some(e=>e.type==='result_settled'));
});
test('final inventory refreshes changed registrations, excludes deleted and empty files, and revokes stale coverage without deleting evidence',async t=>{
 const f=await fixture(t),w=await createWorkspace(f.base,f.task);
 Object.assign(w.run,{mode:'task',executionId:'same',steps:plan.steps,acceptance:['正文包含原文']});
 for(const name of ['good','changed','deleted','empty']){await execute(w,{action:'write_file',path:name+'.txt',content:'原文'});w.run.artifacts.push({path:name+'.txt',label:name,sha256:require('node:crypto').createHash('sha256').update('原文').digest('hex')});}
 await require('../apps/desktop/agent/acceptance.cjs').verify(w,{checks:[{criterionId:require('../apps/desktop/agent/acceptance.cjs').criterionId('正文包含原文'),kind:'text_contains',path:'changed.txt',contains:['原文'],reason:'原版本的真实正文'}]});
 await fs.writeFile(path.join(w.files,'changed.txt'),'修改后');await fs.unlink(path.join(w.files,'deleted.txt'));await fs.writeFile(path.join(w.files,'empty.txt'),'');
 const result=await settlement.settle(w,Object.assign(Error('恢复耗尽'),{code:'AGENT_REPAIR_EXHAUSTED'}));
 assert.deepEqual(w.run.delivery.availableArtifacts.map(f=>f.path),['good.txt','changed.txt']);assert.equal(w.run.artifacts.find(f=>f.path==='changed.txt').quality,'unverified');assert.equal(w.run.delivery.coverage.passed,0);assert.equal(w.run.delivery.unavailableArtifacts.length,2);assert.equal(w.run.artifacts.length,4);assert.equal(Object.values(w.run.acceptanceResults)[0].status,'passed');assert.match(result.content,/未作为本次可交付成果/);
});
test('unknown or running side effects cannot be settled or automatically replayed',async t=>{
 const f=await fixture(t),w=await createWorkspace(f.base,f.task);
 for(const status of ['unknown','running','interrupted']){
  w.run.actionJournal=[{status,readOnly:false}];const before=JSON.stringify(w.run);
  assert.equal(settlement.begin(w.run,{code:'AGENT_REPAIR_EXHAUSTED',message:'failed'}),false);assert.equal(await settlement.settle(w,{code:'AGENT_REPAIR_EXHAUSTED',message:'failed'}),null);assert.equal(JSON.stringify(w.run),before);
 }
 for(const code of ['MODEL_NETWORK','MODEL_PROVIDER_REJECTED','PERMISSION_REQUIRED','ACTION_RESULT_UNKNOWN'])assert.equal(settlement.internal({code}),false);
});
test('a settled result can continue under the original execution and evidence without any service-restored phrase',async t=>{
 const f=await fixture(t);let n=0;
 const actions=[plan,{action:'write_file',path:'course.txt',content:'课程正文'},{action:'artifact',path:'course.txt',label:'课程'}];
 const first=await runAgent({...f,ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return response({action:'route',kind:'task'});if(n<actions.length)return response(actions[n++]);return {content:'invalid action'};}}).catch(e=>{assert.equal(e.code,'AGENT_PROTOCOL');return {content:e.taskMessage,agentRun:e.agentRun};});
 assert.equal(first.agentRun.status,'partial');const executionId=first.agentRun.executionId;
 const task={...f.task,messages:[...f.task.messages,{id:'a1',role:'assistant',content:first.content},{id:'u2',role:'user',content:'继续'}]};
 let resumed=false;
 const second=await runAgent({...f,task,requestOrigin:'user',ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return response({action:'route',kind:'task'});resumed=true;return response({action:'pause',text:'本次只核对续跑身份，未声明任务完成。'});}});
 assert.equal(resumed,true);assert.equal(second.agentRun.executionId,executionId);assert.equal(second.agentRun.artifacts[0].path,'course.txt');const saved=await createWorkspace(f.base,task);assert.equal(saved.run.events.filter(e=>e.type==='write_file').length,1);assert.equal(saved.run.history.find(h=>h.afterMessageId==='a1').delivery.status,'settled');
});
test('a legacy visual-format blocker allows a direct retry but unknown effects still forbid blind retries',()=>{
 const continuation=require('../apps/desktop/agent/task-continuation.cjs');
 const run={status:'blocked',inputKey:'old',steps:[],artifacts:[],events:[],waitingError:{code:'MODEL_VISION_PROTOCOL',message:'观察格式无效'},taskContinuation:{taskOpen:true,code:'MODEL_VISION_PROTOCOL'}};
 continuation.update(run);assert.equal(run.taskContinuation.state,'waiting_retry');assert.doesNotMatch(run.taskContinuation.question,/授权|用量/);
 const task={messages:[{id:'new',role:'user',content:'继续原任务。已处理的条件或补充信息：'}]};assert.equal(continuation.canResume(run,task),true);
 run.actionJournal=[{status:'unknown'}];continuation.update(run);assert.equal(run.taskContinuation.state,'waiting_result_check');assert.equal(continuation.canResume(run,task),false);
});
test('incident: invalid vision responses become a local gap, the text executor completes other work and delivers files',async t=>{
 const f=await fixture(t),{createVisualRouter}=require('../apps/desktop/model-routing.cjs');let visionCalls=0,n=0,sawRecovery=false;
 const image={role:'user',content:[{type:'text',text:'工具观察 screenshot-current'}, {type:'image_url',image_url:{url:'data:image/png;base64,fixture'}}]};
 const prepare=createVisualRouter({enabled:true,run:async(_lane,request)=>({model:{id:'vision'},result:await request({id:'vision'})})});
 const actions=[plan,{action:'write_file',path:'course.txt',content:'课程正文'},{action:'artifact',path:'course.txt',label:'课程'}, {action:'write_file',path:'extra.txt',content:'补充正文'},{action:'artifact',path:'extra.txt',label:'补充'}];
 const result=await runAgent({...f,prepareModelMessages:async messages=>{
  const state=JSON.parse(messages.at(-1).content);
  if(!state.artifacts?.length)return {messages};
  return prepare([messages[0],image,...messages.slice(1)],async()=>{visionCalls++;return {content:'{"action":"finish"}'};});
 },ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);if(state.phase==='route')return response({action:'route',kind:'task'});
  if(state.resultRecovery)sawRecovery=true;
  if(n<actions.length)return response(actions[n++]);
  return response({action:'blocked',text:'已整理两份文件，自动视觉观察未能完成。'});
 }});
 assert.equal(visionCalls,2);assert.equal(sawRecovery,true);assert.equal(result.agentRun.status,'partial');assert.equal(result.agentRun.delivery.availableArtifacts.length,2);assert.equal(result.agentRun.visualAnalysisFailures.length,1);assert.equal(result.agentRun.delivery.coverage.passed,0);assert.ok(result.agentRun.acceptanceCriteria.every(c=>c.status==='pending'));assert.doesNotMatch(result.content,/服务已恢复/);
 const w=await createWorkspace(f.base,f.task);assert.equal(w.run.events.filter(e=>e.type==='visual_analysis_failed').length,1);assert.equal(w.run.visualObservations.some(o=>o.modelReviews?.length),false);
});
test('genuine new writes can continue beyond the remaining-work idle budget; repeated reads cannot replenish it',async t=>{
 const f=await fixture(t);let n=0,writes=0;
 const actions=[plan,{action:'write_file',path:'course.txt',content:'课程正文'},{action:'artifact',path:'course.txt',label:'课程'},...Array(5).fill({action:'read_file',path:'missing.txt'})];
 const result=await runAgent({...f,maxSteps:60,ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);if(state.phase==='route')return response({action:'route',kind:'task'});
  if(n<actions.length)return response(actions[n++]);
  if(writes++<16)return response({action:'write_file',path:'extra.txt',content:'补充正文 '+writes});
  if(writes===18)return response({action:'artifact',path:'extra.txt',label:'补充'});
  return response({action:'blocked',text:'已完成可行文件写入，原检查缺口保留。'});
 }});
 assert.equal(result.agentRun.status,'partial');assert.ok(result.agentRun.resultRecovery.turns>12);const w=await createWorkspace(f.base,f.task);assert.equal(w.run.events.filter(e=>e.type==='write_file').length,17);assert.equal(w.run.failureEpisodes.records[0].failures,5);
});
test('a version-bound generated file is still offered when failure occurs before artifact registration',async t=>{
 const f=await fixture(t);let n=0;
 const result=await runAgent({...f,ask:async messages=>{const state=JSON.parse(messages.at(-1).content);if(state.phase==='route')return response({action:'route',kind:'task'});if(!n++)return response(plan);if(n===2)return response({action:'write_file',path:'draft.txt',content:'课程正文草稿'});return {content:'bad'};}}).catch(e=>({content:e.taskMessage,agentRun:e.agentRun}));
 assert.equal(result.agentRun.status,'partial');assert.equal(result.agentRun.artifacts.length,1);assert.equal(result.agentRun.artifacts[0].origin,'execution_receipt');assert.equal(result.agentRun.delivery.availableArtifacts[0].path,'draft.txt');assert.equal(result.agentRun.delivery.availableArtifacts[0].quality,'unverified');assert.equal(result.agentRun.delivery.coverage.passed,0);
});
test('result icons reflect verified outcomes and settled partial results attach only to their own final response',async()=>{
 const {stripTypeScriptTypes}=require('node:module');
 const load=async name=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(await fs.readFile(path.join(__dirname,'../apps/desktop/src/'+name),'utf8'))).toString('base64'));
 const {deliveryStatus}=await load('delivery-status.ts'),{deliveryForMessage}=await load('delivery-artifacts.ts');
 assert.equal(deliveryStatus({status:'completed',delivery:{outcome:'complete'},acceptanceCriteria:[{status:'passed'}]}).label,'完整完成');
 assert.notEqual(deliveryStatus({status:'partial',delivery:{outcome:'partial',coverage:{passed:4,total:5}}}).tone,'complete');assert.equal(deliveryStatus({status:'partial',delivery:{outcome:'partial',coverage:{passed:4,total:5}}}).label,'大部分要求已核验');
 assert.equal(deliveryStatus({status:'completed',delivery:{outcome:'limited'}}).tone,'limited');assert.equal(deliveryStatus({status:'completed',delivery:{outcome:'complete',unverified:['v']}}).tone,'incomplete');
 const run={status:'partial',currentInputId:'u1',artifacts:[{path:'draft.txt'}],delivery:{status:'settled',outcome:'partial'}},messages=[{id:'u1',role:'user'},{id:'a1',role:'assistant'},{id:'u2',role:'user'},{id:'a2',role:'assistant'}];
 assert.equal(deliveryForMessage({agentRun:run},messages,'a1'),run);assert.equal(deliveryForMessage({agentRun:run},messages,'a2'),undefined);
 const history={...run,afterMessageId:'a1'};assert.equal(deliveryForMessage({agentRun:{status:'running',history:[history]}},messages,'a1'),history);
});

test('user cancellation does not turn the task into an automatic partial delivery',async t=>{
 const f=await fixture(t),w=await createWorkspace(f.base,f.task),controller=new AbortController();controller.abort();const before=JSON.stringify(w.run);
 await assert.rejects(settlement.settle(w,{code:'AGENT_REPAIR_EXHAUSTED',message:'failed'},{signal:controller.signal}),e=>e.name==='AbortError');assert.equal(JSON.stringify(w.run),before);
});
test('failed image delivery survives automatic continuation but an explicit new input gets a bounded new observation',async t=>{
 const f=await fixture(t),{createVisualRouter}=require('../apps/desktop/model-routing.cjs'),sourceId=require('node:crypto').randomUUID();
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 await fs.mkdir(path.join(f.base,'imports'));await fs.writeFile(path.join(f.base,'imports',sourceId),png);
 f.task.messages[0].materials=[{name:'design.png',sourceId,size:png.length,text:null}];let visionCalls=0,n=0;
 const prepare=valid=>{
  const router=createVisualRouter({enabled:true,run:async(_lane,request)=>({model:{id:'vision'},result:await request({id:'vision'})})});
  return messages=>router(messages,async()=>{visionCalls++;return {content:valid?JSON.stringify({summary:'真实图片已观察',observations:['仅有一个像素'],uncertainties:['无法判断页面排版']}):'bad format'};});
 };
 const actions=[plan,{action:'write_file',path:'course.txt',content:'课程正文'},{action:'artifact',path:'course.txt',label:'课程'}];
 const first=await runAgent({...f,prepareModelMessages:prepare(false),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);return response(s.phase==='route'?{action:'route',kind:'task'}:n<actions.length?actions[n++]:{action:'blocked',text:'已无其他可行工作，视觉检查缺口保留。'});
 }});
 assert.equal(first.agentRun.status,'partial');assert.equal(visionCalls,2);const scope=first.agentRun.visualAnalysisFailures[0].recoveryScope;
 await runAgent({...f,continuationReason:'automatic',prepareModelMessages:prepare(false),ask:async messages=>response(JSON.parse(messages.at(-1).content).phase==='route'?{action:'route',kind:'task'}:{action:'blocked',text:'保留原缺口。'})});assert.equal(visionCalls,2);
 const task={...f.task,messages:[...f.task.messages,{id:'a1',role:'assistant',content:first.content},{id:'u2',role:'user',content:'继续'}]};
 await runAgent({...f,task,requestOrigin:'user',prepareModelMessages:prepare(true),ask:async messages=>response(JSON.parse(messages.at(-1).content).phase==='route'?{action:'route',kind:'task'}:{action:'pause',text:'已核对观察重试身份，不声称视觉验收通过。'})});
 assert.equal(visionCalls,3);const saved=await createWorkspace(f.base,task);assert.equal(saved.run.visualAnalysisFailures[0].recoveryScope,scope);assert.equal(saved.run.events.filter(e=>e.type==='visual_analysis_failed').length,1);assert.ok(saved.run.events.some(e=>e.type==='visual_analysis'));assert.equal(saved.run.acceptanceResults.course,undefined);
});

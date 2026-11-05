const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const coverage=require('../apps/desktop/agent/input-coverage.cjs');
const requirements=require('../apps/desktop/agent/requirements.cjs');
const inputTurn=require('../apps/desktop/agent/input-turn.cjs');
const req=(id,text)=>({id,text,type:'content'});
const original=req('base','正文保留基础说明');
const plan={action:'plan',goal:'生成文本说明文件',decisions:[],requirements:[original],steps:[{id:'write',title:'写入并核对正文',status:'running'}]};
async function setup(t,name){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-followup-adoption-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:name,request:'生成文本说明文件，正文保留基础说明',messages:[{id:'original',role:'user',content:'生成文本说明文件，正文保留基础说明'}]};return {base,task};}
function updatePlan(run,task,action){const update=requirements.update(run,action);inputTurn.assertPlan(run,update.requirements);const commit=coverage.plan(run,task,action,update.requirements);Object.assign(run,update);commit();run.acceptanceInputKey=run.inputKey;}
function ledgerFixture(){const task={messages:[{id:'original',role:'user',content:'生成基础说明'}]},run={executionId:'same',inputKey:'original',acceptanceInputKey:'original',requirementsManaged:true,requirements:[original],steps:[]};coverage.receive(run,task);return {run,task};}
function receive(run,task,message){task.messages.push(message);run.inputKey=message.id;run.currentRequest=message.content;inputTurn.begin(run);coverage.receive(run,task,[message]);}

test('substantive text steering must be adopted before old-plan writes, while safe source reads remain available',async t=>{
 const {base,task}=await setup(t,'text-preempts-writes'),queue=[];let calls=0;
 const workspace=await createWorkspace(base,task);await fs.writeFile(path.join(workspace.files,'source.txt'),'基础说明');
 const adopted={...plan,requirements:[original,req('new','正文包含新要求')]};
 const result=await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,maxSteps:16,getSteering:async()=>queue.splice(0),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);let action;calls++;
  if(calls===1)action={action:'route',kind:'task'};
  else if(calls===2)action=plan;
  else if(calls===3){queue.push({id:'followup',role:'user',content:'补充正文包含新要求，保留基础说明'});action={action:'write_file',path:'discarded-decision.txt',content:'旧决定'};}
  else if(s.phase==='route')action={action:'route',kind:'task'};
  else if(calls===5)action={action:'read_file',path:'source.txt',offset:0,limit:1000};
  else if(calls===6)action={action:'write_file',path:'obsolete-after-receipt.txt',content:'基础说明'};
  else if(calls===7)action=adopted;
  else if(calls===8)action={action:'write_file',path:'result.txt',content:'基础说明 新要求'};
  else action={action:'pause',text:'本次隔离回归已保存文件，未调用真实模型。'};
  return {content:JSON.stringify(action)};
 }});
 const saved=await createWorkspace(base,task);
 await assert.rejects(fs.access(path.join(saved.files,'discarded-decision.txt')),/ENOENT/);
 await assert.rejects(fs.access(path.join(saved.files,'obsolete-after-receipt.txt')),/ENOENT/);
 assert.equal(await fs.readFile(path.join(saved.files,'result.txt'),'utf8'),'基础说明 新要求');
 assert.ok(saved.run.events.some(e=>e.type==='read_file'&&e.detail.path==='source.txt'),'安全读取可用于理解及采用新输入');
 assert.ok(saved.run.events.some(e=>e.type==='tool_error'&&['INPUT_REQUIREMENTS_PENDING','INPUT_COVERAGE_PENDING'].includes(e.detail.code)),'旧副作用须在journal与写入前拒绝');
 assert.equal(result.agentRun.inputCoverage.find(e=>e.inputId==='followup').status,'planned');
});

test('separately arriving substantive inputs retain all prior requirement links across later plans',()=>{
 const {run,task}=ledgerFixture(),one=req('one','增加名称信息'),two=req('two','增加库存信息');
 receive(run,task,{id:'input-one',role:'user',content:'增加名称信息'});updatePlan(run,task,{requirements:[original,one]});
 receive(run,task,{id:'input-two',role:'user',content:'增加库存信息'});updatePlan(run,task,{requirements:[original,one,two]});
 assert.deepEqual(coverage.rows(run).map(e=>({id:e.inputId,status:e.status,ids:e.requirementIds})),[
  {id:'original',status:'planned',ids:['base']},
  {id:'input-one',status:'planned',ids:['one']},
  {id:'input-two',status:'planned',ids:['two']},
 ]);
 run.freshAcceptanceIds=['base','two'];coverage.refresh(run);assert.equal(coverage.rows(run).find(e=>e.inputId==='input-one').status,'planned');
 run.freshAcceptanceIds=['base','one','two'];coverage.refresh(run);assert.ok(coverage.rows(run).every(e=>e.status==='verified'));
});

test('a new input cannot silently remove a must requirement belonging to an earlier planned input',()=>{
 const {run,task}=ledgerFixture(),one=req('one','增加名称信息'),two=req('two','增加库存信息');
 receive(run,task,{id:'input-one',role:'user',content:'增加名称信息'});updatePlan(run,task,{requirements:[original,one]});
 receive(run,task,{id:'input-two',role:'user',content:'增加库存信息，保留原要求'});
 const before=JSON.stringify({requirements:run.requirements,coverage:coverage.rows(run)});
 assert.throws(()=>updatePlan(run,task,{requirements:[two]}),/要求|输入|must|原/);
 assert.equal(JSON.stringify({requirements:run.requirements,coverage:coverage.rows(run)}),before,'拒绝应原子保留既有要求与来源关联');
});

test('each received input must link to a changed requirement rather than only an unchanged old requirement',()=>{
 const {run,task}=ledgerFixture(),other=req('other','记录运行日志');run.requirements.push(other);
 receive(run,task,{id:'followup',role:'user',content:'补充新的正文要求'});
 const action={requirements:[original,{...other,text:'记录详细运行日志'}],inputUse:[{inputId:'followup',disposition:'requirements',requirementIds:['base']}]};
 const update=requirements.update(run,action);inputTurn.assertPlan(run,update.requirements);
 assert.throws(()=>coverage.plan(run,task,action,update.requirements),/要求|输入|计划/,'更改其他要求不能让本条新输入只挂原样旧要求');
 assert.equal(coverage.rows(run).find(e=>e.inputId==='followup').status,'received');
});

test('an already corrupted historical mapping blocks delivery instead of silently disappearing from coverage',()=>{
 const {run}=ledgerFixture();run.requirements=[req('replacement','新的无关要求')];coverage.refresh(run);
 assert.deepEqual(coverage.rows(run)[0].missingRequirementIds,['base']);assert.throws(()=>coverage.assertPlanned(run),e=>e.code==='INPUT_COVERAGE_PENDING');
});

test('mixing a historical attachment into this batch reports the actual ID mismatch and permits a precise correction',()=>{
 const material=require('../apps/desktop/agent/material-input.cjs'),run={materialInput:{inputId:'followup',required:true,status:'inspected',materials:[{id:'current_html',name:'效果图总览.html',reads:[{kind:'text',text:'当前参考目录'}]}]}},current={id:'current_html',role:'reference',reason:'读取本次效果参考',requirementIds:['background']},old={id:'historical_zip',role:'design',reason:'历史已采用设计',requirementIds:['background']},requirements=[req('background','按本次输入实现背景切换')];
 assert.throws(()=>material.checkPlan(run,{materialUse:[current,old]},requirements),e=>e.code==='MATERIAL_INPUT_PENDING'&&e.message.includes('非本批ID：historical_zip')&&e.message.includes('current_html')&&!e.message.includes('缺少本批ID'));
 assert.doesNotThrow(()=>material.checkPlan(run,{materialUse:[current]},requirements));assert.equal(run.materialInput.status,'inspected','验证通过尚未提交，不能预先记录adopted');
});

test('a later explicit source-backed withdrawal can supersede its earlier input and remove only its requirements',()=>{
 const {run,task}=ledgerFixture();receive(run,task,{id:'replacement',role:'user',content:'取消上条要求，改为仅生成乙说明'});
 assert.doesNotThrow(()=>updatePlan(run,task,{requirements:[req('new','正文包含乙说明')],inputUse:[
  {inputId:'original',disposition:'superseded',requirementIds:[],supersededBy:'replacement',sourceQuote:'取消上条要求'},
  {inputId:'replacement',disposition:'requirements',requirementIds:['new']},
 ]}));
 assert.equal(coverage.rows(run).find(e=>e.inputId==='original').status,'superseded');
 assert.deepEqual(run.requirements.map(r=>r.id),['new']);
});

test('a rejected material plan cannot commit attached memory, execution state or step progress',async t=>{
 const {base,task}=await setup(t,'atomic-failed-plan'),queue=[];let calls=0,before,after;
 const oldMemory='原任务只登记基础说明，接下来按现有计划读取来源并生成文本，尚未完成核验。';
 const state={goal:'基础说明',facts:[],gaps:['尚未生成'],nextAction:'写入基础说明',expectedResult:'包含基础说明的文本'};
 await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,maxSteps:12,getSteering:async()=>queue.splice(0),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);let action;calls++;
  if(calls===1)action={action:'route',kind:'task'};
  else if(calls===2)action={...plan,progress:{memory:oldMemory,executionState:state}};
  else if(calls===3){queue.push({id:'attachment',role:'user',content:'按照本条附件补充文本说明',materials:[{name:'new-source.txt',text:'新增信息需要纳入当前说明正文。'}]});action={action:'checkpoint',text:'这条旧决定会因补充输入到达而被丢弃，不应改变原任务状态。'};}
  else if(s.phase==='route')action={action:'route',kind:'task'};
  else if(calls===5){before={steps:s.steps,memory:s.workingMemory,executionState:s.executionState,progressEvents:s.recentEvents.filter(e=>e.type==='attached_progress').map(e=>e.id)};action={...plan,requirements:[original,req('new','正文包含附件新增信息')],steps:[{id:'write',title:'附带的新计划不得提前生效',status:'running'}],progress:{steps:[{id:'write',status:'done'}],memory:'这段尚未通过整体验证的计划摘要不能写入当前工作记忆，附件用途仍然缺失。',executionState:{...state,goal:'尚未采用附件的新目标',nextAction:'执行尚未成立的新计划'}}};}
  else {after={steps:s.steps,memory:s.workingMemory,executionState:s.executionState,progressEvents:s.recentEvents.filter(e=>e.type==='attached_progress').map(e=>e.id),errors:s.toolResults.filter(r=>r.error)};action={action:'pause',text:'隔离回归结束，失败计划不能改变原任务状态。'};}
  return {content:JSON.stringify(action)};
 }});
 assert.ok(after?.errors.some(r=>r.error?.includes('附件')),'该计划确因缺少materialUse而被拒绝');
 assert.deepEqual(after.steps,before.steps);assert.equal(after.memory,before.memory);
 const decisionState=({updatedAt,blocker,...value})=>value;
 assert.deepEqual(decisionState(after.executionState),decisionState(before.executionState));assert.equal(after.executionState.blocker?.code,'MATERIAL_INPUT_PENDING','真实错误可以记录为恢复缺口，不能采用被拒绝的新目标');assert.deepEqual(after.progressEvents,before.progressEvents,'失败计划不能发布成功的attached_progress');
});

test('pure continuation may execute the existing plan without a replacement plan',async t=>{
 const {base,task}=await setup(t,'pure-continuation'),queue=[];let calls=0;
 const result=await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,maxSteps:10,getSteering:async()=>queue.splice(0),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);let action;calls++;
  if(calls===1)action={action:'route',kind:'task'};else if(calls===2)action=plan;
  else if(calls===3){queue.push({id:'continue',role:'user',content:'继续任务'});action={action:'checkpoint',text:'旧决策应在继续指令到达后丢弃，之后保留原计划继续。'};}
  else if(s.phase==='route')action={action:'route',kind:'task'};
  else if(calls===5)action={action:'write_file',path:'continued.txt',content:'基础说明'};
  else action={action:'pause',text:'已按原计划执行，隔离回归停止。'};
  return {content:JSON.stringify(action)};
 }});
 const w=await createWorkspace(base,task);assert.equal(await fs.readFile(path.join(w.files,'continued.txt'),'utf8'),'基础说明');assert.equal(result.agentRun.inputCoverage.find(e=>e.inputId==='continue').status,'continuation');
});

test('real discussion steering can be answered without adding a task plan or discarding earlier work',async t=>{
 const {base,task}=await setup(t,'chat-no-adoption-plan'),queue=[];let calls=0;
 const result=await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,maxSteps:10,getSteering:async()=>queue.splice(0),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);let action;calls++;
  if(calls===1)action={action:'route',kind:'task'};else if(calls===2)action=plan;
  else if(calls===3){queue.push({id:'question',role:'user',content:'先解释一下这项任务准备怎么做'});action={action:'checkpoint',text:'旧决定应丢弃，当前问题只需要解释，无需创建新的业务要求。'};}
  else if(s.phase==='route')action={action:'route',kind:'chat'};
  else action={action:'reply',text:'将保留基础说明，生成文本文件后按内容核对。'};
  return {content:JSON.stringify(action)};
 }});
 assert.equal(result.agentRun.inputCoverage.find(e=>e.inputId==='question').status,'answered');assert.equal(result.agentRun.inputCoverage.find(e=>e.inputId==='original').status,'planned');assert.equal(result.agentRun.events.filter(e=>e.type==='plan').length,1);
});

test('adoption effect classification retains explicit connector reads and treats unknown remote calls conservatively',()=>{
 const requires=inputTurn.requiresAdoption;
 for(const operation of ['status','logs','screenshot'])assert.equal(requires({action:'android_device',operation}),false);
 for(const operation of ['check','start','install','launch','tap','back','type','stop'])assert.equal(requires({action:'android_device',operation}),true);
 for(const operation of ['schema','help'])assert.equal(requires({action:'feishu',operation}),false);
 assert.equal(requires({action:'feishu',operation:'api',method:'GET'}),false);
 for(const method of ['POST','PUT','PATCH','DELETE',undefined])assert.equal(requires({action:'feishu',operation:'api',method}),true);
 for(const [query,spec]of Object.entries(require('../apps/desktop/feishu-request.cjs').shortcuts))assert.equal(requires({action:'feishu',operation:'shortcut',query}),spec.write!==false,query);
 assert.equal(requires({action:'feishu',operation:'shortcut',query:'unknown shortcut'}),true);
 for(const action of ['mcp','amap']){assert.equal(requires({action,operation:'list'}),false);assert.equal(requires({action,operation:'call',params:{readOnly:true}}),true);}
 for(const operation of ['list','search','read'])assert.equal(requires({action:'memory',operation}),false);
 for(const operation of ['save','forget'])assert.equal(requires({action:'memory',operation}),true);
 for(const operation of ['list','read'])assert.equal(requires({action:'assistant',operation}),false);
 for(const operation of ['delegate','continue','update','pause','schedule','schedule_toggle'])assert.equal(requires({action:'assistant',operation}),true);
});

test('unknown effects and unadopted attachments still permit explicit read-only device investigation, without running check',async t=>{
 const {base,task}=await setup(t,'readonly-device-before-adoption'),w=await createWorkspace(base,task),invoked=[];
 Object.assign(w.run,{executionId:'original-execution',inputKey:'original',acceptanceInputKey:'original',currentRequest:task.request,status:'partial',mode:'task',goal:plan.goal,steps:structuredClone(plan.steps),requirementsManaged:true,requirements:[original],acceptance:[original.text]});coverage.receive(w.run,task);
 require('../apps/desktop/agent/action-journal.cjs').begin(w.run,{action:'run_command',command:'unknown-command'});await w.save();
 task.messages.push({id:'device-followup',role:'user',content:'依据本条附件补充说明，保留原要求',materials:[{name:'source.txt',text:'新的说明来源'}]});let calls=0;
 const result=await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,maxSteps:10,executeTool:async(_w,action)=>{invoked.push(action.operation);assert.ok(['status','logs'].includes(action.operation));return {running:false,output:'isolated read-only fixture'};},ask:async messages=>{const s=JSON.parse(messages.at(-1).content);calls++;return {content:JSON.stringify(s.phase==='route'?{action:'route',kind:'task'}:calls===2?{action:'android_device',operation:'status'}:calls===3?{action:'android_device',operation:'logs'}:calls===4?{action:'android_device',operation:'check',path:'app.apk'}:{action:'pause',text:'已保留未知操作并只读调查，尚未采用新要求或完成任务。'})};}});
 assert.deepEqual(invoked,['status','logs']);assert.equal(result.agentRun.inputCoverage.find(e=>e.inputId==='device-followup').status,'received');
 const saved=await createWorkspace(base,task);assert.equal(saved.run.actionJournal.find(e=>e.action==='run_command').status,'unknown');assert.equal(result.agentRun.status,'blocked');assert.match(result.content,/尚未确认/);assert.ok(!saved.run.actionJournal.some(e=>e.operation==='check'));
});

test('a remote document write waits for followup adoption while schema lookup is available and adopted writes proceed',async t=>{
 const {base,task}=await setup(t,'external-write-adoption'),queue=[];let calls=0;const invoked=[];
 const adopted={...plan,requirements:[original,req('new','正文包含新要求')]};
 const result=await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,maxSteps:16,getSteering:async()=>queue.splice(0),feishuCli:{execute:async action=>{invoked.push(structuredClone(action));return {ok:true,simulated:true};}},ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);let action;calls++;
  if(calls===1)action={action:'route',kind:'task'};
  else if(calls===2)action=plan;
  else if(calls===3){queue.push({id:'followup',role:'user',content:'先按本次新要求更新正文，再创建飞书文档；保留基础说明'});action={action:'checkpoint',text:'旧决定应先被补充输入替代，再按本次用户要求执行。'};}
  else if(s.phase==='route')action={action:'route',kind:'task'};
  else if(calls===5)action={action:'feishu',operation:'schema',query:'docs'};
  else if(calls===6)action={action:'feishu',operation:'shortcut',query:'docs +create',params:{title:'旧计划文档',markdown:'旧内容'}};
  else if(calls===7)action=adopted;
  else if(calls===8)action={action:'feishu',operation:'shortcut',query:'docs +create',params:{title:'本次要求文档',markdown:'基础说明 新要求'}};
  else action={action:'pause',text:'隔离回归已记录本次采用后的外部写入桩。'};
  return {content:JSON.stringify(action)};
 }});
 assert.deepEqual(invoked.map(a=>a.operation),['schema','shortcut']);
 assert.equal(invoked[1].params.markdown,'基础说明 新要求','采用前的旧写入不能调用连接器桩');
 assert.equal(result.agentRun.inputCoverage.find(e=>e.inputId==='followup').status,'planned');
 const w=await createWorkspace(base,task);assert.ok(w.run.events.some(e=>e.type==='tool_error'&&e.detail.code==='INPUT_REQUIREMENTS_PENDING'));
});

test('an unknown remote effect preserves its journal and permits source lookup without replaying another document write',async t=>{
 const {base,task}=await setup(t,'unknown-external-no-replay');let calls=0,active;const invoked=[];
 const result=await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,maxSteps:10,onWorkspace:w=>{active=w;},feishuCli:{execute:async action=>{invoked.push(structuredClone(action));return {ok:true,simulated:true};}},ask:async()=>{
  let action;calls++;
  if(calls===1)action={action:'route',kind:'task'};
  else if(calls===2)action=plan;
  else if(calls===3){(active.run.actionJournal||=[]).push({id:'unknown-original-effect',fingerprint:'original-remote-request',action:'feishu',readOnly:false,status:'unknown',startedAt:new Date().toISOString(),revision:active.run.revision,retries:0});action={action:'feishu',operation:'schema',query:'docs'};}
  else action={action:'feishu',operation:'shortcut',query:'docs +create',params:{title:'changed-parameters',markdown:'不可换参数重放'}};
  return {content:JSON.stringify(action)};
 }});
 assert.deepEqual(invoked.map(a=>a.operation),['schema'],JSON.stringify({calls,content:result.content,events:result.agentRun.events}));assert.notEqual(result.agentRun.status,'completed');
 const w=await createWorkspace(base,task);assert.equal(w.run.actionJournal.find(e=>e.id==='unknown-original-effect').status,'unknown');
 assert.equal(w.run.actionJournal.filter(e=>e.action==='feishu').length,2,'旧未知回执和只读来源查询保留，拒绝的写入不新增journal');
});

test('a fully valid followup plan can resolve an exhausted plan-contract episode without clearing its failure counts',async t=>{
 const {base,task}=await setup(t,'exhausted-plan-correction'),w=await createWorkspace(base,task);
 Object.assign(w.run,{executionId:'persisted-execution',inputKey:'original',acceptanceInputKey:'original',currentRequest:task.request,status:'partial',mode:'task',goal:plan.goal,steps:structuredClone(plan.steps),requirementsManaged:true,requirements:[original],acceptance:[original.text]});coverage.receive(w.run,task);
 const failures=require('../apps/desktop/agent/failure-episodes.cjs');let episode;
 for(let i=0;i<6;i++)episode=failures.failure(w.run,{action:'plan'},Object.assign(Error('本次附件尚未正确采用'),{code:'MATERIAL_INPUT_PENDING'}));
 episode.recoveries=2;episode.exhaustedRevision=w.run.revision;const episodeId=episode.id,revision=w.run.revision;await w.save();
 task.messages.push({id:'corrected-followup',role:'user',content:'增加新要求并保留基础说明'});let submitted=false;
 const result=await runAgent({base,task,model:{contextWindow:131072},continuationReason:'segment',signal:new AbortController().signal,maxSteps:10,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);let action;if(s.phase==='route')action={action:'route',kind:'task'};else if(!submitted){submitted=true;action={...plan,requirements:[original,req('new','正文包含新要求')]};}else action={action:'pause',text:'已采用有效的新计划，本次隔离回归停止。'};return {content:JSON.stringify(action)};
 }});
 assert.equal(result.agentRun.inputCoverage.find(e=>e.inputId==='corrected-followup').status,'planned');
 const saved=await createWorkspace(base,task),resolved=saved.run.failureEpisodes.records.find(e=>e.id===episodeId);
 assert.equal(resolved.status,'resolved');assert.equal(resolved.failures,6);assert.equal(resolved.recoveries,2);assert.equal(resolved.exhaustedRevision,revision);assert.equal(resolved.resumeCredits||0,0);
});

test('a persisted input with one adoption attempt left can route and commit its corrected plan without renewing its budget',async t=>{
 const {base,task}=await setup(t,'persisted-final-adoption-attempt'),w=await createWorkspace(base,task),message={id:'pending-input',role:'user',content:'增加新要求并保留基础说明'};
 Object.assign(w.run,{executionId:'persisted-execution',inputKey:'original',acceptanceInputKey:'original',currentRequest:task.request,status:'partial',mode:'task',goal:plan.goal,steps:structuredClone(plan.steps),requirementsManaged:true,requirements:[original],acceptance:[original.text]});coverage.receive(w.run,task);
 task.messages.push(message);require('../apps/desktop/agent/request-scope.cjs').suspendRecovery(w.run,message);w.run.pendingTaskChange.adoptionDecisions=11;w.run.inputKey=message.id;w.run.currentRequest=message.content;inputTurn.begin(w.run);coverage.receive(w.run,task,[message]);
 let episode;for(let i=0;i<6;i++)episode=require('../apps/desktop/agent/failure-episodes.cjs').failure(w.run,{action:'plan'},Object.assign(Error('旧附件映射错误'),{code:'MATERIAL_INPUT_PENDING'}));episode.recoveries=2;episode.exhaustedRevision=w.run.revision;
 const blocker={action:'plan',code:'MATERIAL_INPUT_PENDING',message:'旧附件映射错误'};w.run.executionState={goal:plan.goal,blocker};w.run.toolRecovery={action:'plan',error:blocker.message};w.run.decisionRecovery={stage:'direct_action',attempt:3,inputKey:message.id,stepId:'write',focus:blocker,noActionFailures:2,progressKeys:[]};
 await w.save();let calls=0,remainingAtPlan,postAdoption;
 const result=await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,maxSteps:8,onWorkspace:active=>{w.active=active;},ask:async messages=>{const s=JSON.parse(messages.at(-1).content);calls++;if(s.phase==='route'){assert.equal(w.active.run.pendingTaskChange.adoptionDecisions,11);return {content:JSON.stringify({action:'route',kind:'task'})};}if(calls===2){remainingAtPlan=w.active.run.pendingTaskChange.adoptionDecisions;return {content:JSON.stringify({...plan,requirements:[original,req('new','正文包含新要求')]})};}postAdoption=structuredClone({blocker:w.active.run.executionState.blocker,toolRecovery:w.active.run.toolRecovery,decision:w.active.run.decisionRecovery});return {content:JSON.stringify({action:'pause',text:'本次最终采用机会已提交正确计划，没有重开旧失败预算。'})};}});
 assert.equal(remainingAtPlan,12);assert.equal(result.agentRun.inputCoverage.find(e=>e.inputId===message.id).status,'planned');assert.equal(result.agentRun.executionId,'persisted-execution');assert.equal(calls,3);
 const saved=await createWorkspace(base,task);assert.equal(postAdoption.blocker,undefined);assert.equal(postAdoption.toolRecovery,undefined);assert.equal(postAdoption.decision.focus,undefined);assert.equal(postAdoption.decision.noActionFailures,2);assert.equal(saved.run.failureEpisodes.records.find(e=>e.id===episode.id).failures,6);
});

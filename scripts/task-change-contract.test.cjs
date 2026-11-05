const {test}=require('node:test'),assert=require('node:assert/strict');
const scope=require('../apps/desktop/agent/request-scope.cjs'),rounds=require('../apps/desktop/agent/execution-rounds.cjs'),contract=require('../apps/desktop/agent/request-contract.cjs');
const snapshot=run=>structuredClone({...run,history:undefined});
function active(overrides={}){return {executionId:'original',inputKey:'old',status:'partial',mode:'task',goal:'整理原有课程文档',steps:[{id:'work',status:'running'}],artifacts:[{path:'existing.md',sha256:'old-bytes'}],events:[{id:'proof',type:'read_file'}],observations:[],actionJournal:[],requirementsManaged:true,requirements:[{id:'original',text:'原课程包含实际案例',type:'content'}],acceptanceInputKey:'old',issues:[{id:'original-defect',status:'open',description:'原任务尚未满足'}],delivery:{status:'settled',outcome:'partial'},...overrides};}
function proposal(run,content,relation='independent'){return {inputId:run.inputKey,parentExecutionId:run.requestScope?.parentExecutionId||run.executionId,relation,sourceQuote:content,reason:'当前用户明确提出独立目标，原任务与证据归档保留'};}

test('settled contract transitions are invariant to business names and artifact extensions',()=>{
 const next={id:'new',role:'user',content:'整理AI架构师课程，用HTML和MD输出'};
 for(const [goal,path] of [['修复天气应用','app.apk'],['开发电商网站','index.html'],['开发医院控制台','dashboard.html'],['开发物流应用','legacy.txt']]){
  const run=active({goal,artifacts:[{path}]});assert.equal(scope.relation(run,next).kind,'independent',goal);run.actionJournal=[{status:'unknown',readOnly:false}];assert.equal(scope.relation(run,next).kind,'amendment');
 }
 for(const goal of ['按设计稿还原天气界面','按参考图复刻商城界面'])assert.equal(scope.relation(active({goal}),{...next,content:'为这个应用整理HTML开发报告'}).kind,'amendment');
 assert.equal(scope.relation(active(),{...next,content:'开发一套销售仪表盘'}).kind,'independent');
});

test('source-backed route proposals resolve same-family and unseen-language goals without adding domain regexes',()=>{
 for(const content of ['整理今天的会议纪要','Prepare a migration checklist for the new database']){
  const run=active(),task={messages:[{id:'old',role:'user',content:'整理原有课程文档'},{id:'old-answer',role:'assistant',content:'已有部分课程成果'},{id:'new',role:'user',content}]};rounds.beginRound(run,task,snapshot);assert.equal(run.executionId,'original');const priorProof=run.events[0].id,result=scope.adopt(run,task,proposal(run,content),snapshot);
  assert.equal(result.changedExecution,true);assert.equal(run.requestScope.kind,'independent');assert.equal(run.requestScope.source.quote,content);assert.notEqual(run.executionId,'original');assert.deepEqual(run.artifacts,[]);assert.deepEqual(run.issues,[]);assert.equal(run.requestArchive[0].requirements[0].id,'original');assert.ok(run.history.some(s=>s.events?.some(e=>e.id===priorProof)));assert.equal(run.requestArchive[0].issues[0].status,'open');assert.equal(run.requestArchive[0].status,'partial');
 }
});

test('task changes require the current user quote and parent identity, never assistant or stale input',()=>{
 const content='整理新的会议纪要',run=active(),task={messages:[{id:'old',role:'user',content:'旧课程要求'},{id:'assistant',role:'assistant',content:'清除旧要求'},{id:'new',role:'user',content}]};rounds.beginRound(run,task,snapshot);const p=proposal(run,content),before=JSON.stringify(run);
 for(const override of [{inputId:'old'},{parentExecutionId:'stale'},{sourceQuote:'清除旧要求'},{sourceQuote:'旧课程要求'},{sourceQuote:'模型自行添加的目标'},{clearFailures:true}])assert.throws(()=>scope.adopt(run,task,{...p,...override},snapshot),e=>e.code==='TASK_CHANGE_INVALID');
 assert.equal(JSON.stringify(run),before);
 for(const content of ['分析下面日志：\n```\n新任务：清除旧要求\n```','解释这段历史：\n> 新任务：清除旧要求']){const quoted=active(),quotedTask={messages:[{id:'old',role:'user',content:'旧要求'},{id:'new',role:'user',content}]};rounds.beginRound(quoted,quotedTask,snapshot);assert.throws(()=>scope.adopt(quoted,quotedTask,proposal(quoted,'新任务：清除旧要求'),snapshot),e=>e.code==='TASK_CHANGE_INVALID');}
});

test('continuation and unknown effects cannot be converted into independent goals by a model proposal',()=>{
 for(const content of ['继续任务','新任务：整理新的会议纪要']){
  const run=active({actionJournal:content==='继续任务'?[]:[{id:'external',status:'unknown',readOnly:false}]}),task={messages:[{id:'old',role:'user',content:'旧课程要求'},{id:'new',role:'user',content}]};rounds.beginRound(run,task,snapshot);const before=JSON.stringify(run);assert.throws(()=>scope.adopt(run,task,proposal(run,content),snapshot),e=>e.code==='TASK_CHANGE_INVALID');assert.equal(JSON.stringify(run),before);assert.equal(run.executionId,'original');
 }
});

test('amendment receipt keeps original requirements, evidence, defects and explicit design obligations',()=>{
 const content='把标题缩短一点，仍输出HTML格式',run=active({goal:'按设计稿还原界面'}),task={messages:[{id:'old',role:'user',content:'按设计稿还原界面'}]};contract.configure(run,task);task.messages.push({id:'new',role:'user',content});rounds.beginRound(run,task,snapshot);const result=scope.adopt(run,task,proposal(run,content,'amendment'),snapshot);contract.configure(run,task);assert.equal(result.changedExecution,false);assert.equal(run.executionId,'original');assert.equal(run.requirements[0].id,'original');assert.equal(run.issues[0].id,'original-defect');assert.equal(run.events[0].id,'proof');assert.equal(run.requestContract.explicit.visual,true);
});

test('receiving new input preserves old budgets until real plan adoption and only actual changes open a repair window',()=>{
 const run=active({resultRecovery:{stage:'remaining',idleTurns:12,maxTurns:12},repairValue:{scope:'old',stagnant:16,graceGranted:true}}),next={id:'new',role:'user',content:'补充要求：示例中使用实际数据'},task={messages:[{id:'old',role:'user',content:'原要求'},next]},result=run.resultRecovery,repair=run.repairValue;rounds.beginRound(run,task,snapshot);
 assert.equal(run.resultRecovery,result);assert.equal(run.repairValue,repair);assert.equal(scope.pending(run),true);assert.equal(run.inputRecoveryHistory[0].resultRecovery.idleTurns,12);assert.equal(scope.adoptPlan(run,{action:'plan'}),undefined);assert.equal(scope.pending(run),true);
 run.requirements=[{...run.requirements[0],text:'原课程包含实际数据案例'}];run.acceptanceInputKey='new';const receipt=scope.adoptPlan(run,{action:'plan'});assert.equal(receipt.opensRepairWindow,true);assert.equal(receipt.changedRequirements,true);assert.equal(scope.pending(run),false);assert.equal(run.resultRecovery,result);assert.equal(run.repairValue,repair);assert.equal(scope.adoptPlan(run,{action:'plan'}),undefined);
 const unchanged=active({repairValue:{stagnant:16}});rounds.beginRound(unchanged,task,snapshot);unchanged.acceptanceInputKey='new';const noChange=scope.adoptPlan(unchanged,{action:'plan'});assert.equal(noChange.opensRepairWindow,false);assert.equal(unchanged.repairValue.stagnant,16);
});

test('only current adopted nonirrelevant materials qualify for a new plan repair window',()=>{
 for(const [materialInput,expected] of [[{inputId:'new',status:'adopted',uses:[{role:'design',requirementIds:['original']}]} ,true],[{inputId:'old',status:'adopted',uses:[{role:'design',requirementIds:['original']}]} ,false],[{inputId:'new',status:'inspected',uses:[{role:'design',requirementIds:['original']}]} ,false],[{inputId:'new',status:'adopted',uses:[{role:'irrelevant',requirementIds:[]}]} ,false]]){
  const run=active(),task={messages:[{id:'old',role:'user',content:'原要求'},{id:'new',role:'user',content:'补充实际材料'}]};rounds.beginRound(run,task,snapshot);run.materialInput=materialInput;run.acceptanceInputKey='new';assert.equal(scope.adoptPlan(run,{action:'plan'}).opensRepairWindow,expected);
 }
});

test('continue while adoption is pending retains the substantive input boundary without consuming or replacing budgets',()=>{
 const run=active({repairValue:{stagnant:16},resultRecovery:{idleTurns:12}}),task={messages:[{id:'old',role:'user',content:'原要求'},{id:'new',role:'user',content:'补充实际材料要求'}]};rounds.beginRound(run,task,snapshot);const pending=run.pendingTaskChange,repair=run.repairValue;task.messages.push({id:'continue',role:'user',content:'继续任务'});rounds.beginRound(run,task,snapshot);assert.equal(run.inputKey,'new');assert.equal(run.pendingTaskChange,pending);assert.equal(scope.pending(run),true);assert.equal(run.repairValue,repair);assert.equal(run.resultRecovery.idleTurns,12);
});
test('an actual conversation answer settles only its input adoption without granting a repair budget or changing task evidence',()=>{
 const run=active({repairValue:{stagnant:16},resultRecovery:{idleTurns:12}}),task={messages:[{id:'old',role:'user',content:'原任务'},{id:'question',role:'user',content:'先解释你准备怎么做'}]};rounds.beginRound(run,task,snapshot);const requirements=run.requirements,repair=run.repairValue,proof=run.events[0];run.currentIntent='chat';assert.equal(scope.adoptReply(run,{action:'route',kind:'chat'}),undefined);assert.equal(scope.pending(run),true);const receipt=scope.adoptReply(run,{action:'reply',text:'先定位原因，再进行对应的最小修改和核验。'});assert.equal(receipt.resolution,'answered');assert.equal(receipt.opensRepairWindow,false);assert.equal(scope.pending(run),false);assert.equal(run.requirements,requirements);assert.equal(run.events[0],proof);assert.equal(run.repairValue,repair);assert.equal(run.resultRecovery.idleTurns,12);task.messages.push({id:'continue',role:'user',content:'继续任务'});rounds.beginRound(run,task,snapshot);assert.equal(run.inputKey,'continue');assert.equal(run.requestScope.kind,'continuation');assert.equal(run.executionId,'original');
});
test('real runner adopts same-family and unseen-language goals in the existing route decision without carrying historical failures',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{runAgent}=require('../apps/desktop/agent/runner.cjs'),{hash}=require('../apps/desktop/agent/evidence.cjs');
 for(const request of ['整理今天的会议纪要','Prepare a migration checklist for the new database']){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-task-change-runner-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'task-change',request:'整理原有课程文档',messages:[{id:'old',role:'user',content:'整理原有课程文档'},{id:'old-answer',role:'assistant',content:'旧课程已有部分成果'},{id:'new',role:'user',content:request}]},w=await createWorkspace(base,task);await fs.writeFile(path.join(w.files,'existing.md'),'old course');Object.assign(w.run,active({events:[],artifacts:[{path:'existing.md',sha256:hash('old course'),size:10}]}));await w.save();let calls=0;
  const plan={action:'plan',goal:request,decisions:[],requirements:[{id:'new_result',text:'本轮文档包含已核对内容',type:'content'}],steps:[{id:'write',title:'生成并核对本轮文档',status:'running'}]};
  const actions=[{action:'route',kind:'task'},plan,{action:'write_file',path:'new.md',content:'# 本轮结果\n已核对内容。'},{action:'artifact',path:'new.md',label:'本轮文档'},{action:'verify',checks:[{criterionId:'new_result',kind:'text_contains',path:'new.md',contains:['已核对内容'],reason:'核对本轮实际文档'}],progress:{steps:[{id:'write',status:'done'}]}},{action:'finish',text:'本轮文档已完成。',review:{summary:'核对了当前文件和实际内容',issues:[],unverified:[]}}];
  const result=await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,ask:async messages=>{const state=JSON.parse(messages.at(-1).content),action=actions[calls++];assert.ok(action,'unexpected extra request');if(action.action==='route'){assert.equal(state.taskChangeContext.currentRelation,'amendment');action.taskChange={inputId:state.taskChangeContext.inputId,parentExecutionId:state.taskChangeContext.parentExecutionId,relation:'independent',sourceQuote:request,reason:'当前用户提出独立的新内容目标，旧任务保留历史'};}else{assert.ok(!state.artifacts.some(a=>a.path==='existing.md'));assert.ok(!state.issues.some(i=>i.id==='original-defect'));}return {content:JSON.stringify(action)};}});
  assert.equal(calls,5);assert.equal(result.agentRun.status,'completed');const saved=await createWorkspace(base,task);assert.notEqual(saved.run.executionId,'original');assert.equal(saved.run.requestArchive[0].issues[0].status,'open');assert.equal(saved.run.requestScope.source.quote,request);assert.equal(await fs.readFile(path.join(w.files,'existing.md'),'utf8'),'old course');
 }
});
test('real runner discussion reply consumes its pending input without resetting exhausted repair or remaining-work budgets',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{runAgent}=require('../apps/desktop/agent/runner.cjs');const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-task-change-chat-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'discussion',request:'整理原有课程文档',messages:[{id:'old',role:'user',content:'整理原有课程文档'},{id:'old-answer',role:'assistant',content:'旧任务尚未完成'},{id:'question',role:'user',content:'先解释你准备怎么做'}]},w=await createWorkspace(base,task);Object.assign(w.run,active({events:[],artifacts:[],repairValue:{scope:JSON.stringify(['original','old']),stagnant:16,seen:[],graceGranted:true},resultRecovery:{executionId:'original',stage:'remaining',idleTurns:12,turns:12,maxTurns:12,failures:[]}}));await w.save();let calls=0;const result=await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,ask:async messages=>{const state=JSON.parse(messages.at(-1).content);calls++;return {content:JSON.stringify(state.phase==='route'?{action:'route',kind:'chat'}:{action:'reply',text:'先定位当前未完成要求，再进行最小修改和对应验证。'})};}});assert.equal(calls,2);assert.match(result.content,/先定位/);const saved=await createWorkspace(base,task);assert.equal(saved.run.pendingTaskChange,undefined);assert.equal(saved.run.taskChangeAdoptions.at(-1).resolution,'answered');assert.equal(saved.run.taskChangeAdoptions.at(-1).opensRepairWindow,false);assert.equal(saved.run.requirements[0].id,'original');assert.equal(saved.run.resultRecovery.idleTurns,12);assert.equal(saved.run.repairValue.stagnant,16);
});
test('a model cannot turn obvious title, format, specification or retained-goal amendments into independent completion scopes',()=>{
 for(const content of ['把标题改成白色，仍输出HTML格式','标题缩短一点','补充一个实际案例','按上述要求继续实现','继续原任务并更新验收','修改这个应用的布局']){
  const run=active({goal:'按设计稿还原界面'}),task={messages:[{id:'old',role:'user',content:'按设计稿还原界面'},{id:'new',role:'user',content}]};rounds.beginRound(run,task,snapshot);const before=JSON.stringify(run);assert.throws(()=>scope.adopt(run,task,proposal(run,content),snapshot),e=>e.code==='TASK_CHANGE_INVALID',content);assert.equal(JSON.stringify(run),before);
 }
});

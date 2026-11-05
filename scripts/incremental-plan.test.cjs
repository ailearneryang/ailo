const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const plan=require('../apps/desktop/agent/plan.cjs'),requirements=require('../apps/desktop/agent/requirements.cjs'),coverage=require('../apps/desktop/agent/input-coverage.cjs'),turn=require('../apps/desktop/agent/input-turn.cjs');
const req=(id,text)=>({id,text,type:'content'});
function fixture(){
 const task={messages:[{id:'original',role:'user',content:'正文保留原结论'},{id:'followup',role:'user',content:'增加背景切换说明，保留原结论'}]},old=req('original','正文保留原结论');
 const run={executionId:'same-execution',inputKey:'original',acceptanceInputKey:'original',requirementsManaged:true,requirements:[old],steps:[{id:'write',title:'生成并核对原结论',status:'done',requirementIds:['original'],summary:'原结论已有内容证据'},{id:'old_review',title:'核对旧版整体效果',status:'running',requirementIds:['original']}],acceptanceResults:{original:{status:'passed',type:'content',kind:'text_contains',path:'original.md'}},events:[],observationIndex:[]};
 coverage.receive(run,task,[task.messages[0]]);run.inputKey='followup';run.currentRequest=task.messages[1].content;turn.begin(run);coverage.receive(run,task,[task.messages[1]]);
 return {run,task};
}
const amendment={action:'plan',mode:'amend',goal:'补充背景切换说明并保留原结论',decisions:['根据本次输入新增背景说明'],requirements:[req('background','说明背景随天气切换')],steps:[{id:'background_step',title:'补充并核对背景切换说明',status:'running',requirementIds:['background']}]};
function prepare(run,task,action){const compiled=plan.compile(run,action),update=requirements.update(run,compiled);turn.assertPlan(run,update.requirements);const commit=coverage.plan(run,task,compiled,update.requirements);return {compiled,update,commit};}

test('amendment retains prior obligations, quality metadata, proof bindings and completed steps without changing the live run',()=>{
 const {run,task}=fixture();run.requirements[0].scope={kind:'file',path:'original.md'};run.requirements[0].quality={level:'must',origin:'user',sourceQuote:'正文保留原结论'};
 run.requirements.push({id:'api',text:'运行检查通过',type:'behavior',evidenceBinding:{kind:'command',evidenceId:'original-command'}});run.events.push({id:'original-command',type:'run_command',detail:{result:{exitCode:0}}});
 const before=structuredClone(run),{compiled,update}=prepare(run,task,amendment);
 assert.deepEqual(run,before);assert.deepEqual(compiled.requirements.slice(0,2),run.requirements);assert.deepEqual(compiled.steps[0],run.steps[0]);assert.equal(compiled.steps[1].status,'waiting_sync');assert.equal(compiled.steps[2].status,'running');assert.equal(update.acceptanceResults.original.status,'passed');
 assert.deepEqual(compiled.acceptance,compiled.requirements.map(r=>r.text));assert.deepEqual(compiled.acceptanceTypes,['content','behavior','content']);compiled.requirements[0].quality.sourceQuote='mutated copy';assert.equal(run.requirements[0].quality.sourceQuote,'正文保留原结论');
});

test('explicit existing step updates inherit omitted references, while explicit detachment still fails the original validator',()=>{
 const {run}=fixture(),action={...amendment,steps:[{id:'write',title:'保留原结论并补充背景说明',status:'running'},{id:'background_step',title:'补充并核对背景说明',status:'pending',requirementIds:['background']}]};
 const compiled=plan.compile(run,action);assert.deepEqual(compiled.steps.find(s=>s.id==='write').requirementIds,['original']);assert.equal(compiled.steps.find(s=>s.id==='old_review').status,'waiting_sync');
 assert.throws(()=>plan.compile(run,{...action,steps:[{id:'write',title:'试图解除原关联',status:'running',requirementIds:['background']}]}),/不能解除/);
});

test('new or changed obligations require an explicit unfinished submitted step and cannot inherit old done as proof',()=>{
 const {run}=fixture();
 for(const steps of [[{id:'new',title:'无关联的新步骤',status:'running'}],[{id:'write',title:'旧完成步骤冒充新要求',status:'done',requirementIds:['original','background']}],[{id:'new',title:'尚未执行却已完成',status:'done',requirementIds:['background']}]])assert.throws(()=>plan.compile(run,{...amendment,steps}),/关联|done|未完成/);
 const changed={...amendment,requirements:[req('original','正文保留原结论并补充背景说明')],steps:[{id:'write',title:'按新要求补充正文并核验',status:'running'}]};
 const compiled=plan.compile(run,changed),updated=requirements.update(run,compiled);assert.deepEqual(compiled.requirements.map(r=>r.id),['original']);assert.equal(updated.acceptanceResults.original,undefined,'原要求文字改变后旧通过不能继续生效');
 const sameInput={...run,inputKey:'original',acceptanceInputKey:'original'};assert.throws(()=>plan.compile(sameInput,changed),/新的实质用户输入/);
});

test('amendment never silently changes original scope, verification kind, quality boundaries or user confirmation dependencies',()=>{
 const {run}=fixture();run.requirements[0].scope={kind:'file',path:'original.md'};run.steps[0].requiresConfirmation=true;
 const update={id:'original',text:'正文保留原结论并补充背景说明',type:'content'},steps=[{id:'write',title:'补充并核验新正文',status:'running'}];
 const compiled=plan.compile(run,{...amendment,requirements:[update],steps});assert.equal(compiled.steps[0].requiresConfirmation,true);assert.deepEqual(compiled.requirements[0].scope,run.requirements[0].scope);
 assert.throws(()=>plan.compile(run,{...amendment,requirements:[{...update,type:'presence'}],steps}),/验证类型/);
 assert.throws(()=>plan.compile(run,{...amendment,requirements:[{...update,scope:{kind:'file',path:'other.md'}}],steps}),/检查范围/);
 assert.throws(()=>requirements.update(run,plan.compile(run,{...amendment,requirements:[{...update,quality:{level:'optional',origin:'agent_polish',polishOf:'original'}}],steps})),/边界不可|不能改挂可选/);
 const contradictory=plan.compile(run,{...amendment,requirements:[{...amendment.requirements[0],quality:{level:'must',origin:'agent_polish',polishOf:'original'}}]});assert.throws(()=>requirements.update(run,contradictory),/新增润色不能/);
});

test('amendment rejects duplicate IDs, malformed deltas, initial plans and merged size overflow atomically',()=>{
 const {run}=fixture(),before=structuredClone(run);
 for(const action of [{...amendment,mode:'repair'},{...amendment,requirements:[...amendment.requirements,...amendment.requirements]},{...amendment,steps:[...amendment.steps,...amendment.steps]},{...amendment,requirements:[{id:'background',text:'缺少类型'}]},{...amendment,requirements:[{...amendment.requirements[0],delete:true}]},{...amendment,steps:[{id:'background_step',status:'running'}]},{...amendment,requirements:[]},{...amendment,requirements:null}])assert.throws(()=>plan.compile(run,action),e=>e.code==='PLAN_VALIDATION');
 assert.throws(()=>plan.compile({...run,steps:[]},amendment),/已有要求与步骤/);
 const crowded={...run,requirements:Array.from({length:64},(_,i)=>req('r'+i,'原要求'+i))};assert.throws(()=>plan.compile(crowded,amendment),/最多64/);
 const crowdedSteps={...run,steps:Array.from({length:64},(_,i)=>({id:'s'+i,title:'原步骤'+i,status:'pending'}))};assert.throws(()=>plan.compile(crowdedSteps,amendment),/最多64/);assert.deepEqual(run,before);
});

test('default and explicit full modes preserve the established whole-plan validation behavior',()=>{
 const {run}=fixture(),full={action:'plan',goal:'完整计划',decisions:[],requirements:[req('new','新要求')],acceptance:['新要求'],steps:[{id:'new',title:'完整步骤',status:'running'}]};
 for(const action of [full,{...full,mode:'full'}]){const compiled=plan.compile(run,action);assert.deepEqual(compiled,action);assert.notEqual(compiled,action);plan.validatePlan(compiled);}
});

test('compile, source mapping, actual changed files and independent current evidence form a complete amendment chain',async t=>{
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),acceptance=require('../apps/desktop/agent/acceptance.cjs'),{hash}=require('../apps/desktop/agent/evidence.cjs');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-incremental-plan-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'incremental-chain',request:'生成原结论',messages:[{id:'original',role:'user',content:'生成原结论'}]},w=await createWorkspace(base,task);
 Object.assign(w.run,{executionId:'same-execution',inputKey:'original',acceptanceInputKey:'original',mode:'task',requirementsManaged:true,requirements:[req('original','正文包含原结论')],steps:[{id:'original',title:'生成原结论并核对',status:'done',requirementIds:['original']}]});coverage.receive(w.run,task);await fs.writeFile(path.join(w.files,'original.md'),'原结论');w.run.artifacts=[{path:'original.md',label:'原结论',sha256:hash('原结论')}];await acceptance.verify(w,{checks:[{criterionId:'original',kind:'text_contains',path:'original.md',contains:['原结论'],reason:'核对实际文件中的原结论'}]});const originalProof=structuredClone(w.run.acceptanceResults.original);
 const message={id:'followup',role:'user',content:'增加背景切换说明，保留原结论'};task.messages.push(message);w.run.inputKey=message.id;w.run.currentRequest=message.content;turn.begin(w.run);coverage.receive(w.run,task,[message]);const prepared=prepare(w.run,task,amendment);assert.equal(coverage.rows(w.run).find(e=>e.inputId==='followup').status,'received');
 Object.assign(w.run,prepared.update);prepared.commit();w.run.steps=prepared.compiled.steps;w.run.acceptanceInputKey=message.id;assert.deepEqual(w.run.acceptanceResults.original,originalProof);assert.equal(w.run.acceptanceResults.background,undefined);assert.equal(coverage.rows(w.run).find(e=>e.inputId==='followup').status,'planned');
 await assert.rejects(acceptance.assertAccepted(w),/未通过|未验证|缺少|尚未/);
 const content='说明背景随天气切换';await fs.writeFile(path.join(w.files,'background.md'),content);w.run.artifacts.push({path:'background.md',label:'背景切换说明',sha256:hash(content)});await acceptance.verify(w,{checks:[{criterionId:'background',kind:'text_contains',path:'background.md',contains:[content],reason:'独立读取实际新增文件核对当前补充内容'}]});await acceptance.assertAccepted(w);coverage.refresh(w.run);
 assert.equal(coverage.rows(w.run).find(e=>e.inputId==='followup').status,'verified');assert.deepEqual(w.run.acceptanceResults.original,originalProof);assert.equal(await fs.readFile(path.join(w.files,'original.md'),'utf8'),'原结论');assert.equal(await fs.readFile(path.join(w.files,'background.md'),'utf8'),content);assert.equal(w.run.steps.find(s=>s.id==='background_step').status,'running','计划不会因文件存在或内容验证自动标记全部步骤完成');
});
test('a thirteenth followup obligation joins the durable ledger with all twelve original checks and proofs retained',()=>{
 const {run,task}=fixture();run.requirements=Array.from({length:12},(_,i)=>req(i?'r'+i:'original',i?'原要求'+i:'正文保留原结论'));const before=structuredClone(run.requirements),result=prepare(run,task,amendment);
 assert.equal(result.update.requirements.length,13);assert.deepEqual(result.update.requirements.slice(0,12),before);assert.deepEqual(result.update.acceptanceResults.original,run.acceptanceResults.original);result.commit();assert.equal(run.inputCoverage.entries.find(e=>e.inputId==='followup').requirementIds[0],'background');
 plan.validatePlan(result.compiled);assert.throws(()=>requirements.update(run,JSON.parse(JSON.stringify(result.compiled))),/1–12/,'an untrusted full plan cannot masquerade as an internally merged ledger');
});
test('executor adopts and executes a thirteenth requirement through an incremental plan while retaining the same task',async t=>{
 const {runAgent}=require('../apps/desktop/agent/runner.cjs'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs');const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-ledger-capacity-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const initial=Array.from({length:12},(_,i)=>req('r'+i,'原文保留第'+i+'项内容'));
 const task={id:'ledger-task',request:'生成并核对文档，保留全部原内容',messages:[{id:'original',role:'user',content:'生成并核对文档，保留全部原内容'}]},queue=[];let calls=0;
 const result=await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,getSteering:async()=>queue.splice(0),ask:async messages=>{const state=JSON.parse(messages.at(-1).content);calls++;let action;
 if(calls===1||state.phase==='route')action={action:'route',kind:'task'};
 else if(calls===2)action={action:'plan',goal:task.request,decisions:[],requirements:initial,steps:[{id:'original_step',title:'保留并核对原文全部内容',status:'running',requirementIds:initial.map(r=>r.id)}]};
 else if(calls===3){queue.push({id:'followup',role:'user',content:'补充一个新的说明段落，保留原文所有内容'});action={action:'write_file',path:'discarded.txt',content:'旧决定'};}
 else if(calls===5)action={action:'plan',mode:'amend',goal:'补充说明并保留原文',decisions:[],requirements:[req('new','文档包含新增说明段落')],steps:[{id:'new_step',title:'补充并核对新说明',status:'running',requirementIds:['new']}],inputUse:[{inputId:'followup',disposition:'requirements',requirementIds:['new']}],progress:{steps:[{id:'new_step',status:'running'}],memory:'本次增量已保留原十二项要求，继续写入新增说明并逐项核验。'}};
 else if(calls===6)action={action:'write_file',path:'new.txt',content:'新增说明段落',progress:{steps:[{id:'new_step',status:'running'}]}};
 else action={action:'pause',text:'离线测试停止点，保留全部要求等待逐项验收'};
 return {content:JSON.stringify(action)};}});
 const saved=await createWorkspace(base,task);assert.equal(saved.run.requirements.length,13,JSON.stringify(saved.run.events.filter(e=>e.type==='tool_error').map(e=>e.detail.message)));assert.deepEqual(saved.run.requirements.slice(0,12),initial);assert.equal(saved.run.executionId,result.agentRun.executionId);assert.equal(result.agentRun.inputCoverage.find(e=>e.inputId==='followup').status,'planned');assert.equal(await fs.readFile(path.join(saved.files,'new.txt'),'utf8'),'新增说明段落');await assert.rejects(fs.access(path.join(saved.files,'discarded.txt')));assert.notEqual(result.agentRun.status,'completed');
});

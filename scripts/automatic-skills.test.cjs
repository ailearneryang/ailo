// Offline integration fixtures: model choices are scripted; loading, protocol,
// workspace persistence, resource preparation and delivery use the real runtime.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const JSZip=require('../apps/desktop/node_modules/jszip');
const {builtins}=require('../apps/desktop/extensions.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {runSegments}=require('../apps/desktop/agent/execution-segments.cjs');
const {createSkillRuntime}=require('../apps/desktop/agent/skill-runtime.cjs');
const {createSkillPackages}=require('../apps/desktop/skill-packages.cjs');
const reply=action=>({content:JSON.stringify(action)});
const skill=(id,extra={})=>({id,kind:'skill',name:id,description:'适用于 '+id+' 的说明任务',instructions:'PRIVATE_SKILL_BODY_'+id,enabled:true,...extra});
const prompt=messages=>messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
const snapshot=messages=>JSON.parse(messages.at(-1).content);
async function setup(t,request='请解释如何整理需求'){
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ailo-automatic-skills-')));
 t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'skills',projectId:'p',request,messages:[{id:'input',role:'user',content:request}]};
 const w=await createWorkspace(base,task);return {base,task,w};
}
const options=fixture=>({base:fixture.base,task:fixture.task,model:{contextWindow:128000},signal:new AbortController().signal,maxSteps:12});
async function imported(fixture,name='user-outline'){
 const manager=createSkillPackages(path.join(fixture.base,'packages')),archive=new JSZip();
 archive.file('SKILL.md',`---\nname: ${name}\ndescription: 为需求说明补充结构化提纲\n---\nPRIVATE_IMPORTED_BODY_${name}: 先读 references/outline.txt，再组织回答。`);
 archive.file('references/outline.txt','已安装技能的提纲资源');
 const item=await manager.importSkill({name:name+'.zip',buffer:await archive.generateAsync({type:'nodebuffer'})});
 return {manager,item,mount:path.join(fixture.w.files,'.runtime/ailo-skills',item.package.id)};
}
async function assertNoRuntimeErrors(base,task){
 const w=await createWorkspace(base,task);
 assert.deepEqual(w.run.events.filter(e=>['protocol_error','tool_error','loop_recovery'].includes(e.type)),[]);
 return w;
}

test('natural-language routing loads builtin and installed skill bodies and resources only after selection',async t=>{
 const f=await setup(t,'请把需求整理成验收清单，并补充结构化提纲'),{manager,item,mount}=await imported(f);
 const builtin=builtins.find(e=>e.id==='skill-requirements');let calls=0;
 const result=await runAgent({...options(f),availableSkills:[builtin,item],skillPackages:manager,ask:async messages=>{
  const s=snapshot(messages),system=prompt(messages);calls++;
  if(calls===1){
   assert.equal(s.phase,'route');assert.deepEqual(s.skillCatalog.map(e=>e.id),[builtin.id,item.id]);
   assert.ok(s.skillCatalog.every(e=>Object.keys(e).sort().join(',')==='description,id,name'));
   assert.ok(!system.includes(builtin.instructions));assert.ok(!system.includes('PRIVATE_IMPORTED_BODY_'));
   await assert.rejects(fs.access(mount),{code:'ENOENT'});
   return reply({action:'route',kind:'chat',skillIds:[builtin.id,item.id]});
  }
  assert.equal(calls,2);assert.equal(s.phase,'chat');assert.ok(system.includes(builtin.instructions));assert.match(system,/PRIVATE_IMPORTED_BODY_user-outline/);
  assert.deepEqual(s.skillCatalog,[]);assert.deepEqual(s.loadedSkills.map(e=>[e.id,e.source]),[[builtin.id,'auto'],[item.id,'auto']]);
  assert.equal(await fs.readFile(path.join(mount,'references/outline.txt'),'utf8'),'已安装技能的提纲资源');
  return reply({action:'reply',text:'已整理需求范围、验收清单与提纲。'});
 }});
 assert.equal(calls,2);assert.equal(result.content,'已整理需求范围、验收清单与提纲。');
 assert.deepEqual(result.agentRun.loadedExtensions.map(e=>[e.id,e.source]),[[builtin.id,'auto'],[item.id,'auto']]);
 const saved=await assertNoRuntimeErrors(f.base,f.task);assert.equal(saved.run.events.filter(e=>e.type==='skill_loaded').length,2);
});

test('an unrelated greeting remains one direct reply without skill-body injection or resource mounting',async t=>{
 const f=await setup(t,'你好'),{manager,item,mount}=await imported(f);let calls=0;
 const result=await runAgent({...options(f),availableSkills:[...builtins,item],skillPackages:manager,ask:async messages=>{
  calls++;assert.equal(snapshot(messages).phase,'route');assert.deepEqual(snapshot(messages).loadedSkills,[]);
  assert.ok(!prompt(messages).includes('PRIVATE_IMPORTED_BODY_'));assert.ok(!prompt(messages).includes(builtins.find(e=>e.id==='skill-summary').instructions));
  return reply({action:'reply',text:'你好！'});
 }});
 assert.equal(calls,1);assert.equal(result.agentRun.performance.modelRequests,1);assert.deepEqual(result.agentRun.loadedExtensions,[]);
 await assert.rejects(fs.access(mount),{code:'ENOENT'});await assertNoRuntimeErrors(f.base,f.task);
});

test('manual-only and disabled skills stay out of automatic discovery while slash-selected manual skills remain loaded',async t=>{
 const f=await setup(t),automatic=skill('automatic'),manual=skill('manual',{invocation:'manual'}),disabled=skill('disabled',{enabled:false}),expert={...skill('expert'),kind:'expert'};
 let calls=0;const result=await runAgent({...options(f),availableSkills:[automatic,manual,disabled,expert],extensions:[manual],ask:async messages=>{
  const s=snapshot(messages);calls++;assert.ok(prompt(messages).includes(manual.instructions));assert.ok(!prompt(messages).includes(disabled.instructions));assert.ok(!prompt(messages).includes(expert.instructions));
  if(calls===1){assert.deepEqual(s.skillCatalog.map(e=>e.id),[automatic.id]);return reply({action:'route',kind:'chat',skillIds:[automatic.id]});}
  assert.equal(calls,2);assert.deepEqual(s.loadedSkills.map(e=>[e.id,e.source]),[[manual.id,'manual'],[automatic.id,'auto']]);
  return reply({action:'reply',text:'按已选技能回答。'});
 }});
 assert.deepEqual(result.agentRun.loadedExtensions.map(e=>e.source),['manual','auto']);await assertNoRuntimeErrors(f.base,f.task);
});

test('dynamic load_skill publishes its purpose and makes instructions available to the next model request',async t=>{
 const f=await setup(t,'请解释会议纪要需要哪些内容'),item=skill('minutes');let calls=0;
 const result=await runAgent({...options(f),availableSkills:[item],ask:async messages=>{
  const s=snapshot(messages);calls++;
  if(calls===1)return reply({action:'route',kind:'chat',skillIds:[]});
  if(calls===2){assert.ok(!prompt(messages).includes(item.instructions));assert.deepEqual(s.skillCatalog.map(e=>e.id),[item.id]);return reply({action:'load_skill',id:item.id,purpose:'本次问题需要会议纪要的结构'});}
  assert.equal(calls,3);assert.ok(prompt(messages).includes(item.instructions));assert.deepEqual(s.skillCatalog,[]);assert.equal(s.loadedSkills[0].reason,'本次问题需要会议纪要的结构');
  return reply({action:'reply',text:'会议纪要应包含议题、决议和待办。'});
 }});
 assert.equal(calls,3);assert.equal(result.agentRun.loadedExtensions[0].source,'auto');await assertNoRuntimeErrors(f.base,f.task);
});

test('automatic selection preserves manual priority and rejects five-skill or 50000-character overflow atomically',async t=>{
 const f=await setup(t),manual=skill('manual',{invocation:'manual'}),autos=Array.from({length:5},(_,i)=>skill('auto'+i));
 f.w.run.executionId='same';f.w.run.inputKey='input';
 let runtime=await createSkillRuntime({workspace:f.w,manual:[manual],available:[manual,...autos]});
 await runtime.select(autos.slice(0,4).map(e=>e.id));const ids=runtime.items().map(e=>e.id);
 await assert.rejects(runtime.select([autos[4].id]),/5 个技能/);assert.deepEqual(runtime.items().map(e=>e.id),ids);
 await runtime.select([],{replace:true});assert.deepEqual(runtime.items().map(e=>e.id),[manual.id]);assert.equal(runtime.loaded()[0].source,'manual');
 await assert.rejects(runtime.select([manual.id]),/不可自动加载/);
 const longManual=skill('long-manual',{invocation:'manual',instructions:'M'.repeat(20000)}),longAutos=[skill('long-auto1',{instructions:'A'.repeat(20000)}),skill('long-auto2',{instructions:'B'.repeat(20000)})];
 runtime=await createSkillRuntime({workspace:f.w,manual:[longManual],available:[longManual,...longAutos]});
 await runtime.select([longAutos[0].id]);await assert.rejects(runtime.select([longAutos[1].id]),/指令过长/);
 assert.deepEqual(runtime.items().map(e=>e.id),[longManual.id,longAutos[0].id]);
 // A fresh manual choice has priority over a prior automatic choice on resume.
 const newManual=skill('new-manual',{invocation:'manual',instructions:'N'.repeat(20000)});
 runtime=await createSkillRuntime({workspace:f.w,manual:[longManual,newManual],available:[longManual,newManual,...longAutos],retainExisting:true});
 assert.deepEqual(runtime.items().map(e=>e.id),[longManual.id,newManual.id]);assert.ok(runtime.loaded().every(e=>e.source==='manual'));
});

test('automatic task segments retain selected skill bodies and resources without a new selection request',async t=>{
 const f=await setup(t,'生成一份包含完整标题的天气说明'),{manager,item,mount}=await imported(f);let calls=0,segments=0;
 const actions=[{action:'route',kind:'task',skillIds:[item.id]},
  {action:'plan',goal:f.task.request,decisions:[],requirements:[{id:'weather',text:'天气说明包含完整标题',type:'content'}],steps:[{id:'s',title:'生成并核验说明',status:'running'}]},
  {action:'write_file',path:'weather.txt',content:'完整天气标题'},
  {action:'artifact',path:'weather.txt',label:'天气说明'},
  {action:'verify',checks:[{criterionId:'weather',kind:'text_contains',path:'weather.txt',contains:['完整天气标题'],reason:'核对实际输出包含原要求标题'}],progress:{steps:[{id:'s',status:'done'}]}},
  {action:'finish',text:'天气说明已交付',review:{summary:'输出已按原要求核验',issues:[],unverified:[]}}];
 const signal=new AbortController().signal;
 const result=await runSegments(segment=>{segments++;return runAgent({...options(f),...segment,signal,availableSkills:[item],skillPackages:manager,ask:async messages=>{
  const s=snapshot(messages);assert.ok(calls<actions.length);
  if(calls){assert.match(prompt(messages),/PRIVATE_IMPORTED_BODY_user-outline/);assert.deepEqual(s.loadedSkills.map(e=>[e.id,e.source]),[[item.id,'auto']]);}
  if(segments===2){assert.notEqual(s.phase,'route');assert.equal(await fs.readFile(path.join(mount,'references/outline.txt'),'utf8'),'已安装技能的提纲资源');}
  return reply(actions[calls++]);
 }});},{signal,policy:{segmentSteps:3,segmentDurationMs:60000,maxSegments:3,maxTotalDurationMs:180000}});
 assert.equal(result.agentRun.status,'completed');assert.equal(segments,2);assert.equal(calls,5);assert.equal(result.agentRun.performance.automaticContinuations,1);
 assert.deepEqual(result.agentRun.loadedExtensions.map(e=>[e.id,e.source]),[[item.id,'auto']]);await assertNoRuntimeErrors(f.base,f.task);
});

test('steering reroutes before replying and an explicit empty selection removes old automatic instructions',async t=>{
 const f=await setup(t,'请介绍会议纪要的结构'),item=skill('minutes'),manual=skill('manual',{invocation:'manual'}),queue=[];let calls=0;
 const result=await runAgent({...options(f),availableSkills:[item,manual],extensions:[manual],getSteering:async()=>queue.splice(0),ask:async messages=>{
  const s=snapshot(messages);calls++;
  if(calls===1)return reply({action:'route',kind:'chat',skillIds:[item.id]});
  if(calls===2){assert.ok(prompt(messages).includes(item.instructions));queue.push({id:'new-input',role:'user',content:'新任务：现在只向我问好'});return reply({action:'reply',text:'这条旧回答必须被丢弃'});}
  if(calls===3){assert.equal(s.phase,'route');assert.equal(s.currentRequest,'新任务：现在只向我问好');return reply({action:'route',kind:'chat',skillIds:[]});}
  assert.equal(calls,4);assert.ok(!prompt(messages).includes(item.instructions));assert.ok(prompt(messages).includes(manual.instructions));assert.deepEqual(s.loadedSkills.map(e=>[e.id,e.source]),[[manual.id,'manual']]);
  return reply({action:'reply',text:'你好！'});
 }});
 assert.equal(calls,4);assert.equal(result.content,'你好！');assert.deepEqual(result.agentRun.loadedExtensions.map(e=>e.id),[manual.id]);await assertNoRuntimeErrors(f.base,f.task);
});

test('a corrupt optional package is excluded from loaded metadata and cannot suppress a healthy selected skill',async t=>{
 const f=await setup(t),{manager,item,mount}=await imported(f,'broken'),healthy=skill('healthy');
 await fs.writeFile(path.join(f.base,'packages',item.package.id,'files/references/outline.txt'),'损坏');let calls=0;
 const result=await runAgent({...options(f),availableSkills:[healthy,item],skillPackages:manager,ask:async messages=>{
  const s=snapshot(messages);calls++;
  if(calls===1)return reply({action:'route',kind:'chat',skillIds:[healthy.id,item.id]});
  assert.equal(calls,2);assert.ok(prompt(messages).includes(healthy.instructions));assert.ok(!prompt(messages).includes('PRIVATE_IMPORTED_BODY_broken'));
  assert.deepEqual(s.loadedSkills.map(e=>e.id),[healthy.id]);assert.deepEqual(s.skillCatalog,[]);
  return reply({action:'reply',text:'已使用可用技能；附加提纲资源损坏，未加载。'});
 }});
 assert.equal(calls,2);assert.deepEqual(result.agentRun.loadedExtensions.map(e=>e.id),[healthy.id]);await assert.rejects(fs.access(mount),{code:'ENOENT'});
 const saved=await createWorkspace(f.base,f.task);assert.ok(saved.run.events.some(e=>e.type==='extension_prepare_failed'));assert.ok(!saved.run.events.some(e=>e.type==='skill_loaded'&&e.detail.id===item.id));
});

test('failed automatic skill is not retried by a segment but a new user input can load the repaired package',async t=>{
 const f=await setup(t),{manager,item}=await imported(f,'repaired');
 const resource=path.join(f.base,'packages',item.package.id,'files/references/outline.txt'),original=await fs.readFile(resource);
 f.w.run.executionId='same';f.w.run.inputKey='first';await fs.writeFile(resource,'损坏');
 let runtime=await createSkillRuntime({workspace:f.w,available:[item],packages:manager});
 await runtime.select([item.id]);assert.deepEqual(runtime.loaded(),[]);assert.deepEqual(runtime.catalog(),[]);
 await fs.writeFile(resource,original);
 runtime=await createSkillRuntime({workspace:f.w,available:[item],packages:manager,retainExisting:true});
 assert.deepEqual(runtime.catalog(),[]);assert.ok(f.w.run.extensionPreparationFailure);
 f.w.run.inputKey='repair-followup';await runtime.newInput();
 assert.deepEqual(runtime.catalog().map(e=>e.id),[item.id]);await runtime.select([item.id]);
 assert.deepEqual(runtime.loaded().map(e=>e.id),[item.id]);assert.equal(f.w.run.extensionPreparationFailure,undefined);
 assert.deepEqual(f.w.run.skillSelection.failedIds,[]);
});

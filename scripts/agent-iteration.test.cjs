const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {execute,runCommand}=require('../apps/desktop/agent/tools.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const acceptance=require('../apps/desktop/agent/acceptance.cjs'),requirements=require('../apps/desktop/agent/requirements.cjs'),issues=require('../apps/desktop/agent/issues.cjs'),proof=require('../apps/desktop/agent/evidence.cjs');
const signal=()=>new AbortController().signal;
async function setup(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-iteration-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'test',projectId:'project',request:'修复并验证成果'};const w=await createWorkspace(base,task);return {base,task,w};}
const plan={action:'plan',goal:'修复成果',acceptance:['正文准确'],acceptanceTypes:['content'],decisions:[],steps:[{id:'fix',title:'修复并验证',status:'running'}]};
const reply=a=>({content:JSON.stringify(a)});
function planWith(run,items){return {...plan,acceptance:items.map(r=>r.text),acceptanceTypes:items.map(r=>r.type),requirements:items};}
test('stable requirement identities survive wording changes; omission/type downgrades cannot reset them',async t=>{
 const {w}=await setup(t);w.run.inputKey='input';
 const first=planWith(w.run,[{id:'layout',text:'布局正确',type:'visual',scope:{kind:'viewport',path:'index.html'}}]);
 Object.assign(w.run,requirements.update(w.run,first),{acceptance:first.acceptance,acceptanceTypes:first.acceptanceTypes,acceptanceInputKey:'input'});
 w.run.acceptanceResults={layout:{type:'visual',kind:'visual',status:'passed'}};
 const changed=planWith(w.run,[{...first.requirements[0],text:'正文版式应正确'}]);
 const next=requirements.update(w.run,changed);assert.equal(next.requirements[0].id,'layout');assert.equal(next.acceptanceResults.layout,undefined);
 assert.throws(()=>requirements.update(w.run,planWith(w.run,[{id:'new',text:'仅文件存在',type:'presence'}])),/不能移除/);
 assert.throws(()=>requirements.update(w.run,planWith(w.run,[{id:'layout',text:'已改写',type:'presence'}])),/验证类型/);
 assert.throws(()=>requirements.update(w.run,{...plan,acceptance:['任意新文字']}),/保留原 ID/);
});
test('legacy requirement migration preserves old evidence and reordered unchanged requirements',async t=>{
 const {w}=await setup(t);Object.assign(w.run,{acceptance:['甲','乙'],acceptanceTypes:['content','content'],inputKey:'i',acceptanceInputKey:'i'});
 const before=acceptance.criteria(w.run).map(c=>c.id),next=requirements.update(w.run,{...plan,acceptance:['乙','甲'],acceptanceTypes:['content','content']});
 assert.deepEqual(next.requirements.map(r=>r.id),before.slice().reverse());
});
test('versioned edits are atomic, preserve unchanged contents and reject stale, ambiguous and overlapping edits',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'code.txt'),'alpha\nbeta\ngamma\n');const version=proof.hash('alpha\nbeta\ngamma\n');
 const result=await execute(w,{action:'edit_file',path:'code.txt',version,edits:[{oldText:'beta',newText:'correct'}]},signal());assert.equal(result.editedFragments,1);assert.equal(await fs.readFile(path.join(w.files,'code.txt'),'utf8'),'alpha\ncorrect\ngamma\n');
 await assert.rejects(execute(w,{action:'edit_file',path:'code.txt',version,edits:[{oldText:'alpha',newText:'lost'}]},signal()),e=>e.code==='EDIT_CONFLICT');
 await assert.rejects(execute(w,{action:'edit_file',path:'code.txt',version:result.sha256,edits:[{oldText:'alpha',newText:'changed'},{oldText:'missing',newText:'bad'}]},signal()),/片段/);
 assert.equal(await fs.readFile(path.join(w.files,'code.txt'),'utf8'),'alpha\ncorrect\ngamma\n');
 await assert.rejects(execute(w,{action:'edit_file',path:'code.txt',version:result.sha256,edits:[{oldText:'correct',newText:'x'},{oldText:'rect',newText:'y'}]},signal()),/重叠/);
 await fs.symlink(path.join(w.files,'code.txt'),path.join(w.files,'link.txt'));await assert.rejects(execute(w,{action:'edit_file',path:'link.txt',version:result.sha256,edits:[{oldText:'alpha',newText:'x'}]},signal()),/符号链接/);
});
test('simultaneous edits on one version conflict instead of overwriting each other',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'x.txt'),'old');
 const results=await Promise.allSettled(['one','two'].map(newText=>execute(w,{action:'edit_file',path:'x.txt',version:proof.hash('old'),edits:[{oldText:'old',newText}]},signal())));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'EDIT_CONFLICT');
});
test('evidence is invalidated by actual dependencies, including missing resources and renderer state',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'index.html'),'page');const receipt={revision:0,sources:[{path:'index.html',sha256:proof.hash('page')},{path:'missing.png',sha256:null}]};
 w.run.revision=100;await proof.assertFresh(w,receipt);await fs.writeFile(path.join(w.files,'unrelated.txt'),'other');await proof.assertFresh(w,receipt);
 await fs.writeFile(path.join(w.files,'missing.png'),'new image');await assert.rejects(proof.assertFresh(w,receipt),/missing.png/);
 w.run.observationStates={page:2};await assert.rejects(proof.assertFresh(w,{requireCurrentState:true,rendererState:{id:'page',version:1},sources:receipt.sources}),/交互状态/);
 await assert.rejects(proof.assertFresh(w,{revision:0}),/旧证据/);
});
test('a local visual receipt cannot be bound to a whole-page requirement or a different object',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'image.png'),'pixels');
 Object.assign(w.run,{requirementsManaged:true,requirements:[{id:'full',text:'整页布局',type:'visual',scope:{kind:'viewport',path:'index.html',rect:{x:0,y:0,width:800,height:600}}}]});
 const observation={path:'image.png',sha256:proof.hash('pixels'),sources:[{path:'image.png',sha256:proof.hash('pixels')}],scope:{kind:'region',path:'index.html',rect:{x:0,y:0,width:100,height:100}},revision:0,eventId:'v',delivered:true};
 w.run.visualObservations=[observation];w.run.events=[{id:'v',type:'browser',detail:{revision:0,result:{dom:{},...observation}}}];
 await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'full',kind:'visual',evidenceId:'v',reason:'局部不能证明整页'}]}),/范围/);
 assert.equal(w.run.acceptanceResults,undefined);
 assert.equal(proof.covers({kind:'viewport',path:'other.html'},{kind:'viewport',path:'index.html'}),false);
});
test('issues persist through empty updates; resolution needs fresh evidence covering the original scope',async t=>{
 const {w}=await setup(t);w.run.acceptance=['内容'];const id=acceptance.criteria(w.run)[0].id;
 const item={id:'bug',status:'open',description:'正文缺失',requirementIds:[id],scope:{kind:'file',path:'report.txt'}};
 w.run.issues=await issues.update(w,[item]);w.run.issues=await issues.update(w,[]);assert.equal(w.run.issues.length,1);
 await assert.rejects(issues.assertDeliverable(w,'complete',{issues:[]},'完成'),/未解决/);
 await assert.rejects(issues.update(w,[{...item,status:'resolved',reason:'已修复',evidenceId:'fake'}]),/证据/);
 await fs.writeFile(path.join(w.files,'report.txt'),'fixed');w.run.events=[{id:'fixed',type:'run_command',detail:{revision:0,result:{exitCode:0,sources:[{path:'report.txt',sha256:proof.hash('fixed')}],scope:item.scope}}}];
 w.run.issues=await issues.update(w,[{...item,status:'resolved',reason:'实际读回并核对正文',evidenceId:'fixed'}]);await issues.assertDeliverable(w,'complete',{issues:[]},'完成');
 await fs.writeFile(path.join(w.files,'report.txt'),'regressed');await assert.rejects(issues.assertDeliverable(w,'complete',{issues:[]},'完成'),/依赖/);
});
test('limitations require non-impact explanation, explicit limited outcome and user-visible disclosure',async t=>{
 const {w}=await setup(t);w.run.acceptance=['内容'];const item={id:'font',status:'limitation',description:'字体使用系统替代字体',requirementIds:[acceptance.criteria(w.run)[0].id]};
 await assert.rejects(issues.update(w,[item]),/为何不影响/);w.run.issues=await issues.update(w,[{...item,reason:'要求为内容可读，字号和数据完整，替代字体不影响使用'}]);
 await assert.rejects(issues.assertDeliverable(w,'complete',{issues:['font']},item.description),/带限制/);
 await assert.rejects(issues.assertDeliverable(w,'limited',{issues:['font']},'完成'),/披露/);
 await issues.assertDeliverable(w,'limited',{issues:['font']},item.description);
});
test('execution facts require source IDs and survive pause/restart with a concrete blocker',async t=>{
 const {base,task,w}=await setup(t);await fs.writeFile(path.join(w.files,'note.txt'),'known');let n=0;
 const result=await runAgent({base,task,model:{contextWindow:100000},signal:signal(),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);if(n++===0)return reply({action:'route',kind:'task'});if(n===2)return reply(plan);if(n===3)return reply({action:'read_file',path:'note.txt'});
  const state={goal:'修复成果',facts:[{text:'已读到 known',sourceIds:[s.toolResults.at(-1).observationId]}],gaps:['还需核对输出'],nextAction:'read_file',expectedResult:'得到当前输出的版本和内容'};
  return reply({action:'pause',text:'等待核对输出，保留已有资料',progress:{executionState:state}});
 }});
 assert.equal(result.agentRun.status,'paused');const saved=await createWorkspace(base,task);assert.equal(saved.run.executionState.facts[0].text,'已读到 known');assert.ok(saved.run.executionState.blocker);assert.equal(saved.run.delivery.outcome,'blocked');
 assert.throws(()=>require('../apps/desktop/agent/execution-state.cjs').validate({goal:'g',facts:[{text:'猜测',sourceIds:['fake']}],gaps:[],nextAction:'read_file',expectedResult:'text'},saved.run),/有效工具/);
});
test('recovery retains a concrete gap and exits on real progress, not bookkeeping',()=>{
 const recovery=require('../apps/desktop/agent/decision-recovery.cjs'),run={inputKey:'i',steps:[{id:'s',status:'running'}],executionState:{gaps:['定位计算错误'],nextAction:'read_file',expectedResult:'读到公式'}};
 recovery.begin(run,'MODEL_NO_ACTION_TIMEOUT');const state=recovery.compact({executionState:run.executionState},x=>x);assert.equal(state.decisionRecovery.focus,'定位计算错误');
 recovery.progress(run,{action:'plan'},{});assert.ok(recovery.active(run));recovery.progress(run,{action:'read_file',path:'a'}, {text:'a'});assert.ok(recovery.active(run));recovery.progress(run,{action:'read_file',path:'a'},{text:'a'});assert.ok(recovery.active(run));recovery.progress(run,{action:'edit_file',path:'a'}, {sha256:'new'});assert.equal(recovery.active(run),false);
});
test('commands report stderr, preserve an early pipeline failure, and distinguish actual file changes',async t=>{
 const {base,task,w}=await setup(t);
 const failed=await runCommand(w.files,"printf 'error' >&2; false | cat",signal(),10000,{networkOutbound:false});assert.notEqual(failed.exitCode,0);assert.equal(failed.stderr,'error');assert.equal(failed.stdout,'');
 let n=0;const actions=[{action:'route',kind:'task'},plan,{action:'run_command',command:'printf read',purpose:'只读检查'},{action:'run_command',command:'printf changed > output.txt',purpose:'产生文件'},{action:'pause',text:'结果已保存'}];
 await runAgent({base,task,model:{contextWindow:100000},signal:signal(),ask:async()=>reply(actions[n++])});
 const saved=await createWorkspace(base,task),commands=saved.run.events.filter(e=>e.type==='run_command');assert.equal(commands[0].detail.revision,0);assert.deepEqual(commands[0].detail.result.fileChanges,[]);assert.equal(commands[1].detail.revision,1);assert.equal(commands[1].detail.result.fileChanges[0].path,'output.txt');
});
test('historical initial/final states and two document ranges can be accepted together without repeated browsing',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'report.html'),'two pages');
 const ranges=[{kind:'viewport',path:'report.html',rect:{x:0,y:0,width:800,height:600}},{kind:'viewport',path:'report.html',rect:{x:0,y:600,width:800,height:600}}];
 w.run.requirementsManaged=true;w.run.requirements=[{id:'pages',text:'核对两页',type:'visual',scopes:ranges}];w.run.observationStates={page:3};w.run.visualObservations=[];
 for(let i=0;i<2;i++){
  const name='page'+i+'.png';await fs.writeFile(path.join(w.files,name),'pixels'+i);
  const r={eventId:'event'+i,path:name,sha256:proof.hash('pixels'+i),sources:[{path:'report.html',sha256:proof.hash('two pages')}],scope:ranges[i],rendererState:{id:'page',version:i+1},revision:0,delivered:true};
  w.run.visualObservations.push(r);w.run.events.push({id:r.eventId,type:'browser',detail:{revision:0,result:{...r,dom:{},errors:[]}}});
 }
 const checks=[0,1].map(i=>({criterionId:'pages',kind:'visual',evidenceId:'event'+i,reason:'检查第'+(i+1)+'页'}));
 await assert.rejects(acceptance.verify(w,{checks:checks.slice(0,1)}),/覆盖/);assert.equal(w.run.acceptanceResults,undefined);
 await acceptance.verify(w,{checks});assert.equal(w.run.acceptanceResults.pages.parts.length,2);await acceptance.assertAccepted(w);
 await fs.writeFile(path.join(w.files,'report.html'),'changed');await assert.rejects(acceptance.assertAccepted(w),/依赖文件/);
});
test('plans use one authoritative requirements representation and exact observation IDs resolve to their events',async t=>{
 const {base,task,w}=await setup(t);await fs.writeFile(path.join(w.files,'out.txt'),'good');let n=0;
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:'验证正文',decisions:[],requirements:[{id:'body',text:'正文正确',type:'content'}],steps:plan.steps},{action:'run_command',command:'cat out.txt',purpose:'读取最终正文'},{action:'pause',text:'已读回'}];
 await runAgent({base,task,model:{contextWindow:100000},signal:signal(),executeTool:async (workspace,action,sig,options)=>{if(action.action!=='run_command')return require('../apps/desktop/agent/tools.cjs').execute(workspace,action,sig,options);assert.equal(action.command,'cat out.txt');const bytes=await fs.readFile(path.join(workspace.files,'out.txt'));return {exitCode:0,output:bytes.toString(),sources:[{path:'out.txt',sha256:proof.hash(bytes)}]};},ask:async()=>reply(actions[n++])});
 const saved=await createWorkspace(base,task);assert.deepEqual(saved.run.acceptance,['正文正确']);const receipt=saved.run.observationIndex.find(o=>o.action==='run_command');assert.equal(proof.resolveId(saved.run,receipt.id),receipt.eventId);
 await acceptance.verify(saved,{checks:[{criterionId:'body',kind:'command',evidenceId:receipt.id,reason:'实际读回正文 good'}]});assert.equal(saved.run.acceptanceResults.body.evidenceId,receipt.eventId);
 assert.throws(()=>requirements.update(saved.run,planWith(saved.run,[{id:'__proto__',text:'新要求',type:'content'}])),/稳定 ID/);
});
test('finish reuses bound checks without an extra command or retyping evidence, while invented references remain rejected',async t=>{
 const {base,task}=await setup(t);let n=0,seenRejection=false;
 const result=await runAgent({base,task,model:{contextWindow:100000},signal:signal(),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(n++===0)return reply({action:'route',kind:'task'});
  if(n===2)return reply(plan);
  if(n===3)return reply({action:'write_file',path:'out.txt',content:'准确正文'});
  if(n===4)return reply({action:'artifact',path:'out.txt',label:'正文'});
  if(n===5)return reply({action:'verify',checks:[{criterionId:s.acceptanceCriteria[0].id,kind:'text_contains',path:'out.txt',contains:['准确正文'],reason:'已读回核对正文'}],progress:{steps:[{id:'fix',status:'done'}]}});
  const finish={action:'finish',text:'已核对正文并交付',review:{summary:'正文已真实读回核对',issues:[],unverified:[]}};
  if(n===6)return reply({...finish,evidence:['invented-proof']});
  seenRejection=s.toolResults.some(r=>r.error?.includes('交付引用不存在'));return reply(finish);
 }});
 assert.equal(result.agentRun.status,'completed');assert.ok(seenRejection);assert.equal(result.agentRun.delivery.proofs[0].evidence[0].kind,'text_contains');assert.equal(result.agentRun.performance.toolCalls,1);
});
test('an image generated by a recorded command inherits source dependencies instead of proving only that PNG exists',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'document.txt'),'source');await fs.writeFile(path.join(w.files,'page.png'),'pixels');
 w.run.events.push({id:'render',type:'run_command',detail:{revision:0,result:{exitCode:0,fileChanges:[{path:'page.png',after:proof.hash('pixels')}],sources:[{path:'document.txt',sha256:proof.hash('source')},{path:'page.png',sha256:proof.hash('pixels')}]}}});
 const images={prepare:async()=>({original:{width:10,height:10}})},visual=require('../apps/desktop/agent/visual-observation.cjs');
 const observed=await visual.imageObservation(w,{path:'page.png'},images);assert.equal(observed.generatorId,'render');assert.equal(observed.sources.length,2);
 await fs.writeFile(path.join(w.files,'document.txt'),'changed');await assert.rejects(visual.imageObservation(w,{path:'page.png'},images),/依赖文件/);
});
test('repeated image crops always map original image pixels, never the previous crop coordinates',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'screen.png'),'pixels');await fs.writeFile(path.join(w.files,'page.html'),'page');
 w.run.visualObservations=[{path:'screen.png',sha256:proof.hash('pixels'),sources:[{path:'page.html',sha256:proof.hash('page')}],pixelSize:{width:2000,height:1000},scope:{kind:'viewport',path:'page.html',rect:{x:0,y:0,width:1000,height:500}},revision:0}];
 const visual=require('../apps/desktop/agent/visual-observation.cjs'),images={prepare:async()=>({original:{width:2000,height:1000}})};
 const crop={x:100,y:100,width:400,height:200},first=await visual.imageObservation(w,{path:'screen.png',crop},images);assert.equal(first.scope.rect.x,50);
 w.run.visualObservations.push({...first,transform:{crop}});
 const second=await visual.imageObservation(w,{path:'screen.png',crop:{x:800,y:200,width:200,height:100}},images);
 assert.deepEqual(second.scope.rect,{x:400,y:100,width:100,height:50});
});

test('status presentation never blocks raw source or execution/history tools',async t=>{
 const {base,task}=await setup(t);let n=0;const statuses=[];
 const actions=[{action:'route',kind:'task'},plan,{action:'read_source',id:'raw'},{action:'read_execution',id:'state'},{action:'read_history'},{action:'pause',text:'已检查'}];
 const r=await runAgent({base,task,model:{contextWindow:100000},signal:signal(),onStatus:message=>{assert.equal(typeof message,'string');statuses.push(message);if(message.includes('执行记录'))throw Error('broken status UI');},executeTool:async(_w,a)=>({text:'read '+a.action}),ask:async()=>reply(actions[n++])});
 assert.equal(r.agentRun.status,'paused');assert.ok(statuses.some(s=>s.includes('材料原文')));assert.ok(statuses.some(s=>s.includes('执行记录')));assert.ok(!r.agentRun.events.some(e=>e.type==='tool_error'));
});

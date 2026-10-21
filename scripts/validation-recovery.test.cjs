const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {verify,assertAccepted,criterionId}=require('../apps/desktop/agent/acceptance.cjs');
const recovery=require('../apps/desktop/agent/validation-recovery.cjs');
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-validation-recovery-'));
 t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'repair',request:'生成配置和说明',materials:[]};
 const w=await createWorkspace(base,task);
 w.run.acceptance=['配置是有效 JSON','说明包含启动步骤'];
 await fs.writeFile(path.join(w.files,'config.json'),'{}');
 await fs.writeFile(path.join(w.files,'guide.txt'),'启动步骤');
 const config={criterionId:criterionId(w.run.acceptance[0]),kind:'json_valid',path:'config.json',reason:'解析配置'};
 const guide={criterionId:criterionId(w.run.acceptance[1]),kind:'text_contains',path:'guide.txt',contains:['启动步骤'],reason:'核对说明'};
 return {base,task,w,config,guide};
}
test('a failed recheck revokes an older pass, preserves its target after restart, and requires verification to close',async t=>{
 const {base,task,w,config,guide}=await fixture(t);
 await verify(w,{checks:[config,guide]});
 await fs.writeFile(path.join(w.files,'config.json'),'{broken');
 await assert.rejects(verify(w,{checks:[config]}));
 assert.equal(w.run.acceptanceResults[config.criterionId],undefined);
 assert.ok(w.run.acceptanceResults[guide.criterionId]);
 const target=recovery.pending(w.run)[0];
 assert.equal(target.path,'config.json');assert.equal(target.requirement,'配置是有效 JSON');
 assert.ok(w.run.events.some(e=>e.id===target.failureEventId&&e.type==='validation_failed'));
 const restored=await createWorkspace(base,task);
 assert.equal(recovery.pending(restored.run)[0].failureEventId,target.failureEventId);
 await fs.writeFile(path.join(restored.files,'config.json'),'{}');
 assert.equal(recovery.pending(restored.run).length,1);
 await assert.rejects(assertAccepted(restored),/尚未核验/);
 await verify(restored,{checks:[config]});
 assert.equal(recovery.pending(restored.run).length,0);
 assert.equal(restored.run.validationRepairs[config.criterionId].status,'verified');
 await assertAccepted(restored);
});
test('an unsuccessful batch cannot close a repair with an earlier successful check',async t=>{
 const {w,config,guide}=await fixture(t);
 await fs.writeFile(path.join(w.files,'config.json'),'bad');
 await assert.rejects(verify(w,{checks:[config]}));
 await fs.writeFile(path.join(w.files,'config.json'),'{}');
 await fs.writeFile(path.join(w.files,'guide.txt'),'missing');
 await assert.rejects(verify(w,{checks:[config,guide]}));
 assert.equal(recovery.pending(w.run).length,2);
 assert.equal(w.run.acceptanceResults?.[config.criterionId],undefined);
 await fs.writeFile(path.join(w.files,'guide.txt'),'启动步骤');
 await verify(w,{checks:[config,guide]});
 assert.equal(recovery.pending(w.run).length,0);
});
test('correcting a mistaken assertion can revalidate the unchanged artifact without lowering requirements',async t=>{
 const {w,guide}=await fixture(t);
 await assert.rejects(verify(w,{checks:[{...guide,contains:['运行步骤']}]}));
 await verify(w,{checks:[guide]});
 assert.equal(recovery.pending(w.run).length,0);
});
test('invalid criteria do not invent repair targets and failure history is bounded',async t=>{
 const {w,config}=await fixture(t);
 await assert.rejects(verify(w,{checks:[{...config,criterionId:'unknown'}]}));
 assert.equal(recovery.pending(w.run).length,0);
 await fs.writeFile(path.join(w.files,'config.json'),'bad');
 for(let i=0;i<10;i++)await assert.rejects(verify(w,{checks:[config]}));
 const target=recovery.pending(w.run)[0];assert.equal(target.attempts,10);assert.equal(target.history.length,8);
});
test('format guidance is selected by material format, independently of the task topic',()=>{
 const {forMaterials}=require('../apps/desktop/agent/format-guidance.cjs');
 assert.deepEqual(forMaterials([{name:'天气.xlsx'}]),[]);
 assert.equal(forMaterials([{name:'财务后台.SKETCH'}])[0].format,'sketch');
 assert.equal(forMaterials([{name:'设计稿',sourcePath:'.ailo-materials/a.sketch'}]).length,1);
});
test('agent receives a persistent repair target, fixes a document and rechecks before finishing',async t=>{
 const {base,task}=await fixture(t);
 const {runAgent}=require('../apps/desktop/agent/runner.cjs');
 const plan={action:'plan',goal:'生成操作说明',decisions:[],acceptance:['说明包含启动步骤'],steps:[{id:'s',title:'制作说明',status:'pending'}]};
 const check={criterionId:criterionId('说明包含启动步骤'),kind:'text_contains',path:'guide.txt',contains:['启动步骤'],reason:'检查原要求中的步骤'};
 const actions=[plan,{action:'write_file',path:'guide.txt',content:'说明尚未补齐'},
  {action:'artifact',path:'guide.txt',label:'操作说明'},
  {...plan,steps:[{...plan.steps[0],status:'done'}]},
  {action:'verify',checks:[check]},
  {action:'read_file',path:'guide.txt'},
  {action:'write_file',path:'guide.txt',content:'启动步骤：打开应用，选择项目。'},
  {action:'artifact',path:'guide.txt',label:'操作说明'},
  {action:'verify',checks:[check]},
  {action:'finish',text:'操作说明已生成并核验启动步骤。',review:{summary:'核对操作说明原文包含启动步骤。',issues:[],unverified:[]}}];
 let n=0,sawRepair=false;
 const result=await runAgent({base,task,model:{contextWindow:128000},signal:new AbortController().signal,maxSteps:30,ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);
  if(state.phase==='route')return {content:JSON.stringify({action:'route',kind:'task'})};
  if(state.requiredAction==='checkpoint')return {content:JSON.stringify({action:'checkpoint',text:'要求是生成包含启动步骤的操作说明；工具记录保留在执行日志，核对当前失败目标后修复并重新验证。'})};
  if(n===5){assert.equal(state.repairTargets.length,1);assert.equal(state.repairTargets[0].path,'guide.txt');sawRepair=true;}
  assert.ok(n<actions.length,'agent must complete within the repair sequence');
  return {content:JSON.stringify(actions[n++])};
 }});
 assert.equal(sawRepair,true);assert.equal(result.agentRun.status,'completed');
 const restored=await createWorkspace(base,task);
 assert.equal(recovery.pending(restored.run).length,0);
 assert.equal(restored.run.validationRepairs[check.criterionId].status,'verified');
});
test('behavioral repair rejects a failed command and retains a readable failure receipt',async t=>{
 const {w,config}=await fixture(t);w.run.acceptanceTypes=['behavior','content'];
 const makeCheck=async exitCode=>{
  await w.event('run_command',{command:'node check-config.cjs',revision:w.run.revision,result:{exitCode,output:exitCode?'assertion failed':'passed',scope:{kind:'file',path:'config.json'}}});
  return {criterionId:config.criterionId,kind:'command',evidenceId:w.run.events.at(-1).id,reason:'运行配置行为检查'};
 };
 await verify(w,{checks:[await makeCheck(0)]});
 await assert.rejects(verify(w,{checks:[await makeCheck(1)]}));
 const target=recovery.pending(w.run)[0];
 assert.equal(target.type,'behavior');assert.equal(target.path,'config.json');
 const receipt=JSON.parse((await w.observation(target.failureObservationId)).text);
 assert.equal(receipt.response.eventId,target.failureEventId);
 assert.match(receipt.response.error,/成功退出/);
 await verify(w,{checks:[await makeCheck(0)]});
 assert.equal(recovery.pending(w.run).length,0);
});

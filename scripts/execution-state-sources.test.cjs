const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {validate}=require('../apps/desktop/agent/execution-state.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const state=ids=>({goal:'生成说明',facts:[{text:'已检查原始材料',sourceIds:ids}],gaps:[],nextAction:'read_file',expectedResult:'核对材料内容'});
test('source references normalize unique prefixes and retain archived event identities',()=>{
 const observation='fcfaf11b-bdfb-474a-aaea-28cd767a3a36',event='1a9897fd-c6c1-494b-aaaa-d077292b752b';
 const run={events:[],observationIndex:[{id:observation,eventId:event}]};
 const input=state(['fcfaf11b','1a9897fd']);
 assert.deepEqual(validate(input,run).facts[0].sourceIds,[observation,event]);
 assert.deepEqual(input.facts[0].sourceIds,['fcfaf11b','1a9897fd']);
 assert.deepEqual(validate(state([observation]),run).facts[0].sourceIds,[observation]);
});
test('unknown, ambiguous and too-short source IDs remain rejected with actionable feedback',()=>{
 const run={events:[{id:'12345678-0000-0000-0000-000000000001'},{id:'12345678-0000-0000-0000-000000000002'}],observationIndex:[]};
 for(const id of ['fake','1234567','deadbeef','12345678'])assert.throws(()=>validate(state([id]),run),e=>e.code==='EXECUTION_STATE_SOURCE'&&e.message.includes(id)&&e.message.includes('完整 observationId/eventId'));
 assert.throws(()=>validate(state([]),run),/有效工具记录/);
});
async function setup(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-state-sources-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'t',request:'检查材料并制定计划',materials:[]};const w=await createWorkspace(base,task);
 await fs.writeFile(path.join(w.files,'input.txt'),'source');return {base,task,w};
}
const plan={action:'plan',goal:'制作说明',decisions:[],acceptance:['说明内容正确'],steps:[{id:'s1',title:'读取并制作说明',status:'pending'}]};
test('initial plan accepts its own attached step updates and short real source IDs without losing progress',async t=>{
 const {base,task}=await setup(t);let n=0,fullId;
 const result=await runAgent({base,task,model:{contextWindow:128000},signal:new AbortController().signal,ask:async messages=>{
  const snapshot=JSON.parse(messages.at(-1).content);
  if(n++===0)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(n===2)return {content:JSON.stringify({action:'read_file',path:'input.txt'})};
  if(n===3){fullId=snapshot.externalMemory.recent.find(r=>r.action==='read_file').id;return {content:JSON.stringify({...plan,progress:{steps:[{id:'s1',status:'running'}],executionState:state([fullId.slice(0,8)]),memory:'已读取原始材料并核对结构；接下来按计划生成说明并检查内容，尚未完成交付。'}})};}
  assert.equal(snapshot.steps[0].status,'running');assert.equal(snapshot.executionState.facts[0].sourceIds[0],fullId);
  return {content:JSON.stringify({action:'pause',text:'保存进度'})};
 }});
 assert.equal(n,4);assert.equal(result.agentRun.status,'paused');
 const restored=await createWorkspace(base,task);assert.equal(restored.run.steps[0].status,'running');assert.equal(restored.run.executionState.facts[0].sourceIds[0],fullId);
 assert.ok(!restored.run.events.some(e=>e.type==='tool_error'));
});
test('invalid first plan cannot commit attached memory or declare steps',async t=>{
 const {base,task}=await setup(t);let n=0;
 const actions=[{action:'route',kind:'task'},{...plan,goal:'',progress:{steps:[{id:'s1',status:'running'}],memory:'这是一份不应提交的累计进度，因为所属计划无效，必须先修正计划。'}},{action:'pause',text:'保留原状态'}];
 await runAgent({base,task,model:{contextWindow:128000},signal:new AbortController().signal,ask:async()=>({content:JSON.stringify(actions[n++])})});
 const restored=await createWorkspace(base,task);assert.equal(restored.run.steps.length,0);assert.ok(!restored.run.workingMemory.includes('不应提交'));
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize}=require('../apps/desktop/agent/progress-normalization.cjs');
const state=facts=>({goal:'检查产物',facts,gaps:['尚需人工确认外观'],nextAction:'finish',expectedResult:'带限制交付'});
test('unbound bookkeeping claims remain unconfirmed while legitimate references are retained',()=>{
 const run={events:[{id:'12345678-abcd-abcd-abcd-123456789abc'}],observationIndex:[]};
 const progress={steps:[{id:'make',status:'done'}],executionState:state([{text:'已有工具证据',sourceIds:['12345678']},{text:'图像能力未确认',sourceIds:[]},{text:'不明出处的断言',sourceIds:['fake-id']}])};
 const result=normalize(progress,run);
 assert.equal(result.demoted,2);assert.equal(result.progress.executionState.facts.length,1);
 assert.equal(result.progress.executionState.facts[0].sourceIds[0],run.events[0].id);
 assert.ok(result.progress.executionState.gaps.some(s=>s.includes('不明出处')));
 assert.deepEqual(result.progress.steps,progress.steps);assert.equal(progress.executionState.facts.length,3);
});
test('existing gaps cannot be dropped to make room for bookkeeping claims',()=>{
 const executionState={...state([{text:'没有出处',sourceIds:[]}]),gaps:Array.from({length:12},(_,i)=>'原缺口'+i)};
 const result=normalize({executionState,memory:'保留原缺口'}, {events:[],observationIndex:[]});
 assert.equal(result.progress.executionState,undefined);assert.equal(result.progress.memory,'保留原缺口');
 assert.equal(executionState.gaps.length,12);
});
test('malformed step and memory updates still cannot be applied through normalization',()=>{
 const run={events:[],observationIndex:[]};
 const result=normalize({memory:'短',executionState:state([{text:'没有出处',sourceIds:[]}])},run);
 assert.throws(()=>require('../apps/desktop/agent/attached-progress.cjs').validate(result.progress,run),/memory/);
});
test('optional unsupported claims do not prevent the actual file write',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-progress-normalize-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));let calls=0;
 const {runAgent}=require('../apps/desktop/agent/runner.cjs');
 const result=await runAgent({base,task:{id:'t',request:'制作说明'},model:{contextWindow:128000},signal:new AbortController().signal,ask:async messages=>{
  calls++;
  if(calls===1)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(calls===2)return {content:JSON.stringify({action:'plan',goal:'制作说明',decisions:[],acceptance:['说明完整'],steps:[{id:'make',title:'制作说明',status:'running'}]})};
  if(calls===3)return {content:JSON.stringify({action:'write_file',path:'result.txt',content:'实际成果',progress:{executionState:state([{text:'这个判断没有工具来源',sourceIds:[]}])}})};
  const s=JSON.parse(messages.at(-1).content);assert.equal(s.executionState.facts.length,0);assert.ok(s.executionState.gaps.some(g=>g.includes('没有工具来源')));
  return {content:JSON.stringify({action:'pause',text:'测试保存'})};
 }});
 assert.equal(calls,4);assert.equal(result.agentRun.events.some(e=>e.type==='tool_error'),false);
 const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(base,{id:'t',request:'制作说明'});assert.equal(await fs.readFile(path.join(w.files,'result.txt'),'utf8'),'实际成果');
});

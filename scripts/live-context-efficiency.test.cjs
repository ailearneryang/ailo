const {test}=require('node:test'),assert=require('node:assert/strict');
const context=require('../apps/desktop/agent/working-context.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
test('batch context retains each original page once with exact child pagination and durable references',()=>{
 const observations=[{observationId:'child-a',action:{action:'read_material'},response:{result:{text:'原始材料ABCDE',offset:0,next:null,total:9}}},
  {observationId:'batch',action:{action:'batch_read'},response:{result:{results:[{observationId:'child-a',result:{text:'原始材料',offset:0,next:4,total:9,truncated:true}},{observationId:'omitted-child',result:{text:'仅父结果可见',offset:0,next:null,total:6}}]}}}];
 const before=JSON.stringify(observations),rows=context.recent(observations);
 assert.equal(rows[0].result.text,'原始材料ABCDE');assert.equal(rows[1].result.results[0].result.text,undefined);assert.equal(rows[1].result.results[0].result.resultRef,'child-a');assert.equal(rows[1].result.results[0].result.next,null);
 assert.equal(rows[1].result.results[1].result.text,'仅父结果可见');assert.equal(JSON.stringify(observations),before);assert.equal(JSON.stringify(rows).split('原始材料ABCDE').length-1,1);
});
test('different or absent child ranges are never removed as duplicate parent content',()=>{
 const rows=context.recent([{observationId:'a',response:{result:{text:'different',offset:10,next:null}}},{observationId:'b',response:{result:{results:[{observationId:'a',result:{text:'original',offset:0,next:8}}]}}}]);
 assert.equal(rows[1].result.results[0].result.text,'original');assert.equal(rows[1].result.results[0].result.next,8);
});
test('connector business results are never treated as batch previews',()=>{
 const business={results:[{observationId:'a',result:{text:'original',offset:0,next:8,total:20}}]};
 const rows=context.recent([{observationId:'a',action:{action:'read_file'},response:{result:{text:'original content',offset:0,next:null,total:16}}},{observationId:'mcp',action:{action:'mcp'},response:{result:business}}]);
 assert.deepEqual(rows[1].result,business);
});
test('legacy children without explicit pagination cannot erase a parent page or its continuation',()=>{
 for(const child of [{text:'original full',offset:0},{text:'original full',offset:0,next:null}]){
  const parent={text:'original',offset:0,next:8,total:20,truncated:true};
  const rows=context.recent([{observationId:'a',response:{result:child}},{observationId:'batch',action:{action:'batch_read'},response:{result:{results:[{observationId:'a',result:parent}]}}}]);
  assert.deepEqual(rows[1].result.results[0].result,parent);
 }
});
test('the observed 14K-token batch does not force a checkpoint in a 1M window while small windows remain protected',()=>{
 assert.ok(14496<context.checkpointThreshold(1048576));assert.ok(14360<context.checkpointThreshold(1048576));assert.equal(context.checkpointThreshold(32768),5692);assert.ok(14496>context.checkpointThreshold(32768));assert.ok(context.checkpointThreshold(2000000)<=120000);
});
test('four real material reads in one batch preserve content without an immediate 1M checkpoint',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-live-context-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'batch-live',request:'读取四份原始材料并制定计划',materials:Array.from({length:4},(_,i)=>({name:'material-'+i+'.md',text:'中文原始内容'+i+'：'+'中文资料'.repeat(975)}))};let n=0;
 const result=await runAgent({base,task,model:{contextWindow:1048576},signal:new AbortController().signal,executeTool:execute,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);n++;
  if(n===1)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(n===2)return {content:JSON.stringify({action:'batch_read',items:s.materials.map(m=>({action:'read_material',id:m.id,limit:4000}))})};
  assert.notEqual(s.requiredAction,'checkpoint');for(let i=0;i<4;i++)assert.ok(s.toolResults.some(row=>row.result?.text?.startsWith('中文原始内容'+i+'：')));
  return {content:JSON.stringify({action:'pause',text:'按用户要求保留材料进度'})};
 }});
 assert.equal(n,3);assert.equal(result.agentRun.status,'paused');assert.ok(!result.agentRun.events.some(e=>e.type==='checkpoint'));
});

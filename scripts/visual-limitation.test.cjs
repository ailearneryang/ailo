const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const acceptance=require('../apps/desktop/agent/acceptance.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
async function setup(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-text-only-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return base;}
test('a text-only model delivers checked output with visual requirements explicitly unverified',async t=>{
 const base=await setup(t);let calls=0;
 const actions=[{action:'route',kind:'task'},
 {action:'plan',goal:'生成图形',decisions:[],requirements:[{id:'source',text:'生成含天气文字的SVG',type:'content'},{id:'appearance',text:'外观符合设计稿',type:'visual'}],steps:[{id:'make',title:'生成图形和检查源文件',status:'running'}]},
 {action:'write_file',path:'weather.svg',content:'<svg xmlns="http://www.w3.org/2000/svg"><text>天气</text></svg>'},
 {action:'artifact',path:'weather.svg',label:'天气图形'},
 {action:'verify',checks:[{criterionId:'source',kind:'text_contains',path:'weather.svg',contains:['<svg','天气'],reason:'检查源文件内容'}],progress:{steps:[{id:'make',status:'done'}]}},
 {action:'finish',outcome:'limited',text:'图形已生成，源文件检查通过。',review:{summary:'已检查生成文件，外观待人工确认',issues:[],unverified:['appearance']}}];
 const result=await runAgent({base,task:{id:'t',request:'生成天气图形'},model:{contextWindow:65536,imageInput:'disabled'},signal:new AbortController().signal,ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);assert.equal(state.observationCapabilities.images,false);
  return {content:JSON.stringify(actions[calls++])};
 }});
 assert.equal(calls,5);assert.equal(result.agentRun.status,'completed');assert.equal(result.agentRun.delivery.outcome,'limited');
 assert.equal(result.agentRun.delivery.visualReviewPending,true);assert.deepEqual(result.agentRun.delivery.unverified,['appearance']);assert.match(result.content,/未进行视觉核验/);
 assert.equal(result.agentRun.acceptanceCriteria.find(c=>c.id==='appearance').status,'pending');
 assert.equal(result.agentRun.acceptanceCriteria.find(c=>c.id==='source').status,'passed');
 assert.ok(!result.agentRun.events.some(e=>e.type==='browser'||e.type==='view_image'));
});
test('unavailable visual verification gives capability guidance rather than creating a repair target',async t=>{
 const base=await setup(t),w=await createWorkspace(base,{id:'t',request:'图形'});
 w.run.requirementsManaged=true;w.run.requirements=[{id:'visual',text:'检查外观',type:'visual'}];w.run.observationCapabilities={images:false};
 await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'visual',kind:'text_contains',path:'out.svg',contains:['svg'],reason:'检查'}]}),e=>e.code==='VISUAL_REVIEW_UNAVAILABLE');
 assert.equal(w.run.validationRepairs,undefined);
 await assert.rejects(acceptance.assertAccepted(w),/尚未核验/);
 await acceptance.assertAccepted(w,{unverifiedVisualIds:['visual']});
 w.run.observationCapabilities.images=true;
 await assert.rejects(acceptance.assertAccepted(w,{unverifiedVisualIds:['visual']}),/只能在缺少图像能力/);
});
test('limited delivery cannot omit visual disclosure or bypass content checks',async t=>{
 const prepare=require('../apps/desktop/agent/visual-limitation.cjs').prepare;
 const criteria=[{id:'v',text:'外观',type:'visual'},{id:'c',text:'内容',type:'content'}],run={observationCapabilities:{images:false}};
 assert.throws(()=>prepare(run,{outcome:'limited'},{issues:[],unverified:[]},criteria),/逐项列出/);
 assert.throws(()=>prepare(run,{outcome:'limited'},{issues:[],unverified:['v','c']},criteria),/其他要求仍须/);
 assert.equal(prepare(run,{outcome:'complete'},{issues:[],unverified:['v']},criteria),null);
 assert.equal(prepare({observationCapabilities:{images:true}},{outcome:'limited'},{issues:[],unverified:['v']},criteria),null);
 const base=await setup(t),w=await createWorkspace(base,{id:'t',request:'生成内容'});w.run.requirementsManaged=true;w.run.requirements=criteria;w.run.observationCapabilities={images:false};
 await assert.rejects(acceptance.assertAccepted(w,{unverifiedVisualIds:['v']}),/尚未核验验收项：内容/);
});

test('visual requirement IDs with explanatory text normalize without waiving other requirements',()=>{
 const {prepare}=require('../apps/desktop/agent/visual-limitation.cjs');
 const run={observationCapabilities:{visualReview:false}},criteria=[{id:'req-artboard-png',text:'画板完整可见',type:'visual'},{id:'report',text:'交付说明完整',type:'content'}];
 for(const entry of ['req-artboard-png：需人工打开总览确认','req-artboard-png: 源文件各画板主体内容完整可见']){
  const result=prepare(run,{outcome:'limited'},{issues:[],unverified:[entry]},criteria);
  assert.deepEqual(result.ids,['req-artboard-png']);assert.deepEqual(result.review.unverified,['req-artboard-png']);
 }
 assert.throws(()=>prepare(run,{outcome:'limited'},{issues:[],unverified:['report: 内容待核验']},criteria),/其他要求仍须/);
 assert.throws(()=>prepare(run,{outcome:'limited'},{issues:[],unverified:['req-artboard-png-other: 不同要求']},criteria),/逐项列出/);
});

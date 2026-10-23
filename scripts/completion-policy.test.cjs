const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),acceptance=require('../apps/desktop/agent/acceptance.cjs');
const {automaticDelivery}=require('../apps/desktop/agent/completion-policy.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
const svg='<svg xmlns="http://www.w3.org/2000/svg"><text>天气</text></svg>';
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-completion-policy-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'t',request:'生成天气界面',messages:[{id:'u',role:'user',content:'生成天气界面'}]},w=await createWorkspace(base,task);
 await fs.writeFile(path.join(w.files,'weather.svg'),svg);
 Object.assign(w.run,{goal:task.request,acceptance:['SVG包含天气文字','视觉效果符合设计稿'],acceptanceTypes:['content','visual'],inputKey:'u',acceptanceInputKey:'u',mode:'task',status:'paused',requirementsManaged:true,requirements:[{id:'source',text:'SVG包含天气文字',type:'content'},{id:'visual',text:'视觉效果符合设计稿',type:'visual'}],steps:[{id:'make',title:'生成并检查',status:'done'}],artifacts:[{path:'weather.svg',label:'天气图形',sha256:hash(svg),size:Buffer.byteLength(svg)}],observationCapabilities:{images:false,visualReview:false},executionState:{blocker:{action:'verify',message:'视觉证据尚未传给模型或已过期'}}});
 await acceptance.verify(w,{checks:[{criterionId:'source',kind:'text_contains',path:'weather.svg',contains:['svg','天气'],reason:'核对文件内容'}]});
 await w.save();return {base,task,w};
}
test('a resumed all-done text-only task closes automatically without another model finish or continue',async t=>{
 const {base,task}=await fixture(t);let calls=0;
 const result=await runAgent({base,task,model:{contextWindow:65536,imageInput:'disabled'},signal:new AbortController().signal,ask:async()=>{
  assert.equal(++calls,1,'automatic delivery must not ask the model to retry visual verification');
  return {content:JSON.stringify({action:'route',kind:'task'})};
 }});
 assert.equal(calls,1);assert.equal(result.agentRun.status,'completed');assert.equal(result.agentRun.delivery.visualReviewPending,true);
 assert.equal(result.agentRun.acceptanceCriteria.find(c=>c.id==='source').status,'passed');
 assert.equal(result.agentRun.acceptanceCriteria.find(c=>c.id==='visual').status,'pending');
 assert.match(result.content,/视觉效果待人工确认/);assert.ok(!result.agentRun.events.some(e=>['browser','view_image'].includes(e.type)));
});
test('auto image transport keeps visual review pending instead of automatically downgrading to limited delivery',async t=>{
 const {base,task}=await fixture(t);let calls=0;
 const result=await runAgent({base,task,model:{contextWindow:65536,imageInput:'auto'},images:{prepare:()=>assert.fail('no images needed')},signal:new AbortController().signal,ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);assert.equal(state.observationCapabilities.images,true);assert.equal(state.observationCapabilities.visualReview,true);assert.equal(state.observationCapabilities.imageUnderstanding,'unconfirmed');calls++;
  return {content:JSON.stringify(calls===1?{action:'route',kind:'task'}:{action:'pause',text:'保留视觉要求，等待实际对照'})};
 }});
 assert.equal(calls,2);assert.equal(result.agentRun.status,'paused');assert.notEqual(result.agentRun.delivery.outcome,'limited');
});
test('automatic completion cannot waive content failures, changed files, unfinished work or real defects',async t=>{
 const {w}=await fixture(t);
 w.run.acceptanceInputKey='previous-input';assert.equal(await automaticDelivery(w),null);w.run.acceptanceInputKey='u';
 const original=w.run.acceptanceResults;
 w.run.acceptanceResults={};assert.equal(await automaticDelivery(w),null);w.run.acceptanceResults=original;
 w.run.steps[0].status='running';assert.equal(await automaticDelivery(w),null);w.run.steps[0].status='done';
 w.run.issues=[{id:'broken',status:'open',description:'图片无法加载'}];assert.equal(await automaticDelivery(w),null);w.run.issues=[];
 w.run.observationCapabilities={images:true,visualReview:true};assert.equal(await automaticDelivery(w),null);w.run.observationCapabilities={images:false};
 await fs.writeFile(path.join(w.files,'weather.svg'),'<svg>changed</svg>');assert.equal(await automaticDelivery(w),null);
});
test('an image-unsupported endpoint falls back to text and completes the existing task',async t=>{
 const {base,task,w}=await fixture(t);
 // Start fresh so the fallback is exercised before machine checks finish.
 w.run.steps[0].status='running';w.run.acceptanceResults={};w.run.artifacts=[];await w.save();
 let calls=0,rejected=false,views=0;
 const images={prepare:async()=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,eA=='}}})};
 const result=await runAgent({base,task,model:{contextWindow:128000,imageInput:'auto'},images,signal:new AbortController().signal,ask:async messages=>{
  calls++;const state=JSON.parse(messages.at(-1).content);
  if(calls===1)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(state.requiredAction==='checkpoint')return {content:JSON.stringify({action:'checkpoint',text:'已保存天气图形和来源；当前视觉能力不可用时完成内容检查并交付，不重复回看图片。'})};
  if(state.observationCapabilities.images){
   if(messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'))){rejected=true;throw Object.assign(Error('image unsupported'),{code:'MODEL_IMAGE_UNSUPPORTED'});}
   views++;return {content:JSON.stringify({action:'view_image',path:'weather.svg',purpose:'检查图形'})};
  }
  assert.ok(rejected);assert.ok(!messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));
  if(!state.artifacts.length)return {content:JSON.stringify({action:'artifact',path:'weather.svg',label:'天气图形'})};
  return {content:JSON.stringify({action:'verify',checks:[{criterionId:'source',kind:'text_contains',path:'weather.svg',contains:['天气'],reason:'核对源文件'}],progress:{steps:[{id:'make',status:'done'}]}})};
 }});
 assert.ok(rejected);assert.equal(views,1);assert.equal(result.agentRun.status,'completed');assert.equal(result.agentRun.delivery.visualReviewPending,true);
 assert.ok(result.agentRun.events.some(e=>e.type==='capability_fallback'));
});
test('long text-only tasks with an existing visual limitation and evicted issue evidence still close in one decision',async t=>{
 const {base,task,w}=await fixture(t);
 await w.event('run_command',{revision:w.run.revision,result:{exitCode:0,sources:[{path:'weather.svg',sha256:hash(svg)}],scope:{kind:'file',path:'weather.svg'}}});
 const oldEvidence=w.run.events.at(-1).id;
 w.run.issues=[{id:'prior_fixed_problem',status:'resolved',evidenceId:oldEvidence},{id:'repair_visual',status:'limitation',description:'自动视觉核验不可用，画板主体需人工确认',reason:'visualReview=false',requirementIds:['visual']}];
 for(let i=0;i<105;i++)await w.event('attached_progress',{i});
 let calls=0;
 const result=await runAgent({base,task,model:{contextWindow:65536,imageInput:'disabled'},images:{prepare:()=>assert.fail('no image retry')},signal:new AbortController().signal,ask:async()=>{
  assert.equal(++calls,1);return {content:JSON.stringify({action:'route',kind:'task'})};
 }});
 assert.equal(result.agentRun.status,'completed');assert.equal(calls,1);
 assert.match(result.content,/画板主体需人工确认/);assert.ok(result.agentRun.completionReview.issues.includes('repair_visual'));
});

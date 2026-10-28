const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{runAgent}=require('../apps/desktop/agent/runner.cjs'),{execute}=require('../apps/desktop/agent/tools.cjs');
const proof=require('../apps/desktop/agent/evidence.cjs'),flow=require('../apps/desktop/agent/visual-workflow.cjs'),menu=require('../apps/desktop/agent/tool-menu.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const images={prepare:async()=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64')}}})};
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-visual-pipeline-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'visual',request:'核对应用运行图并在测试停止点保存'},w=await createWorkspace(base,task);await fs.mkdir(path.join(w.files,'verification'));await fs.writeFile(path.join(w.files,'app.apk'),'compiled APK');await fs.writeFile(path.join(w.files,'verification/shot.png'),png);return {base,task,w};}
function screenshot(){return {path:'verification/shot.png',sessionId:'new-session',apkPath:'app.apk',apkSha256:proof.hash(Buffer.from('compiled APK')),sources:[{path:'verification/shot.png',sha256:proof.hash(png)},{path:'app.apk',sha256:proof.hash(Buffer.from('compiled APK'))}],pixelSize:{width:1,height:1},displayCheck:{matches:true,actual:{density:160}},scope:{kind:'viewport',path:'verification/shot.png'}};}
test('visual requirements retain the image tool in ordinary and repair menus without expanding authorization',()=>{
 for(const state of [{phase:'task',steps:[{id:'s'}],acceptanceCriteria:[{type:'visual'}]},{phase:'task',steps:[{id:'s'}],executionState:{blocker:{action:'verify'}},pendingVisualReview:{path:'shot.png'}}]){
  assert.ok(menu.select(state,['edit_file','verify','view_image']).includes('view_image'));assert.ok(!menu.select(state,['edit_file','verify']).includes('view_image'));
 }
});
test('a managed screenshot reaches the immediately next model request, while its preview cannot pass design acceptance',async t=>{
 const {base,task}=await fixture(t);let calls=0,sawPreview=false;
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:task.request,decisions:[],requirements:[{id:'v',text:'原稿与真实结果视觉一致',type:'visual'}],steps:[{id:'s',title:'核对截图',status:'running'}]},{action:'android_device',operation:'screenshot'}];
 const result=await runAgent({base,task,model:{contextWindow:1048576},images,signal:new AbortController().signal,executeTool:async(w,a,...rest)=>a.action==='android_device'?screenshot():execute(w,a,...rest),ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content),n=calls++;
  if(n<3)return {content:JSON.stringify(actions[n])};
  if(n===3){sawPreview=messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));assert.equal(sawPreview,true);return {content:JSON.stringify({action:'verify',checks:[{criterionId:'v',kind:'visual',evidenceId:state.visualObservations.at(-1).eventId,reason:'尝试用预览核验'}]})};}
  return {content:'{"action":"pause","text":"在测试停止点保存，等待成对核验"}'};
 }});
 assert.equal(sawPreview,true);assert.equal(calls,5);assert.notEqual(result.agentRun.acceptanceCriteria[0].status,'passed');assert.equal(result.agentRun.status,'paused');assert.ok(result.agentRun.events.some(e=>e.type==='tool_error'&&/预览/.test(e.detail.message)));
});
test('continuation image replay is bounded diagnostic history and grants neither progress nor new-device evidence',async t=>{
 const {w}=await fixture(t);await w.event('android_device',{operation:'screenshot',result:screenshot()});const old=w.run.events.at(-1);flow.enqueue(w.run,old);w.run.visualObservations[0].delivered=true;
 w.run.runtimeContinuation={kind:'assisted_resume',deviceState:'new_environment'};await w.event('evaluation_resume',{kind:'assisted_resume'});const progress=JSON.stringify(w.run.progressEvidence);
 assert.equal(await flow.replay(w),true);assert.equal(await flow.replay(w),false);assert.equal(w.run.visualObservations[0].historicalReplay,true);assert.equal(JSON.stringify(w.run.progressEvidence),progress);
 const parts=await require('../apps/desktop/agent/visual-observation.cjs').messages(w,w.run.visualObservations,images);assert.equal(parts.length,1);assert.match(JSON.stringify(parts),/历史/);await assert.rejects(proof.event(w,old.id),{code:'ANDROID_ASSISTED_RUNTIME_REQUIRED'});
});
test('derived design archives deduplicate unchanged specs and preserve full raw details without tool progress',async t=>{
 const {w}=await fixture(t),body={screens:[{baseline:{fonts:['字体'.repeat(10000)],regions:[{id:'real-region'}]}}]},archive=require('../apps/desktop/agent/context-archives.cjs').archive;
 w.run.executionId='execution-one';const before=w.run.progressEvidence,id=await archive(w,'android_design',body);assert.equal(await archive(w,'android_design',body),id);assert.equal(w.run.observationIndex.length,1);assert.equal(w.run.observationIndex[0].contextOnly,true);assert.equal(w.run.progressEvidence,before);
 let offset=0,text='';do{const page=await w.observation(id,offset,4000,'result');text+=page.text;offset=page.next;}while(offset!==null);assert.deepEqual(JSON.parse(text),body);
});
test('standard successful builds expose current APK milestones without claiming acceptance or final completion',async t=>{
 const {w}=await fixture(t),register=require('../apps/desktop/agent/delivery-milestones.cjs').registerBuild,base={type:'build_android',id:'build-proof',detail:{result:{exitCode:0,buildArtifacts:[{path:'app.apk',sha256:proof.hash(Buffer.from('compiled APK'))}]}}};
 w.run.status='running';assert.equal((await register(w,base)).length,1);assert.equal(w.run.artifacts[0].quality,'unverified');assert.equal(w.run.status,'running');assert.equal(w.run.acceptanceResults,undefined);assert.equal((await register(w,base)).length,0);
 for(const extra of [{exitCode:1},{timedOut:true},{buildInputsChanged:true}])assert.equal((await register(w,{...base,detail:{result:{...base.detail.result,...extra}}})).length,0);
});
test('the combined Android check queues its real child screenshot rather than the outer aggregate as preview evidence',async t=>{
 const {w}=await fixture(t),result=screenshot();await w.event('android_device',{operation:'screenshot',result});const child=w.run.events.at(-1);
 const combined={...result,checks:[{operation:'screenshot',eventId:child.id}]};await w.event('android_device',{operation:'check',result:combined});const outer=w.run.events.at(-1);
 assert.equal(await flow.enqueueOperation(w,{operation:'check'},combined,outer),true);assert.equal(w.run.visualObservations[0].eventId,child.id);assert.notEqual(w.run.visualObservations[0].eventId,outer.id);assert.equal(w.run.visualObservations[0].previewOnly,true);
 assert.equal((await require('../apps/desktop/agent/visual-observation.cjs').messages(w,w.run.visualObservations,images)).length,1);
});
test('invalid or disappeared milestone files cannot turn a successful build into a new tool failure',async t=>{
 const {w}=await fixture(t),register=require('../apps/desktop/agent/delivery-milestones.cjs').registerBuild;
 const result=await register(w,{type:'build_android',id:'build-ok',detail:{result:{exitCode:0,buildArtifacts:[{path:'missing.apk',sha256:'missing'},{path:'../escape.apk',sha256:'escape'}]}}});
 assert.deepEqual(result,[]);assert.equal(w.run.artifacts.length,0);assert.equal(w.run.artifactMilestoneWarnings.length,2);
});

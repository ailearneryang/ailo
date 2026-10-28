const test=require('node:test');
const assert=require('node:assert/strict');
const {observationCapabilities,documentedTextModel}=require('../apps/desktop/agent/model-capabilities.cjs');
const model={model:'glm-5.2',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',imageInput:'auto'};
const runtime={images:{prepare(){}},browser:{}};
test('exact documented Aliyun GLM-5.2 is text only despite local image decoding',()=>{
 const result=observationCapabilities(model,runtime);
 assert.equal(result.images,false);assert.equal(result.visualReview,false);assert.equal(result.browser,true);assert.equal(result.imageInput,'auto');assert.equal(result.imageUnderstanding,'unsupported');assert.equal(result.source,'documented_text_model');assert.equal(result.sourceUrl,'https://help.aliyun.com/zh/model-studio/glm-5-2');
});
test('documented model IDs are exact and display names cannot grant or remove capability',()=>{
 for(const id of ['GLM-5.2','glm-5.2-0807','glm-5.2-vision','glm-5.20',' glm-5.2','glm-5.2 ']){
  const result=observationCapabilities({...model,model:id,name:'glm-5.2'},runtime);assert.equal(result.imageUnderstanding,'unconfirmed');assert.equal(result.images,true);assert.equal(result.sourceUrl,undefined);
 }
 assert.equal(observationCapabilities({...model,name:'Custom vision proxy'},runtime).images,false);
});
test('all supported official MaaS regions remain scoped to the exact provider suffix',()=>{
 for(const region of ['cn-beijing','ap-southeast-1','us-east-1','eu-central-1','cn-hongkong'])assert.equal(observationCapabilities({...model,baseUrl:`https://deployment-123.${region}.maas.aliyuncs.com/compatible-mode/v1`},runtime).images,false);
});
test('lookalike domains, credentials, nonstandard ports and nonofficial protocols stay unknown',()=>{
 for(const baseUrl of ['https://dashscope.aliyuncs.com.attacker.example/v1','https://attacker.example/dashscope.aliyuncs.com','https://dashscope-aliyuncs.com/v1','https://x.cn-beijing.maas.aliyuncs.com.attacker.example/v1','https://x.attacker.maas.aliyuncs.com/v1','https://user:pass@dashscope.aliyuncs.com/v1','https://dashscope.aliyuncs.com:9443/v1','http://dashscope.aliyuncs.com/v1','https://dashscope.aliyuncs.com/v1?proxy=1','https://dashscope.aliyuncs.com/v1#proxy','invalid']){
  const result=observationCapabilities({...model,baseUrl},runtime);assert.equal(result.images,true,baseUrl);assert.equal(result.imageUnderstanding,'unconfirmed',baseUrl);assert.equal(result.sourceUrl,undefined);
 }
 assert.equal(observationCapabilities({...model,baseUrl:'https://dashscope.aliyuncs.com:443/v1'},runtime).images,false);
});
test('custom and local proxies are not classified by their upstream model name',()=>{
 for(const baseUrl of ['https://company-proxy.example/v1','http://127.0.0.1:8080/v1','http://localhost:1234/v1']){
  const result=observationCapabilities({...model,baseUrl},runtime);assert.equal(result.images,true);assert.equal(result.visualReview,true);assert.equal(result.imageUnderstanding,'unconfirmed');assert.equal(documentedTextModel({...model,baseUrl}),null);
 }
});
test('disabled always respects user preference without leaking model or endpoint details',()=>{
 for(const baseUrl of [model.baseUrl,'https://private.example/v1']){
  const result=observationCapabilities({...model,baseUrl,imageInput:'disabled',apiKey:'secret-value'},runtime);assert.equal(result.images,false);assert.equal(result.visualReview,false);assert.equal(result.imageUnderstanding,'disabled');assert.equal(result.source,'user_configuration');assert.doesNotMatch(JSON.stringify(result),/private\.example|secret-value/);
 }
});
test('enabled is only a user declaration for unknown endpoints and cannot override documented text input',()=>{
 const custom=observationCapabilities({...model,baseUrl:'https://proxy.example/v1',imageInput:'enabled'},runtime);assert.equal(custom.images,true);assert.equal(custom.imageUnderstanding,'user_confirmed');assert.equal(custom.source,'user_configuration');
 const known=observationCapabilities({...model,imageInput:'enabled'},runtime);assert.equal(known.images,false);assert.equal(known.visualReview,false);assert.equal(known.imageUnderstanding,'unsupported');assert.equal(known.source,'documented_text_model');
});
test('missing image adapter prevents observation without claiming that the model was tested',()=>{
 for(const imageInput of ['auto','enabled']){
  const result=observationCapabilities({imageInput},{browser:true});assert.equal(result.images,false);assert.equal(result.visualReview,false);assert.equal(result.browser,true);assert.equal(result.imageUnderstanding,imageInput==='enabled'?'user_confirmed':'unconfirmed');
 }
 assert.equal(observationCapabilities().imageInput,'auto');
});
test('attachment image transport is independent of the native image observer',()=>{
 for(const imageInput of ['auto','enabled']){
  const result=observationCapabilities({baseUrl:'https://proxy.example/v1',model:'glm-5.2',imageInput});assert.equal(result.imageTransport,true);assert.equal(result.images,false);assert.equal(result.visualReview,false);
 }
 for(const input of [{...model},{...model,imageInput:'enabled'},{imageInput:'disabled'}])assert.equal(observationCapabilities(input).imageTransport,false);
});
test('HTTP 200, delivered images and capability-shaped response metadata cannot promote understanding',()=>{
 const before=observationCapabilities(model,runtime);
 const after=observationCapabilities({...model,httpStatus:200,imageInputs:2,imageUnderstanding:'verified',visualReview:true,capabilities:{vision:true}}, {...runtime,httpStatus:200,delivered:true});assert.deepEqual(after,before);
 const proxy={...model,baseUrl:'https://proxy.example/v1'};assert.deepEqual(observationCapabilities({...proxy,httpStatus:200},runtime),observationCapabilities(proxy,runtime));
});
test('capability resolution is pure and leaves saved model and runtime objects unchanged',()=>{
 const source=structuredClone(model),before=JSON.stringify(source);Object.freeze(source);Object.freeze(runtime);observationCapabilities(source,runtime);assert.equal(JSON.stringify(source),before);
});
test('text-only recovery projection replaces stale visual navigation without altering task or budgets',()=>{
 const {projectVisualConstraint}=require('../apps/desktop/agent/model-capabilities.cjs');
 const state={observationCapabilities:observationCapabilities(model,runtime),acceptanceCriteria:[{id:'ui',type:'visual'},{id:'api',type:'behavior'}],steps:[{id:'s1',status:'running'}],designRegionIssues:[{id:'actual-gap'}],executionState:{blocker:{code:'VISUAL_REVIEW_READY',navigation:{resolvedBy:'prior-pair'}},nextAction:'view_image'},decisionRecovery:{attempt:4,focus:{code:'VISUAL_REVIEW_PENDING',message:'view_image',navigation:{issue:'paired_image_required'}}},progressEvidence:['prior']};
 const before=structuredClone(state),projected=projectVisualConstraint(state);
 assert.deepEqual(state,before);assert.deepEqual(projected.steps,before.steps);assert.deepEqual(projected.progressEvidence,before.progressEvidence);assert.deepEqual(projected.designRegionIssues,before.designRegionIssues);assert.equal(projected.decisionRecovery.attempt,4);
 assert.equal(projected.executionState.blocker.code,'VISUAL_CAPABILITY_UNAVAILABLE');assert.equal(projected.decisionRecovery.focus.code,'VISUAL_CAPABILITY_UNAVAILABLE');assert.equal(projected.executionState.nextAction,'read_file');assert.deepEqual(projected.visualReviewConstraint.unverifiedCriterionIds,['ui']);assert.equal(projected.pendingVisualReview.status,'unavailable');
});
test('capability projection does not rewrite nonvisual failure or a capable endpoint',()=>{
 const {projectVisualConstraint}=require('../apps/desktop/agent/model-capabilities.cjs');
 const state={observationCapabilities:{images:true},decisionRecovery:{attempt:3,focus:{code:'BUILD_FAILED'}}};assert.equal(projectVisualConstraint(state),state);
 const disabled={...state,observationCapabilities:{images:false}};assert.deepEqual(projectVisualConstraint(disabled).decisionRecovery,disabled.decisionRecovery);
});
test('unavailable image observation is absent from every task action catalogue including recovery and artifact gates',()=>{
 const {allowedActions}=require('../apps/desktop/agent/protocol.cjs');
 for(const extra of [{},{pendingArtifactUpdates:[{path:'app.apk'}]},{decisionRecovery:{stage:'small_action'}},{requiredAction:'finish_review'}]){
  const state={phase:'task',steps:[{id:'s1'}],observationCapabilities:{images:false},...extra},names=allowedActions(state);assert.equal(names.includes('view_image'),false);assert.equal(names.includes('read_file'),true);
 }
 assert.equal(allowedActions({phase:'task',steps:[{id:'s1'}]}).includes('view_image'),true);
});

test('a capability gap does not hide actual design mismatches or unrelated pending-review classification',()=>{
 const {projectVisualConstraint}=require('../apps/desktop/agent/model-capabilities.cjs');
 for(const code of ['VISUAL_REPAIR_REQUIRED','VISUAL_DESIGN_MISMATCH','VISUAL_REVIEW_PENDING']){
  const snapshot={observationCapabilities:{images:false},decisionRecovery:{attempt:4,focus:{code,message:'actual missing region'}},executionState:{blocker:{code,message:'actual missing region'},nextAction:'edit_file'}};
  const projected=projectVisualConstraint(snapshot);assert.deepEqual(projected.decisionRecovery,snapshot.decisionRecovery);assert.deepEqual(projected.executionState,snapshot.executionState);
 }
});

async function historicalVisualFixture(t){
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
 const acceptance=require('../apps/desktop/agent/acceptance.cjs'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-historical-visual-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'historical-visual',request:'生成天气图形并核验设计',messages:[{id:'input',role:'user',content:'生成天气图形并核验设计'}]},w=await createWorkspace(base,task);
 const svg='<svg xmlns="http://www.w3.org/2000/svg"><text>天气</text></svg>',png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrL8AAAAASUVORK5CYII=','base64'),hash=data=>createHash('sha256').update(data).digest('hex');
 await fs.writeFile(path.join(w.files,'weather.svg'),svg);await fs.writeFile(path.join(w.files,'actual.png'),png);await fs.writeFile(path.join(w.files,'reference.png'),png);
 Object.assign(w.run,{goal:task.request,mode:'task',status:'paused',inputKey:'input',acceptanceInputKey:'input',acceptance:['包含天气文字','符合设计稿'],acceptanceTypes:['content','visual'],requirementsManaged:true,requirements:[{id:'source',text:'包含天气文字',type:'content'},{id:'appearance',text:'符合设计稿',type:'visual'}],steps:[{id:'make',title:'生成并检查',status:'done'}],artifacts:[{path:'weather.svg',label:'天气图形',sha256:hash(svg),size:Buffer.byteLength(svg)}],observationCapabilities:{images:true,visualReview:true,imageUnderstanding:'unconfirmed'}});
 const image={path:'actual.png',sha256:hash(png),reference:{path:'reference.png',sha256:hash(png)},sources:[{path:'weather.svg',sha256:hash(svg)},{path:'actual.png',sha256:hash(png)},{path:'reference.png',sha256:hash(png)}],scope:{kind:'viewport',path:'weather.svg',rect:{x:0,y:0,width:1,height:1}},revision:w.run.revision};
 await w.event('view_image',{revision:w.run.revision,result:image});image.eventId=w.run.events.at(-1).id;w.run.visualObservations=[{...image,delivered:true}];
 // Obtain the old result through the real verifier, as the former optimistic
 // auto capability did. Do not forge an acceptanceResults pass in the fixture.
 await acceptance.verify(w,{checks:[{criterionId:'source',kind:'text_contains',path:'weather.svg',contains:['天气'],reason:'源文件包含要求文字'},{criterionId:'appearance',kind:'visual',evidenceId:image.eventId,reason:'旧运行认为已经比较图像'}]});await w.save();
 return {base,task,w,acceptance,createWorkspace};
}
test('documented text capability keeps historical image assessments pending without deleting their audit records',async t=>{
 const {w,acceptance}=await historicalVisualFixture(t),original=structuredClone(w.run.acceptanceResults),observations=structuredClone(w.run.visualObservations);
 assert.equal(acceptance.criteria(w.run).find(c=>c.id==='appearance').check.status,'passed');
 w.run.observationCapabilities=observationCapabilities(model,runtime);
 assert.equal(acceptance.criteria(w.run).find(c=>c.id==='appearance').check,undefined);assert.equal(acceptance.criteria(w.run).find(c=>c.id==='source').check.status,'passed');
 await assert.rejects(acceptance.assertAccepted(w),/尚未核验验收项：符合设计稿/);await acceptance.assertAccepted(w,{unverifiedVisualIds:['appearance']});
 assert.deepEqual(w.run.acceptanceResults,original);assert.deepEqual(w.run.visualObservations,observations);
 // The restriction is not a blanket revocation of historical evidence for a
 // capable endpoint or a separately configured private proxy.
 w.run.observationCapabilities=observationCapabilities({...model,baseUrl:'https://proxy.example/v1',imageInput:'enabled'},runtime);
 await acceptance.assertAccepted(w);assert.deepEqual(w.run.acceptanceResults,original);
});
test('real resumed runner cannot turn a historical image pass into complete delivery on documented text input',async t=>{
 const {base,task,w,createWorkspace}=await historicalVisualFixture(t),original=JSON.parse(JSON.stringify(w.run.acceptanceResults)),{runAgent}=require('../apps/desktop/agent/runner.cjs');let calls=0;
 const result=await runAgent({base,task,model:{...model,contextWindow:65536},images:{prepare:()=>assert.fail('known text must not prepare images')},signal:new AbortController().signal,ask:async messages=>{
  calls++;assert.equal(messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>['image_url','input_image'].includes(p.type))),false);
  return {content:JSON.stringify(calls===1?{action:'route',kind:'task'}:{action:'finish',outcome:'complete',text:'不能接受未核验视觉的完整交付',review:{summary:'回归故意尝试复用旧视觉通过',issues:[],unverified:[]}})};
 }});
 assert.equal(result.agentRun.status,'completed');assert.equal(result.agentRun.delivery.outcome,'limited');assert.equal(result.agentRun.delivery.visualReviewPending,true);assert.deepEqual(result.agentRun.delivery.unverified,['appearance']);assert.equal(result.agentRun.acceptanceCriteria.find(c=>c.id==='appearance').status,'pending');assert.equal(result.agentRun.acceptanceCriteria.find(c=>c.id==='source').status,'passed');assert.equal(calls,1,'runtime must disclose the limitation before asking for complete finish');
 const saved=await createWorkspace(base,task);assert.deepEqual(saved.run.acceptanceResults,original);assert.equal(saved.run.events.some(e=>e.type==='finish'&&e.detail.text?.includes('不能接受')),false);
});
test('known text does not clear a real historical defect to obtain limited delivery',async t=>{
 const {w}=await historicalVisualFixture(t),{automaticDelivery}=require('../apps/desktop/agent/completion-policy.cjs');w.run.observationCapabilities=observationCapabilities(model,runtime);w.run.designRegionIssues={card:{status:'open',finding:'mismatch',regionId:'card',reason:'真实组件缺失'}};
 const before=structuredClone(w.run.designRegionIssues);assert.equal(await automaticDelivery(w),null);assert.deepEqual(w.run.designRegionIssues,before);
});

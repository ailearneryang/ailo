const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createModelRouter,createVisualRouter}=require('../apps/desktop/model-routing.cjs');
const quality=require('../apps/desktop/agent/visual-quality.cjs'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{hash}=require('../apps/desktop/agent/evidence.cjs');
function routing(){const models=['p','shared'].map(id=>({id,name:id,model:id,baseUrl:'https://fixture.example/v1',imageInput:'enabled',contextWindow:131072,maxOutputTokens:32768}));return {readWorkspace:async()=>({models,autoModel:{primaryModelId:'p',primaryFallbackId:'shared',visionModelId:'shared',failover:true}}),modelCredentials:async id=>models.find(m=>m.id===id)};}
const timeout=()=>Object.assign(Error('actual visual timeout'),{code:'MODEL_OUTPUT_TIMEOUT'});
test('a visual timeout cannot poison the same model used by the primary fallback',async()=>{
 const router=await createModelRouter(routing(),'auto');await assert.rejects(router.run('vision',()=>{throw timeout();}),{code:'MODEL_OUTPUT_TIMEOUT'});const calls=[];
 const r=await router.run('primary',m=>{calls.push(m.id);if(m.id==='p')throw Object.assign(Error('upstream unavailable'),{code:'MODEL_HTTP_TRANSIENT'});return 'actual primary result';});assert.equal(r.result,'actual primary result');assert.deepEqual(calls,['p','shared']);
});
test('circuit waiting reports no new request, cooldown permits finite probes and success clears only its lane',async()=>{
 let at=0,calls=0;const router=await createModelRouter(routing(),'auto',{now:()=>at,cooldownMs:10,maxProbes:2});const fail=()=>{calls++;throw timeout();};
 await assert.rejects(router.run('vision',fail));await assert.rejects(router.run('vision',fail),e=>e.code==='MODEL_OUTPUT_TIMEOUT'&&e.requestAttempted===false&&e.lastErrorCode==='MODEL_OUTPUT_TIMEOUT');assert.equal(calls,1);
 at=10;await assert.rejects(router.run('vision',fail));assert.equal(calls,2);at=20;assert.equal((await router.run('vision',()=>{calls++;return 'recovered';})).result,'recovered');assert.equal(calls,3);
 assert.equal((await router.run('vision',()=>{calls++;return 'still healthy';})).result,'still healthy');assert.equal(calls,4);
 const other=await createModelRouter(routing(),'auto',{now:()=>at,cooldownMs:10,maxProbes:1});await assert.rejects(other.run('vision',fail));at+=10;await assert.rejects(other.run('vision',fail));at+=100;const before=calls;await assert.rejects(other.run('vision',fail),e=>e.requestAttempted===false&&e.recoveryExhausted);assert.equal(calls,before);
});
test('cached failure presentation never diagnoses authorization and preserves unknown-result protection',()=>{
 const continuation=require('../apps/desktop/agent/task-continuation.cjs');const r={status:'blocked',inputKey:'old',revision:1,steps:[],artifacts:[],waitingError:{code:'MODEL_OUTPUT_TIMEOUT',message:'cached timeout',requestAttempted:false},events:[]};
 const c=continuation.update(r);assert.equal(c.state,'waiting_retry');assert.match(c.question,/未发起新的模型请求/);assert.doesNotMatch(c.question,/请检查.*授权|服务已恢复/);assert.equal(continuation.canResume(r,{messages:[{id:'new',role:'user',content:'继续'}]}),true);
 r.actionJournal=[{status:'unknown'}];assert.equal(continuation.update(r).state,'waiting_result_check');assert.match(r.taskContinuation.question,/尚未确认上次操作/);assert.equal(r.actionJournal[0].status,'unknown');
});
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-visual-quality-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const w=await createWorkspace(base,{id:'task',request:'还原设计并保留内容'});w.run.requirementsManaged=true;w.run.requirements=[{id:'v',text:'界面视觉要求同时满足',type:'visual'}];return {w,base};}
async function observe(w,name,content,{paired=true}={}){
 const p='verification/'+name;await fs.mkdir(path.dirname(path.join(w.files,p)),{recursive:true});await fs.writeFile(path.join(w.files,p),content);const sources=[{path:p,sha256:hash(content)}];
 if(paired){await fs.writeFile(path.join(w.files,'reference.png'),'reference');sources.push({path:'reference.png',sha256:hash('reference')});}
 return {eventId:name,path:p,sha256:hash(content),revision:w.run.revision,sources,reference:paired?{path:'reference.png'}:undefined,scope:{kind:paired?'viewport':'file',path:paired?'app/src/main/res/layout/main.xml':p}};
}
const defect=(kind,description)=>({kind,subject:'actual',description});
test('watermark and missing-content conditions survive summaries and require joint recheck on a genuinely new paired image',async t=>{
 const {w,base}=await fixture(t),first=await observe(w,'before.png','watermarked');await quality.record(w,first,{inputHash:'first',defects:[defect('watermark','背景含可见标识'),defect('missing_content','应有的云层未完整显示')]});
 w.run.workingMemory='已修复所有问题';await w.save();const saved=await createWorkspace(base,{id:'task'});assert.equal(saved.run.visualQuality.constraints.length,2);assert.throws(()=>quality.assertNoOpen(saved.run));
 const ids=w.run.visualQuality.constraints.map(c=>c.id),flat=await observe(w,'flat.png','plain-blue');await quality.record(w,flat,{inputHash:'flat',defects:[],checks:[{id:ids[0],status:'matched',reason:'没有可见标识'},{id:ids[1],status:'mismatch',reason:'云层缺失'}]});assert.throws(()=>quality.assertNoOpen(w.run));
 const good=await observe(w,'good.png','clean-clouds');await quality.record(w,good,{inputHash:'good',defects:[],checks:ids.map(id=>({id,status:'matched',reason:'新图无标识且云层完整'}))});quality.assertNoOpen(w.run);await quality.assertDeliverable(w);
 await fs.writeFile(path.join(w.files,good.path),'changed after review');await assert.rejects(quality.assertDeliverable(w),/变化|过期/);
});
test('same pixels, crops and missing checks cannot erase known defects',async t=>{
 const {w}=await fixture(t),o=await observe(w,'before.png','same');await quality.record(w,o,{inputHash:'bad',defects:[defect('watermark','可见水印')]});const id=w.run.visualQuality.constraints[0].id;
 await quality.record(w,{...o,eventId:'repeated'},{inputHash:'repeat',checks:[{id,status:'matched',reason:'只是重新查看'}]});assert.throws(()=>quality.assertNoOpen(w.run));
 const next=await observe(w,'next.png','new');await quality.record(w,{...next,transform:{crop:{x:0,y:0,width:1,height:1}}},{inputHash:'crop',checks:[{id,status:'matched',reason:'局部无水印'}]});assert.throws(()=>quality.assertNoOpen(w.run));
});
test('an image proven bad cannot be reintroduced under another filename, while unused historical resources remain allowed',async t=>{
 const {w}=await fixture(t),o=await observe(w,'asset.png','BAD-SOURCE',{paired:false});await quality.record(w,o,{inputHash:'asset',defects:[defect('watermark','素材本身带水印')]});assert.equal(w.run.visualQuality.rejectedAssets[0].sha256,hash('BAD-SOURCE'));
 const folder=path.join(w.files,'app/src/main/res');await fs.mkdir(path.join(folder,'drawable'),{recursive:true});await fs.mkdir(path.join(folder,'layout'),{recursive:true});await fs.writeFile(path.join(folder,'drawable/renamed.png'),'BAD-SOURCE');await fs.writeFile(path.join(folder,'drawable/clean.png'),'clean');await fs.writeFile(path.join(folder,'drawable/background.xml'),'<bitmap src="@drawable/renamed"/>');await fs.writeFile(path.join(folder,'layout/main.xml'),'<View background="@drawable/background"/>');
 assert.deepEqual((await quality.activeRejected(w)).map(v=>v.path),['app/src/main/res/drawable/renamed.png']);await assert.rejects(require('../apps/desktop/agent/tools.cjs').execute(w,{action:'build_android'},new AbortController().signal,{authorizeBuild:()=>assert.fail('bad asset must be caught before authorization or build')}),{code:'VISUAL_ASSET_REJECTED'});await fs.writeFile(path.join(folder,'drawable/background.xml'),'<bitmap src="@drawable/clean"/>');assert.deepEqual(await quality.activeRejected(w),[]);
});
test('a screenshot defect never blacklists all project image dependencies',async t=>{
 const {w}=await fixture(t),o=await observe(w,'screen.png','screenshot');await quality.record(w,o,{inputHash:'screen',defects:[defect('watermark','截图中可见水印')]});assert.equal(w.run.visualQuality.rejectedAssets.length,0);
});
test('design navigation exposes the original large bitmap identity and frame without claiming it is qualified',()=>{
 const projection=require('../apps/desktop/agent/context-projections.cjs').designContext({screens:[{boardId:'board',reference:'render/png/main.png',baseline:{width:100,height:100,bitmaps:[{id:'sky',name:'source sky',image:'images/source.png',frame:{x:0,y:0,width:100,height:100}}],regions:[]}}]});
 assert.equal(projection.screens[0].baseline.bitmapSources[0].image,'images/source.png');assert.match(projection.notice,/不是已合格素材/);assert.match(projection.notice,/裁剪/);
});
test('real executor persists a structured image defect before continuing an unrelated implementation',async t=>{
 const {w,base}=await fixture(t);await fs.writeFile(path.join(w.files,'asset.png'),'IMAGE');await w.save();
 let step=0;const image={type:'image_url',image_url:{url:'data:image/png;base64,fixture'}};
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task:{id:'task',request:'检查素材并制作说明'},model:{contextWindow:131072},signal:new AbortController().signal,images:{prepare:async()=>({image,size:{width:100,height:100},original:{width:100,height:100}})},prepareModelMessages:async messages=>{
  const visual=messages.find(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));
  return {messages:messages.map(m=>Array.isArray(m.content)?{...m,content:'图片已观察，不是验收通过'}:m),reviews:visual?[{inputHash:'actual-review',sourceHash:require('../apps/desktop/model-routing.cjs').digest(visual.content),summary:'素材含水印',observations:['可见标识'],uncertainties:[],defects:[defect('watermark','素材带可见标识')]}]:[]};
 },ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return {content:JSON.stringify({action:'route',kind:'task'})};
  const actions=[{action:'plan',goal:'检查素材并制作说明',decisions:[],requirements:[{id:'v',text:'界面视觉要求同时满足',type:'visual'}],steps:[{id:'s',title:'检查与实现',status:'running'}]},{action:'view_image',path:'asset.png',purpose:'检查原始素材'},{action:'write_file',path:'notes.txt',content:'独立工作已完成'},{action:'pause',text:'等待继续视觉实现'}];return {content:JSON.stringify(actions[step++])};
 }});
 const saved=await createWorkspace(base,{id:'task'});assert.equal(await fs.readFile(path.join(saved.files,'notes.txt'),'utf8'),'独立工作已完成');assert.equal(saved.run.visualQuality.rejectedAssets[0].sha256,hash('IMAGE'));assert.equal(saved.run.visualQuality.constraints[0].status,'open');assert.notEqual(result.agentRun.status,'completed');
});
test('the same timed-out pixels get finite cooldown probes without repeat reads resetting the budget',async()=>{
 let at=0,calls=0;const image={role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,same'}}]},r={enabled:true,run:async(_lane,f)=>({result:await f({id:'v'}),model:{id:'v'}})};
 const prepare=createVisualRouter(r,{now:()=>at,retryDelayMs:10});const fail=()=>{calls++;throw timeout();};
 let result=await prepare([image],fail);assert.equal(result.failures[0].attempts,1);await prepare([image],fail);assert.equal(calls,1);
 at=10;result=await prepare([image],fail);assert.equal(result.failures[0].attempts,2);at=20;await prepare([image],fail);assert.equal(calls,3);at=100;await prepare([image],fail);assert.equal(calls,3);
 const recover=createVisualRouter(r,{now:()=>at,retryDelayMs:10});await recover([image],fail);at+=10;result=await recover([image],()=>({content:JSON.stringify({summary:'恢复后观察',observations:['实际图像可见'],uncertainties:[],defects:[],checks:[]})}));assert.equal(result.reviews.length,1);assert.equal(result.failures.length,0);
});
test('legacy synthetic model-unavailable state allows explicit bounded retry without claiming service restoration',()=>{
 const continuation=require('../apps/desktop/agent/task-continuation.cjs');const run={status:'blocked',inputKey:'old',events:[],steps:[],artifacts:[],waitingError:{code:'MODEL_HTTP_TRANSIENT',message:'此模型在本次执行中已不可用；自动备用切换已用尽，任务进度已保留。'}};
 assert.equal(continuation.update(run).state,'waiting_retry');assert.equal(continuation.canResume(run,{messages:[{id:'new',role:'user',content:'继续'}]}),true);assert.match(run.taskContinuation.question,/未发起新的模型请求/);
});
test('a tainted reference is disclosed as source information rather than a demand to reproduce its watermark',async t=>{
 const {w}=await fixture(t),o=await observe(w,'screen.png','clean actual');o.reference.sha256=hash('reference');await quality.record(w,o,{inputHash:'source-conflict',defects:[{kind:'watermark',subject:'reference',description:'原稿含可见标识，不能照搬'}]});
 quality.assertNoOpen(w.run);assert.equal(w.run.visualQuality.constraints[0].assetOnly,true);assert.equal(w.run.visualQuality.rejectedAssets[0].path,'reference.png');assert.equal(w.run.visualQuality.rejectedAssets[0].sha256,hash('reference'));
});
test('network normalization preserves the distinction between a failed request and a deferred one',()=>{
 const error=require('../apps/desktop/network-error.cjs').networkError({code:'MODEL_NETWORK',networkCode:'ERR_NETWORK_CHANGED',requestAttempted:false,lastErrorCode:'MODEL_NETWORK',retryAt:1234,recoveryExhausted:true});assert.equal(error.requestAttempted,false);assert.equal(error.retryAt,1234);assert.match(error.message,/未发起新的模型请求/);assert.doesNotMatch(error.message,/请检查/);
 const r={status:'blocked',waitingError:error,events:[],steps:[],artifacts:[]};assert.equal(require('../apps/desktop/agent/task-continuation.cjs').update(r).state,'waiting_retry');
});
test('exhausted transient visual service errors remain local without fabricating evidence',async()=>{
 const prepare=createVisualRouter({enabled:true,run:async()=>{throw Object.assign(Error('visual endpoint temporary failure'),{code:'MODEL_HTTP_TRANSIENT'});}});
 const result=await prepare([{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,fixture'}}]}],()=>assert.fail('router exhausted its bounded transport recovery'));
 assert.equal(result.reviews.length,0);assert.equal(result.failures[0].code,'MODEL_HTTP_TRANSIENT');assert.equal(result.failures[0].retryable,true);assert.equal(typeof result.messages[0].content,'string');
});

// Real browser-origin provenance distinguishes standalone rendering repairs
// from paired design comparisons. No model service or browser is started.
async function standaloneFixture(t){
 const {w}=await fixture(t);Object.assign(w.run,{executionId:'browser-execution',revision:1,requestContract:{version:1,executionId:'browser-execution',kind:'application',checks:{visual:true},explicit:{visual:false}}});
 w.run.requirements=[{id:'v',text:'标题与按钮在800×600视口内可读',type:'visual',scope:{kind:'viewport',path:'index.html',rect:{x:0,y:0,width:800,height:600}}}];
 await fs.writeFile(path.join(w.files,'index.html'),'initial');return w;
}
async function standaloneObservation(w,name,content,options={}){
 const image='verification/'+name;await fs.mkdir(path.dirname(path.join(w.files,image)),{recursive:true});await fs.writeFile(path.join(w.files,image),content);
 const page='index.html',sources=[{path:page,sha256:hash(await fs.readFile(path.join(w.files,page)))}],scope={kind:'viewport',path:page,rect:{x:0,y:0,width:800,height:600}},result={path:page,screenshot:image,sha256:hash(content),sources,scope,pixelSize:{width:1600,height:1200},dom:{text:'计数器 0 加1',missingImages:[],layoutHealth:{textNodes:3,clippedTextNodes:0,truncated:false},clipped:[],offscreen:0,overflow:{left:0,top:0,right:0,bottom:0}},errors:[],sourceAudit:{status:'not_required',sources:[]},...options};
 await w.event('browser',{operation:'open',revision:w.run.revision,result});return {...result,eventId:w.run.events.at(-1).id,path:image,revision:w.run.revision};
}
async function standaloneFinding(w){const first=await standaloneObservation(w,'unreadable.png','actual-unreadable');await quality.record(w,first,{inputHash:'actual-unreadable',defects:[{kind:'readability',subject:'actual',certainty:'confirmed',facet:'content',description:'标题和按钮实际显示编码乱码'}]});return w.run.visualQuality.constraints[0].id;}
test('a current full browser rendering closes its exact standalone defect without inventing a design reference',async t=>{
 for(const kind of ['application','document']){const w=await standaloneFixture(t);w.run.requestContract.kind=kind;const id=await standaloneFinding(w);await fs.writeFile(path.join(w.files,'index.html'),'charset-fixed');w.run.revision++;const current=await standaloneObservation(w,'readable.png','actual-readable');await quality.record(w,current,{inputHash:'current-readable',defects:[],checks:[{id,status:'matched',reason:'当前完整截图标题和按钮均显示正常中文，原乱码消失'}]});
 assert.equal(current.reference,undefined);assert.equal(w.run.visualQuality.constraints[0].status,'verified');await require('../apps/desktop/agent/problem-state.cjs').refresh(w);assert.equal(require('../apps/desktop/agent/problem-state.cjs').rows(w.run)[0].status,'resolved');assert.equal(w.run.acceptanceResults?.v,undefined,'repair observation is not full requirement acceptance');}
});
test('standalone repair still rejects the same pixels, crop, missing id and contrary finding',async t=>{
 const w=await standaloneFixture(t),id=await standaloneFinding(w),matched=[{id,status:'matched',reason:'当前截图已核对'}];
 for(const [name,bytes,extra,review]of [['same.png','actual-unreadable',{},{}],['crop.png','changed-crop',{transform:{crop:{x:0,y:0,width:10,height:10}}},{}],['omitted.png','changed-no-check',{}, {checks:[]}],['contrary.png','changed-contrary',{}, {defects:[{kind:'readability',subject:'actual',certainty:'confirmed',facet:'content',description:'当前标题依然不可读'}]}]]){const o=await standaloneObservation(w,name,bytes);await quality.record(w,{...o,...extra},{inputHash:name,defects:[],checks:matched,...review});assert.equal(w.run.visualQuality.constraints.find(c=>c.id===id).status,'open');}
});
test('design contract, adopted design source and missing browser provenance cannot use standalone closure',async t=>{
 for(const marker of ['contract','history','material','binding','preview','sourceAudit','no-browser','unknown-contract','no-contract','nonvisual-requirement']){const w=await standaloneFixture(t),id=await standaloneFinding(w);await fs.writeFile(path.join(w.files,'index.html'),'fixed');w.run.revision++;const options=marker==='binding'?{designBinding:{layout:'index.html',reference:'expected.png'}}:marker==='preview'?{previewOnly:true}:marker==='sourceAudit'?{sourceAudit:{status:'checked',sources:[{path:'design.json',sha256:hash('design')}]}}:{};const o=await standaloneObservation(w,marker+'.png','new-'+marker,options);if(marker==='contract')w.run.requestContract.kind='design';if(marker==='history')w.run.requestContractHistory=[{executionId:w.run.executionId,kind:'design'}];if(marker==='material')w.run.materialInput={uses:[{role:'design',requirementIds:['v']}]};if(marker==='no-browser')o.eventId='missing-browser-provenance';if(marker==='unknown-contract')w.run.requestContract.kind='unspecified';if(marker==='no-contract')delete w.run.requestContract;if(marker==='nonvisual-requirement')w.run.requirements[0].type='content';await quality.record(w,o,{inputHash:marker,defects:[],checks:[{id,status:'matched',reason:'当前截图已核对'}]});assert.equal(w.run.visualQuality.constraints[0].status,'open',marker);}
});
test('standalone closure rejects stale current dependencies and a smaller replacement viewport',async t=>{
 const w=await standaloneFixture(t),id=await standaloneFinding(w);let o=await standaloneObservation(w,'stale.png','fresh-image-old-source');await fs.writeFile(path.join(w.files,'index.html'),'changed-after-image');await assert.rejects(quality.record(w,o,{inputHash:'stale',checks:[{id,status:'matched',reason:'宣称已修复'}]}),/变化|过期/);assert.equal(w.run.visualQuality.constraints[0].status,'open');const rect={kind:'viewport',path:'index.html',rect:{x:0,y:0,width:400,height:300}};o=await standaloneObservation(w,'small.png','small-new-image',{scope:rect});await quality.record(w,o,{inputHash:'small',checks:[{id,status:'matched',reason:'局部可见'}]});assert.equal(w.run.visualQuality.constraints[0].status,'open');
});

// Legacy processed reports retain their dedupe keys. Upgrade reconciliation
// authenticates the original archive rather than replaying record or the VLM.
async function cacheStandaloneReview(w,o,checks,extra={}){
 const review={inputHash:hash(JSON.stringify([o.eventId,checks,extra])),sourceHash:hash('source-'+o.eventId),modelId:'fixture-vision',at:new Date().toISOString(),summary:'实际完整页面复核',observations:['真实页面中文可读'],uncertainties:[],defects:[],checks,...extra};
 await w.event('visual_analysis',{reviews:[structuredClone(review)]});const archived=w.run.events.at(-1),metadata={...structuredClone(review),detailsEventId:archived.id};
 let stored=w.run.visualObservations?.find(x=>x.eventId===o.eventId);if(!stored){stored={...structuredClone(o),modelReviews:[]};(w.run.visualObservations||=[]).push(stored);}stored.modelReviews.push(metadata);
 const key=hash(JSON.stringify([o.eventId,review.inputHash,review.defects,review.checks]));w.run.visualQuality.reviews.push(key);await w.save();return {o:stored,metadata,review,archived,key};
}
async function legacyStandalone(t,{kind='application',content='actual-fixed',options={}}={}){
 const w=await standaloneFixture(t),id=await standaloneFinding(w);w.run.requestContract.kind=kind;await fs.writeFile(path.join(w.files,'index.html'),'fixed');w.run.revision++;
 const current=await standaloneObservation(w,'legacy-fixed.png',content,options),cached=await cacheStandaloneReview(w,current,[{id,status:'matched',reason:'已逐项核对完整页面，原乱码消失'}]);
 w.run.status='paused';w.run.acceptanceResults={sentinel:{passed:true}};w.run.recoveryBudget={failures:3,reads:7};w.run.progressEvidence={writes:1};await w.save();return {w,id,...cached};
}
test('startup reconciles authenticated legacy matched reports without deleting dedupe, passing acceptance or resetting budgets',async t=>{
 for(const kind of ['application','document']){const {w,id}=await legacyStandalone(t,{kind}),dedupe=structuredClone(w.run.visualQuality.reviews),accepted=structuredClone(w.run.acceptanceResults),budget=structuredClone(w.run.recoveryBudget),progress=structuredClone(w.run.progressEvidence);
  const result=await quality.reconcileStandalone(w);assert.deepEqual(result,{changed:true,reconciledIds:[id],checked:1});assert.deepEqual(w.run.visualQuality.reviews,dedupe);assert.equal(w.run.problemState.records[id].data.status,'verified');assert.equal(w.run.status,'paused');assert.deepEqual(w.run.acceptanceResults,accepted);assert.deepEqual(w.run.recoveryBudget,budget);assert.deepEqual(w.run.progressEvidence,progress);
  await require('../apps/desktop/agent/problem-state.cjs').refresh(w);assert.equal(require('../apps/desktop/agent/problem-state.cjs').rows(w.run).find(r=>r.id===id).status,'resolved');const events=w.run.events.length;assert.equal((await quality.reconcileStandalone(w)).changed,false);assert.equal(w.run.events.length,events,'already reconciled status is naturally idempotent');
 }
});
test('cached standalone reconciliation requires original archived report and processed dedupe binding',async t=>{
 for(const marker of ['missing-archive','tampered-report','unprocessed','invalid-report']){const {w,id,metadata,key}=await legacyStandalone(t);if(marker==='missing-archive')metadata.detailsEventId='00000000-0000-0000-0000-000000000000';if(marker==='tampered-report')metadata.summary='模型从未给出的新结论';if(marker==='unprocessed')w.run.visualQuality.reviews=w.run.visualQuality.reviews.filter(k=>k!==key);if(marker==='invalid-report')metadata.checks[0].reason='';const result=await quality.reconcileStandalone(w);assert.equal(result.changed,false,marker);assert.equal(w.run.problemState.records[id].data.status,'open',marker);}
});
test('legacy cached repairs remain open for design, stale, crop, same pixels and forced candidate restoration',async t=>{
 for(const marker of ['design','history','design-material','unknown','stale','crop','same','smaller','candidateRecovery','forcedRestore']){const options=marker==='crop'?{transform:{crop:{x:0,y:0,width:10,height:10}}}:marker==='smaller'?{scope:{kind:'viewport',path:'index.html',rect:{x:0,y:0,width:400,height:300}}}:{};const {w,id}=await legacyStandalone(t,{content:marker==='same'?'actual-unreadable':'fixed-'+marker,options});
  if(marker==='design')w.run.requestContract.kind='design';if(marker==='history')w.run.requestContractHistory=[{executionId:w.run.executionId,kind:'design'}];if(marker==='design-material')w.run.materialInput={uses:[{role:'design',requirementIds:['v']}]};if(marker==='unknown')delete w.run.requestContract;if(marker==='stale')await fs.writeFile(path.join(w.files,'index.html'),'source changed after cached screenshot');if(marker==='candidateRecovery')w.run.candidateRecovery={transactionId:'restored-transaction'};if(marker==='forcedRestore')w.run.problemState.records[id].requiresVerificationAfter={at:new Date().toISOString(),existingEventIds:[],previousEvidenceIds:[]};
  const before=structuredClone(w.run.visualQuality.reviews),result=await quality.reconcileStandalone(w);assert.equal(result.changed,false,marker);assert.equal(w.run.problemState.records[id].data.status,'open',marker);assert.deepEqual(w.run.visualQuality.reviews,before,marker);
 }
});
test('a later mismatch or recurrence cannot be erased by an older archived matched report',async t=>{
 for(const marker of ['new-capture','same-capture','later-finding','reopened-same-id']){const {w,id,o}=await legacyStandalone(t);const later=marker==='new-capture'?await standaloneObservation(w,'regressed.png','actual-regressed'):o;
  if(marker==='later-finding')await quality.record(w,later,{inputHash:'new-contrary-defect',defects:[{kind:'readability',subject:'actual',certainty:'confirmed',description:'页面同区域出现新的编码错误'}]});
  else if(marker==='reopened-same-id'){const finding=await standaloneObservation(w,'reopened.png','new-bad-pixels');await quality.record(w,finding,{inputHash:'regression',checks:[{id,status:'mismatch',reason:'修复后中文再次乱码'}]});}
  else await cacheStandaloneReview(w,later,[{id,status:'mismatch',reason:'后续原问题依然存在'}]);
  assert.equal((await quality.reconcileStandalone(w)).changed,false,marker);assert.equal(w.run.problemState.records[id].data.status,'open',marker);
 }
});
test('reconciliation propagates real storage and assertion errors instead of silently reporting a skipped repair',async t=>{
 for(const code of ['EIO','ERR_ASSERTION']){const {w}=await legacyStandalone(t),event=w.event;w.event=async(...args)=>{if(args[0]==='visual_repair_reconciled')throw Object.assign(Error('actual storage or assertion failure'),{code});return event(...args);};await assert.rejects(quality.reconcileStandalone(w),{code});}
});
test('startup cached reconciliation bounds proof work and preserves remaining open problems',async t=>{
 const w=await standaloneFixture(t),before=await standaloneObservation(w,'many-before.png','many-unreadable');await quality.record(w,before,{inputHash:'many-original',defects:Array.from({length:9},(_,i)=>({kind:'readability',subject:'actual',description:'当前页面第 '+i+' 处乱码'}))});const ids=w.run.visualQuality.constraints.map(c=>c.id);assert.equal(ids.length,9);await fs.writeFile(path.join(w.files,'index.html'),'all fixed');w.run.revision++;
 const current=await standaloneObservation(w,'many-after.png','many-fixed');await cacheStandaloneReview(w,current,ids.map(id=>({id,status:'matched',reason:'当前完整页面已逐项核对'})));const dedupe=structuredClone(w.run.visualQuality.reviews),result=await quality.reconcileStandalone(w);assert.equal(result.checked,8);assert.equal(result.reconciledIds.length,8);assert.equal(w.run.visualQuality.constraints.filter(c=>c.status==='open').length,1);assert.deepEqual(w.run.visualQuality.reviews,dedupe);assert.equal((await quality.reconcileStandalone(w)).reconciledIds.length,1);
});

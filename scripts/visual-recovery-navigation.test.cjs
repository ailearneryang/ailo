const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const proof=require('../apps/desktop/agent/evidence.cjs'),visual=require('../apps/desktop/agent/visual-observation.cjs'),flow=require('../apps/desktop/agent/visual-workflow.cjs');
const recovery=require('../apps/desktop/agent/decision-recovery.cjs'),loop=require('../apps/desktop/agent/loop-recovery.cjs');
const navigation=require('../apps/desktop/agent/evidence-navigation.cjs');
const legacyMessage='自动截图预览不能替代原稿成对核验；请先 view_image(path=当前截图,reference=正确原稿)，再按实际图像检查。';
function png(){const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(1280,16);bytes.writeUInt32BE(720,20);return bytes;}
const images={prepare:async()=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,OFFLINE_FIXTURE'}}}),compare:async()=>({grossMismatch:false})};
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-visual-navigation-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'navigation',request:'按原稿还原Android界面并核验真实功能'},w=await createWorkspace(base,task);
 const board={_class:'page',layers:[{_class:'artboard',do_objectID:'home',name:'Home',frame:{x:0,y:0,width:1280,height:720},layers:[{_class:'rectangle',do_objectID:'card',name:'Card',frame:{x:20,y:20,width:300,height:200}}]}]};
 await fs.mkdir(path.join(w.files,'extract/pages'),{recursive:true});await fs.writeFile(path.join(w.files,'extract/pages/page.json'),JSON.stringify(board));
 for(const [file,body]of [['activity_main.xml','<FrameLayout/>'],['reference.png',png()],['screen.png',png()],['app.apk','current-apk'],['android-design.json',JSON.stringify({screens:[{boardId:'home',layout:'activity_main.xml',reference:'reference.png',screenshot:''}]})]])await fs.writeFile(path.join(w.files,file),body);
 const apkSha256=proof.hash(Buffer.from('current-apk')),sources=[{path:'app.apk',sha256:apkSha256},{path:'screen.png',sha256:proof.hash(png())}];
 await w.event('android_device',{operation:'screenshot',revision:w.run.revision,result:{path:'screen.png',apkPath:'app.apk',apkSha256,sessionId:'session',pixelSize:{width:1280,height:720},displayCheck:{matches:true},sources}});
 const shot=w.run.events.at(-1);w.run.artifacts=[{path:'app.apk',sha256:apkSha256}];w.run.requirementsManaged=true;w.run.requirements=[{id:'ui',text:'界面与原稿一致',type:'visual'}];w.run.acceptance=['界面与原稿一致'];w.run.steps=[{id:'review',title:'逐区核验',status:'running'}];w.run.inputKey='round';w.run.observationCapabilities={images:true,visualReview:true};w.run.progressEvidence=['existing-progress'];
 flow.enqueue(w.run,shot);w.run.visualObservations.at(-1).delivered=true;
 const unpaired=await visual.imageObservation(w,{path:'screen.png'},images);await w.event('view_image',{path:'screen.png',revision:w.run.revision,result:unpaired});const preview={...unpaired,eventId:w.run.events.at(-1).id,delivered:true};w.run.visualObservations.push(preview);
 const failed={action:{action:'verify',checks:[{criterionId:'ui',kind:'visual',evidenceId:preview.eventId,reason:'按原稿核对区域'}]},response:{error:legacyMessage}};
 failed.observationId=await w.archiveObservation(failed.action,failed.response);w.run.observationIndex=[{id:failed.observationId,action:'verify'}];w.run.observations=[failed];
 w.run.executionState={blocker:{action:'verify',code:'VISUAL_REVIEW_PENDING',message:legacyMessage},nextAction:'先view_image成对观察'};recovery.begin(w.run,'AGENT_LOOP',3);
 return {w,task,base,preview,shot,apkSha256};
}
async function pair(w,delivered=false){
 const result=await visual.imageObservation(w,{path:'screen.png',reference:'reference.png'},images);await w.event('view_image',{path:'screen.png',revision:w.run.revision,result});const image={...result,eventId:w.run.events.at(-1).id,previewOnly:false,delivered};w.run.visualObservations.push(image);return image;
}
async function structureFixture(t,nodeCount=3){
 const result=await fixture(t),{w,shot}=result,tree='<hierarchy>'+Array.from({length:nodeCount},(_,i)=>`<node package="com.example" resource-id="com.example:id/real_${i}" class="android.widget.TextView" text="captured node ${i}" content-desc="" bounds="[${i%16*20},${Math.floor(i/16)*20}][${i%16*20+15},${Math.floor(i/16)*20+15}]"${i<2?' visible-to-user="'+(i===0)+'"':''}/>`).join('')+'</hierarchy>';
 await fs.writeFile(path.join(w.files,'tree.xml'),tree);const treeHash=proof.hash(tree),capture={...shot.detail.result,package:'com.example',displayCheck:{matches:true,actual:{width:1280,height:720,density:160}},uiHierarchy:{path:'tree.xml',sha256:treeHash,package:'com.example',nodes:[{id:'invented-inline-node'}]},sources:[...shot.detail.result.sources,{path:'tree.xml',sha256:treeHash}]};
 await w.event('android_device',{operation:'screenshot',revision:w.run.revision,result:capture});w.run.visualObservations=[];w.run.observationCapabilities={images:false,visualReview:false};return {...result,capture,event:w.run.events.at(-1)};
}
function protectedState(run){return JSON.stringify({progress:run.progressEvidence,budget:{attempt:run.decisionRecovery?.attempt,maxOutputTokens:run.decisionRecovery?.maxOutputTokens,noActionTimeoutMs:run.decisionRecovery?.noActionTimeoutMs,progressKeys:run.decisionRecovery?.progressKeys},loops:run.loopEpisodes,repairs:run.validationRepairs,issues:run.designRegionIssues,acceptance:run.acceptanceResults});}
test('source deduplication is idempotent, clones the array and retains conflicting versions',()=>{
 const sources=[{path:'a',sha256:'old'},{path:'a',sha256:'old'},{path:'a',sha256:'new'},{path:'b',sha256:'ok'}],copy=structuredClone(sources),result=visual.deduplicateSources(sources);
 assert.deepEqual(result,[sources[0],sources[2],sources[3]]);assert.deepEqual(visual.deduplicateSources(result),result);assert.notEqual(result,sources);assert.deepEqual(sources,copy);
});
test('repeated pair preparation preserves original screenshot sources and cannot grow duplicate dependencies',async t=>{
 const {w,shot}=await fixture(t),original=structuredClone(shot.detail.result.sources);let previous;
 for(let i=0;i<4;i++){const image=await pair(w);const keys=image.sources.map(s=>JSON.stringify([s.path,s.sha256]));assert.equal(new Set(keys).size,keys.length);if(previous!==undefined)assert.equal(keys.length,previous);previous=keys.length;assert.deepEqual(shot.detail.result.sources,original);}
 await assert.rejects(visual.assertSources(w,{sources:[...original,...original,{path:'app.apk',sha256:'0'.repeat(64)}]}),/app\.apk/);
});
test('prepared pairs stay awaiting delivery and cannot clear the old waiter or create progress',async t=>{
 const {w}=await fixture(t),image=await pair(w),before=protectedState(w.run),nav=await navigation.context(w);
 assert.equal(await flow.reconcilePending(w,nav),false);assert.equal(w.run.executionState.blocker.code,'VISUAL_REVIEW_PENDING');assert.equal(w.run.decisionRecovery.focus.code,'VISUAL_REVIEW_PENDING');assert.equal(protectedState(w.run),before);
 const context=flow.context(w.run,{screens:[]},nav);assert.equal(context.status,'awaiting_delivery');assert.match(context.instruction,/本请求将提供/);assert.equal(image.delivered,false);
});
test('actual delivered same-version pair redirects only navigation and prevents stale next-action advice',async t=>{
 const {w}=await fixture(t),image=await pair(w,true),before=protectedState(w.run),nav=await navigation.context(w);
 assert.equal(await flow.reconcilePending(w,nav),true);assert.equal(w.run.executionState.blocker.code,'VISUAL_REVIEW_READY');assert.equal(w.run.decisionRecovery.focus.navigation.resolvedBy,image.eventId);assert.equal(protectedState(w.run),before);
 const snapshot=recovery.compact({executionState:w.run.executionState,decisionRecovery:w.run.decisionRecovery,steps:w.run.steps},x=>x);assert.match(snapshot.decisionRecovery.nextAction,/已有成对图/);assert.match(snapshot.decisionRecovery.instruction,/不能作为行为/);assert.equal(w.run.acceptanceResults,undefined);
 assert.equal(await flow.reconcilePending(w,nav),false);
 const context=flow.context(w.run,{screens:[]},nav);assert.equal(context.status,'paired_delivered');assert.match(context.instruction,/无需再次/);assert.match(context.instruction,/kind=visual/);
});
test('stale APK, changed screenshot and failed or missing pair never clear a waiter',async t=>{
 for(const change of ['apk','pixels','missing']){
  const {w}=await fixture(t);if(change!=='missing')await pair(w,true);
  if(change==='apk')await fs.writeFile(path.join(w.files,'app.apk'),'new-apk');if(change==='pixels')await fs.writeFile(path.join(w.files,'screen.png'),'changed-pixels');
  const before=protectedState(w.run);assert.equal(await flow.reconcilePending(w,await navigation.context(w)),false);assert.equal(w.run.decisionRecovery.focus.code,'VISUAL_REVIEW_PENDING');assert.equal(protectedState(w.run),before);
 }
});
test('regional pending errors, true mismatch and unrelated blockers are never dismissed by paired delivery',async t=>{
 for(const [code,message]of [['VISUAL_REVIEW_PENDING','请补充逐区域观察节点'],['DESIGN_REGION_MISMATCH','真实组件缺失'],['ACCEPTANCE_FAILED','功能未满足原要求']]){
  const {w}=await fixture(t);await pair(w,true);w.run.executionState.blocker={action:'verify',code,message};w.run.decisionRecovery.focus={...w.run.executionState.blocker};w.run.designRegionIssues={card:{status:'open',finding:'mismatch',regionId:'card'}};
  const before=JSON.stringify(w.run);assert.equal(await flow.reconcilePending(w,await navigation.context(w)),false);assert.equal(JSON.stringify(w.run),before);
 }
});
test('an old preview waiter redirects to repair when the real pair still has a gross visual mismatch',async t=>{
 const {w}=await fixture(t),image=await pair(w,true);image.comparison={grossMismatch:true};w.run.designRegionIssues={card:{status:'open',finding:'mismatch',regionId:'card'}};const before=protectedState(w.run);
 assert.equal(await flow.reconcilePending(w,await navigation.context(w)),true);assert.equal(w.run.decisionRecovery.focus.code,'VISUAL_REPAIR_REQUIRED');assert.equal(protectedState(w.run),before);assert.match(w.run.decisionRecovery.focus.message,/先修复/);
});
test('loop receipts distinguish previews from paired visual-only candidates without granting credit',async t=>{
 const {w,preview}=await fixture(t),image=await pair(w,true),nav=await navigation.context(w);const state=loop.begin(w.run,{action:{action:'view_image',path:image.path,reference:image.reference.path},location:{path:image.path},receipt:{eventId:image.eventId},navigation:nav});
 const previewRow=state.evidence.find(e=>e.eventId===preview.eventId),pairRow=state.evidence.find(e=>e.eventId===image.eventId);assert.equal(previewRow.previewOnly,true);assert.deepEqual(previewRow.allowedKinds,[]);assert.equal(pairRow.previewOnly,false);assert.equal(pairRow.reference.path,'reference.png');assert.deepEqual(pairRow.allowedKinds,['visual']);assert.equal(state.blockedAction.reference,'reference.png');assert.equal(state.attempt,1);assert.deepEqual(w.run.progressEvidence,['existing-progress']);
});
test('legacy pending recovery can use the exact independent archive without scanning event logs',async t=>{
 const {w}=await fixture(t),image=await pair(w,true);w.run.observations=[];const original=w.observationRecord.bind(w);let reads=0;w.observationRecord=async(id,options)=>{assert.equal(options.archiveOnly,true);reads++;return original(id,options);};
 assert.equal(await flow.reconcilePending(w,await navigation.context(w)),true);assert.ok(reads>0);assert.equal(w.run.decisionRecovery.focus.navigation.resolvedBy,image.eventId);
});
test('a derived ready hint cannot keep advertising a pair after its APK changes',async t=>{
 const {w}=await fixture(t);await pair(w,true);await flow.reconcilePending(w,await navigation.context(w));const before=protectedState(w.run);
 await fs.writeFile(path.join(w.files,'app.apk'),'new-version');assert.equal(await flow.reconcilePending(w,await navigation.context(w)),true);assert.equal(w.run.decisionRecovery.focus.code,'VISUAL_REVIEW_REFRESH_REQUIRED');assert.equal(protectedState(w.run),before);
});
test('typed waiters require the exact screenshot, reference and APK identities',async t=>{
 for(const field of ['sha256','reference','apkSha256']){
  const {w,preview}=await fixture(t);await pair(w,true);w.run.observations=[];w.run.observationIndex=[];const waiter=navigation.pendingNavigation(preview,{criterionId:'ui',evidenceId:preview.eventId});
  if(field==='reference')waiter.reference={path:'other.png',sha256:proof.hash(png())};else waiter[field]='0'.repeat(64);
  w.run.executionState.blocker.navigation=waiter;w.run.decisionRecovery.focus.navigation=waiter;
  assert.equal(await flow.reconcilePending(w,await navigation.context(w)),false);assert.equal(w.run.decisionRecovery.focus.code,'VISUAL_REVIEW_PENDING');
 }
});
test('unrelated legacy image records cannot hide an otherwise complete exact-target pair',async t=>{
 const {w}=await fixture(t),image=await pair(w,true);w.run.visualObservations.unshift({eventId:require('node:crypto').randomUUID(),path:'old-shot.png',sha256:'1'.repeat(64),sources:[{path:'old.apk',sha256:'2'.repeat(64)}],delivered:true});
 assert.equal(await flow.reconcilePending(w,await navigation.context(w)),true);assert.equal(w.run.decisionRecovery.focus.navigation.resolvedBy,image.eventId);
});
test('an unknown record of the same target cannot be treated as complete unique-reference coverage',async t=>{
 const {w}=await fixture(t),image=await pair(w,true);w.run.visualObservations.unshift({...image,eventId:require('node:crypto').randomUUID(),reference:{path:'other-reference.png',sha256:'3'.repeat(64)}});
 assert.equal(await flow.reconcilePending(w,await navigation.context(w)),false);assert.equal(w.run.decisionRecovery.focus.code,'VISUAL_REVIEW_PENDING');
});
test('runner refreshes navigation only after real paired image delivery and does not add progress for the refresh',async t=>{
 const {w,base,task}=await fixture(t),round=require('../apps/desktop/agent/execution-rounds.cjs').inputKey({role:'user',content:task.request});
 Object.assign(w.run,{status:'blocked',mode:'task',goal:task.request,inputKey:round,currentRequest:task.request});w.run.decisionRecovery.inputKey=round;await w.save();
 let calls=0,active,beforeDeliveryProgress,afterDeliveryProgress;
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task,images,model:{contextWindow:131072,imageInput:'enabled'},signal:new AbortController().signal,maxSteps:8,onWorkspace:workspace=>{active=workspace;},ask:async messages=>{
  const snapshot=JSON.parse(messages.at(-1).content),n=calls++;
  if(n===0)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(n===1){assert.equal(snapshot.executionState.blocker.code,'VISUAL_REVIEW_PENDING');return {content:JSON.stringify({action:'view_image',path:'screen.png',reference:'reference.png'})};}
  if(n===2){assert.equal(snapshot.pendingVisualReview.status,'awaiting_delivery');assert.equal(snapshot.executionState.blocker.code,'VISUAL_REVIEW_PENDING');assert.equal(messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url').length,2);beforeDeliveryProgress=JSON.stringify(active.run.progressEvidence);return {content:JSON.stringify({action:'read_execution',id:'state',limit:1000})};}
  assert.equal(n,3);assert.equal(snapshot.executionState.blocker.code,'VISUAL_REVIEW_READY');assert.equal(snapshot.decisionRecovery.focus.code,'VISUAL_REVIEW_READY');assert.equal(snapshot.pendingVisualReview.status,'paired_delivered');afterDeliveryProgress=JSON.stringify(active.run.progressEvidence);assert.equal(afterDeliveryProgress,beforeDeliveryProgress);assert.equal(snapshot.acceptanceCriteria[0].check,undefined);return {content:JSON.stringify({action:'pause',text:'离线测试停止点，验收仍待真实逐区检查'})};
 }});
 assert.equal(calls,4);assert.equal(result.agentRun.status,'paused');assert.equal(afterDeliveryProgress,beforeDeliveryProgress);assert.notEqual(result.agentRun.acceptanceCriteria[0].status,'passed');
});
test('a failed native-image request cannot mark delivery or clear the pending navigation',async t=>{
 const {w,base,task}=await fixture(t),round=require('../apps/desktop/agent/execution-rounds.cjs').inputKey({role:'user',content:task.request});Object.assign(w.run,{status:'blocked',mode:'task',goal:task.request,inputKey:round,currentRequest:task.request});w.run.decisionRecovery.inputKey=round;await w.save();let calls=0,active;
 await assert.rejects(require('../apps/desktop/agent/runner.cjs').runAgent({base,task,images,model:{contextWindow:131072,imageInput:'enabled'},signal:new AbortController().signal,maxSteps:8,onWorkspace:value=>{active=value;},ask:async messages=>{
  const n=calls++;if(n===0)return {content:JSON.stringify({action:'route',kind:'task'})};if(n===1)return {content:JSON.stringify({action:'view_image',path:'screen.png',reference:'reference.png'})};
  assert.equal(n,2);assert.equal(JSON.parse(messages.at(-1).content).pendingVisualReview.status,'awaiting_delivery');throw Object.assign(Error('offline response headers timeout'),{code:'MODEL_CONNECT_TIMEOUT'});
 }}),{code:'MODEL_CONNECT_TIMEOUT'});
 assert.equal(active.run.visualObservations.at(-1).delivered,false);assert.equal(active.run.executionState.blocker.code,'VISUAL_REVIEW_PENDING');assert.equal(active.run.decisionRecovery.focus.code,'VISUAL_REVIEW_PENDING');assert.equal(active.run.acceptanceResults,undefined);
});
test('explicit same-execution user continuation replays a single existing current APK receipt once without progress or device proof',async t=>{
 const {w}=await fixture(t),image=await pair(w,true);w.run.executionId='same-execution';await w.event('user_continuation',{origin:'user',executionId:w.run.executionId,previousStatus:'blocked'});const boundary=w.run.events.at(-1),before=protectedState(w.run),events=w.run.events.length,count=w.run.visualObservations.length;
 assert.equal(await flow.replay(w,{userContinuationEvent:boundary}),true);assert.equal(w.run.visualObservations.at(-1),image);assert.equal(image.delivered,false);assert.equal(image.replayKind,'user_continuation');assert.equal(w.run.events.length,events);assert.equal(w.run.visualObservations.length,count);assert.equal(protectedState(w.run),before);assert.equal(await flow.replay(w,{userContinuationEvent:boundary}),false);
 const messages=await visual.messages(w,w.run.visualObservations,images);assert.equal(messages.length,1);assert.equal(messages[0].eventId,image.eventId);assert.match(JSON.stringify(messages),/历史诊断重放/);assert.match(JSON.stringify(messages),/不能作为新会话运行证明/);assert.equal(w.run.acceptanceResults,undefined);
});
test('automatic segments, scheduled or foreign continuation boundaries and stale APKs cannot trigger desktop replay',async t=>{
 const {w}=await fixture(t),image=await pair(w,true);w.run.executionId='execution';assert.equal(await flow.replay(w),false);
 for(const detail of [{origin:'scheduled',executionId:'execution',previousStatus:'blocked'},{origin:'user',executionId:'foreign',previousStatus:'blocked'},{origin:'user',executionId:'execution',previousStatus:'completed'}]){await w.event('user_continuation',detail);assert.equal(await flow.replay(w,{userContinuationEvent:w.run.events.at(-1)}),false);assert.equal(image.delivered,true);}
 await w.event('user_continuation',{origin:'user',executionId:'execution',previousStatus:'paused'});await fs.writeFile(path.join(w.files,'app.apk'),'new-apk');assert.equal(await flow.replay(w,{userContinuationEvent:w.run.events.at(-1)}),false);assert.equal(image.delivered,true);
 w.run.runtimeContinuation={kind:'assisted_resume',deviceState:'new_environment'};await w.event('evaluation_resume',{kind:'assisted_resume'});assert.equal(await flow.replay(w,{allowAssisted:false}),false);
});
test('desktop continuation redelivers paired pixels before reuse without executing another image tool',async t=>{
 const {w,base,task}=await fixture(t),image=await pair(w,true),round=require('../apps/desktop/agent/execution-rounds.cjs').inputKey({role:'user',content:task.request});Object.assign(w.run,{executionId:require('node:crypto').randomUUID(),status:'blocked',mode:'task',goal:task.request,inputKey:round,currentRequest:task.request});w.run.decisionRecovery.inputKey=round;await w.save();let calls=0,active;const oldViews=w.run.events.filter(e=>e.type==='view_image').length;
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task,requestOrigin:'user',images,model:{contextWindow:131072,imageInput:'enabled'},signal:new AbortController().signal,maxSteps:5,onWorkspace:value=>{active=value;},ask:async messages=>{
  const snapshot=JSON.parse(messages.at(-1).content),n=calls++;if(n===0)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(n===1){assert.equal(snapshot.pendingVisualReview.status,'awaiting_delivery');assert.equal(snapshot.executionState.blocker.code,'VISUAL_REVIEW_PENDING');assert.equal(messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url').length,2);return {content:JSON.stringify({action:'read_execution',id:'state',limit:1000})};}
  assert.equal(n,2);assert.equal(snapshot.executionState.blocker.code,'VISUAL_REVIEW_READY');return {content:JSON.stringify({action:'pause',text:'离线测试已验证历史像素重放，未宣称设备重启或验收通过'})};
 }});
 assert.equal(calls,3);assert.equal(result.agentRun.status,'paused');assert.equal(active.run.events.filter(e=>e.type==='view_image').length,oldViews);assert.equal(active.run.visualObservations.filter(o=>o.eventId===image.eventId).length,1);assert.deepEqual(active.run.progressEvidence,['existing-progress']);assert.equal(active.run.visualObservations.at(-1).delivered,true);
});
test('text-only structure navigation uses hash-verified captured nodes independently of images or pair delivery',async t=>{
 const {w,event}=await structureFixture(t),before=JSON.stringify(w.run),nav=await navigation.context(w),structure=nav.androidStructure;
 assert.equal(structure.status,'available');assert.equal(structure.eventId,event.id);assert.equal(structure.nodes.complete,true);assert.equal(structure.nodes.returned,3);assert.equal(structure.nodes.items[0].id,'node_0');assert.equal(structure.nodes.items[0].resourceId,'com.example:id/real_0');assert.deepEqual(structure.nodes.items[0].bounds,{x:0,y:0,width:15,height:15});assert.equal(structure.nodes.items[0].visible,true);assert.equal(structure.nodes.items[1].visible,false);assert.equal(structure.nodes.items[2].visible,undefined);assert.equal(structure.coordinateSystem.density,160);assert.equal(structure.coordinateSystem.dpPerPixel,1);assert.deepEqual(structure.allowedKinds,[]);assert.equal(structure.visualAcceptance,'unverified');assert.equal(structure.behaviorAcceptance,'unverified');assert.deepEqual(nav.byKind.visual,[]);assert.equal(JSON.stringify(w.run),before);
});
test('structure sampling is bounded and unknown visibility is never fabricated',async t=>{
 const {w}=await structureFixture(t,140),structure=(await navigation.context(w)).androidStructure;assert.equal(structure.nodes.returned,128);assert.equal(structure.nodes.total,140);assert.equal(structure.nodes.complete,false);assert.equal(structure.nodes.truncated,true);assert.equal(structure.nodes.items[127].visible,undefined);
});
test('stale or tampered structure, screenshot, APK and inline-only unbound nodes are rejected',async t=>{
 for(const kind of ['tree','pixels','apk','hash','source','inline','package']){
  const {w,capture}=await structureFixture(t);
  if(kind==='tree')await fs.writeFile(path.join(w.files,'tree.xml'),'<hierarchy/>');if(kind==='pixels')await fs.writeFile(path.join(w.files,'screen.png'),'other-pixels');if(kind==='apk')await fs.writeFile(path.join(w.files,'app.apk'),'new-apk');
  if(kind==='hash')capture.uiHierarchy.sha256='not-a-hash';if(kind==='source')capture.sources=capture.sources.filter(s=>s.path!=='tree.xml');if(kind==='inline')delete capture.uiHierarchy.path;if(kind==='package')capture.uiHierarchy.package='unrelated.package';
  const before=protectedState(w.run);assert.equal((await navigation.context(w)).androidStructure.status,'unavailable');assert.equal(protectedState(w.run),before);assert.equal(w.run.acceptanceResults,undefined);
 }
});
test('combined checks expose their recorded screenshot child as structure source, never synthesize outer proof',async t=>{
 const {w,capture,event}=await structureFixture(t);await w.event('android_device',{operation:'check',result:{...capture,checks:[{operation:'screenshot',eventId:event.id}]}});const outer=w.run.events.at(-1);w.run.events=w.run.events.filter(e=>e.id!==event.id);
 const structure=(await navigation.context(w)).androidStructure;assert.equal(structure.status,'available');assert.equal(structure.eventId,event.id);assert.notEqual(structure.eventId,outer.id);
});
test('official text-only GLM keeps old paired receipts unaccepted, sends zero image blocks and still gets actual structure',async t=>{
 const {w,base,task}=await structureFixture(t),oldPair=await pair(w,true),oldViews=w.run.events.filter(e=>e.type==='view_image').length,round=require('../apps/desktop/agent/execution-rounds.cjs').inputKey({role:'user',content:task.request});Object.assign(w.run,{executionId:require('node:crypto').randomUUID(),status:'blocked',mode:'task',goal:task.request,inputKey:round,currentRequest:task.request});w.run.decisionRecovery.inputKey=round;await w.save();let calls=0,active;
 const model={model:'glm-5.2',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',imageInput:'auto',contextWindow:131072},observer={...images,prepare:async()=>{assert.fail('text-only task must not prepare image input');}};
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task,requestOrigin:'user',images:observer,model,signal:new AbortController().signal,maxSteps:4,onWorkspace:value=>{active=value;},ask:async messages=>{
  assert.equal(messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url'||p.type==='input_image').length,0);const snapshot=JSON.parse(messages.at(-1).content),n=calls++;
  if(n===0)return {content:JSON.stringify({action:'route',kind:'task'})};assert.equal(n,1);assert.equal(snapshot.observationCapabilities.images,false);assert.equal(snapshot.observationCapabilities.imageTransport,false);assert.equal(snapshot.observationCapabilities.source,'documented_text_model');assert.equal(snapshot.verificationEvidence.androidStructure.status,'available');assert.equal(snapshot.verificationEvidence.androidStructure.nodes.items[0].resourceId,'com.example:id/real_0');assert.equal(snapshot.pendingVisualReview.status,'unavailable');assert.equal(snapshot.acceptanceCriteria[0].check,undefined);return {content:JSON.stringify({action:'pause',text:'离线测试保存结构诊断，视觉尚未验证'})};
 }});
 assert.equal(calls,2);assert.equal(result.agentRun.status,'paused');assert.deepEqual(active.run.progressEvidence,['existing-progress']);assert.equal(active.run.visualObservations.find(o=>o.eventId===oldPair.eventId).delivered,true);assert.notEqual(result.agentRun.acceptanceCriteria[0].status,'passed');assert.equal(active.run.events.filter(e=>e.type==='view_image').length,oldViews);
});

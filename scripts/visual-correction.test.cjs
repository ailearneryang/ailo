const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const visual=require('../apps/desktop/agent/visual-observation.cjs');
const design=require('../apps/desktop/agent/android-design.cjs');
const acceptance=require('../apps/desktop/agent/acceptance.cjs');
function png(){const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(1280,16);b.writeUInt32BE(720,20);return b;}
const images={prepare:async bytes=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}}}),compare:async()=>({grossMismatch:true,changedFraction:.98,meanDifference:.5})};
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-visual-correction-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'visual',request:'还原Android设计'},w=await createWorkspace(base,task);
 await fs.mkdir(path.join(w.files,'extract/pages'),{recursive:true});
 await fs.writeFile(path.join(w.files,'extract/pages/home.json'),JSON.stringify({_class:'page',layers:[{_class:'artboard',do_objectID:'home',name:'Home',frame:{width:1280,height:720},layers:[]}]}));
 await fs.writeFile(path.join(w.files,'layout.xml'),'<layout/>');
 await fs.writeFile(path.join(w.files,'reference.png'),png());
 await fs.writeFile(path.join(w.files,'app.apk'),'apk-v1');
 await fs.writeFile(path.join(w.files,'android-design.json'),JSON.stringify({screens:[{boardId:'home',layout:'layout.xml',reference:'reference.png',screenshot:'old.png'}]}));
 w.run.artifacts=[{path:'app.apk',sha256:visual.hash(Buffer.from('apk-v1'))}];
 w.run.requirementsManaged=true;w.run.requirements=[{id:'ui',text:'与原稿布局一致',type:'visual',scope:{kind:'viewport',path:'layout.xml'}}];
 w.run.steps=[{id:'ui',title:'实现主页面',status:'done'}];w.run.visualObservations=[];
 return {base,task,w};
}
async function screenshot(w,name='current.png'){
 await fs.writeFile(path.join(w.files,name),png());
 const result={path:name,apkPath:'app.apk',apkSha256:w.run.artifacts[0].sha256,pixelSize:{width:1280,height:720},displayCheck:{matches:true},sources:[{path:name,sha256:visual.hash(png())},{path:'app.apk',sha256:w.run.artifacts[0].sha256}]};
 await w.event('android_device',{operation:'screenshot',revision:w.run.revision,result});
 return w.run.events.at(-1);
}
async function observe(w,options={}){
 const result=await visual.imageObservation(w,{path:'current.png',reference:'reference.png',...options},images);
 delete result.image;
 await w.event('view_image',{revision:w.run.revision,result});
 const observation={...result,eventId:w.run.events.at(-1).id,transform:options.crop?{crop:options.crop}:{},delivered:false};
 w.run.visualObservations.push(observation);design.recordComparison(w,observation);return observation;
}
test('current APK screenshot is paired with the reference on every review and blocks known mismatch',async t=>{
 const {w,base,task}=await fixture(t);await screenshot(w);
 w.run.acceptanceResults={ui:{status:'passed'}};
 const o=await observe(w);assert.equal(w.run.steps[0].status,'running');assert.equal(w.run.acceptanceResults.ui,undefined);
 assert.equal(o.scope.path,'layout.xml');
 const outgoing=await visual.messages(w,[{eventId:'old-reference',delivered:true},o],images);
 assert.equal(outgoing.length,1);assert.equal(outgoing[0].message.content.filter(c=>c.type==='image_url').length,2);
 o.delivered=true;await w.save();
 const saved=await createWorkspace(base,task);assert.throws(()=>visual.assertComparisons(saved.run),/已知原稿差异/);
 await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'ui',kind:'visual',evidenceId:o.eventId,reason:'比较完整主界面'}]}),/大面积差异/);
 await assert.rejects(design.assertDelivery(w,images),/大面积外观差异/);
 const repeat=await observe(w);assert.equal((await visual.messages(w,[repeat],images))[0].message.content.filter(c=>c.type==='image_url').length,2);
 assert.throws(()=>visual.assertComparisons(w.run),/已知原稿差异/);
});
test('a repaired full comparison uses latest screenshot without editing the old config and still requires semantic verification',async t=>{
 const {w}=await fixture(t);await screenshot(w);await observe(w);
 await screenshot(w,'repaired.png');
 const repaired=await visual.imageObservation(w,{path:'repaired.png',reference:'reference.png'},{...images,compare:async()=>({grossMismatch:false})});
 delete repaired.image;await w.event('view_image',{revision:w.run.revision,result:repaired});
 const o={...repaired,eventId:w.run.events.at(-1).id,delivered:true};
 w.run.visualObservations.push(o);design.recordComparison(w,o);visual.assertComparisons(w.run);
 await assert.rejects(acceptance.assertAccepted(w),/尚未核验/);
 await acceptance.verify(w,{checks:[{criterionId:'ui',kind:'visual',evidenceId:o.eventId,reason:'逐项比较区域、卡片、文字及资源，数据变化不改变布局'}]});
 await acceptance.assertAccepted(w);
 await design.assertDelivery(w,{compare:async()=>({grossMismatch:false})});
 await fs.writeFile(path.join(w.files,'layout.xml'),'<changed/>');
 await assert.rejects(acceptance.assertAccepted(w),/依赖文件已变化/);
});
test('crop, stale reference and stale APK cannot discharge an existing mismatch',async t=>{
 const {w}=await fixture(t);await screenshot(w);await observe(w);
 const crop=await observe(w,{crop:{x:0,y:0,width:100,height:100}});
 assert.equal(crop.comparison,undefined);assert.throws(()=>visual.assertComparisons(w.run),/已知原稿差异/);
 await fs.writeFile(path.join(w.files,'reference.png'),Buffer.concat([png(),Buffer.from('changed')]));
 assert.equal((await visual.messages(w,w.run.visualObservations,images)).length,0);
 await fs.writeFile(path.join(w.files,'app.apk'),'apk-v2');
 await assert.rejects(visual.imageObservation(w,{path:'current.png',reference:'reference.png'},images),/依赖文件已变化/);
});
test('Android behavior observations bind real successful operations to unchanged APK, not screenshots to interaction claims',async t=>{
 const {w}=await fixture(t);
 w.run.requirements=[{id:'launch',text:'APK启动成功',type:'behavior',scope:{kind:'file',path:'app.apk'}}];
 const result={apkPath:'app.apk',apkSha256:w.run.artifacts[0].sha256,output:'Status: ok',scope:{kind:'file',path:'app.apk'},sources:[{path:'app.apk',sha256:w.run.artifacts[0].sha256}]};
 await w.event('android_device',{operation:'launch',result});const id=w.run.events.at(-1).id;
 await acceptance.verify(w,{checks:[{criterionId:'launch',kind:'observation',evidenceId:id,reason:'am start返回Status ok，仅证明启动'}]});
 await acceptance.assertAccepted(w);
 await w.event('android_device',{operation:'launch',result:{...result,output:'Error: activity missing'}});
 await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'launch',kind:'observation',evidenceId:w.run.events.at(-1).id,reason:'检查启动结果'}]}),/有效成功结果/);
 await fs.writeFile(path.join(w.files,'app.apk'),'apk-v2');await assert.rejects(require('../apps/desktop/agent/evidence.cjs').event(w,id),/依赖文件已变化/);
});
test('named image tool exposes reference and unrelated pending observations are not dropped behind delivered ones',async t=>{
 const tool=require('../apps/desktop/agent/protocol.cjs').actionTools({phase:'task'}).find(t=>t.function.name==='view_image');
 assert.equal(tool.function.parameters.properties.reference.type,'string');
 const {w}=await fixture(t);await screenshot(w);const o=await observe(w);
 const sent=await visual.messages(w,[o,{delivered:true},{delivered:true}],images);assert.equal(sent[0].eventId,o.eventId);
});
test('real runner sends paired images, reopens done work immediately and persists mismatches across continuation',async t=>{
 const {base,task,w}=await fixture(t);await screenshot(w);await w.save();
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:task.request,decisions:[],requirements:w.run.requirements,steps:[{id:'ui',title:'还原主页面',status:'done'}]},{action:'view_image',path:'current.png',reference:'reference.png'},{action:'blocked',text:'界面缺失组件，未完成交付'}];
 let n=0;
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task,images,model:{contextWindow:65536,imageInput:'auto'},signal:new AbortController().signal,ask:async messages=>{
  if(n===3){
   const state=JSON.parse(messages.at(-1).content);
   assert.equal(state.steps[0].status,'running');assert.equal(state.designComparisons[0].comparison.grossMismatch,true);
   assert.equal(messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='image_url').length,2);
  }
  assert.ok(n<actions.length);return {content:JSON.stringify(actions[n++])};
 }});
 assert.equal(n,4);assert.equal(result.agentRun.status,'blocked');
 const saved=await createWorkspace(base,task);assert.throws(()=>visual.assertComparisons(saved.run),/已知原稿差异/);
 assert.equal(saved.run.visualObservations.at(-1).delivered,true);
 assert.ok(!JSON.stringify(saved.run).includes('data:image/png;base64'));
});
test('generic image mismatch cannot be waived by text-only automatic delivery or unrelated new comparisons',async t=>{
 const {w}=await fixture(t);
 const o={path:'result.png',reference:{path:'ref.png'},comparison:{grossMismatch:true}};
 design.recordComparison(w,o);
 design.recordComparison(w,{path:'unchecked.png',reference:{path:'ref.png'}});
 assert.throws(()=>visual.assertComparisons(w.run),/已知原稿差异/);
 design.recordComparison(w,{path:'another.png',reference:{path:'another-ref.png'},comparison:{grossMismatch:false}});
 assert.throws(()=>visual.assertComparisons(w.run),/已知原稿差异/);
 assert.match(w.run.executionState.nextAction,/成对检查/);
 w.run.steps[0].status='done';w.run.mode='task';w.run.inputKey='input';w.run.acceptanceInputKey='input';
 w.run.observationCapabilities={images:false,visualReview:false};
 assert.equal(await require('../apps/desktop/agent/completion-policy.cjs').automaticDelivery(w),null);
});

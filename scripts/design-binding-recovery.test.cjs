const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const design=require('../apps/desktop/agent/android-design.cjs');
const visual=require('../apps/desktop/agent/visual-observation.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {hash}=require('../apps/desktop/agent/evidence.cjs');
function png(width=1280,height=720){const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes;}
const images={prepare:async bytes=>({size:{width:1280,height:720},image:{type:'image_url',image_url:{url:'data:image/png;base64,OFFLINE_FIXTURE'}}}),compare:async()=>({grossMismatch:false})};
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-binding-recovery-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const w=await createWorkspace(base,{id:'binding',request:'按原稿还原Android界面'});
 const page={_class:'page',layers:[{_class:'artboard',do_objectID:'home',name:'Home',frame:{x:0,y:0,width:1280,height:720},layers:[{_class:'rectangle',do_objectID:'card',name:'Card',frame:{x:20,y:20,width:300,height:200},style:{fills:[{isEnabled:true,fillType:0,color:{red:1,green:1,blue:1,alpha:1}}]}}]}]};
 await fs.mkdir(path.join(w.files,'extract/pages'),{recursive:true});await fs.writeFile(path.join(w.files,'extract/pages/page.json'),JSON.stringify(page));await fs.writeFile(path.join(w.files,'activity_main.xml'),'<FrameLayout/>');await fs.writeFile(path.join(w.files,'reference.png'),png());
 const screen={boardId:'home',layout:'activity_main.xml',reference:'reference.png',screenshot:''};
 const save=async entry=>fs.writeFile(path.join(w.files,'android-design.json'),JSON.stringify({screens:[entry]}));await save(screen);
 w.run.requirementsManaged=true;w.run.requirements=[{id:'ui',text:'界面与原稿一致',type:'visual'}];w.run.acceptance=['界面与原稿一致'];w.run.acceptanceTypes=['visual'];w.run.observationCapabilities={images:true,visualReview:true};return {w,screen,save};
}
async function screenshot(w){
 await fs.writeFile(path.join(w.files,'app.apk'),'current-apk');await fs.writeFile(path.join(w.files,'screen.png'),png());const apkSha=hash(Buffer.from('current-apk'));
 await w.event('android_device',{operation:'screenshot',revision:w.run.revision,result:{path:'screen.png',apkPath:'app.apk',apkSha256:apkSha,pixelSize:{width:1280,height:720},displayCheck:{matches:true},sources:[{path:'screen.png',sha256:hash(png())},{path:'app.apk',sha256:apkSha}]}});w.run.artifacts=[{path:'app.apk',sha256:apkSha}];return apkSha;
}

test('an empty optional screenshot does not block viewing a reference but cannot satisfy final delivery',async t=>{
 const {w,screen,save}=await fixture(t);
 for(const value of ['', '   ',undefined]){
  await save({...screen,screenshot:value});const parsed=await design.inspect(w.files);assert.equal(parsed.screens[0].screenshot,undefined);
  const observed=await visual.imageObservation(w,{path:'reference.png'},images);assert.equal(observed.path,'reference.png');assert.equal(observed.designBinding,undefined);
  await assert.rejects(design.assertDelivery(w),error=>error.code==='ANDROID_DESIGN_MISMATCH'&&/尚无绑定的最终运行截图/.test(error.message));
 }
});

test('configuration field errors identify the binding and reject invalid screenshot types and escaped paths',async t=>{
 const {w,screen,save}=await fixture(t);
 for(const value of [null,false,7,{},[], '../outside.png','/tmp/outside.png']){
  await save({...screen,screenshot:value});await assert.rejects(visual.imageObservation(w,{path:'reference.png'},images),error=>error.code==='ANDROID_DESIGN_BINDING_INVALID'&&error.bindingField==='screens[0].screenshot'&&error.message.includes('android-design.json screens[0].screenshot'));
 }
 for(const key of ['layout','reference'])for(const value of ['',null,'../outside.xml']){
  await save({...screen,[key]:value});await assert.rejects(design.inspect(w.files),error=>error.code==='ANDROID_DESIGN_BINDING_INVALID'&&error.bindingField==='screens[0].'+key);
 }
});

test('a current APK screenshot can be paired while the optional binding is empty; regional review is still required',async t=>{
 const {w}=await fixture(t);const apkSha=await screenshot(w);
 const observed=await visual.imageObservation(w,{path:'screen.png',reference:'reference.png'},images);
 assert.equal(observed.designBinding.boardId,'home');assert.equal(observed.designBinding.apkSha256,apkSha);assert.equal(observed.scope.path,'activity_main.xml');assert.equal(observed.reference.path,'reference.png');assert.ok(observed.designManifest.regions.length);
 // Successfully observing the pair is not a visual acceptance result.
 w.run.visualComparisons=[observed];await assert.rejects(design.assertDelivery(w),/逐区域验收记录/);
});

test('an old APK screenshot remains stale and cannot be revalidated through a draft placeholder',async t=>{
 const {w}=await fixture(t);await screenshot(w);await fs.writeFile(path.join(w.files,'app.apk'),'newer-apk');
 await assert.rejects(visual.imageObservation(w,{path:'screen.png',reference:'reference.png'},images),/证据依赖文件已变化.*app.apk/);
 w.run.artifacts=[{path:'app.apk',sha256:hash(Buffer.from('newer-apk'))}];await assert.rejects(design.assertDelivery(w),/尚无绑定的最终运行截图/);
});

test('matching a reference with itself is still rejected with the exact screenshot field',async t=>{
 const {w,screen,save}=await fixture(t);await save({...screen,screenshot:'reference.png'});
 await assert.rejects(design.inspect(w.files),error=>error.code==='ANDROID_DESIGN_BINDING_INVALID'&&error.bindingField==='screens[0].screenshot'&&/不能使用同一文件/.test(error.message));
});

test('an Android preview cannot become a visual pass through an unpaired view_image',async t=>{
 const {w}=await fixture(t);await screenshot(w);
 const result=await visual.imageObservation(w,{path:'screen.png'},images);assert.equal(result.previewOnly,true);assert.equal(result.designBinding,undefined);
 await w.event('view_image',{path:'screen.png',revision:w.run.revision,result});const event=w.run.events.at(-1);w.run.visualObservations=[{...result,eventId:event.id,delivered:true}];
 await assert.rejects(require('../apps/desktop/agent/acceptance.cjs').verify(w,{checks:[{criterionId:'ui',kind:'visual',evidenceId:event.id,reason:'核验预览'}]}),{code:'VISUAL_REVIEW_PENDING'});
 assert.notEqual(w.run.acceptanceResults?.ui?.status,'passed');
 const paired=await visual.imageObservation(w,{path:'screen.png',reference:'reference.png'},images);assert.notEqual(paired.previewOnly,true);assert.equal(paired.designBinding.boardId,'home');
 await fs.writeFile(path.join(w.files,'unbound-reference.png'),png());await assert.rejects(visual.imageObservation(w,{path:'screen.png',reference:'unbound-reference.png'},images),{code:'ANDROID_DESIGN_BINDING_INVALID'});
});

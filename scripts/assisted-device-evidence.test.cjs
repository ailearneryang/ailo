const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),proof=require('../apps/desktop/agent/evidence.cjs');
const delivery=require('../apps/desktop/agent/android-delivery.cjs'),visual=require('../apps/desktop/agent/visual-observation.cjs');
const display={width:1280,height:720,density:160,source:'explicit',sources:[]};
const images={prepare:async()=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,FIXTURE'}}})};
function png(){const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(display.width,16);bytes.writeUInt32BE(display.height,20);return bytes;}
async function event(w,type,detail){await w.event(type,detail);return w.run.events.at(-1);}
async function device(w,operation,sessionId,extra={}){
 const apk={sessionId,apkPath:'app.apk',apkSha256:proof.hash(Buffer.from('same-apk')),sources:[{path:'app.apk',sha256:proof.hash(Buffer.from('same-apk'))}]};
 let result=operation==='start'?{sessionId,running:true,display}:operation==='install'?{...apk,installed:true}:operation==='launch'?{...apk,output:'Status: ok'}:operation==='logs'?{...apk,running:true,output:'fixture normal log'}:{...apk,path:'shot-'+randomUUID()+'.png',pixelSize:{width:display.width,height:display.height},display,displayCheck:{matches:true,actual:{width:display.width,height:display.height,density:display.density}}};
 result={...result,...extra};if(operation==='screenshot'){await fs.writeFile(path.join(w.files,result.path),png());result.sources=[...(result.sources||[]),{path:result.path,sha256:proof.hash(png())}];}
 return event(w,'android_device',{operation,result});
}
async function chain(w,sessionId=randomUUID(),options={}){const events={};for(const op of ['start','install','launch','screenshot'])if(!options.skip?.includes(op)){if(options.distinctTimes)await new Promise(resolve=>setTimeout(resolve,3));events[op]=await device(w,op,options.sessions?.[op]||sessionId,options.results?.[op]);}return events;}
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-assisted-device-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'device-proof',request:'安装运行并截图'},w=await createWorkspace(base,task);await fs.writeFile(path.join(w.files,'app.apk'),'same-apk');w.run.artifacts=[{path:'app.apk',sha256:proof.hash(Buffer.from('same-apk'))}];w.run.acceptance=['安装运行并截图'];w.run.acceptanceTypes=['behavior'];w.run.visualObservations=[];const oldSession=randomUUID(),old=await chain(w,oldSession);old.logs=await device(w,'logs',oldSession);return {base,task,w,oldSession,old};}
async function resume(w){w.run.runtimeContinuation={kind:'assisted_resume',deviceState:'new_environment'};return event(w,'evaluation_resume',{kind:'assisted_resume',deviceState:'new_environment'});}
async function observe(w,imagePath){const result=await visual.imageObservation(w,{path:imagePath},images),e=await event(w,'view_image',{result});w.run.visualObservations.push({...result,eventId:e.id,delivered:true});return e;}

test('an assisted new device cannot finish from cloned APK screenshots or old running receipts',async t=>{
 const {w,old}=await fixture(t);await resume(w);
 await assert.rejects(delivery.assertAndroidDelivery(w),{code:'ANDROID_ASSISTED_RUNTIME_REQUIRED'});
 for(const op of ['install','launch','screenshot','logs'])await assert.rejects(proof.event(w,old[op].id),{code:'ANDROID_ASSISTED_RUNTIME_REQUIRED'});
 assert.equal(w.run.events.filter(e=>e.type==='android_device').length,5);assert.equal(w.run.artifacts.length,1);
});

test('old screenshots remain viewable references but cannot become new-device visual acceptance by viewing again',async t=>{
 const {w,old}=await fixture(t),before=await observe(w,old.screenshot.detail.result.path);await resume(w);
 await assert.rejects(proof.event(w,before.id),{code:'ANDROID_ASSISTED_RUNTIME_REQUIRED'});
 const after=await observe(w,old.screenshot.detail.result.path);assert.equal(after.detail.result.path,old.screenshot.detail.result.path);
 await assert.rejects(proof.event(w,after.id),{code:'ANDROID_ASSISTED_RUNTIME_REQUIRED'});
});

test('a new successful same-session start/install/launch/screenshot chain validates current APK without resetting history or requiring unrelated logs',async t=>{
 const {base,task,w,old}=await fixture(t),boundary=await resume(w),current=await chain(w);
 w.run.revision+=100;await delivery.assertAndroidDelivery(w);await proof.event(w,current.screenshot.id);const view=await observe(w,current.screenshot.detail.result.path);await proof.event(w,view.id);
 assert.ok(w.run.events.some(e=>e.id===old.screenshot.id));assert.ok(w.run.events.some(e=>e.id===boundary.id));await w.save();
 const reloaded=await createWorkspace(base,task);await delivery.assertAndroidDelivery(reloaded);assert.equal(reloaded.run.runtimeContinuation.deviceState,'new_environment');
});

test('each missing new stage, incorrect APK, missing session and mixed sessions reject runtime completion',async t=>{
 const variants=[...['start','install','launch'].map(op=>({skip:[op]})),{sessions:{install:randomUUID()}},{sessions:{launch:randomUUID()}},{results:{screenshot:{sessionId:undefined}}},{results:{install:{installed:false}}},{results:{launch:{output:'Status: error'}}},{results:{install:{apkSha256:proof.hash(Buffer.from('other-apk'))}}},{results:{install:{sources:[]}}}];
 for(const options of variants){const {w}=await fixture(t);await resume(w);await chain(w,randomUUID(),options);await assert.rejects(delivery.assertAndroidDelivery(w),{code:'ANDROID_ASSISTED_RUNTIME_REQUIRED'});}
});

test('source sessions and a chain preceding the latest assisted boundary cannot be reused as a new environment',async t=>{
 const {w,oldSession}=await fixture(t);await resume(w);await chain(w,oldSession);await assert.rejects(delivery.assertAndroidDelivery(w),{code:'ANDROID_ASSISTED_RUNTIME_REQUIRED'});
 await chain(w);await delivery.assertAndroidDelivery(w);await resume(w);await assert.rejects(delivery.assertAndroidDelivery(w),{code:'ANDROID_ASSISTED_RUNTIME_REQUIRED'});
});

test('a real new install is independently checkable before launch and later bookkeeping does not invalidate a valid runtime chain',async t=>{
 const {w}=await fixture(t);await resume(w);const session=randomUUID();await device(w,'start',session);const install=await device(w,'install',session);await proof.event(w,install.id);
 await assert.rejects(delivery.assertAndroidDelivery(w),{code:'ANDROID_ASSISTED_RUNTIME_REQUIRED'});
 await device(w,'launch',session);const shot=await device(w,'screenshot',session);await device(w,'start',session);await proof.event(w,shot.id);await delivery.assertAndroidDelivery(w);
});

test('no-crash acceptance requires a fresh successful logs receipt in the same new APK session and preserves crash rejection',async t=>{
 const {w}=await fixture(t);w.run.acceptance=['安装运行并截图，无已知崩溃'];await resume(w);const session=randomUUID();await chain(w,session);
 await assert.rejects(delivery.assertAndroidDelivery(w),{code:'ANDROID_ASSISTED_LOGS_REQUIRED'});
 await device(w,'logs',randomUUID());await assert.rejects(delivery.assertAndroidDelivery(w),{code:'ANDROID_ASSISTED_LOGS_REQUIRED'});
 await device(w,'logs',session,{running:false});await assert.rejects(delivery.assertAndroidDelivery(w),{code:'ANDROID_ASSISTED_LOGS_REQUIRED'});
 await device(w,'logs',session,{output:'FATAL EXCEPTION: fixture'});await assert.rejects(delivery.assertAndroidDelivery(w),{code:'ANDROID_ASSISTED_LOGS_REQUIRED'});
 const logs=await device(w,'logs',session);await delivery.assertAndroidDelivery(w);await proof.event(w,logs.id);
});

test('normal continuations, browser evidence and standalone reference images retain their prior contracts',async t=>{
 const {w,old}=await fixture(t);await delivery.assertAndroidDelivery(w);await proof.event(w,old.screenshot.id);
 w.run.runtimeContinuation={kind:'assisted_resume',deviceState:'existing_environment'};await delivery.assertAndroidDelivery(w);
 await resume(w);await fs.writeFile(path.join(w.files,'reference.png'),png());const reference=await observe(w,'reference.png');await proof.event(w,reference.id);
 const browser=await event(w,'browser',{result:{dom:{text:'original browser state'},sources:[{path:'app.apk',sha256:proof.hash(Buffer.from('same-apk'))}]}});await proof.event(w,browser.id);
});

test('archive lookup preserves the boundary after recent events are evicted, while ambiguous equal-time old receipts cannot pass',async t=>{
 const {w}=await fixture(t);const boundary=await resume(w);await new Promise(resolve=>setTimeout(resolve,5));const current=await chain(w,randomUUID(),{distinctTimes:true});for(let n=0;n<105;n++)await event(w,'fixture_bookkeeping',{index:n});assert.ok(!w.run.events.some(e=>e.id===boundary.id));await delivery.assertAndroidDelivery(w);await proof.event(w,current.screenshot.id);
 const saved=current.screenshot.at;current.screenshot.at=boundary.at;const original=w.findEvent.bind(w);w.findEvent=async predicate=>predicate(current.screenshot)?current.screenshot:original(predicate);await assert.rejects(delivery.assertAssistedDeviceEvidence(w,current.screenshot),{code:'ANDROID_ASSISTED_RUNTIME_REQUIRED'});current.screenshot.at=saved;
});

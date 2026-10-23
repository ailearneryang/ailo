const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const design=require('../apps/desktop/agent/android-design.cjs'),{compareSamples,createImageObserver}=require('../apps/desktop/agent/image-observer.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{hash}=require('../apps/desktop/agent/evidence.cjs');
function png(width=1280,height=720){const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);return b;}
const source={_class:'page',layers:[{_class:'group',do_objectID:'home',name:'Weather home',frame:{x:500,y:600,width:2560,height:1440},layers:[{_class:'symbolInstance',do_objectID:'card',name:'Forecast',symbolID:'card-master',frame:{x:864,y:154,width:1610,height:512}}]},{_class:'symbolMaster',symbolID:'card-master',frame:{width:805,height:256},layers:[{_class:'text',do_objectID:'label',name:'Title',frame:{x:10,y:20,width:120,height:30},attributedString:{string:'Future weather',attributes:[{attributes:{MSAttributedStringFontAttribute:{attributes:{size:24,name:'Roboto'}},MSAttributedStringColorAttribute:{red:1,green:1,blue:1,alpha:1}}}]}},{_class:'bitmap',do_objectID:'sky',name:'Sky',frame:{x:0,y:0,width:805,height:256},image:{_ref:'images/sky.png'}}]}]};
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-design-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const w=await createWorkspace(root,{id:'design',request:'按Sketch还原Android界面并截图'});
 await fs.mkdir(path.join(w.files,'extract/pages'),{recursive:true});await fs.writeFile(path.join(w.files,'extract/pages/page.json'),JSON.stringify(source));
 return w;
}
async function bind(w,extra={}){
 const screen={boardId:'home',layout:'activity_main.xml',reference:'Weather home.png',screenshot:'screen.png',...extra};
 await fs.writeFile(path.join(w.files,'android-design.json'),JSON.stringify({screens:[screen]}));return screen;
}
test('Android source baseline binds exact boards and expands component geometry without page offset',async t=>{
 const w=await setup(t);let result=await design.inspect(w.files);assert.equal(result.status,'binding_required');assert.equal(result.candidates.length,1);
 await bind(w);result=await design.inspect(w.files); // Source remains available before implementation exists.
 assert.equal(result.screens[0].baseline.texts[0].text,'Future weather');assert.deepEqual(result.screens[0].baseline.texts[0].frame,{x:884,y:194,width:240,height:60});
 assert.equal(result.screens[0].baseline.texts[0].font.size,48);assert.equal(result.screens[0].baseline.texts[0].font.sourceSize,24);
 assert.deepEqual(design.context(result,{width:1280,height:720,widthDp:1280,heightDp:720}).screens[0].coordinateMapping.dpPerSourcePixel,{x:.5,y:.5});
 assert.equal(result.screens[0].baseline.bitmaps[0].image,'images/sky.png');assert.ok(result.issues.some(s=>s.includes('尚不存在')));
 await bind(w,{boardId:'invented'});await assert.rejects(design.inspect(w.files),/真实/);
 await bind(w,{reference:'../escape.png'});await assert.rejects(design.inspect(w.files),/相对路径|不允许/);
});
test('large-area mismatch detection tolerates local data changes and never claims visual approval',()=>{
 const pixels=64*36,sky=Buffer.alloc(pixels*4),dark=Buffer.alloc(pixels*4);
 for(let i=0;i<pixels;i++){sky.set([220,170,110,255],i*4);dark.set([46,26,26,255],i*4);}
 assert.equal(compareSamples(sky,dark).grossMismatch,true);
 const edited=Buffer.from(sky);dark.copy(edited,0,0,pixels*4*.15);
 assert.equal(compareSamples(sky,edited).grossMismatch,false);assert.equal(compareSamples(sky,sky).grossMismatch,false);
 assert.match(compareSamples(sky,sky).notice,/不代表/);
});
test('native comparison decodes and bounds both inputs even without model image capability',async()=>{
 let sampled=0;
 const native={createFromBuffer:bytes=>({isEmpty:()=>!bytes.length,getSize:()=>({width:2560,height:1440}),resize:options=>{assert.deepEqual(options,{width:64,height:36,quality:'best'});sampled++;return {toBitmap:()=>Buffer.alloc(64*36*4,bytes[0])};}})};
 const observer=createImageObserver(native);assert.equal((await observer.compare(Buffer.from([0]),Buffer.from([255]))).grossMismatch,true);assert.equal(sampled,2);
 await assert.rejects(observer.compare(Buffer.alloc(0),Buffer.from([1])),/无法解码/);
});
test('limited delivery cannot waive missing design bindings, stale APK screenshots or known large differences',async t=>{
 const w=await setup(t);w.run.acceptance=['主界面与Sketch设计一致'];w.run.acceptanceTypes=['visual'];w.run.observationCapabilities={images:false,visualReview:false};
 w.run.steps=[{id:'design',status:'done'}];
 await assert.rejects(design.assertDelivery(w),e=>{design.rememberFailure(w,e);return e.code==='ANDROID_DESIGN_MISMATCH';});
 assert.equal(w.run.steps[0].status,'running');assert.ok(w.run.executionState.gaps.length);
 await bind(w);await fs.writeFile(path.join(w.files,'activity_main.xml'),'<layout/>');await fs.writeFile(path.join(w.files,'Weather home.png'),png());await fs.writeFile(path.join(w.files,'screen.png'),png());
 await assert.rejects(design.assertDelivery(w),/匹配当前 APK/);
 await fs.writeFile(path.join(w.files,'app.apk'),'v1');w.run.artifacts=[{path:'app.apk',sha256:hash(Buffer.from('v1'))}];
 const sources=await Promise.all(['app.apk','screen.png'].map(async p=>({path:p,sha256:hash(await fs.readFile(path.join(w.files,p)))})));
 await w.event('android_device',{operation:'screenshot',result:{path:'screen.png',pixelSize:{width:1280,height:720},apkSha256:w.run.artifacts[0].sha256,sources}});
 await assert.rejects(design.assertDelivery(w,{compare:async()=>({grossMismatch:true,meanDifference:.4,changedFraction:.95})}),/大面积外观差异/);
 await design.assertDelivery(w,{compare:async()=>({grossMismatch:false})});assert.equal(w.run.executionState.gaps.length,0);
 await fs.writeFile(path.join(w.files,'screen.png'),png(320,640));await assert.rejects(design.assertDelivery(w),/变化/);
});
test('non-visual APK build tasks do not acquire design rendering requirements',async t=>{
 const w=await setup(t);w.run.acceptance=['仅构建APK'];w.run.acceptanceTypes=['content'];await design.assertDelivery(w);
});
test('duplicate extraction trees and unrelated build output do not truncate the source graph',async t=>{
 const w=await setup(t);await fs.mkdir(path.join(w.files,'second/pages'),{recursive:true});
 await fs.copyFile(path.join(w.files,'extract/pages/page.json'),path.join(w.files,'second/pages/page.json'));
 await fs.mkdir(path.join(w.files,'app/build'),{recursive:true});
 await Promise.all(Array.from({length:1600},(_,i)=>fs.writeFile(path.join(w.files,'app/build',i+'.json'),'{}')));
 const graph=await require('../apps/desktop/agent/sketch-fidelity.cjs').readSource(w.files);assert.equal(graph.truncated,false);assert.equal(graph.pages.length,1);assert.equal(graph.sources.length,1);
});
test('previously read source cannot be deleted to evade the Android design check',async t=>{
 const w=await setup(t);w.run.acceptance=['UI还原'];w.run.acceptanceTypes=['visual'];
 design.rememberSource(w.run,await design.inspect(w.files));
 assert.equal(w.run.androidDesignSourceBaseline.sources.length,1);
 await fs.rm(path.join(w.files,'extract'),{recursive:true});
 await assert.rejects(design.assertDelivery(w),/原稿数据已修改或删除/);
});
test('agent finish reopens design work rather than marking an unimplemented Sketch UI as limited completion',async t=>{
 // Use a separate workspace with a stable base so the real runner owns all state.
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-design-runner-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const task={id:'native',request:'按Sketch还原Android APK界面'},project=await createWorkspace(root,task);
 await fs.mkdir(path.join(project.files,'extract/pages'),{recursive:true});await fs.writeFile(path.join(project.files,'extract/pages/page.json'),JSON.stringify(source));
 await fs.writeFile(path.join(project.files,'app.apk'),'apk');await fs.writeFile(path.join(project.files,'screen.png'),png(2560,1440));
 const apkHash=hash(Buffer.from('apk'));project.run.artifacts=[{path:'app.apk',sha256:apkHash}];
 await project.event('android_device',{operation:'screenshot',revision:project.run.revision,result:{path:'screen.png',pixelSize:{width:2560,height:1440},apkSha256:apkHash,display:{width:2560,height:1440,density:160,source:'explicit'},displayCheck:{matches:true,actual:{width:2560,height:1440,density:160}},sources:[{path:'app.apk',sha256:apkHash},{path:'screen.png',sha256:hash(png(2560,1440))}]}});await project.save();
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:'还原Android APK界面',decisions:[],requirements:[{id:'ui',text:'外观与Sketch设计一致',type:'visual'}],steps:[{id:'ui',title:'还原界面',status:'done'}]},{action:'finish',outcome:'limited',text:'APK已生成，外观待人工核验',review:{summary:'交付APK',issues:[],unverified:['ui']}},{action:'blocked',text:'设计尚未实现，保留未完成状态'}];
 let calls=0,sawRepair=false;
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base:root,task,model:{contextWindow:65536,imageInput:'disabled'},signal:new AbortController().signal,ask:async messages=>{
  const snapshot=JSON.parse(messages.at(-1).content);
  if(calls===3){assert.equal(snapshot.steps[0].status,'running');assert.equal(snapshot.androidDesign.status,'binding_required');assert.ok(snapshot.executionState.gaps.some(g=>g.includes('Android 设计')));sawRepair=true;}
  return {content:JSON.stringify(actions[calls++])};
 }});
 assert.equal(sawRepair,true);assert.notEqual(result.agentRun.status,'completed');assert.equal(result.agentRun.acceptanceCriteria[0].status,'pending');
});

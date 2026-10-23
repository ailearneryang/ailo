const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{hash}=require('../apps/desktop/agent/evidence.cjs');
const design=require('../apps/desktop/agent/android-design.cjs'),regions=require('../apps/desktop/agent/design-regions.cjs');
const visual=require('../apps/desktop/agent/visual-observation.cjs'),acceptance=require('../apps/desktop/agent/acceptance.cjs');
function png(suffix=''){const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(1200,16);b.writeUInt32BE(800,20);return Buffer.concat([b,Buffer.from(suffix)]);}
const frames=Array.from({length:6},(_,i)=>({x:40+i%3*300,y:160+Math.floor(i/3)*240,width:260,height:200}));
function board(){return {_class:'artboard',do_objectID:'dashboard',name:'Independent dashboard',frame:{width:1200,height:800},layers:[{_class:'group',do_objectID:'content',name:'Metric tiles',frame:{x:0,y:0,width:1200,height:700},layers:frames.map((frame,i)=>({_class:'rectangle',do_objectID:'tile-'+i,name:'Tile '+i,frame,style:{fills:[{color:{red:1,green:1,blue:1,alpha:.6}}]}}))},{_class:'group',do_objectID:'controls',name:'Device controls',frame:{x:0,y:700,width:1200,height:100},layers:[]}]};}
function hierarchy(bounds=frames){return Buffer.from('<hierarchy>'+bounds.map((f,i)=>`<node package="app.test" resource-id="app.test:id/tile${i}" class="android.widget.FrameLayout" text="${i}" content-desc="" bounds="[${f.x},${f.y}][${f.x+f.width},${f.y+f.height}]"/>`).join('')+'</hierarchy>');}
const images={prepare:async bytes=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}}}),compare:async()=>({grossMismatch:false,changedFraction:.033,meanDifference:.076,visualAcceptance:'unverified'})};
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-region-review-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'t',request:'Implement this dashboard'},w=await createWorkspace(base,task);
 await fs.mkdir(path.join(w.files,'extract/pages'),{recursive:true});await fs.writeFile(path.join(w.files,'extract/pages/p.json'),JSON.stringify({_class:'page',layers:[board()]}));
 await fs.writeFile(path.join(w.files,'layout.xml'),'<layout/>');await fs.writeFile(path.join(w.files,'reference.png'),png());await fs.writeFile(path.join(w.files,'app.apk'),'v1');
 await fs.writeFile(path.join(w.files,'android-design.json'),JSON.stringify({screens:[{boardId:'dashboard',layout:'layout.xml',reference:'reference.png'}]}));
 w.run.requirementsManaged=true;w.run.requirements=[{id:'ui',text:'All regions match original design',type:'visual',scope:{kind:'viewport',path:'layout.xml'}}];w.run.observationCapabilities={images:true};w.run.steps=[{id:'ui',status:'done'}];w.run.visualObservations=[];return {w,base,task};
}
async function observe(w,suffix='',bounds=frames){
 await fs.writeFile(path.join(w.files,'current.png'),png(suffix));const bytes=hierarchy(bounds);await fs.writeFile(path.join(w.files,'ui.xml'),bytes);
 const sources=await Promise.all(['current.png','app.apk','ui.xml'].map(async p=>({path:p,sha256:hash(await fs.readFile(path.join(w.files,p)))})));
 const apkSha256=sources.find(s=>s.path==='app.apk').sha256;w.run.artifacts=[{path:'app.apk',sha256:apkSha256}];
 await w.event('android_device',{operation:'screenshot',result:{path:'current.png',apkPath:'app.apk',apkSha256,pixelSize:{width:1200,height:800},displayCheck:{matches:true},sources,uiHierarchy:{path:'ui.xml',sha256:hash(bytes),package:'app.test'}}});
 const result=await visual.imageObservation(w,{path:'current.png',reference:'reference.png'},images);delete result.image;
 await w.event('view_image',{revision:w.run.revision,result});const o={...result,eventId:w.run.events.at(-1).id,delivered:true};w.run.visualObservations.push(o);design.recordComparison(w,o);return o;
}
function reports(o,basis='hierarchy'){return o.designManifest.regions.map(r=>({id:r.id,status:'matched',reason:r.id==='controls'?'专用设备控制区完整显示，逐项核对控件语义及位置':'逐项核对六张卡片，间距、颜色、文字与图标完整可见',repeats:r.repeats.map(g=>({id:g.id,observedCount:g.count,rows:g.rows,columns:g.columns,basis,nodeIds:frames.map((_,i)=>'node_'+i),reason:'逐列逐行确认卡片边界，动态数值变化保留布局'}))}));}
function verify(w,o,r){return acceptance.verify(w,{checks:[{criterionId:'ui',kind:'visual',evidenceId:o.eventId,reason:'逐区域核对当前APK运行结果',...(r?{regions:r}:{})}]});}
test('source manifest extracts repeated grids without task names and emits explicit Android ARGB',()=>{
 const b=design.describe(board(),new Map()),m=b.designManifest;
 assert.equal(m.regions.length,2);assert.equal(m.regions[0].repeats.length,1);assert.equal(m.regions[0].repeats[0].count,6);assert.equal(m.regions[0].repeats[0].rows,2);assert.equal(m.regions[0].repeats[0].columns,3);
 assert.equal(design.color({red:1,green:1,blue:1,alpha:.6}),'#ffffff99');assert.equal(design.androidColor({red:1,green:1,blue:1,alpha:.6}),'#99ffffff');
 const other=board();other.layers[0].layers=other.layers[0].layers.slice(0,3);assert.equal(design.describe(other,new Map()).designManifest.regions[0].repeats[0].count,3);
});
test('mixed symbol and detached group tiles remain one grid, while stacked background layers are not repeated controls',()=>{
 const b=board(),master={symbolID:'tile',frame:{width:260,height:200},layers:[]};
 b.layers[0].layers=frames.map((frame,i)=>i<3?{_class:'symbolInstance',do_objectID:'s'+i,symbolID:'tile',frame}:{_class:'group',do_objectID:'g'+i,frame,layers:[]});
 let m=design.describe(b,new Map([['tile',master]])).designManifest;assert.equal(m.regions[0].repeats[0].count,6);assert.deepEqual([m.regions[0].repeats[0].rows,m.regions[0].repeats[0].columns],[2,3]);
 b.layers[0].layers=Array.from({length:3},(_,i)=>({_class:'group',do_objectID:'overlay'+i,frame:{x:0,y:0,width:1200,height:700},layers:[]}));
 m=design.describe(b,new Map()).designManifest;assert.equal(m.regions[0].repeats.length,0);
});
test('matching sky/background and a 3.3% colour score do not satisfy visual acceptance without regional checks',async t=>{
 const {w}=await fixture(t),o=await observe(w);
 await assert.rejects(verify(w,o),/逐项覆盖/);assert.equal(w.run.acceptanceResults?.ui,undefined);
 await assert.rejects(design.assertDelivery(w,images),/逐区域验收记录/);
 const bad=reports(o);bad[0].repeats[0].observedCount=1;
 await assert.rejects(verify(w,o,bad),/数量或排列不符/);assert.equal(w.run.steps[0].status,'running');assert.equal(regions.issues(w.run).length,1);
});
test('a same-count wrong grid, invented controls or clipped positions cannot pass hierarchy checks',async t=>{
 const {w}=await fixture(t);
 let o=await observe(w,'wrong-grid',frames.map((f,i)=>({...f,x:40+i*160,y:160,width:120,height:200})));
 await assert.rejects(verify(w,o,reports(o)),/控件树未证明/);
 o=await observe(w,'invented');const invented=reports(o);invented[0].repeats[0].nodeIds[5]='node_999';await assert.rejects(verify(w,o,invented),/控件树未证明/);
 o=await observe(w,'tiny',frames.map(f=>({x:f.x+f.width/2,y:f.y+f.height/2,width:1,height:1})));await assert.rejects(verify(w,o,reports(o)),/控件树未证明/);
 o=await observe(w,'clipped',frames.map((f,i)=>i===5?{...f,x:1180,width:260}:f));await assert.rejects(verify(w,o,reports(o)),/控件树未证明/);
});
test('regional defects survive restart, new low colour scores, and text-only limited delivery',async t=>{
 const {w,base,task}=await fixture(t),o=await observe(w);const bad=reports(o);bad[1].status='mismatch';bad[1].reason='温控区域被通用导航替换';await assert.rejects(verify(w,o,bad),/通用导航/);
 const saved=await createWorkspace(base,task);assert.equal(regions.issues(saved.run).length,1);
 const again=await observe(saved);assert.throws(()=>visual.assertComparisons(saved.run),/通用导航/);
 await assert.rejects(verify(saved,again,reports(again)),/同一张结果图/);
 saved.run.observationCapabilities.images=false;await assert.rejects(acceptance.assertAccepted(saved,{unverifiedVisualIds:['ui']}),/区域尚未核验/);
});
test('a repaired APK and fresh complete regional review resolve defects and source edits invalidate approval',async t=>{
 const {w}=await fixture(t),old=await observe(w);const bad=reports(old);bad[0].status='mismatch';bad[0].reason='卡片缺失';await assert.rejects(verify(w,old,bad));
 await fs.writeFile(path.join(w.files,'app.apk'),'v2');const repaired=await observe(w,'repaired');await verify(w,repaired,reports(repaired));
 assert.equal(regions.issues(w.run).length,0);await acceptance.assertAccepted(w);await design.assertDelivery(w,images);
 await verify(w,repaired); // The exact reviewed evidence can serve another check without another model review.
 await fs.writeFile(path.join(w.files,'layout.xml'),'<changed/>');await assert.rejects(acceptance.assertAccepted(w),/依赖文件已变化/);
});
test('empty data remains unverified and cannot silently turn a missing region into approval',async t=>{
 const {w}=await fixture(t),o=await observe(w),r=reports(o);r[0].status='unverified';r[0].reason='预报接口返回空列表，尚未检查空数据布局和重试入口';await assert.rejects(verify(w,o,r),/空列表/);
 assert.equal(w.run.acceptanceResults?.ui,undefined);assert.equal(regions.issues(w.run)[0].reason,r[0].reason);
 assert.equal(regions.issues(w.run)[0].finding,'unverified');
});
test('custom drawn components can use explicit image assessment without inventing machine proof',async t=>{
 const {w}=await fixture(t),o=await observe(w);await verify(w,o,reports(o,'image'));
 const review=Object.values(w.run.designRegionReviews)[0];assert.match(review.basis,/model_assessment/);assert.equal(w.run.acceptanceResults.ui.basis,'model_assessment');
});
test('hierarchy parsing excludes other apps, rejects unsafe XML and keeps real node identities',()=>{
 const {parse}=require('../apps/desktop/agent/android-hierarchy.cjs');const parsed=parse(hierarchy(),'app.test');assert.equal(parsed.nodes.length,6);assert.equal(parsed.nodes[0].id,'node_0');assert.equal(parse(hierarchy(),'other.app').nodes.length,0);
 assert.throws(()=>parse(Buffer.from('<!DOCTYPE hierarchy [<!ENTITY x SYSTEM "file:///etc/passwd">]><hierarchy/>'),'app.test'),/XML声明|XML 声明/);
 assert.throws(()=>parse(Buffer.from('<hierarchy><node></hierarchy>'),'app.test'),/XML无效|XML 无效|Opening and ending/);
});
test('named verify schema exposes bounded region reports and colour diagnostics stay unverified',()=>{
 const tool=require('../apps/desktop/agent/protocol.cjs').actionTools({phase:'task'}).find(t=>t.function.name==='verify');assert.equal(tool.function.parameters.properties.checks.items.properties.regions.maxItems,32);
 const bytes=Buffer.alloc(64*36*4),result=require('../apps/desktop/agent/image-observer.cjs').compareSamples(bytes,bytes);assert.equal(result.visualAcceptance,'unverified');assert.match(result.notice,/不是设计差异率/);
});
test('legacy colour-only approval is pending and cropped evidence cannot cover the region checklist',async t=>{
 const {w}=await fixture(t),o=await observe(w);w.run.acceptanceResults={ui:{type:'visual',kind:'visual',status:'passed',evidenceId:o.eventId}};
 assert.equal(acceptance.criteria(w.run)[0].check,undefined);
 o.transform={crop:{x:0,y:0,width:100,height:100}};await assert.rejects(verify(w,o,reports(o)),/完整运行截图/);
});
test('the real runner presents region repair targets and public progress across continuation',async t=>{
 const {w,base,task}=await fixture(t);const o=await observe(w),r=reports(o);r[0].status='mismatch';r[0].reason='缺少重复卡片';await assert.rejects(verify(w,o,r));
 w.run.status='blocked';await w.save();let calls=0;
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task,images,model:{contextWindow:65536,imageInput:'auto'},signal:new AbortController().signal,ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);assert.ok(calls++<3);
  if(state.phase==='route')return {content:JSON.stringify({action:'route',kind:'task'})};
  assert.equal(state.designRegionIssues[0].reason,'缺少重复卡片');assert.equal(state.androidDesign.screens[0].baseline.designManifest.regions[0].repeats[0].count,6);
  return {content:JSON.stringify({action:'blocked',text:'区域差异仍待修复，保留当前产物'})};
 }});
 assert.equal(result.agentRun.status,'blocked');assert.equal(result.agentRun.designRegionIssues[0].reason,'缺少重复卡片');assert.equal(result.agentRun.acceptanceCriteria[0].status,'pending');
});
test('a new terminal execution archives old region issues without contaminating an unrelated new task',()=>{
 const run={status:'completed',mode:'task',inputKey:'old',steps:[],history:[],designRegionIssues:{one:{status:'open',region:'Old region'}},designRegionReviews:{one:{status:'passed'}}};
 require('../apps/desktop/agent/execution-rounds.cjs').beginRound(run,{messages:[{id:'new',role:'user',content:'Another task'}]},r=>({designRegionIssues:r.designRegionIssues}));
 assert.equal(run.history[0].designRegionIssues.one.region,'Old region');assert.deepEqual(run.designRegionIssues,{});assert.deepEqual(run.designRegionReviews,{});
});

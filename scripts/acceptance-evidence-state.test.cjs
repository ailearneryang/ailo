const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{hash}=require('../apps/desktop/agent/evidence.cjs');
const acceptance=require('../apps/desktop/agent/acceptance.cjs'),regions=require('../apps/desktop/agent/design-regions.cjs');
const requirements=require('../apps/desktop/agent/requirements.cjs');
function png(){const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(1200,16);b.writeUInt32BE(800,20);return b;}
const images={prepare:async bytes=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}}}),compare:async()=>({grossMismatch:false})};
async function fixture(t,visual=true){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-evidence-state-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'t',request:'Implement the specified dashboard'},w=await createWorkspace(base,task);
 Object.assign(w.run,{inputKey:'input',acceptanceInputKey:'input',requirementsManaged:true,requirements:[{id:'ui',text:'Every region matches the design',type:'visual',scope:{kind:'viewport',path:'layout.xml'}}],steps:[{id:'make',status:'done'}],observationCapabilities:{images:true},visualObservations:[]});
 if(!visual)return {w,base,task};
 const board={_class:'artboard',do_objectID:'board',name:'Dashboard',frame:{width:1200,height:800},layers:[{_class:'group',do_objectID:'first',name:'Content',frame:{x:0,y:0,width:1200,height:700},layers:[]},{_class:'group',do_objectID:'second',name:'Controls',frame:{x:0,y:700,width:1200,height:100},layers:[]}]};
 await fs.mkdir(path.join(w.files,'extract/pages'),{recursive:true});await fs.writeFile(path.join(w.files,'extract/pages/p.json'),JSON.stringify({_class:'page',layers:[board]}));
 for(const [name,bytes]of [['layout.xml','<layout/>'],['reference.png',png()],['app.apk','apk-v1'],['current.png',png()]])await fs.writeFile(path.join(w.files,name),bytes);
 await fs.writeFile(path.join(w.files,'android-design.json'),JSON.stringify({screens:[{boardId:'board',layout:'layout.xml',reference:'reference.png'}]}));
 const sources=await Promise.all(['app.apk','current.png'].map(async p=>({path:p,sha256:hash(await fs.readFile(path.join(w.files,p)))}))),apkSha256=sources[0].sha256;
 w.run.artifacts=[{path:'app.apk',sha256:apkSha256}];
 await w.event('android_device',{operation:'screenshot',result:{path:'current.png',apkPath:'app.apk',apkSha256,pixelSize:{width:1200,height:800},displayCheck:{matches:true},sources}});
 const result=await require('../apps/desktop/agent/visual-observation.cjs').imageObservation(w,{path:'current.png',reference:'reference.png'},images);delete result.image;
 await w.event('view_image',{revision:w.run.revision,result});const image={...result,eventId:w.run.events.at(-1).id,delivered:true};w.run.visualObservations.push(image);await w.save();return {w,base,task,image};
}
const reports=image=>image.designManifest.regions.map(r=>({id:r.id,status:'matched',reason:'逐区核对控件及其位置符合原设计',repeats:[]}));
const verify=(w,image,review)=>acceptance.verify(w,{checks:[{criterionId:'ui',kind:'visual',evidenceId:image.eventId,reason:'使用成对原稿和当前APK截图核对完整页面',regions:review}]});

test('unverified review can be completed against the same unchanged image after restart without a rebuild',async t=>{
 const {w,base,task,image}=await fixture(t),pending=reports(image);pending[0].status='unverified';pending[0].reason='尚未逐项核对该区域';
 await assert.rejects(verify(w,image,pending),e=>e.code==='VISUAL_REVIEW_PENDING');
 assert.equal(regions.issues(w.run)[0].finding,'unverified');assert.equal(w.run.validationRepairs?.ui,undefined);assert.equal(w.run.events.filter(e=>e.type==='validation_failed').length,0);
 const saved=await createWorkspace(base,task);await verify(saved,image,reports(image));
 assert.equal(regions.issues(saved.run).length,0);assert.equal(saved.run.acceptanceResults.ui.status,'passed');await acceptance.assertAccepted(saved);
 assert.equal(await fs.readFile(path.join(saved.files,'app.apk'),'utf8'),'apk-v1');
 assert.equal(saved.run.events.filter(e=>e.type==='build_android').length,0);
});
test('a confirmed mismatch cannot be downgraded to unverified or closed by new words and the same pixels',async t=>{
 const {w,image}=await fixture(t),bad=reports(image);bad[0].status='mismatch';bad[0].reason='真实运行结果缺少原设计的内容区';
 await assert.rejects(verify(w,image,bad),e=>e.code==='DESIGN_REGION_MISMATCH');
 const pending=reports(image);pending[0].status='unverified';pending[0].reason='先标为待检查';
 await assert.rejects(verify(w,{...image,eventId:image.eventId},pending),e=>e.code==='DESIGN_REGION_MISMATCH');
 assert.equal(regions.issues(w.run)[0].finding,'mismatch');assert.match(regions.issues(w.run)[0].reason,/缺少原设计/);
 await assert.rejects(verify(w,image,reports(image)),/同一张结果图/);assert.equal(w.run.acceptanceResults?.ui,undefined);
});
test('a pending report on a different image cannot erase the original confirmed-defect fingerprint',async t=>{
 const {w,image}=await fixture(t),bad=reports(image);bad[0].status='mismatch';bad[0].reason='内容区缺失';await assert.rejects(regions.assess(w,image,bad));
 const pending=reports(image);pending[0].status='unverified';pending[0].reason='新图尚未检查';
 await assert.rejects(regions.assess(w,{...image,sha256:'different-image'},pending),e=>e.code==='DESIGN_REGION_MISMATCH');
 assert.equal(regions.issues(w.run)[0].sha256,image.sha256);await assert.rejects(regions.assess(w,image,reports(image)),/同一张结果图/);
});
test('malformed later regions and unknown region IDs never create product defects or revoke an existing pass',async t=>{
 const {w,image}=await fixture(t);await verify(w,image,reports(image));const pass=structuredClone(w.run.acceptanceResults),events=w.run.events.length;
 for(const change of [{id:'invented'},{status:'not-a-state'},{reason:''},{nodeIds:['node_0','node_0']}]){
  const r=reports(image);Object.assign(r[1],change);await assert.rejects(verify(w,image,r),e=>e.code==='VERIFY_REQUEST_INVALID');
  assert.deepEqual(w.run.acceptanceResults,pass);assert.equal(w.run.events.length,events);assert.equal(regions.issues(w.run).length,0);assert.equal(w.run.validationRepairs?.ui,undefined);
 }
 await acceptance.assertAccepted(w);
});
test('missing hierarchy is pending proof and can be corrected on the same image; known wrong geometry stays a mismatch',async t=>{
 const {w,image}=await fixture(t),r=reports(image);r[0].nodeIds=['node_0'];
 await assert.rejects(verify(w,image,r),e=>e.code==='VISUAL_REVIEW_PENDING');assert.equal(regions.issues(w.run)[0].finding,'unverified');
 await verify(w,image,reports(image));assert.equal(regions.issues(w.run).length,0);
});
test('a real mismatch in another region remains blocking when another region is merely unverified',async t=>{
 const {w,image}=await fixture(t),r=reports(image);r[0].status='unverified';r[0].reason='待补充核对';r[1].status='mismatch';r[1].reason='真实底部控件被裁切';
 await assert.rejects(verify(w,image,r),e=>e.code==='DESIGN_REGION_MISMATCH');assert.deepEqual(regions.issues(w.run).map(i=>i.finding),['unverified','mismatch']);
 await assert.rejects(acceptance.assertAccepted(w),e=>e.code==='DESIGN_REGION_MISMATCH');
});

async function command(w,path='report.txt',exitCode=0){
 const sources=[{path,sha256:hash(await fs.readFile(require('node:path').join(w.files,path)))}];
 await w.event('run_command',{revision:w.run.revision,result:{exitCode,timedOut:false,scope:{kind:'file',path},sources}});return w.run.events.at(-1).id;
}
async function reportFixture(t){
 const f=await fixture(t,false);f.w.run.requirements=[{id:'report',text:'报告必须包含原定结论',type:'content',scope:{kind:'file',path:'report.txt'}}];await fs.writeFile(path.join(f.w.files,'report.txt'),'原定结论');return f;
}
test('technical binding corrects only an exact known receipt and remains subject to original verification and freshness',async t=>{
 const {w}=await reportFixture(t),id=await command(w),prior=w.run.requirements[0];
 Object.assign(w.run,requirements.update(w.run,{requirements:[{...prior,evidenceBinding:{kind:'command',evidenceId:id}}]}));
 assert.deepEqual(w.run.requirements[0].scope,prior.scope);assert.equal(acceptance.criteria(w.run)[0].evidenceBinding.evidenceId,id);
 const checks=()=>({checks:[{criterionId:'report',kind:'command',reason:'使用已执行命令核对原报告内容和范围'}]});
 await acceptance.verify(w,checks());await acceptance.assertAccepted(w);
 await fs.writeFile(path.join(w.files,'report.txt'),'wrong');await assert.rejects(acceptance.verify(w,checks()),/已变化/);assert.equal(w.run.acceptanceResults.report,undefined);
});
test('rebinding keeps semantics and explicit user scopes immutable, invalidates prior pass, and requires reverification',async t=>{
 const {w}=await reportFixture(t),one=await command(w),prior=w.run.requirements[0];
 Object.assign(w.run,requirements.update(w.run,{requirements:[{...prior,evidenceBinding:{kind:'command',evidenceId:one}}]}));
 await acceptance.verify(w,{checks:[{criterionId:'report',kind:'command',reason:'核对报告原定结论'}]});const two=await command(w);
 const next={...w.run.requirements[0],evidenceBinding:{kind:'command',evidenceId:two}};
 for(const altered of [{...next,text:'只检查存在'},{...next,type:'presence'},{...next,scope:{kind:'file',path:'unrelated.txt'}},{...next,scope:undefined}])assert.throws(()=>requirements.update(w.run,{requirements:[altered]}),/原要求文字|验证类型|检查范围/);
 Object.assign(w.run,requirements.update(w.run,{requirements:[next]}));assert.equal(w.run.acceptanceResults.report,undefined);await assert.rejects(acceptance.assertAccepted(w),/尚未核验/);
 await acceptance.verify(w,{checks:[{criterionId:'report',kind:'command',reason:'重新检查相同要求及范围'}]});await acceptance.assertAccepted(w);
});
test('bindings never guess IDs from prefixes, numbers, descriptions, failures, other tools, or changed requirement types',async t=>{
 const {w}=await reportFixture(t),id=await command(w),failed=await command(w,'report.txt',1),prior=w.run.requirements[0];
 for(const evidenceId of [id.slice(0,12),'1','报告必须包含原定结论','missing-event',failed])assert.throws(()=>requirements.update(w.run,{requirements:[{...prior,evidenceBinding:{kind:'command',evidenceId}}]}),e=>e.code==='EVIDENCE_BINDING_INVALID');
 assert.throws(()=>requirements.update(w.run,{requirements:[{...prior,type:'visual',evidenceBinding:{kind:'command',evidenceId:id}}]}),/验证类型/);
 assert.throws(()=>requirements.update(w.run,{requirements:[{...prior,evidenceBinding:{kind:'visual',evidenceId:id}}]}),/已经传给模型/);
 assert.equal(w.run.requirements[0].evidenceBinding,undefined);
});
test('exact observation receipt IDs map deterministically, and explicit caller evidence is never replaced by the binding',async t=>{
 const {w}=await reportFixture(t),id=await command(w);w.run.observationIndex=[{id:'exact-observation',eventId:id}];
 Object.assign(w.run,requirements.update(w.run,{requirements:[{...w.run.requirements[0],evidenceBinding:{kind:'command',evidenceId:'exact-observation'}}]}));
 assert.equal(w.run.requirements[0].evidenceBinding.evidenceId,id);
 await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'report',kind:'command',evidenceId:'unknown',reason:'保留调用方显式提供的证据'}]}),/证据无效/);
});
test('a single technical binding cannot shrink a multi-scope requirement or convert a legacy scope into a hint',async t=>{
 const {w}=await reportFixture(t);await fs.writeFile(path.join(w.files,'second.txt'),'原定结论');w.run.requirements[0].scopes=[{kind:'file',path:'second.txt'}];const id=await command(w),prior=w.run.requirements[0];
 Object.assign(w.run,requirements.update(w.run,{requirements:[{...prior,evidenceBinding:{kind:'command',evidenceId:id}}]}));
 await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'report',kind:'command',reason:'此证据只覆盖第一个文件'}]}),/范围未覆盖/);
 assert.throws(()=>requirements.update(w.run,{requirements:[{...w.run.requirements[0],scopes:undefined}]}),/检查范围集合/);
});
test('omitting an established technical binding preserves it, including after its event ages out of the hot event list',async t=>{
 const {w}=await reportFixture(t),id=await command(w);Object.assign(w.run,requirements.update(w.run,{requirements:[{...w.run.requirements[0],evidenceBinding:{kind:'command',evidenceId:id}}]}));
 w.run.events=[];const {evidenceBinding,...semantic}=w.run.requirements[0];Object.assign(w.run,requirements.update(w.run,{requirements:[semantic]}));assert.deepEqual(w.run.requirements[0].evidenceBinding,evidenceBinding);
 await acceptance.verify(w,{checks:[{criterionId:'report',kind:'command',reason:'原归档证据仍须实际读取并检查'}]});await acceptance.assertAccepted(w);
});
test('binding defaults never fill another kind, invalid supplied IDs, or ambiguous semantic aliases',async t=>{
 const {w}=await reportFixture(t),id=await command(w);Object.assign(w.run,requirements.update(w.run,{requirements:[{...w.run.requirements[0],evidenceBinding:{kind:'command',evidenceId:id}}]}));
 for(const check of [{criterionId:'report',kind:'visual'},{criterionId:'1',kind:'command'},{criterionId:'report',kind:'command',evidenceId:''}])await assert.rejects(acceptance.verify(w,{checks:[{...check,reason:'保持原要求，不猜证据'}]}),e=>e.code==='VERIFY_REQUEST_INVALID');
 assert.equal(w.run.acceptanceResults?.report,undefined);
});
test('a failed verification batch identifies the actual failing requirement and never attributes it to an earlier passing row',async t=>{
 const {w}=await reportFixture(t);w.run.requirements.push({id:'second',text:'第二份报告必须含 OK',type:'content',scope:{kind:'file',path:'second.txt'}});await fs.writeFile(path.join(w.files,'second.txt'),'wrong');
 const good={criterionId:'report',kind:'text_contains',path:'report.txt',contains:['原定结论'],reason:'实际核对原报告正文'},bad={criterionId:'second',kind:'text_contains',path:'second.txt',contains:['OK'],reason:'实际核对第二份报告正文'};
 await assert.rejects(acceptance.verify(w,{checks:[good,bad]}),e=>e.criterionId==='second'&&e.code==='ACCEPTANCE_TEXT_MISSING');
 assert.equal(w.run.acceptanceResults?.report,undefined);assert.equal(w.run.validationRepairs?.report,undefined);assert.equal(w.run.validationRepairs.second.status,'open');
 await acceptance.verify(w,{checks:[good]});assert.equal(w.run.validationRepairs.second.status,'open');
});
test('batch-end coverage failures carry the requirement whose full scope is incomplete',async t=>{
 const {w}=await reportFixture(t);w.run.requirements[0].scopes=[{kind:'file',path:'second.txt'}];
 await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'report',kind:'text_contains',path:'report.txt',contains:['原定结论'],reason:'只核对第一个文件，不能覆盖第二个文件'}]}),e=>e.criterionId==='report'&&/范围未覆盖/.test(e.message));
});

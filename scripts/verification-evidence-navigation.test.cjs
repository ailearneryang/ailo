const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),proof=require('../apps/desktop/agent/evidence.cjs'),navigation=require('../apps/desktop/agent/evidence-navigation.cjs'),request=require('../apps/desktop/agent/verification-request.cjs'),acceptance=require('../apps/desktop/agent/acceptance.cjs');
const images={prepare:async bytes=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}}}),compare:async()=>({grossMismatch:false})};
function png(){const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(1200,16);b.writeUInt32BE(800,20);return b;}
async function fixture(t,{delivered=true,nodeCount=3,pair=true}={}){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-evidence-navigation-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const w=await createWorkspace(base,{id:'task',request:'Complete the original dashboard'});
 Object.assign(w.run,{inputKey:'input',acceptanceInputKey:'input',requirementsManaged:true,requirements:[{id:'ui',text:'Match the original complete design',type:'visual',scope:{kind:'viewport',path:'layout.xml'}},{id:'runtime',text:'Actually install the app',type:'behavior'}],observationCapabilities:{images:true},visualObservations:[],artifacts:[]});
 const board={_class:'artboard',do_objectID:'board',name:'Dashboard',frame:{width:1200,height:800},layers:[{_class:'group',do_objectID:'content',name:'Content',frame:{x:0,y:0,width:1200,height:800},layers:[]}]};await fs.mkdir(path.join(w.files,'extract/pages'),{recursive:true});await fs.writeFile(path.join(w.files,'extract/pages/p.json'),JSON.stringify({_class:'page',layers:[board]}));
 for(const [name,data]of [['app.apk','apk-v1'],['layout.xml','<layout/>'],['shot.png',png()],['reference.png',png()]])await fs.writeFile(path.join(w.files,name),data);
 const tree='<hierarchy>'+Array.from({length:nodeCount},(_,i)=>`<node package="com.example" resource-id="com.example:id/item${i}" class="android.widget.TextView" text="${'visible '.repeat(20)}" content-desc="" bounds="[${i*2},10][${i*2+1},20]"/>`).join('')+'</hierarchy>';await fs.writeFile(path.join(w.files,'tree.xml'),tree);
 await fs.writeFile(path.join(w.files,'android-design.json'),JSON.stringify({screens:[{boardId:'board',layout:'layout.xml',reference:'reference.png'}]}));
 const sources=await Promise.all(['app.apk','shot.png','tree.xml'].map(async name=>({path:name,sha256:proof.hash(await fs.readFile(path.join(w.files,name)))}))),apk=sources[0].sha256;w.run.artifacts=[{path:'app.apk',sha256:apk}];
 await w.event('android_device',{operation:'screenshot',revision:w.run.revision,result:{path:'shot.png',apkPath:'app.apk',apkSha256:apk,pixelSize:{width:1200,height:800},displayCheck:{matches:true},sources,uiHierarchy:{path:'tree.xml',sha256:proof.hash(tree),package:'com.example',nodeCount,complete:true}}});
 const shot=w.run.events.at(-1),preview={eventId:shot.id,path:'shot.png',sha256:sources[1].sha256,scope:{kind:'viewport',path:'shot.png'},pixelSize:{width:1200,height:800},sources,revision:w.run.revision,previewOnly:true,delivered:true};w.run.visualObservations.push(preview);
 let image;if(pair){const result=await require('../apps/desktop/agent/visual-observation.cjs').imageObservation(w,{path:'shot.png',reference:'reference.png'},images);delete result.image;await w.event('view_image',{revision:w.run.revision,result});image={...result,eventId:w.run.events.at(-1).id,delivered};w.run.visualObservations.push(image);}
 return {w,image,preview,apk};
}
const report=image=>image.designManifest.regions.map(r=>({id:r.id,status:'matched',reason:'Check actual visible nodes within the original region',repeats:[]}));

test('current real paired proof and node mapping are separate from automatic previews and reference-only images',async t=>{
 const {w,image,preview,apk}=await fixture(t);const raw=await require('../apps/desktop/agent/visual-observation.cjs').imageObservation(w,{path:'reference.png'},images);delete raw.image;await w.event('view_image',{revision:w.run.revision,result:raw});w.run.visualObservations.push({...raw,eventId:w.run.events.at(-1).id,delivered:true});
 const nav=await navigation.context(w);assert.equal(nav.visual.paired[0].eventId,image.eventId);assert.equal(nav.visual.paired[0].apkSha256,apk);assert.deepEqual(nav.byKind.visual,[image.eventId]);assert.ok(nav.visual.preview.some(v=>v.eventId===preview.eventId));assert.equal(nav.visual.coverage.complete,true);assert.ok(nav.constraints.excludedVisualIds.includes(preview.eventId));assert.ok(nav.constraints.excludedVisualIds.includes(w.run.events.at(-1).id));
 const nodes=nav.visual.paired[0].nodes;assert.equal(nodes.complete,true);assert.equal(nodes.total,3);assert.equal(nodes.items[0].id,'node_0');assert.equal(nodes.items[0].resourceId,'com.example:id/item0');assert.ok(nodes.items[0].text.length<=60);assert.deepEqual(nodes.items[0].bounds,{x:0,y:10,width:1,height:10});
 assert.equal(w.run.acceptanceResults?.ui,undefined);
});

test('undelivered prepared pairs are awaiting delivery and only exact delivered current identities redirect a pending focus',async t=>{
 const {w,image,preview}=await fixture(t,{delivered:false}),focus={navigation:navigation.pendingNavigation(preview,{criterionId:'ui',evidenceId:preview.eventId})};let nav=await navigation.context(w);
 assert.equal(nav.visual.paired.length,0);assert.equal(nav.visual.awaitingDelivery[0].status,'awaiting_delivery');assert.equal(nav.byKind.visual.length,0);assert.equal(await navigation.pairedForPending(w,focus,{context:nav}),undefined);
 image.delivered=true;nav=await navigation.context(w);assert.equal((await navigation.pairedForPending(w,focus,{context:nav})).eventId,image.eventId);
 for(const change of [{path:'other.png'},{sha256:proof.hash('other')},{apkSha256:proof.hash('other')},{reference:{path:'other.png',sha256:proof.hash('other')}},{issue:'regions_unverified'}])assert.equal(await navigation.pairedForPending(w,{...focus.navigation,...change},{context:nav}),undefined);
 const partial=structuredClone(nav);partial.visual.coverage.complete=false;partial.visual.targetCoverage[0].complete=false;assert.equal(await navigation.pairedForPending(w,focus,{context:partial}),undefined);assert.equal((await navigation.pairedForPending(w,{...focus.navigation,reference:image.reference},{context:partial})).eventId,image.eventId);
 await fs.writeFile(path.join(w.files,'app.apk'),'new APK');nav=await navigation.context(w);assert.equal(nav.visual.paired.length,0);assert.equal(await navigation.pairedForPending(w,focus,{context:nav}),undefined);
});

test('the real preview-ID failure becomes a typed selection error when a same-version pair exists without granting approval',async t=>{
 const {w,image,preview}=await fixture(t),oldEvents=w.run.events.length;
 await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'ui',kind:'visual',evidenceId:preview.eventId,reason:'Check original design'}]}),e=>e.code==='VERIFY_REQUEST_INVALID'&&e.diagnostics.issue==='paired_evidence_selection'&&e.diagnostics.candidateIds.includes(image.eventId)&&e.navigation.issue==='paired_image_required'&&e.navigation.waitFor==='paired_image_delivery');
 assert.equal(w.run.events.length,oldEvents);assert.equal(w.run.acceptanceResults?.ui,undefined);assert.equal(w.run.validationRepairs?.ui,undefined);
 const f=await fixture(t,{pair:false});await assert.rejects(acceptance.verify(f.w,{checks:[{criterionId:'ui',kind:'visual',evidenceId:f.preview.eventId,reason:'Check original design'}]}),e=>e.code==='VISUAL_REVIEW_PENDING'&&e.navigation.path==='shot.png'&&e.navigation.apkSha256===f.apk);
});

test('image observations cannot replace runtime behavior and known gross visual differences remain failures',async t=>{
 const {w,image}=await fixture(t);await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'runtime',kind:'observation',evidenceId:image.eventId,reason:'Image does not prove install'}]}),e=>e.code==='VERIFY_REQUEST_INVALID'&&e.diagnostics.issue==='evidence_kind');assert.equal(w.run.acceptanceResults?.runtime,undefined);
 image.comparison={grossMismatch:true};const nav=await navigation.context(w);assert.equal(nav.visual.paired[0].grossMismatch,true);await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'ui',kind:'visual',evidenceId:image.eventId,reason:'Cannot ignore the known difference',regions:report(image)}]}),/大面积差异/);assert.equal(w.run.acceptanceResults?.ui,undefined);
});

test('dynamic native and JSON evidence/node choices agree, preserve outer clauses and never mutate the shared schema',async t=>{
 const {w,image,preview}=await fixture(t),nav=await navigation.context(w),schema={properties:{checks:request.schema},allOf:[{description:'keep unrelated outer constraint'}]};request.constrain(schema,w.run.requirements,nav);
 assert.equal(schema.allOf[0].description,'keep unrelated outer constraint');const visual=schema.properties.checks.items.allOf.find(b=>b.if.properties.kind?.const==='visual'&&!b.if.properties.evidenceId);assert.deepEqual(visual.then.properties.evidenceId.enum,[image.eventId]);assert.ok(!visual.then.properties.evidenceId.enum.includes(preview.eventId));const node=schema.properties.checks.items.allOf.find(b=>b.if.properties.evidenceId?.const===image.eventId);assert.deepEqual(node.then.properties.regions.items.properties.nodeIds.items.enum,['node_0','node_1','node_2']);assert.equal(request.schema.items.allOf,undefined);
 const protocol=require('../apps/desktop/agent/protocol.cjs'),state={phase:'task',steps:[{id:'s1'}],acceptanceCriteria:w.run.requirements,verificationEvidence:nav};const named=protocol.actionTools(state,['verify'])[0].function.parameters.properties.checks;const json=protocol.jsonActionContract(state,['verify'],false).parametersSchema,branch=json.oneOf.find(b=>b.properties.action.const==='verify'),jsonChecks=json.$defs[branch.properties.checks.$ref.split('/').at(-1)];assert.deepEqual(named,jsonChecks);assert.equal(named.items.allOf.length,schema.properties.checks.items.allOf.length);
});

test('sampled node indexes remain open to genuine unlisted nodes in the complete source tree',async t=>{
 const {w,image}=await fixture(t,{nodeCount:125}),nav=await navigation.context(w),nodes=nav.visual.paired[0].nodes;assert.equal(nodes.returned,120);assert.equal(nodes.total,125);assert.equal(nodes.complete,false);const schema={properties:{checks:request.schema}};request.constrain(schema,w.run.requirements,nav);const branch=schema.properties.checks.items.allOf.find(b=>b.if.properties.evidenceId?.const===image.eventId);assert.equal(branch.then.properties.regions.items.properties.nodeIds.items.enum,undefined);
 const regions=report(image);regions[0].nodeIds=['node_124'];await acceptance.verify(w,{checks:[{criterionId:'ui',kind:'visual',evidenceId:image.eventId,reason:'Use an actual unlisted node from the complete tree',regions}]});assert.equal(w.run.acceptanceResults.ui.status,'passed');
});

test('legacy reference resolution uses complete exact-target coverage, not unrelated missing historical receipts',async t=>{
 const {w,image,preview}=await fixture(t),focus=navigation.pendingNavigation(preview,{criterionId:'ui',evidenceId:preview.eventId});
 w.run.visualObservations.push({eventId:'unrelated-missing-event',path:'old-other.png',sha256:proof.hash('other'),delivered:true,revision:w.run.revision});
 let nav=await navigation.context(w);assert.equal(nav.visual.coverage.complete,false);assert.equal(nav.visual.targetCoverage[0].complete,true);assert.equal((await navigation.pairedForPending(w,focus,{context:nav})).eventId,image.eventId);
 w.run.visualObservations.push({...image,eventId:'same-target-missing-event'});nav=await navigation.context(w);assert.equal(nav.visual.targetCoverage[0].complete,false);assert.equal(await navigation.pairedForPending(w,focus,{context:nav}),undefined);
 // An explicit known reference still needs a genuine delivered candidate.
 assert.equal((await navigation.pairedForPending(w,{...focus,reference:image.reference},{context:nav})).eventId,image.eventId);
});

test('truncation and multiple references never infer a legacy target reference',async t=>{
 const {w,image,preview}=await fixture(t),focus=navigation.pendingNavigation(preview,{criterionId:'ui',evidenceId:preview.eventId});
 let nav=await navigation.context(w);nav=structuredClone(nav);nav.visual.targetCoverage[0].referenceCount=2;assert.equal(await navigation.pairedForPending(w,focus,{context:nav}),undefined);
 for(let i=0;i<96;i++)w.run.visualObservations.push({...image});nav=await navigation.context(w);assert.equal(nav.visual.targetCoverage[0].complete,false);assert.ok(nav.visual.targetCoverage[0].scanned<nav.visual.targetCoverage[0].total);assert.equal(await navigation.pairedForPending(w,focus,{context:nav}),undefined);
});

test('explicit desktop user replay remains static visual proof after delivery, while assisted old-device images stay rejected',async t=>{
 const {w,image}=await fixture(t);Object.assign(image,{historicalReplay:true,replayKind:'user_continuation',delivered:false});let nav=await navigation.context(w);assert.equal(nav.visual.awaitingDelivery.length,1);assert.equal(nav.byKind.visual.length,0);
 image.delivered=true;nav=await navigation.context(w);assert.equal(nav.visual.paired[0].eventId,image.eventId);assert.equal(nav.visual.paired[0].historicalReplay,true);assert.equal(nav.visual.paired[0].runtimeEvidence,false);
 image.replayKind='automatic';nav=await navigation.context(w);assert.equal(nav.visual.paired.length,0);
 image.replayKind='user_continuation';w.run.runtimeContinuation={kind:'assisted_resume',deviceState:'new_environment'};await w.event('evaluation_resume',{kind:'assisted_resume'});nav=await navigation.context(w);assert.equal(nav.visual.paired.length,0);
});

test('navigation avoids absent-type archive scans and validates design and hierarchy identities',async t=>{
 const {w,image}=await fixture(t);w.findEvent=()=>assert.fail('ordinary navigation must not search the whole event archive for absent types');let nav=await navigation.context(w);assert.equal(nav.visual.paired.length,1);assert.ok(nav.runtime.some(e=>e.eventType==='android_device'));
 await fs.writeFile(path.join(w.files,'tree.xml'),'<hierarchy/>');nav=await navigation.context(w);assert.equal(nav.visual.paired.length,0);
 const f=await fixture(t);f.image.designBinding.boardId='invented-board';nav=await navigation.context(f.w);assert.equal(nav.visual.paired.length,0);
 const g=await fixture(t);g.image.uiHierarchy.sha256=proof.hash('a different tree');nav=await navigation.context(g.w);assert.equal(nav.visual.paired.length,1);assert.equal(nav.visual.paired[0].nodes,undefined);
});

test('real browser HTML path and screenshot path retain their distinct evidence roles',async t=>{
 const {w}=await fixture(t);await fs.writeFile(path.join(w.files,'index.html'),'<html><body>Page</body></html>');const sources=await Promise.all(['index.html','shot.png'].map(async name=>({path:name,sha256:proof.hash(await fs.readFile(path.join(w.files,name)))})));
 const result={path:'index.html',screenshot:'shot.png',sha256:sources[1].sha256,sources,scope:{kind:'viewport',path:'index.html'},dom:{layoutHealth:{scope:'document',textNodes:1,clippedTextNodes:0},missingImages:[]},errors:[]};await w.event('browser',{revision:w.run.revision,result});const event=w.run.events.at(-1);w.run.visualObservations.push({eventId:event.id,path:'shot.png',sha256:result.sha256,sources,scope:result.scope,revision:w.run.revision,delivered:true});
 let nav=await navigation.context(w);assert.ok(nav.visual.standalone.some(c=>c.eventId===event.id));assert.ok(nav.byKind.visual.includes(event.id));assert.ok(nav.byKind.observation.includes(event.id));
 result.errors=['a page execution failed'];nav=await navigation.context(w);assert.ok(!nav.byKind.visual.includes(event.id));assert.ok(!nav.byKind.observation.includes(event.id));
 result.errors=[];await fs.writeFile(path.join(w.files,'index.html'),'<html>Changed</html>');nav=await navigation.context(w);assert.ok(!nav.byKind.visual.includes(event.id));
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const value=require('../apps/desktop/agent/repair-value.cjs'),tickets=require('../apps/desktop/agent/repair-tickets.cjs'),proof=require('../apps/desktop/agent/evidence.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
function run(){return {mode:'task',executionId:'same-task',inputKey:'font-input',inputTurn:{eventIds:[],artifacts:{'app/src/main/res/layout/activity_main.xml':'old'}},requirements:[{id:'font',text:'字体与原稿匹配',type:'visual'}],requirementsManaged:true,visualQuality:{constraints:[{id:'known',status:'open',description:'字体偏小',scopeKey:JSON.stringify(['app/src/main/res/layout/activity_main.xml','reference.png']),requirementIds:['font']}]},events:[],visualObservations:[]};}
function chain(r,n){const layout='app/src/main/res/layout/activity_main.xml',sha=proof.hash('source'+n),apk=proof.hash('apk'+n);r.events.push({id:'edit'+n,type:'edit_file',detail:{path:layout,revision:n,result:{changed:true,sha256:sha}}},{id:'build'+n,type:'build_android',detail:{revision:n,result:{exitCode:0,sources:[{path:layout,sha256:sha}],buildArtifacts:[{path:'app.apk',sha256:apk}]}}});return apk;}
test('real linked build, runtime and paired delivery each advance a bounded workflow without passing acceptance',()=>{
 const r=run();for(let i=0;i<15;i++)value.tick(r);const apk=chain(r,1);assert.equal(value.tick(r).stagnant,0);
 for(let i=0;i<7;i++)value.tick(r);r.events.push({id:'shot',type:'android_device',detail:{operation:'screenshot',result:{path:'shot.png',apkPath:'app.apk',apkSha256:apk,pixelSize:{width:1280,height:720},displayCheck:{matches:true},sources:[{path:'app.apk',sha256:apk}]}}});assert.equal(value.tick(r).stagnant,0);
 r.visualObservations.push({eventId:'pair',path:'shot.png',delivered:true,reference:{path:'reference.png'},sources:[{path:'app.apk',sha256:apk}]});assert.equal(value.tick(r).stagnant,0);
 const hydrated=JSON.parse(JSON.stringify(r));for(let i=0;i<16;i++){hydrated.events.push({id:'read'+i,type:'read_file',detail:{path:'shot.png'}});value.tick(hydrated);}assert.equal(hydrated.executionRecovery.repair.stagnant,16);assert.equal(hydrated.visualQuality.constraints[0].status,'open');assert.equal(hydrated.acceptanceResults,undefined);
});
test('new build loops, unrelated edits and reused builds cannot renew repair budget forever',()=>{
 const r=run();value.tick(r);chain(r,1);assert.equal(value.tick(r).stagnant,0);chain(r,2);assert.equal(value.tick(r).stagnant,0);chain(r,3);assert.equal(value.tick(r).stagnant,1);
 for(let i=0;i<15;i++)value.tick(r);assert.equal(value.tick(r).exhausted,true);
 const unrelated=run();chain(unrelated,1);unrelated.events[0].detail.path='unused.xml';for(let i=0;i<16;i++)value.tick(unrelated);assert.equal(unrelated.executionRecovery.repair.stagnant,16);
 const reused=run();chain(reused,1);reused.events[1].detail.result.reused=true;value.tick(reused);assert.equal(reused.executionRecovery.repair.stagnant,1);
});
test('current font input outranks broadly-linked icon backlog without removing original requirements or issues',()=>{
 const r=run();r.requirements.push({id:'icons',text:'图标正确',type:'visual'});r.inputCoverage={entries:[{inputId:'font-input',status:'planned',text:'调整天气页面的字体',requirementIds:['font']}]};r.visualQuality.constraints.unshift({id:'old-icon',status:'open',description:'旧的图标问题',requirementIds:['font','icons']});
 const context=tickets.context(r);assert.equal(context.currentWork.request,'调整天气页面的字体');assert.deepEqual(context.active.map(t=>t.id),['known']);assert.equal(context.backlogCount,1);assert.equal(r.visualQuality.constraints.length,2);assert.equal(r.requirements.length,2);
 const onlyOld=run();onlyOld.requirements=r.requirements;onlyOld.inputCoverage=r.inputCoverage;onlyOld.visualQuality.constraints=[{id:'old-icon',status:'open',description:'旧图标问题',requirementIds:['font','icons']}];assert.equal(tickets.context(onlyOld).active.length,0);assert.equal(tickets.context(onlyOld).currentWork.requirements[0].id,'font');
});
function png(){const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(1280,16);b.writeUInt32BE(720,20);return b;}
const images={prepare:async bytes=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}}}),compare:async()=>({grossMismatch:false})};
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-workflow-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const w=await createWorkspace(base,{id:'same-task',request:'调整天气页面的字体'});await fs.mkdir(path.join(w.files,'extract/pages'),{recursive:true});await fs.writeFile(path.join(w.files,'extract/pages/page.json'),JSON.stringify({_class:'page',layers:[{_class:'artboard',do_objectID:'home',name:'Home',frame:{x:0,y:0,width:1280,height:720},layers:[]}]}));for(const [name,body] of [['layout.xml','<FrameLayout/>'],['ref.png',png()],['shot.png',png()],['app.apk','apk'],['android-design.json',JSON.stringify({screens:[{boardId:'home',layout:'layout.xml',reference:'ref.png',screenshot:''}]})]])await fs.writeFile(path.join(w.files,name),body);await w.event('android_device',{operation:'screenshot',revision:w.run.revision,result:{path:'shot.png',apkPath:'app.apk',apkSha256:proof.hash('apk'),pixelSize:{width:1280,height:720},displayCheck:{matches:true},sources:[{path:'shot.png',sha256:proof.hash(png())},{path:'app.apk',sha256:proof.hash('apk')}]}});return w;}
test('bound managed screenshot automatically supplies both real images exactly once without delivery or acceptance credit',async t=>{
 const w=await fixture(t),flow=require('../apps/desktop/agent/visual-workflow.cjs'),visual=require('../apps/desktop/agent/visual-observation.cjs'),event=w.run.events.at(-1);flow.enqueue(w.run,event);
 assert.equal(await flow.pairScreenshot(w,event,images),true);const pair=w.run.visualObservations.at(-1);assert.equal(pair.reference.path,'ref.png');assert.equal(pair.designBinding.apkSha256,proof.hash('apk'));assert.equal(pair.delivered,false);assert.equal(w.run.acceptanceResults,undefined);
 const messages=await visual.messages(w,w.run.visualObservations,images);assert.equal(messages.length,1);assert.equal(messages[0].message.content.filter(p=>p.type==='image_url').length,2);assert.equal(await flow.pairScreenshot(w,event,images),false);
 await fs.writeFile(path.join(w.files,'app.apk'),'changed');assert.equal((await visual.messages(w,w.run.visualObservations,images)).length,0);
});
test('visual recheck omission gets one correction and explicit unverified remains pending instead of prose-based closure',async()=>{
 const prepare=require('../apps/desktop/model-routing.cjs').createVisualRouter({enabled:true,run:async(_lane,f)=>({result:await f({id:'vision'}),model:{id:'vision'}})});let calls=0;
 const state={phase:'task',visualQuality:{constraints:[{id:'known',status:'open',description:'字体大小'}]},repairFocus:{tickets:[{id:'known'}],currentWork:{request:'调整字体'}}};
 const result=await prepare([{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,fixture'}}]},{role:'user',content:JSON.stringify(state)}],async messages=>{calls++;return {content:JSON.stringify({summary:'旧问题已消失',observations:[],uncertainties:[],...(calls===1?{}:{checks:[{id:'known',status:'unverified',reason:'没有充分原稿依据'}]})})};});
 assert.equal(calls,2);assert.equal(result.reviews[0].checks[0].status,'unverified');assert.equal(state.visualQuality.constraints[0].status,'open');
});
test('executor archives the real device receipt before automatic pair delivery and keeps visual acceptance pending',async t=>{
 const w=await fixture(t),capture=structuredClone(w.run.events.at(-1).detail.result);
 w.run.events=[];w.run.visualObservations=[];await w.save();
 const task={id:'same-task',request:'调整天气页面的字体',messages:[{id:'font-message',role:'user',content:'调整天气页面的字体'}]};let calls=0,pairId,deviceId;
 const {execute}=require('../apps/desktop/agent/tools.cjs');
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base:path.resolve(w.project,'../..'),task,model:{contextWindow:1048576},images,signal:new AbortController().signal,executeTool:async(workspace,a,...rest)=>a.action==='android_device'?capture:execute(workspace,a,...rest),ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content),n=calls++;
  if(n===0)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(n===1)return {content:JSON.stringify({action:'plan',goal:task.request,decisions:[],requirements:[{id:'font',text:'字体与原稿一致',type:'visual'}],steps:[{id:'review',title:'配对核验字体',status:'running'}]})};
  if(n===2)return {content:JSON.stringify({action:'android_device',operation:'screenshot'})};
  if(n===3){const packets=messages.filter(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));assert.equal(packets.length,1);assert.equal(packets[0].content.filter(p=>p.type==='image_url').length,2);pairId=state.visualObservations.at(-1).eventId;return {content:JSON.stringify({action:'read_file',path:'layout.xml'})};}
  return {content:JSON.stringify({action:'pause',text:'在离线测试停止点保留原任务和未通过的验收'})};
 }});
 const saved=await createWorkspace(path.resolve(w.project,'../..'),task);const pair=await proof.lookup(saved,pairId);assert.equal(pair.type,'view_image');assert.equal(pair.detail.origin,'runtime_pairing');deviceId=pair.detail.screenshotEventId;assert.equal((await proof.lookup(saved,deviceId)).type,'android_device');
 const archived=saved.run.observations.find(o=>o.action?.action==='android_device');assert.equal(archived.response.eventId,deviceId);assert.equal(saved.run.visualObservations.find(o=>o.eventId===pairId).delivered,true);assert.notEqual(result.agentRun.acceptanceCriteria[0].status,'passed');assert.equal(result.agentRun.status,'paused');
});
test('ambiguous boards and unknown side effects neither auto-pair nor replay device operations',async t=>{
 const w=await fixture(t),flow=require('../apps/desktop/agent/visual-workflow.cjs'),event=w.run.events.at(-1);flow.enqueue(w.run,event);const originalCount=w.run.events.length;
 w.run.actionJournal=[{id:'unknown',action:'android_device',status:'unknown',readOnly:false}];assert.equal(await flow.pairScreenshot(w,event,images),false);assert.equal(w.run.events.length,originalCount);
 w.run.actionJournal=[];const config=JSON.parse(await fs.readFile(path.join(w.files,'android-design.json'),'utf8'));config.screens.push({...config.screens[0]});await fs.writeFile(path.join(w.files,'android-design.json'),JSON.stringify(config));assert.equal(await flow.pairScreenshot(w,event,images),false);assert.equal(w.run.events.length,originalCount);assert.equal(w.run.acceptanceResults,undefined);
});
test('expiration of an old passed criterion cannot reopen the source-backed workflow allowance',()=>{
 const r=run(),state={};r.acceptanceResults={font:{status:'passed'}};r.freshAcceptanceIds=['font'];chain(r,1);value.workflowMarkers(r,state);const generation=state.workflow.generation;chain(r,2);value.workflowMarkers(r,state);assert.equal(state.workflow.chains.length,2);
 r.freshAcceptanceIds=[];chain(r,3);const markers=value.workflowMarkers(r,state);assert.equal(state.workflow.generation,generation);assert.equal(state.workflow.chains.length,2);assert.ok(!markers.some(m=>m.includes(proof.hash('apk3'))));
});
test('a registered large original design is stream-hash checked without dropping sources or accepting mutations',async t=>{
 const w=await fixture(t),file=path.join(w.files,'large-original.sketch');const handle=await fs.open(file,'w');await handle.truncate(21*1024*1024);await handle.close();const sha256=await proof.hashFile(file),record={sources:[{path:'large-original.sketch',sha256}]};
 await assert.rejects(proof.assertFresh(w,record),{code:'EVIDENCE_SOURCE_SIZE'});w.catalog.push({id:'material',sourcePath:'large-original.sketch',sourceHash:sha256});await proof.assertFresh(w,record);
 const changed=await fs.open(file,'r+');await changed.write(Buffer.from('changed'),0,7,100);await changed.close();await assert.rejects(proof.assertFresh(w,record),{code:'EVIDENCE_SOURCE_CHANGED'});
});

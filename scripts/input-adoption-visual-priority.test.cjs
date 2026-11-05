const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID,createHash}=require('node:crypto');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{runAgent}=require('../apps/desktop/agent/runner.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const hash=b=>createHash('sha256').update(b).digest('hex'),reply=a=>({content:JSON.stringify(a)}),model={name:'company',model:'fixture',imageInput:'enabled',baseUrl:'https://company.example/v1',contextWindow:131072};
const images={prepare:async()=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64')}}})};
const imageLabels=messages=>messages.filter(m=>Array.isArray(m.content)).flatMap(m=>m.content.filter(p=>p.type==='text').map(p=>p.text));
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-adoption-visual-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'weather',request:'实现天气应用',messages:[{id:'u1',role:'user',content:'实现天气应用'}]},w=await createWorkspace(base,task);
 Object.assign(w.run,{executionId:'original',inputKey:'u1',acceptanceInputKey:'u1',mode:'task',status:'partial',goal:task.request,requirementsManaged:true,requirements:[{id:'weather',text:'显示天气页面',type:'content'}],acceptance:['显示天气页面'],steps:[{id:'weather',title:'显示天气',status:'running'}]});
 await fs.writeFile(path.join(w.files,'old-runtime.png'),png);await w.event('view_image',{path:'old-runtime.png',revision:w.run.revision,result:{path:'old-runtime.png',sha256:hash(png)}});
 const oldId=w.run.events.at(-1).id;w.run.visualObservations=[{eventId:oldId,path:'old-runtime.png',sha256:hash(png),sources:[{path:'old-runtime.png',sha256:hash(png)}],revision:w.run.revision,scope:{kind:'file',path:'old-runtime.png'},delivered:false}];await w.save();
 task.messages.push({id:'a1',role:'assistant',content:'已有阶段成果'},{id:'u2',role:'user',content:'补充要求：根据天气切换背景'});return {base,task,oldId};
}
const plan={action:'plan',goal:'天气动态背景',decisions:[],requirements:[{id:'weather',text:'显示天气页面',type:'content'},{id:'background',text:'根据天气切换不同背景',type:'behavior'}],steps:[{id:'weather',title:'根据天气切换背景并核验',status:'running',requirementIds:['weather','background']}]};
test('a text followup adopts its requirements before automatically reviewing old runtime pixels, then original review resumes',async t=>{
 const f=await fixture(t);let planned=false,sawAfter=false;const preflight=[];
 const result=await runAgent({...f,model,images,signal:new AbortController().signal,prepareModelMessages:async messages=>{const labels=imageLabels(messages);preflight.push({planned,labels});if(!planned)assert.deepEqual(labels,[]);else if(labels.some(s=>s.includes(f.oldId)))sawAfter=true;return {messages,reviews:[]};},ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return reply({action:'route',kind:'task'});if(!planned){assert.ok(s.visualAdoptionPriority);assert.equal(s.pendingVisualReview,undefined);planned=true;return reply(plan);}return reply({action:'pause',text:'新要求已纳入，保留原核验'});}});
 const w=await createWorkspace(f.base,f.task);assert.equal(result.agentRun.executionId,'original');assert.ok(preflight.length>=3);assert.equal(sawAfter,true,JSON.stringify({preflight,scope:w.run.requestScope,material:w.run.materialInput,coverage:w.run.inputCoverage,events:w.run.events.slice(-8)}));assert.ok(w.run.visualObservations.some(o=>o.eventId===f.oldId));assert.deepEqual(result.agentRun.acceptanceCriteria.map(r=>r.id),['weather','background']);assert.ok(result.agentRun.acceptanceCriteria.every(r=>r.status!=='passed'));
});
test('pending attachment adoption sends the new reference, excludes earlier message attachments and keeps both imported originals',async t=>{
 const f=await fixture(t);await fs.mkdir(path.join(f.base,'imports'),{recursive:true});
 const oldSource=randomUUID(),newSource=randomUUID();await fs.writeFile(path.join(f.base,'imports',oldSource),png);await fs.writeFile(path.join(f.base,'imports',newSource),png);
 const oldMaterial={name:'old-reference.png',sourceId:oldSource,size:png.length},newMaterial={name:'new-reference.png',sourceId:newSource,size:png.length};
 f.task.messages[0].materials=[oldMaterial];f.task.messages.at(-1).materials=[newMaterial];f.task.materials=[oldMaterial,newMaterial];let sawReference=false;
 const result=await runAgent({...f,model,images,signal:new AbortController().signal,prepareModelMessages:async messages=>{const s=JSON.parse(messages.at(-1).content),labels=imageLabels(messages);if(s.phase==='task'){assert.ok(labels.some(s=>s.includes('new-reference.png')));assert.ok(labels.every(s=>!s.includes('old-reference.png')&&!s.includes(f.oldId)));sawReference=true;}return {messages,reviews:[]};},ask:async messages=>reply(JSON.parse(messages.at(-1).content).phase==='route'?{action:'route',kind:'task'}:{action:'pause',text:'已查看当前附件，尚未采用，不冒充完成'})});
 assert.equal(sawReference,true);assert.equal(result.agentRun.materialInput.status,'inspected');const w=await createWorkspace(f.base,f.task);assert.ok(w.catalog.some(m=>m.name==='old-reference.png'));assert.ok(w.catalog.some(m=>m.name==='new-reference.png'));assert.equal(w.run.visualObservations.find(o=>o.eventId===f.oldId).delivered,false);
});
test('explicit current reference inspection remains visible during adoption without automatically sending old screenshots',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join((await createWorkspace(f.base,f.task)).files,'current-reference.png'),png);let inspected=false,sawCurrent=false;
 const result=await runAgent({...f,model,images,signal:new AbortController().signal,prepareModelMessages:async messages=>{const labels=imageLabels(messages);assert.ok(labels.every(s=>!s.includes(f.oldId)));if(labels.some(s=>s.includes('current-reference.png')))sawCurrent=true;return {messages,reviews:[]};},ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return reply({action:'route',kind:'task'});if(!inspected){inspected=true;return reply({action:'view_image',path:'current-reference.png'});}return reply({action:'pause',text:'已查看新参考图，待纳入计划'});}});
 assert.equal(sawCurrent,true);assert.ok(result.agentRun.acceptanceCriteria.every(r=>r.status!=='passed'));
});

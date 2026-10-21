const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {verify,criterionId,assertAccepted}=require('../apps/desktop/agent/acceptance.cjs');
const {projectResponse}=require('../apps/desktop/agent/browser-observer.cjs');
const {imageObservation,messages,hash}=require('../apps/desktop/agent/visual-observation.cjs');
async function setup(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-observe-test-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'visual',projectId:'p',request:'制作并检查页面'};return {base,task,w:await createWorkspace(base,task)};}
const images={async prepare(){return {size:{width:2,height:2},image:{type:'image_url',image_url:{url:'data:image/png;base64,TEST_IMAGE_BYTES'}}};}};
test('visual acceptance requires delivered, current, unchanged image evidence',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'screen.png'),'image');w.run.acceptance=['布局正确'];w.run.acceptanceTypes=['visual'];
 const check={criterionId:criterionId('布局正确'),kind:'visual',evidenceId:'image-event',reason:'检查页面布局与对齐'};
 await assert.rejects(verify(w,{checks:[{...check,kind:'text_contains',path:'screen.png',contains:['image']}]}),/视觉要求/);
 const observed=await imageObservation(w,{path:'screen.png'},images);w.run.visualObservations=[{...observed,eventId:'image-event',delivered:false}];
 await assert.rejects(verify(w,{checks:[check]}),/尚未传给模型/);
 w.run.visualObservations[0].delivered=true;w.run.events.push({id:'image-event',type:'view_image',detail:{revision:w.run.revision,result:observed}});
 const result=await verify(w,{checks:[check]});assert.equal(result.results[0].basis,'model_assessment');await assertAccepted(w);
 await fs.writeFile(path.join(w.files,'screen.png'),'changed');await assert.rejects(assertAccepted(w),/文件已变化/);
 assert.equal((await messages(w,w.run.visualObservations,images)).length,0);
 w.run.revision++;await assert.rejects(verify(w,{checks:[check]}),/文件已变化|图片已变化/);
});
test('file presence cannot prove content and browser errors prevent observation acceptance',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'a.txt'),'present');w.run.acceptance=['内容正确'];
 await assert.rejects(verify(w,{checks:[{criterionId:criterionId('内容正确'),kind:'file_exists',path:'a.txt',reason:'存在'}]}),/文件存在只能/);
 w.run.acceptanceTypes=['behavior'];await w.event('browser',{revision:w.run.revision,result:{dom:{missingImages:['missing.png']},errors:[]}});
 await assert.rejects(verify(w,{checks:[{criterionId:criterionId('内容正确'),kind:'observation',evidenceId:w.run.events.at(-1).id,reason:'实际打开并检查页面'}]}),/图片加载失败/);
});
test('project browser resource handler rejects external resources, hidden files and symlinks',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'index.html'),'<h1>local</h1>');await fs.writeFile(path.join(w.files,'.secret'),'secret');
 const read=url=>projectResponse(w.files,{url,method:'GET'});
 assert.match(await (await read('ailo-project://local/index.html')).text(),/local/);
 assert.equal((await read('https://example.com/index.html')).status,403);
 assert.equal((await read('ailo-project://other/index.html')).status,403);
 assert.equal((await read('ailo-project://local/.secret')).status,403);
 await fs.symlink(path.join(w.files,'index.html'),path.join(w.files,'link.html'));assert.equal((await read('ailo-project://local/link.html')).status,404);
 assert.equal((await projectResponse(w.files,{url:'ailo-project://local/index.html',method:'POST'})).status,403);
});
test('generated image reaches next model decision without storing base64 in execution history',async t=>{
 const {base,task,w}=await setup(t);await fs.writeFile(path.join(w.files,'screen.png'),'image');let n=0,sawImage=false;
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:'检查布局',decisions:[],acceptance:['布局正确'],acceptanceTypes:['visual'],steps:[{id:'check',title:'检查',status:'running'}]},{action:'view_image',path:'screen.png'},{action:'pause',text:'已回看，继续修复'}];
 const result=await runAgent({base,task,model:{contextWindow:32768},images,signal:new AbortController().signal,ask:async input=>{if(n===3){sawImage=input.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));assert.equal(JSON.parse(input.at(-1).content).visualObservations[0].delivered,false);}return {content:JSON.stringify(actions[n++])};}});
 assert.ok(sawImage);assert.equal(result.agentRun.status,'paused');const saved=await createWorkspace(base,task);assert.equal(saved.run.visualObservations[0].delivered,true);
 assert.ok(!JSON.stringify(saved.run).includes('TEST_IMAGE_BYTES'));
 const directory=path.join(saved.project,'runs',require('../apps/desktop/agent/workspace.cjs').key(task.id)+'.json.observations');const archive=await fs.readdir(directory);assert.ok(archive.length>0);for(const file of archive)assert.ok(!(await fs.readFile(path.join(directory,file),'utf8')).includes('TEST_IMAGE_BYTES'));
});
test('finish review rejects known gaps and model image rejection becomes an honest blocked outcome',async t=>{
 const review=require('../apps/desktop/agent/completion-review.cjs');assert.throws(()=>review.validate(undefined),/finish.review/);assert.throws(()=>review.validate({summary:'尚有问题',issues:['布局错位'],unverified:[]}),/不能声明全部完成/);
 const {base,task,w}=await setup(t);await fs.writeFile(path.join(w.files,'screen.png'),'image');let n=0;
 const actions=[{action:'route',kind:'task'},{action:'view_image',path:'screen.png'}];
 const result=await runAgent({base,task,images,model:{contextWindow:32768},signal:new AbortController().signal,ask:async()=>{if(n>=actions.length)throw Object.assign(Error('端点不支持图像'),{code:'MODEL_IMAGE_UNSUPPORTED'});return {content:JSON.stringify(actions[n++])};}});
 assert.equal(result.agentRun.status,'blocked');assert.match(result.content,/尚未完成视觉验收/);
 assert.equal((await createWorkspace(base,task)).run.visualObservations[0].delivered,false);
});

test('upgrading a requirement type and changing a browser dependency invalidate prior acceptance',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'index.html'),'page');await fs.writeFile(path.join(w.files,'screen.png'),'image');w.run.acceptance=['页面正确'];
 const criterionIdValue=criterionId('页面正确');await verify(w,{checks:[{criterionId:criterionIdValue,kind:'text_contains',path:'index.html',contains:['page'],reason:'只证明正文内容'}]});
 w.run.acceptanceTypes=['visual'];await assert.rejects(assertAccepted(w),/尚未核验/);
 w.run.visualObservations=[{eventId:'v',path:'screen.png',sha256:hash(Buffer.from('image')),revision:w.run.revision,delivered:true,sources:[{path:'index.html',sha256:hash(Buffer.from('page'))}]}];
 w.run.events.push({id:'v',type:'view_image',detail:{revision:w.run.revision,result:{sources:w.run.visualObservations[0].sources}}});
 await verify(w,{checks:[{criterionId:criterionIdValue,kind:'visual',evidenceId:'v',reason:'对照图像评估页面'}]});
 await fs.writeFile(path.join(w.files,'index.html'),'new page');await assert.rejects(assertAccepted(w),/依赖文件已变化/);
});

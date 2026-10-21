const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const proof=require('../apps/desktop/agent/evidence.cjs');
async function setup(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-evidence-archive-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return {base,w:await createWorkspace(base,{id:'t',request:'检查文件'})};}
async function evict(w){for(let i=0;i<105;i++)await w.event('attached_progress',{index:i});}
test('evicted evidence remains available by event ID, observation ID and a unique ID prefix',async t=>{
 const {base,w}=await setup(t);await fs.writeFile(path.join(w.files,'result.txt'),'天气');
 await w.event('run_command',{revision:0,result:{exitCode:0,sources:[{path:'result.txt',sha256:proof.hash(Buffer.from('天气'))}],scope:{kind:'file',path:'result.txt'}}});
 const id=w.run.events.at(-1).id,observationId=await w.archiveObservation({action:'run_command'},{eventId:id,result:{exitCode:0}});
 w.run.observationIndex=[{id:observationId,eventId:id}];await evict(w);
 assert.equal(w.run.events.some(e=>e.id===id),false);
 for(const reference of [id,observationId,id.slice(0,8)])assert.equal((await proof.event(w,reference)).id,id);
 await require('../apps/desktop/agent/issues.cjs').assertDeliverable({...w,run:{...w.run,issues:[{id:'old',status:'resolved',evidenceId:id}]}},'complete',{issues:[]},'完成');
 const foreign=await createWorkspace(base,{id:'other',request:'其他任务'});await assert.rejects(proof.event(foreign,id),/不存在/);
 await assert.rejects(proof.event(w,randomUUID()),/不存在/);
 await fs.writeFile(path.join(w.files,'result.txt'),'changed');await assert.rejects(proof.event(w,id),/已变化/);
});
test('HTML delivery recovers its latest archived observation without hiding a later broken page',async t=>{
 const {w}=await setup(t),html='<h1>天气</h1>';await fs.writeFile(path.join(w.files,'index.html'),html);await fs.writeFile(path.join(w.files,'shot.png'),'pixels');
 Object.assign(w.run,{artifacts:[{path:'index.html',sha256:proof.hash(Buffer.from(html))}],observationCapabilities:{images:false}});
 const result={path:'index.html',screenshot:'shot.png',sources:[{path:'index.html',sha256:proof.hash(Buffer.from(html))}],scope:{kind:'viewport',path:'index.html'},dom:{layoutHealth:{scope:'document',textNodes:1,clippedTextNodes:0},missingImages:[]},errors:[]};
 await w.event('browser',{revision:0,result});await evict(w);
 await require('../apps/desktop/agent/html-delivery.cjs').assertHtmlDelivery(w);
 await w.event('browser',{revision:0,result:{...result,errors:['script failed']}});await evict(w);
 await assert.rejects(require('../apps/desktop/agent/html-delivery.cjs').assertHtmlDelivery(w),/运行错误/);
});
test('an archived browser defect cannot be hidden by referring to its screenshot as an image',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'shot.png'),'pixels');
 await w.event('browser',{revision:0,result:{path:'index.html',screenshot:'shot.png',scope:{kind:'viewport',path:'index.html'},dom:{layoutHealth:{scope:'document',textNodes:47,clippedTextNodes:45}},errors:[]}});
 await evict(w);
 await w.event('view_image',{revision:0,result:{path:'shot.png',sources:[{path:'shot.png',sha256:proof.hash(Buffer.from('pixels'))}]}});
 const id=w.run.events.at(-1).id;w.run.visualObservations=[{eventId:id,delivered:true,path:'shot.png',sha256:proof.hash(Buffer.from('pixels'))}];
 await assert.rejects(proof.event(w,id),/大量内容被容器裁剪/);
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const {createScheduler}=require('../apps/desktop/chat-scheduler.cjs');
test('three concurrent projects, same-project serialization, cancellation and fair eligible queue',async()=>{
 const s=createScheduler(3),controllers=Array.from({length:6},()=>new AbortController());
 const a=await s.acquire('a',controllers[0].signal),b=await s.acquire('b',controllers[1].signal),c=await s.acquire('c',controllers[2].signal);
 let started=false;const d=s.acquire('d',controllers[3].signal).then(release=>{started=true;return release;});
 let secondA=false;const a2=s.acquire('a',controllers[4].signal).then(release=>{secondA=true;return release;});
 const cancelled=s.acquire('e',controllers[5].signal);controllers[5].abort();await assert.rejects(cancelled,/取消/);
 assert.equal(started,false);b();const releaseD=await d;assert.equal(secondA,false);a();const releaseA=await a2;assert.equal(secondA,true);c();releaseD();releaseA();
});
test('atomic task patches preserve simultaneous replies and configuration writes',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-concurrent-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const storage=require('../apps/desktop/storage.cjs').createStorage(dir,{});
 await storage.saveWorkspace({tasks:[],projects:[{id:'p',name:'p'}],models:[]});
 await Promise.all(['a','b'].map(id=>storage.patchTask(id,{projectId:'p',title:id,request:id,materials:[],messages:[]})));
 const stale=await storage.readWorkspace();
 await Promise.all([storage.patchTask('a',{},[{id:'a1',role:'assistant',content:'a'}]),storage.patchTask('b',{},[{id:'b1',role:'assistant',content:'b'}]),storage.saveWorkspace(stale,true)]);
 const state=await storage.readWorkspace();assert.equal(state.tasks.length,2);assert.equal(state.tasks.find(t=>t.id==='a').messages.length,1);assert.equal(state.tasks.find(t=>t.id==='b').messages.length,1);
});

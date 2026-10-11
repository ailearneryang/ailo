const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createStorage}=require('../apps/desktop/storage.cjs');
test('conversation pins persist and stale conversation writes cannot undo them',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-pin-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const storage=createStorage(directory,{});
 const original=await storage.patchTask('t',{title:'设计讨论',request:'讨论',materials:[],created:new Date().toISOString()});
 await storage.setTaskPinned('t',true);
 await storage.patchTask('t',{...original,pinned:false},[{id:'reply',role:'assistant',content:'完成'}]);
 const restarted=createStorage(directory,{});let task=(await restarted.readWorkspace()).tasks[0];
 assert.equal(task.pinned,true);assert.ok(task.pinnedAt);assert.equal(task.messages.at(-1).content,'完成');
 await restarted.setTaskPinned('t',false);
 await restarted.patchTask('t',task);
 task=(await restarted.readWorkspace()).tasks[0];assert.equal(task.pinned,false);assert.equal(task.pinnedAt,undefined);
 await assert.rejects(storage.setTaskPinned('missing',true),/不存在/);
 await assert.rejects(storage.setTaskPinned('t','true'),/无效/);
});

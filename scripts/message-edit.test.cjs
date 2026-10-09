const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createStorage}=require('../apps/desktop/storage.cjs');
const {beginRound}=require('../apps/desktop/agent/execution-rounds.cjs');
test('editing replaces only the unanswered last message and preserves attachments',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-edit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const materials=[{id:'file',name:'大纲.md',content:'材料'}];
 const task={id:'t',request:'原始需求',materials,messages:[{id:'u',role:'user',content:'原始需求',materials}],lastError:'已停止',partialReply:'旧片段',contextCheckpoint:{summary:'旧内容'}};
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[task]}));
 const storage=createStorage(dir,{});
 await assert.rejects(storage.editLastMessage('t','u','  '),/请输入/);
 const edited=await storage.editLastMessage('t','u',' 新需求 ');
 assert.equal(edited.request,'新需求');assert.equal(edited.messages.length,1);assert.notEqual(edited.messages[0].id,'u');assert.deepEqual(edited.messages[0].materials,materials);assert.deepEqual(edited.materials,materials);assert.equal(edited.contextCheckpoint,undefined);assert.equal(edited.partialReply,undefined);
 await assert.rejects(storage.editLastMessage('t','u','过期修改'),/最后一条/);
 const run={inputKey:'u',executionId:'old',status:'paused',mode:'task',goal:'旧需求',steps:[{id:'old'}],events:[],observations:[],artifacts:[]};
 beginRound(run,edited,r=>({...r}));assert.notEqual(run.executionId,'old');assert.equal(run.currentRequest,'新需求');assert.deepEqual(run.steps,[]);assert.equal(run.history.length,1);
 const execution=run.executionId;beginRound(run,edited,r=>({...r}));assert.equal(run.executionId,execution);
 await storage.patchTask('t',{},[{id:'a',role:'assistant',content:'已回复'}]);
 await assert.rejects(storage.editLastMessage('t','a','改回复'),/最后一条/);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createStorage}=require('../apps/desktop/storage.cjs');
const {beginRound}=require('../apps/desktop/agent/execution-rounds.cjs');
test('message dates persist across retries without assigning current dates to old history',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-message-date-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const storage=createStorage(dir,{}),createdAt='2026-10-10T06:00:00.000Z';
 const first=await storage.patchTask('new',{request:'问题',materials:[],created:createdAt,messages:[{id:'u',role:'user',content:'问题',createdAt}]});
 assert.equal(first.messages[0].createdAt,createdAt);
 const answered=await storage.patchTask('new',{},[{id:'a',role:'assistant',content:'回答'}]);assert.ok(Number.isFinite(Date.parse(answered.messages[1].createdAt)));
 const retry=await storage.patchTask('new',{messages:[{id:'u',role:'user',content:'问题',createdAt:'2026-10-11T00:00:00.000Z'}]},[{id:'a',role:'assistant',content:'重复回答'}]);
 assert.equal(retry.messages.length,2);assert.equal(retry.messages[0].createdAt,createdAt);assert.equal(retry.messages[1].createdAt,answered.messages[1].createdAt);
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[{id:'old',request:'旧问题',materials:[],messages:[{id:'old-u',role:'user',content:'旧问题'},{id:'old-a',role:'assistant',content:'旧回答'}]}]}));
 const continued=await storage.patchTask('old',{},[{id:'new-u',role:'user',content:'继续',createdAt:'invalid'}]);
 assert.equal(continued.messages[0].createdAt,undefined);assert.equal(continued.messages[1].createdAt,undefined);assert.ok(Number.isFinite(Date.parse(continued.messages[2].createdAt)));
 const edited=await storage.editLastMessage('old','new-u','修改后');assert.ok(Number.isFinite(Date.parse(edited.messages[2].createdAt)));assert.equal(edited.messages[0].createdAt,undefined);
 await assert.rejects(storage.editLastMessage('old','old-u','不能编辑旧消息'),/最近一条/);
});
test('editing replaces only the unanswered last message and preserves attachments',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-edit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const materials=[{id:'file',name:'大纲.md',content:'材料'}];
 const task={id:'t',request:'原始需求',materials,messages:[{id:'u',role:'user',content:'原始需求',materials}],lastError:'已停止',partialReply:'旧片段',contextCheckpoint:{summary:'旧内容'}};
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[task]}));
 const storage=createStorage(dir,{});
 await assert.rejects(storage.editLastMessage('t','u','  '),/请输入/);
 const edited=await storage.editLastMessage('t','u',' 新需求 ');
 assert.equal(edited.request,'新需求');assert.equal(edited.messages.length,1);assert.notEqual(edited.messages[0].id,'u');assert.deepEqual(edited.messages[0].materials,materials);assert.deepEqual(edited.materials,materials);assert.equal(edited.contextCheckpoint,undefined);assert.equal(edited.partialReply,undefined);
 await assert.rejects(storage.editLastMessage('t','u','过期修改'),/最近一条/);
 const run={inputKey:'u',executionId:'old',status:'paused',mode:'task',goal:'旧需求',steps:[{id:'old'}],events:[],observations:[],artifacts:[]};
 beginRound(run,edited,r=>({...r}));assert.notEqual(run.executionId,'old');assert.equal(run.currentRequest,'新需求');assert.deepEqual(run.steps,[]);assert.equal(run.history.length,1);
 const execution=run.executionId;beginRound(run,edited,r=>({...r}));assert.equal(run.executionId,execution);
 await storage.patchTask('t',{},[{id:'a',role:'assistant',content:'已回复'}]);
 await assert.rejects(storage.editLastMessage('t','a','改回复'),/最近一条/);
});
test('the latest answered user message can be edited; old replies are backed up and removed from active context',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-answered-edit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const messages=[{id:'u1',role:'user',content:'原始目标'},{id:'a1',role:'assistant',content:'此前回复'},{id:'u2',role:'user',content:'蓝色标题',materials:[{name:'参考.png'}]},{id:'a2',role:'assistant',content:'已生成蓝色标题'}];
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[{id:'t',request:'原始目标',materials:[],messages,contextCheckpoint:{summary:'蓝色'},lastErrorCode:'OLD',modelRequestDiagnostics:{id:'old'}}]}));
 const storage=createStorage(dir,{});await assert.rejects(storage.editLastMessage('t','u1','不能修改'),/最近一条/);await assert.rejects(storage.editLastMessage('t','a2','不能修改回复'),/最近一条/);
 const edited=await storage.editLastMessage('t','u2','红色标题');assert.deepEqual(edited.messages.slice(0,2),messages.slice(0,2));assert.equal(edited.messages.length,3);assert.equal(edited.messages.at(-1).content,'红色标题');assert.deepEqual(edited.messages.at(-1).materials,messages[2].materials);assert.equal(edited.request,'原始目标');assert.equal(edited.contextCheckpoint,undefined);assert.equal(edited.lastErrorCode,undefined);assert.equal(edited.modelRequestDiagnostics,undefined);
 const backup=JSON.parse(await fs.readFile(path.join(dir,'message-edits',edited.editedInputId+'.json'),'utf8'));assert.deepEqual(backup.messages,messages.slice(2));assert.equal((await storage.readWorkspace()).tasks[0].messages.length,3);
 const run={inputKey:'u2',executionId:'old',status:'completed',mode:'task',goal:'蓝色',steps:[],events:[],observations:[],artifacts:[{path:'weather.html'}],workingMemory:'旧需求是蓝色标题'};
 beginRound(run,edited,r=>({...r}));assert.equal(run.workingMemory,'');assert.equal(run.currentRequest,'红色标题');assert.deepEqual(run.artifacts,[{path:'weather.html'}]);assert.equal(run.history.length,1);
});
test('editing the first answered question updates the request; a backup failure leaves persisted history untouched',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-edit-backup-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const state={tasks:[{id:'t',request:'旧需求',materials:[],messages:[{id:'u',role:'user',content:'旧需求'},{id:'a',role:'assistant',content:'旧回复'}]}]};await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify(state));const storage=createStorage(dir,{});
 await fs.writeFile(path.join(dir,'message-edits'),'blocked');await assert.rejects(storage.editLastMessage('t','u','新需求'));assert.deepEqual((await storage.readWorkspace()).tasks,state.tasks);
 await fs.unlink(path.join(dir,'message-edits'));const edited=await storage.editLastMessage('t','u','新需求');assert.equal(edited.request,'新需求');assert.equal(edited.messages.length,1);
});

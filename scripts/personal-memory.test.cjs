const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createPersonalMemory,retrieve}=require('../apps/desktop/personal-memory.cjs');
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-memory-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let owner='alice';const work={tasks:[],projects:[{id:'a',name:'A'},{id:'b',name:'B'}]};const store=createPersonalMemory({directory,account:async()=>({id:owner}),workspace:async()=>structuredClone(work)});return {store,work,directory,switchOwner:id=>owner=id,async change(input){const state=await store.read();await store.update({ownerId:state.ownerId,revision:state.revision,...input});return store.read();},async enable(){await this.change({action:'settings',settings:{autoEnabled:true}});},message(content){return {id:crypto.randomUUID(),role:'user',content,createdAt:new Date(Date.now()+10).toISOString()};}};}
const entry=(extra={})=>({topic:'周报风格',content:'周报先讲风险，再讲进展',type:'preference',scope:'personal',...extra});
test('atomic account-partitioned writes, stale revisions and source history',async t=>{
 const f=await fixture(t);let state=await f.change({action:'save',item:entry()});const original=state.items[0];
 await assert.rejects(f.store.update({ownerId:'alice',revision:0,action:'save',item:entry()}),/刷新/);
 state=await f.change({action:'save',item:{...original,content:'周报先讲结果'}});assert.equal(state.items[0].revision,2);assert.equal(state.items[0].history[0].content,original.content);
 f.switchOwner('bob');assert.equal((await f.store.read()).items.length,0);await assert.rejects(f.store.read('alice'),/账号已切换/);
 await f.change({action:'save',item:entry({content:'使用英语'})});f.switchOwner('alice');assert.equal((await f.store.read()).items[0].content,'周报先讲结果');
 const files=await fs.readdir(path.join(f.directory,'personal-memory'));assert.equal(files.length,2);assert.equal((await fs.stat(path.join(f.directory,'personal-memory',files[0]))).mode&0o777,0o600);
});
test('scope isolation, relevance, expiration and strict character budget',()=>{
 const item=(id,extra={})=>({id,revision:1,status:'active',updatedAt:'2026-10-18',...entry(),...extra});
 const items=[item('personal'),item('a',{scope:'project',projectId:'a',topic:'发布计划',content:'发布计划下周复核',type:'project'}),item('b',{scope:'project',projectId:'b'}),item('pending',{status:'pending'}),item('expired',{expiresAt:'2000-01-01'}),item('unrelated',{type:'reference',topic:'爬山',content:'杭州路线'})];
 assert.deepEqual(retrieve(items,{projectId:'a',query:'发布计划'}).map(i=>i.id),['a','personal']);assert.deepEqual(retrieve(items,{query:'周报'}).map(i=>i.id),['personal']);assert.equal(retrieve(items,{query:'周报',budget:5}).length,0);
});
test('natural language saves require explicit request, exact current source, and optimistic updates',async t=>{
 const f=await fixture(t),task={id:'chat',memoryOwner:'alice',messages:[f.message('请记住：周报先讲风险，再讲进展')]};const service=await f.store.scope({task,owner:'alice'});
 const saved=await service.execute({operation:'save',data:{...entry(),quote:'周报先讲风险，再讲进展'}});assert.equal(saved.origin,'explicit');assert.equal(saved.source.messageId,task.messages[0].id);
 await assert.rejects(service.execute({operation:'save',data:{...entry(),quote:'模型编造的原文'}}),/原文/);
 task.messages=[f.message('今天帮我写周报')];await assert.rejects(service.execute({operation:'save',data:{...entry(),quote:'今天帮我写周报'}}),/明确/);
 task.messages=[f.message('更新记忆：周报先讲结果')];await assert.rejects(service.execute({operation:'save',data:{...entry({content:'周报先讲结果'}),quote:'周报先讲结果'}}),/真实 id/);
 await service.execute({operation:'save',id:saved.id,data:{...entry({content:'周报先讲结果'}),revision:1,quote:'周报先讲结果'}});assert.equal((await service.context('周报')).entries[0].revision,2);
 task.memoryEnabled=false;assert.equal((await service.context('周报')).entries.length,0);await assert.rejects(service.execute({operation:'read',id:saved.id}),/关闭/);
});
test('memory tools cannot alter another project or write from delegated/scheduled prompts',async t=>{
 const f=await fixture(t),state=await f.change({action:'save',item:entry({scope:'project',projectId:'b'})});
 const task={id:'chat',projectId:'a',memoryOwner:'alice',messages:[f.message('记住：周报先讲风险，再讲进展')]},service=await f.store.scope({task,owner:'alice'});
 await assert.rejects(service.execute({operation:'read',id:state.items[0].id}),/范围/);
 await assert.rejects(service.execute({operation:'save',id:state.items[0].id,data:{...entry({scope:'project',projectId:'a'}),revision:1,quote:'周报先讲风险，再讲进展'}}),/范围/);
 task.parentAssistantId='parent';await assert.rejects(service.execute({operation:'save',data:{...entry(),quote:'周报先讲风险，再讲进展'}}),/自行/);
});
test('automatic extraction is opt-in, incremental, user-only and never scans legacy chats',async t=>{
 const f=await fixture(t);f.work.tasks=[{id:'chat',memoryOwner:'alice',messages:[{id:'old',role:'user',content:'旧偏好',createdAt:'2000-01-01'}]}];assert.equal(await f.store.batch('alice'),null);await f.enable();
 const message=f.message('我的周报先讲风险，再讲进展');f.work.tasks[0].messages.push(message,{...f.message('不应提取助手内容'),role:'assistant'});
 const batch=await f.store.batch('alice');assert.equal(batch.messages.length,1);assert.equal(batch.messages[0].id,message.id);
 await f.store.commitBatch(batch,[{...entry(),messageId:message.id,quote:'周报先讲风险，再讲进展'}],{inputTokens:100,outputTokens:20});
 const state=await f.store.read();assert.equal(state.items[0].status,'pending');assert.equal(state.worker.inputTokens,100);assert.equal(await f.store.batch('alice'),null);
 const service=await f.store.scope({task:f.work.tasks[0],owner:'alice'});assert.equal((await service.context('周报')).entries.length,0);
 await f.change({action:'approve',id:state.items[0].id});assert.equal((await service.context('周报')).entries.length,1);
});
test('forget removes content and versions, blocks resurrection on auto/import, allows explicit re-add',async t=>{
 const f=await fixture(t);await f.enable();let state=await f.change({action:'save',item:entry()});const original=state.items[0];state=await f.change({action:'save',item:{...original,content:'周报简洁一点'}});await f.change({action:'forget',id:original.id});
 let raw=await fs.readFile(path.join(f.directory,'personal-memory',(await fs.readdir(path.join(f.directory,'personal-memory')))[0]),'utf8');assert.ok(!raw.includes('周报简洁一点'));assert.ok(!raw.includes('周报先讲风险'));assert.equal((await f.store.exportData('alice')).items.length,0);
 const message=f.message('周报先讲风险，再讲进展');f.work.tasks=[{id:'chat',memoryOwner:'alice',messages:[message]}];const batch=await f.store.batch('alice');await f.store.commitBatch(batch,[{...entry(),messageId:message.id,quote:message.content}]);assert.equal((await f.store.read()).items.length,0);
 await f.change({action:'import',items:[entry()]});assert.equal((await f.store.read()).items.length,0);
 const task={id:'chat',memoryOwner:'alice',messages:[f.message('请记住：周报先讲风险，再讲进展')]};await (await f.store.scope({task,owner:'alice'})).execute({operation:'save',data:{...entry(),quote:'周报先讲风险，再讲进展'}});assert.equal((await f.store.read()).items.length,1);
});
test('reset, disabled chats and edited source invalidate in-flight background writes',async t=>{
 const f=await fixture(t);await f.enable();let message=f.message('我的周报先讲风险，再讲进展');f.work.tasks=[{id:'chat',memoryOwner:'alice',messages:[message]}];let batch=await f.store.batch('alice');await f.change({action:'reset'});assert.equal((await f.store.commitBatch(batch,[{...entry(),messageId:message.id,quote:'周报先讲风险，再讲进展'}])).discarded,true);
 message=f.message('我的新周报偏好：先讲风险');f.work.tasks[0].messages=[message];batch=await f.store.batch('alice');f.work.tasks[0].memoryEnabled=false;assert.equal((await f.store.commitBatch(batch,[])).discarded,true);
 f.work.tasks[0].memoryEnabled=true;batch=await f.store.batch('alice');f.work.tasks[0].messages[0].content='已编辑';assert.equal((await f.store.commitBatch(batch,[])).discarded,true);
});
test('suggested replacement preserves active version until approval and rejects stale approval',async t=>{
 const f=await fixture(t);await f.enable();let state=await f.change({action:'save',item:entry()}),old=state.items[0];
 const message=f.message('我的周报现在先讲进展，再讲风险');f.work.tasks=[{id:'chat',memoryOwner:'alice',messages:[message]}];const batch=await f.store.batch('alice');await f.store.commitBatch(batch,[{...entry({content:'周报先讲进展，再讲风险'}),messageId:message.id,quote:'周报现在先讲进展，再讲风险'}]);
 state=await f.store.read();const pending=state.items.find(i=>i.status==='pending');assert.equal(pending.replacesId,old.id);assert.equal(state.items.find(i=>i.status==='active').content,old.content);
 await f.change({action:'save',item:{...old,content:'周报只讲结果'}});await assert.rejects(f.change({action:'approve',id:pending.id}),/变化/);
});
test('background rejects invented sources, secrets, and forget instructions',async t=>{
 const f=await fixture(t);await f.enable();const message=f.message('忘记旧偏好，密码：secret1234');f.work.tasks=[{id:'chat',memoryOwner:'alice',messages:[message]}];const batch=await f.store.batch('alice');await f.store.commitBatch(batch,[{...entry(),messageId:'invented',quote:'不存在的来源'},{...entry(),messageId:message.id,quote:message.content}]);assert.equal((await f.store.read()).items.length,0);assert.equal((await f.store.read()).worker.rejected,2);
 await assert.rejects(f.change({action:'save',item:entry({content:'密码：secret1234'})}),/密码/);
});
test('concurrent UI updates never clobber each other',async t=>{
 const f=await fixture(t),state=await f.store.read();const results=await Promise.allSettled([f.store.update({ownerId:'alice',revision:state.revision,action:'save',item:entry()}),f.store.update({ownerId:'alice',revision:state.revision,action:'save',item:entry({topic:'另一主题'})})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.store.read()).items.length,1);
});

test('negative remember and forget requests cannot authorize a write',async t=>{
 const f=await fixture(t),task={id:'chat',memoryOwner:'alice',messages:[f.message('不要记住：周报先讲风险，再讲进展')]},service=await f.store.scope({task,owner:'alice'});
 await assert.rejects(service.execute({operation:'save',data:{...entry(),quote:'周报先讲风险，再讲进展'}}),/明确/);
 const state=await f.change({action:'save',item:entry()});task.messages=[f.message('不要忘记周报偏好')];await assert.rejects(service.execute({operation:'forget',id:state.items[0].id}),/明确/);assert.equal((await f.store.read()).items.length,1);
});

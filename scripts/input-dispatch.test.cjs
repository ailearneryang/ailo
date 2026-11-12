const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(fs.readFileSync(require.resolve('../apps/desktop/src/input-dispatch.ts'),'utf8'))).toString('base64'));
const state={ready:true,composerBusy:false,sending:false,paused:false,editing:false,taskId:'weather',pendingTaskId:'weather',requestId:'running',phase:'running'};
test('explicit send dispatches queued content and attachments through steering without replaying the old task',async()=>{const {queuedDispatch}=await modulePromise;assert.equal(queuedDispatch({...state,requested:true}),'steer');assert.equal(queuedDispatch({...state,requested:true,pendingTaskId:undefined,requestId:undefined}),'start');});
test('queue respects preparing/settling, other task ownership, explicit stop and message edits',async()=>{const {queuedDispatch}=await modulePromise;for(const change of [{phase:'preparing'},{phase:'settling'},{pendingTaskId:'other'},{requestId:null},{paused:true},{editing:true},{sending:true},{composerBusy:true},{ready:false}])assert.equal(queuedDispatch({...state,requested:true,...change}),'wait');assert.equal(queuedDispatch({...state,requested:true,pendingTaskId:undefined,requestId:undefined,blocked:true}),'wait');});

test('submitted commands stay queued throughout a live execution; Run explicitly steers the chosen row',async()=>{const {queuedDispatch}=await modulePromise;for(const phase of ['preparing','running','settling'])assert.equal(queuedDispatch({...state,requested:false,phase}),'wait');assert.equal(queuedDispatch({...state,requested:true,phase:'running'}),'steer');assert.equal(queuedDispatch({...state,pendingTaskId:undefined,requestId:undefined}),'start');});
test('renderer drains only after startup reconciliation and final reply settlement, retaining compact direct rows',()=>{const source=fs.readFileSync(require.resolve('../apps/desktop/src/main.tsx'),'utf8');assert.match(source,/if\(!ready\|\|!queueReconciled/);assert.match(source,/if\(item\)void executeQueued\(item,true\)/);assert.match(source,/respondingTasks.current.add\(nextTask.id\)/);assert.match(source,/respondingTasks.current.delete\(nextTask.id\)/);assert.match(source,/\.\.\.respondingTasks.current/);assert.match(source,/fromQueue\?models.find/);assert.match(source,/if\(!fromQueue\)setActive/);assert.match(source,/<div className="message-queue" key=\{task.id\} aria-label="待发送消息">/);assert.doesNotMatch(source,/message-queue-toggle|待发送 \{queued.filter/);});
test('FIFO per task survives completion, independent task selection and reload; editing and failed head cannot be bypassed',async()=>{
 const {nextQueued}=await modulePromise,items=[{id:'one',taskId:'weather'},{id:'two',taskId:'weather'},{id:'other',taskId:'report'}],tasks=[{id:'weather',agentRun:{status:'partial'}},{id:'report',agentRun:{status:'completed'}}];
 assert.equal(nextQueued(items,tasks,[],[]).id,'one');assert.equal(nextQueued(items,tasks,['weather'],[]).id,'other');assert.equal(nextQueued(items,tasks,[],[],'one').id,'other');assert.equal(nextQueued([{...items[0],error:'offline'},...items.slice(1)],tasks,[],[]).id,'other');assert.equal(nextQueued(JSON.parse(JSON.stringify(items.slice(1))),tasks,[],[]).id,'two');assert.equal(nextQueued(items,tasks,[],['weather']).id,'other');
});
test('permission, clarification, explicit pause and shared service failures hold the queue; repair exhaustion alone does not',async()=>{
 const {nextQueued,queueBlockReason}=await modulePromise,item=[{id:'one',taskId:'weather'}];
 for(const status of ['waiting_permission','waiting_user','blocked','failed','paused','cancelled']){const task={id:'weather',agentRun:{status}};assert.ok(queueBlockReason(task));assert.equal(nextQueued(item,[task],[],[]),undefined);}
 for(const task of [{id:'weather',lastError:'network unavailable'},{id:'weather',messages:[{id:'reply',role:'assistant',clarification:{title:'请选择'}}]},{id:'weather',assistantPaused:true},{id:'weather',archived:true}])assert.equal(nextQueued(item,[task],[],[]),undefined);
 assert.equal(nextQueued(item,[{id:'weather',agentRun:{status:'partial'}}],[],[]).id,'one');
});
test('actual handoff drains stable messages and attachments once, resumes a saved input and never replays a settled input',async()=>{
 const {deliverQueued}=await modulePromise;let task={id:'weather',messages:[]},calls=0;const item={id:'one',content:'改背景',materials:[{sourceId:'sky'}]};
 const run=async(t,append)=>{calls++;if(append)t.messages.push({id:item.id,role:'user',content:item.content,materials:item.materials});t.messages.push({id:'result',role:'assistant'});};
 await deliverQueued(item,async()=>task,run);assert.equal(calls,1);assert.deepEqual(task.messages[0].materials,item.materials);await deliverQueued(item,async()=>JSON.parse(JSON.stringify(task)),run);assert.equal(calls,1);
 task={id:'weather',messages:[{id:item.id,role:'user'}]};await deliverQueued(item,async()=>task,async(t,append)=>{calls++;assert.equal(append,false);t.messages.push({id:'resumed',role:'assistant'});});assert.equal(calls,2);assert.equal(task.messages.filter(m=>m.id===item.id).length,1);
});
test('failed or unknown handoff retains the input for explicit recovery instead of claiming completion or auto replay',async()=>{
 const {deliverQueued,nextQueued}=await modulePromise;let calls=0,task={id:'weather',messages:[]};const item={id:'one',taskId:'weather'},queue=[item,{id:'two',taskId:'weather'}];
 await assert.rejects(deliverQueued(item,async()=>task,async()=>{calls++;task.messages.push({id:item.id,role:'user'});throw Error('unknown reply result');}),/unknown reply result/);
 queue[0].error='unknown reply result';assert.equal(nextQueued(queue,[task],[],[]),undefined);assert.equal(calls,1);assert.equal(queue.length,2);
 await assert.rejects(deliverQueued({id:'missing'},async()=>task,async()=>{}),/尚未保存/);await assert.rejects(deliverQueued(item,async()=>undefined,async()=>{}),/原任务不存在/);
});
test('conversation receipt removes duplicate composer rows before completion but preserves restart work and strict message identity',async()=>{
 const {queuedAwaitingReceipt,nextQueued}=await modulePromise;
 const queue=[{id:'accepted',taskId:'weather',content:'相同文字'},{id:'unsent',taskId:'weather',content:'相同文字'},{id:'foreign',taskId:'other'}];
 const tasks=[{id:'weather',messages:[{id:'accepted',role:'user'},{id:'unsent',role:'assistant'}]},{id:'other',messages:[]}];
 assert.deepEqual(queuedAwaitingReceipt(queue,tasks).map(m=>m.id),['unsent','foreign']);assert.equal(queue.length,3,'display filtering must not erase recovery state');
 assert.equal(nextQueued(queue,tasks,['weather'],[]).id,'foreign');assert.equal(nextQueued(queue,tasks,[],[]).id,'accepted','saved unfinished input can still resume after restart');
 assert.equal(queuedAwaitingReceipt([{id:'accepted',taskId:'other'}],tasks).length,1,'receipt belongs to its task');
 const source=fs.readFileSync(require.resolve('../apps/desktop/src/main.tsx'),'utf8');assert.match(source,/visibleQueued=queuedAwaitingReceipt\(queued,data.tasks\)/);assert.match(source,/visibleQueued.filter\(m=>m.taskId===task.id\).map/);assert.match(source,/nextQueued\(queued,/);
});
test('two inputs submitted during a task remain as separate actionable rows until completion or explicit Run',async()=>{
 const {queuedDispatch,queuedAwaitingReceipt,nextQueued}=await modulePromise;
 const queue=[{id:'first',taskId:'weather',content:'北京明天天气'},{id:'second',taskId:'weather',content:'未来一周呢'}];
 const tasks=[{id:'weather',messages:[{id:'original',role:'user'}]}];
 for(const item of queue)assert.equal(queuedDispatch({...state,requested:false,taskId:item.taskId}),'wait');
 assert.deepEqual(queuedAwaitingReceipt(queue,tasks).map(m=>m.id),['first','second']);
 assert.equal(nextQueued(queue,tasks,['weather'],[]),undefined);
 assert.equal(queuedDispatch({...state,requested:true,taskId:queue[1].taskId}),'steer','the chosen row can run without auto-sending other rows');
 tasks[0].messages.push({id:'second',role:'user'});assert.deepEqual(queuedAwaitingReceipt(queue,tasks).map(m=>m.id),['first']);
 assert.equal(nextQueued(queue,tasks,[],[]).id,'first','remaining rows resume in order after the active execution settles');
 const source=fs.readFileSync(require.resolve('../apps/desktop/src/main.tsx'),'utf8');assert.doesNotMatch(source,/executeQueued\(liveItem,true\)/);assert.match(source,/onClick=\{\(\)=>void executeQueued\(item\)\}/);assert.match(source,/已加入等待队列/);
});

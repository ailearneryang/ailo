const {test}=require('node:test'),assert=require('node:assert/strict');
const {createExecutionPresence}=require('../apps/desktop/execution-presence.cjs');
const {createExecutionCredentials}=require('../apps/desktop/execution-credentials.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){let unlocked=false,denied=false,calls=0;const awake=require('../apps/desktop/execution-awake.cjs').createExecutionAwake();const presence=createExecutionPresence({isUnlocked:()=>unlocked,awake});const storage={executionPresence:presence,async modelCredentials(id,{background=false}={}){if(background)throw Object.assign(Error('uncached'),{code:'KEYCHAIN_USER_ACTION_REQUIRED'});calls++;if(denied)throw Object.assign(Error('OS refused'),{code:'MODEL_CREDENTIALS_UNAVAILABLE'});return {id,model:'fixture',name:'fixture',baseUrl:'https://example.test/v1'};}};return {awake,presence,storage,calls:()=>calls,setDenied:v=>denied=v,unlock(){unlocked=true;presence.unlock();},lock(){unlocked=false;presence.lock();}};}
test('17:05 DarkWake does not decrypt; original scheduled operation continues once after normal unlock',async()=>{
 const f=fixture(),c=new AbortController(),statuses=[];let completed=0;const read=createExecutionCredentials(f.storage,{signal:c.signal,scheduled:true,onStatus:s=>statuses.push(s)});
 const work=read('company').then(result=>{completed++;return result;});await flush();assert.equal(f.calls(),0);assert.equal(f.presence.pending,1);
 f.presence.resume();f.awake.suspend();f.awake.resume();f.presence.resume();await flush();assert.equal(f.calls(),0);assert.equal(completed,0);
 f.unlock();assert.equal((await work).id,'company');assert.equal(completed,1);assert.equal(f.calls(),1);assert.equal(f.presence.pending,0);assert.ok(statuses.some(s=>s.includes('等待设备解锁')));
});
test('decryption failure retains wait; duplicate notifications and repeated reads do not reset two-attempt budget',async()=>{
 const f=fixture(),read=createExecutionCredentials(f.storage,{signal:new AbortController().signal,scheduled:true});f.setDenied(true);f.unlock();
 const work=read('company'),rejection=assert.rejects(work,error=>error.code==='MODEL_CREDENTIALS_UNAVAILABLE'&&!error.message.includes('重新填写'));
 await flush();assert.equal(f.calls(),1);assert.equal(f.presence.pending,1);f.presence.unlock();f.presence.resume();await flush();assert.equal(f.calls(),1);
 f.lock();f.presence.resume();await flush();assert.equal(f.calls(),1);f.unlock();await rejection;assert.equal(f.calls(),2);assert.equal(f.presence.pending,0);
});
test('one failed unlock can recover at the next real presence event; cancellation prevents all requests',async()=>{
 const f=fixture(),c=new AbortController(),read=createExecutionCredentials(f.storage,{signal:c.signal,scheduled:true});f.setDenied(true);f.unlock();const work=read('company');await flush();assert.equal(f.calls(),1);f.setDenied(false);f.lock();f.unlock();assert.equal((await work).id,'company');assert.equal(f.calls(),2);
 const g=fixture(),stop=new AbortController(),waiting=createExecutionCredentials(g.storage,{signal:stop.signal,scheduled:true})('company');await flush();stop.abort(Error('user cancelled'));await assert.rejects(waiting,/user cancelled/);g.unlock();assert.equal(g.calls(),0);assert.equal(g.presence.pending,0);
});
test('cached credentials require no unlock; unknown and configuration errors never loop or switch models',async()=>{
 let reads=0;const s={async modelCredentials(id,options){reads++;assert.equal(options.background,true);return {id};}};assert.equal((await createExecutionCredentials(s,{signal:new AbortController().signal,scheduled:true})('company')).id,'company');assert.equal(reads,1);
 const f=fixture();f.storage.modelCredentials=async()=>{throw Object.assign(Error('model missing'),{code:'MODEL_NOT_FOUND'});};await assert.rejects(createExecutionCredentials(f.storage,{signal:new AbortController().signal,scheduled:true})('company'),{code:'MODEL_NOT_FOUND'});assert.equal(f.presence.pending,0);
});
test('desktop scheduled chat waits in its original session and sends exactly one request after unlock',async()=>{
 const f=fixture();let requests=0;const statuses=[],chat=require('../apps/desktop/chat.cjs').createChat(f.storage,async()=>{requests++;return new Response(JSON.stringify({choices:[{message:{content:'same scheduled result'}}]}));});
 const work=chat.complete({id:'scheduled-run',executionOrigin:'scheduled',modelId:'company',messages:[{role:'user',content:'summarize messages'}],onStatus:s=>statuses.push(s)});
 for(let i=0;i<20&&!f.presence.pending;i++)await flush();assert.equal(requests,0);assert.equal(chat.sessions()[0].id,'scheduled-run');assert.match(chat.sessions()[0].status,/等待设备解锁/);
 f.unlock();assert.equal((await work).content,'same scheduled result');assert.equal(requests,1);assert.equal(f.calls(),1);assert.equal(chat.sessions().length,0);
});
test('desktop cancellation while locked releases original scheduled session without decrypting or executing',async()=>{
 const f=fixture(),chat=require('../apps/desktop/chat.cjs').createChat(f.storage,async()=>assert.fail('no request before unlock'));
 const work=chat.complete({id:'cancel-locked',executionOrigin:'scheduled',modelId:'company',messages:[{role:'user',content:'task'}]});
 for(let i=0;i<20&&!f.presence.pending;i++)await flush();chat.cancel('cancel-locked');await assert.rejects(work,e=>e.code==='MODEL_CANCELLED');f.unlock();assert.equal(f.calls(),0);assert.equal(f.presence.pending,0);assert.equal(chat.sessions().length,0);
});
test('scheduled history keeps the same run queued through locked wake and records completion only after recovery',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-scheduled-keychain-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const f=fixture();let executions=0,requests=0;const chat=require('../apps/desktop/chat.cjs').createChat(f.storage,async()=>{requests++;return new Response(JSON.stringify({choices:[{message:{content:'summary'}}]}));});
 const schedules=require('../apps/desktop/scheduled-tasks.cjs').createScheduledTasks({directory,execute:async(task,run)=>{executions++;return chat.complete({id:run.id,taskId:run.taskId,executionOrigin:'scheduled',modelId:'company',messages:[{role:'user',content:task.prompt}]});}});
 t.after(()=>schedules.stop());const task=await schedules.save({title:'飞书消息整理',prompt:'总结当天消息',modelId:'company',frequency:'once',at:new Date(Date.now()+60000).toISOString()});await schedules.run(task.id);
 for(let i=0;i<30&&!f.presence.pending;i++)await flush();let run=(await schedules.list())[0].runs[0];const id=run.id,taskId=run.taskId;
 assert.equal(run.status,'running');assert.equal(run.finishedAt,undefined);assert.equal(requests,0);f.presence.resume();await flush();assert.equal(requests,0);f.unlock();
 for(let i=0;i<50;i++){run=(await schedules.list())[0].runs[0];if(run.finishedAt)break;await flush();}
 assert.equal(run.status,'completed');assert.equal(run.id,id);assert.equal(run.taskId,taskId);assert.equal(executions,1);assert.equal(requests,1);assert.equal((await schedules.list())[0].runs.length,1);
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const {createConnectivityWait}=require('../apps/desktop/execution-connectivity.cjs');
const {recoverRequest}=require('../apps/desktop/model-request.cjs');
function fixture(){let time=0,online=false;const pending=new Set();const awake=require('../apps/desktop/execution-awake.cjs').createExecutionAwake({now:()=>time,setTimer:(fn,ms)=>{const t={fn,due:time+ms};pending.add(t);return t;},clearTimer:t=>pending.delete(t)});return {awake,pending,setOnline:v=>online=v,wait:createConnectivityWait({isOnline:()=>online,awake,timeout:20,interval:10})(),async tick(ms){time+=ms;for(const t of [...pending])if(t.due<=time){pending.delete(t);t.fn();}await new Promise(r=>setImmediate(r));}};}
test('original model request waits for restored network without reissuing tools',async()=>{
 const f=fixture(),statuses=[];let calls=0;const work=recoverRequest(async()=>{calls++;if(calls===1)throw Error('net::ERR_INTERNET_DISCONNECTED');return 'original result';},{signal:new AbortController().signal,retryDelay:0,waitForNetwork:s=>f.wait(s,v=>statuses.push(v))});
 await f.tick(0);assert.equal(calls,1);await f.tick(10);assert.equal(calls,1);f.setOnline(true);await f.tick(10);assert.equal(await work,'original result');assert.equal(calls,2);assert.equal(statuses.length,2);assert.equal(f.pending.size,0);
});
test('sleep excludes network wait time and cancellation removes its timer',async()=>{
 const f=fixture(),c=new AbortController();const work=f.wait(c.signal);await f.tick(0);f.awake.suspend();await f.tick(900000);f.awake.resume();f.setOnline(true);await f.tick(10);assert.equal(await work,true);
 const g=fixture(),cancel=new AbortController(),waiting=g.wait(cancel.signal);await g.tick(0);cancel.abort(Error('user stopped'));await assert.rejects(waiting,/user stopped/);assert.equal(g.pending.size,0);
});
test('offline wait ends without extra request; visible output and user cancellation never wait or replay',async()=>{
 const f=fixture();let calls=0;const work=recoverRequest(async()=>{calls++;throw Error('net::ERR_INTERNET_DISCONNECTED');},{signal:new AbortController().signal,waitForNetwork:s=>f.wait(s)});const rejected=assert.rejects(work,e=>e.code==='MODEL_NETWORK'&&e.retryCount===0);await f.tick(0);await f.tick(10);await f.tick(10);await rejected;assert.equal(calls,1);
 const c=new AbortController();await assert.rejects(recoverRequest(async()=>{throw Object.assign(Error('net::ERR_NETWORK_CHANGED'),{hasVisibleOutput:true});},{signal:c.signal,waitForNetwork:()=>assert.fail('must not wait')}));
 c.abort();await assert.rejects(recoverRequest(()=>assert.fail('cancelled'),{signal:c.signal,waitForNetwork:()=>assert.fail('cancelled')}));
});
test('connectivity changes do not reset the original retry budget',async()=>{
 let calls=0,waits=0;await assert.rejects(recoverRequest(async()=>{calls++;throw Error('net::ERR_NETWORK_CHANGED');},{signal:new AbortController().signal,retryDelay:0,waitForNetwork:async()=>{waits++;return true;}}),e=>e.retryCount===2);assert.equal(calls,3);assert.equal(waits,2);
});
test('desktop chat wires host connectivity into the same request and retains one final reply',async()=>{
 const f=fixture(),statuses=[];let calls=0;
 const chat=require('../apps/desktop/chat.cjs').createChat({executionAwake:f.awake,executionConnectivity:()=>f.wait,modelCredentials:async()=>({baseUrl:'https://example.com/v1',model:'fixture',name:'fixture'})},async()=>{if(++calls===1)throw Error('net::ERR_INTERNET_DISCONNECTED');return new Response(JSON.stringify({choices:[{message:{content:'recovered reply'}}]}));},{retryDelay:0});
 const work=chat.complete({id:'offline-chat',modelId:'fixture',messages:[{role:'user',content:'hello'}],onStatus:s=>statuses.push(s)});
 for(let i=0;i<30&&!statuses.some(s=>s.includes('网络已断开'));i++)await f.tick(0);
 assert.equal(calls,1);assert.ok(statuses.some(s=>s.includes('网络已断开')));f.setOnline(true);await f.tick(10);assert.equal((await work).content,'recovered reply');assert.equal(calls,2);assert.ok(statuses.some(s=>s.includes('网络已恢复')));
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const {createExecutionAwake}=require('../apps/desktop/execution-awake.cjs');
function fixture(){let time=0,id=0;const timers=new Map();const awake=createExecutionAwake({now:()=>time,setTimer:(fn,ms)=>{timers.set(++id,{fn,due:time+ms});return id;},clearTimer:id=>timers.delete(id)});return {awake,advance(ms){time+=ms;for(const [id,t] of [...timers])if(t.due<=time){timers.delete(id);t.fn();}}};}
test('17:00 scheduled request survives 43 minutes asleep without spending its three-minute budget',async()=>{
 const {awake,advance}=fixture();let fired=0;awake.setTimeout(()=>fired++,180000);advance(1000);awake.suspend();awake.suspend();advance(43*60000);assert.equal(fired,0);assert.equal(awake.now(),1000);
 let executed=0;const controller=new AbortController();const work=awake.wait(controller.signal).then(()=>executed++);await Promise.resolve();assert.equal(executed,0);
 awake.resume();awake.resume();await work;assert.equal(executed,1);advance(178999);assert.equal(fired,0);advance(1);assert.equal(fired,1);
});
test('cancel during sleep releases waiters and cancelled timers cannot fire after resume',async()=>{
 const {awake,advance}=fixture();awake.suspend();const c=new AbortController(),waiting=awake.wait(c.signal);c.abort(Error('user stopped'));await assert.rejects(waiting,/user stopped/);
 let count=0;const timer=awake.setTimeout(()=>count++,100);awake.clearTimeout(timer);advance(50000);awake.resume();advance(1000);assert.equal(count,0);
});
test('issued operation settles once; only its continuation waits for wake',async()=>{
 const {awake,advance}=fixture();let issued=0,continued=0;let settle;const operation=()=>{issued++;return new Promise(r=>settle=r);};
 const work=(async()=>{const result=await operation();await awake.wait();continued++;return result;})();awake.suspend();settle('receipt');await Promise.resolve();assert.equal(continued,0);advance(900000);awake.resume();assert.equal(await work,'receipt');assert.equal(issued,1);assert.equal(continued,1);
});
test('chat preserves its in-flight response across sleep and sends no duplicate model request',async()=>{
 const {awake,advance}=fixture();const {createChat}=require('../apps/desktop/chat.cjs');let respond,started,calls=0;
 const ready=new Promise(r=>started=r),statuses=[],records=[];
 const chat=createChat({executionAwake:awake,modelCredentials:async()=>({baseUrl:'https://example.com/v1',model:'offline',name:'offline'}),recordModelRequest:async r=>records.push(r)},async()=>{calls++;started();return new Promise(r=>respond=r);},{connect:100,first:100,idle:100,total:1000});
 const work=chat.complete({id:'sleep',modelId:'offline',messages:[{role:'user',content:'hi'}],onStatus:s=>statuses.push(s)});await ready;
 awake.suspend();advance(43*60000);respond(new Response(JSON.stringify({choices:[{message:{content:'summary'}}]})));
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);awake.resume();const result=await work;
 assert.equal(result.content,'summary');assert.equal(calls,1);assert.equal(records.length,1);assert.ok(records[0].durationMs<100);assert.ok(statuses.some(s=>s.includes('电脑已睡眠')));assert.ok(statuses.some(s=>s.includes('电脑已唤醒')));
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/desktop/src/delivery-artifacts.ts',import.meta.url),'utf8'));
const {deliveryForMessage}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const completed=(extra={})=>({status:'completed',artifacts:[{path:'result.png'}],...extra});
const messages=[{id:'u1',role:'user'},{id:'a1',role:'assistant'},{id:'u2',role:'user'},{id:'a2',role:'assistant'}];
test('current delivery attaches to its own response and never to a later ordinary answer',()=>{
 const run=completed({currentInputId:'u1'}),task={agentRun:run};
 assert.equal(deliveryForMessage(task,messages,'a1'),run);
 assert.equal(deliveryForMessage(task,messages,'a2'),undefined);
 assert.equal(deliveryForMessage(task,messages,'u1'),undefined);
});
test('historical delivery stays on the original reply while a new task runs',()=>{
 const old=completed({afterMessageId:'a1'}),task={agentRun:{status:'running',artifacts:[],history:[old]}};
 assert.equal(deliveryForMessage(task,messages,'a1'),old);
 assert.equal(deliveryForMessage(task,messages,'a2'),undefined);
});
test('intermediate assistant replies cannot duplicate the delivery block',()=>{
 const run=completed({progressInputId:'u1'}),task={agentRun:run},turns=[messages[0],{id:'interim',role:'assistant'},messages[1],messages[2]];
 assert.equal(deliveryForMessage(task,turns,'interim'),undefined);
 assert.equal(deliveryForMessage(task,turns,'a1'),run);
});
test('legacy completed runs attach only to the last assistant reply; incomplete and empty runs have none',()=>{
 const run=completed();assert.equal(deliveryForMessage({agentRun:run},messages,'a2'),run);
 assert.equal(deliveryForMessage({agentRun:run},messages,'a1'),undefined);
 for(const r of [completed({status:'blocked'}),completed({status:'running'}),completed({artifacts:[]})])assert.equal(deliveryForMessage({agentRun:r},messages,'a2'),undefined);
 assert.equal(deliveryForMessage({},messages,'a2'),undefined);
});

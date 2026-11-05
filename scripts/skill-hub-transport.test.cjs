const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
const {createSkillHubTransport}=require('../apps/desktop/skill-hub-transport.cjs');
const {createSkillHub}=require('../apps/desktop/skill-hub.cjs');
function transport(run){const calls=[];return {calls,fetch:createSkillHubTransport(()=>({app:{whenReady:async()=>{}},net:{request:options=>{calls.push(options);const req=new EventEmitter();req.abort=()=>req.emit('error',Error('Redirect was cancelled'));req.end=()=>queueMicrotask(()=>run(req,options));return req;}}}))};}
function respond(req,body,status=200){const response=new PassThrough();response.statusCode=status;response.headers={};req.emit('response',response);response.end(body);return response;}
test('Electron manual redirect cancellation still exposes Location and installs through checked next hop',async()=>{
 const env=transport((req,options)=>{if(options.url.includes('/download?'))req.emit('redirect',302,'GET','https://bucket.cos.ap-guangzhou.myqcloud.com/git.zip');else respond(req,'ZIP bytes');});
 let imported;const hub=createSkillHub({fetch:env.fetch,packages:{importSkill:async input=>{imported=input;return {name:'git',package:{id:'test',files:1}};}}});
 const skill=await hub.install({slug:'git',version:'1.0.0'});assert.equal(skill.name,'git');assert.equal(imported.buffer.toString(),'ZIP bytes');assert.equal(env.calls.length,2);assert.equal(env.calls[0].redirect,'manual');assert.equal(env.calls[0].credentials,'omit');
});
test('Electron redirect to untrusted destination is rejected before second request',async()=>{
 const env=transport(req=>req.emit('redirect',302,'GET','http://127.0.0.1/private'));const hub=createSkillHub({fetch:env.fetch});await assert.rejects(hub.install({slug:'git',version:'1.0.0'}),/地址/);assert.equal(env.calls.length,1);
});
test('Electron response streams preserve errors and cancellation',async()=>{
 const controller=new AbortController();let response;const env=transport(req=>{response=new PassThrough();response.statusCode=200;response.headers={};req.emit('response',response);});
 const result=await env.fetch('https://api.skillhub.cn/test',{signal:controller.signal});const read=result.arrayBuffer();controller.abort();await assert.rejects(read);assert.ok(response.destroyed);
 const failed=transport(req=>req.emit('error',Error('net::ERR_CONNECTION_RESET')));await assert.rejects(failed.fetch('https://api.skillhub.cn/test'),/RESET/);
});
test('Electron cancellation before readiness sends no request',async()=>{const c=new AbortController();c.abort();const env=transport(()=>{throw Error('must not execute');});await assert.rejects(env.fetch('https://api.skillhub.cn',{signal:c.signal}),{name:'AbortError'});assert.equal(env.calls.length,0);});

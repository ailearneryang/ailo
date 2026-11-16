const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createBridge,desktopAdapter,endpoint,connectionDirectory}=require('../apps/desktop/mobile-bridge.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-mobile-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('mobile dispatch persists outcomes, real progress continues, restart never replays an unknown side effect',async t=>{
 const directory=await fixture(t);let calls=0;const updates=[];const job={id:'mobile-case',text:'write a file'};
 const server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);if(body.update)updates.push(body.update);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jobs:[job]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url='http://127.0.0.1:'+server.address().port;
 const bridge=await createBridge({directory,url,key:'fixture',execute:async(j,progress)=>{calls++;await progress({detail:'真实进展'});return {status:'completed',detail:'核验完成',result:'done'};}});await bridge.tick();bridge.stop();assert.equal(calls,1);
 const again=await createBridge({directory,url,key:'fixture',execute:()=>assert.fail('must not replay')});await again.tick();again.stop();assert.equal(calls,1);assert.ok(updates.some(u=>u.status==='completed'));
 await fs.writeFile(path.join(connectionDirectory(directory,url,'fixture'),'jobs.json'),JSON.stringify({[job.id]:{id:job.id,status:'running'}}));const restored=await createBridge({directory,url,key:'fixture',execute:()=>assert.fail('unknown side effect replayed')});await restored.tick();restored.stop();assert.equal(updates.at(-1).status,'unknown');
});
test('mobile adapter preserves original conversation and uses normal chat input, unfinished outcome stays unfinished',async t=>{
 const tasks=[],seen=[];const storage={readWorkspace:async()=>({tasks,defaultModelId:'company-model'}),patchTask:async(id,p,append=[])=>{let task=tasks.find(t=>t.id===id);if(!task){task={id,...p,messages:[]};tasks.push(task);}Object.assign(task,p);for(const m of append)if(!task.messages.some(x=>x.id===m.id))task.messages.push(m);}};
 const chat={sessions:()=>[],complete:async input=>{seen.push(input);input.onStatus('实际步骤');return {content:'仍未完成，证据保留',agentRun:{status:'blocked',artifacts:[]}};}};
 // No artifact workspace access when a task has no registered artifacts.
 const adapter=desktopAdapter(storage,chat);const result=await adapter.execute({id:'original',text:'原要求'},async()=>{});
 assert.equal(result.status,'incomplete');
 chat.complete=async()=>({content:'聊天请求失败',agentRun:{status:'blocked',currentIntent:'chat',artifacts:[]}});const failedChat=await adapter.execute({id:'failed-chat',text:'查询'},async()=>{});assert.equal(failedChat.status,'incomplete');tasks.splice(1);chat.complete=async input=>{seen.push(input);return {content:'仍未完成',agentRun:{status:'blocked',artifacts:[]}};};assert.equal(seen[0].modelId,'company-model');assert.equal(seen[0].executionOrigin,'user');assert.equal(seen[0].feishuEnabled,false);assert.equal((await adapter.history())[0].messages.length,2);
 await adapter.execute({id:'followup',text:'补充要求',taskId:result.taskId},async()=>{});assert.equal(tasks.length,1);assert.equal(seen[1].messages[0].content,'原要求');assert.equal(seen[1].messages.at(-1).content,'补充要求');
 await assert.rejects(adapter.execute({id:'bad',text:'读其他会话',taskId:'unshared'},async()=>{}),/不存在或未开放/);
});
test('remote endpoints require HTTPS and do not accept URL credentials or paths',()=>{assert.equal(endpoint('http://localhost:8787'),'http://localhost:8787');for(const u of ['http://192.168.1.2:8787','https://user:pass@example.org','https://example.org/path'])assert.throws(()=>endpoint(u));});

test('existing desktop history projects real progress without treating empty conversations as completed',async()=>{
 const tasks=[{id:'existing',title:'电脑任务',messages:[{role:'user',content:'原要求'}]},{id:'empty',title:'未执行会话',messages:[]},{id:'my-ailo-assistant',messages:[]},{id:'temp',temporary:true,messages:[]}];
 const storage={readWorkspace:async()=>({tasks})},chat={sessions:()=>[{taskId:'existing',status:'正在核对来源',run:{steps:[{id:'s1',title:'核对来源',status:'running'}]}}]};
 assert.equal((await desktopAdapter(storage,chat).history()).length,0);
 const history=await desktopAdapter(storage,chat,{shareHistory:true}).history();assert.equal(history.length,2);assert.equal(history[0].status,'running');assert.equal(history[0].steps[0].title,'核对来源');assert.equal(history[0].messages[0].content,'原要求');assert.equal(history[1].status,'conversation');
});

test('switching relay credentials isolates old receipts and preserves unbound legacy evidence',async t=>{
 const directory=await fixture(t);const legacy={old:{id:'old',status:'running',detail:'保留证据'}};await fs.writeFile(path.join(directory,'jobs.json'),JSON.stringify(legacy));let updates=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);if(body.update)updates.push(body.update.id);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jobs:[]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port;
 const a=await createBridge({directory,url,key:'local',execute:()=>assert.fail()});await a.tick();a.stop();const b=await createBridge({directory,url,key:'cloud',execute:()=>assert.fail()});await b.tick();b.stop();assert.deepEqual(updates,[]);assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'jobs.json'))),legacy);assert.notEqual(connectionDirectory(directory,url,'local'),connectionDirectory(directory,url,'cloud'));
});
test('missing remote receipts are quarantined once while fresh jobs and history continue',async t=>{
 const directory=await fixture(t);let calls=0,missing=0;const job={id:'fresh',text:'new task'};
 const server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);res.setHeader('Content-Type','application/json');if(body.update?.id==='removed'){missing++;res.writeHead(404);return res.end(JSON.stringify({error:'任务不存在'}));}res.end(JSON.stringify({jobs:[job]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port,dir=connectionDirectory(directory,url,'key');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'jobs.json'),JSON.stringify({removed:{id:'removed',status:'running',detail:'unknown effect'}}));
 const bridge=await createBridge({directory,url,key:'key',execute:async()=>{calls++;return {status:'completed'};}});await bridge.tick();bridge.stop();await bridge.tick();assert.equal(missing,1);assert.equal(calls,1);const saved=JSON.parse(await fs.readFile(path.join(dir,'jobs.json')));assert.equal(saved.removed.status,'unknown');assert.equal(saved.removed.deliveryMissing,true);assert.equal(saved.removed.detail.includes('不会自动重放'),true);
});

test('mobile-created history from a different relay stays private unless history sharing is explicit',async()=>{
 const storage={readWorkspace:async()=>({tasks:[{id:'a',mobileLinked:true,mobileConnectionId:'local',messages:[]},{id:'b',mobileLinked:true,mobileConnectionId:'cloud',messages:[]},{id:'legacy',mobileLinked:true,messages:[]}]})},chat={sessions:()=>[]};
 assert.deepEqual((await desktopAdapter(storage,chat,{connectionId:'cloud'}).history()).map(t=>t.id),['b']);assert.equal((await desktopAdapter(storage,chat,{connectionId:'cloud',shareHistory:true}).history()).length,3);
});

test('explicit connection config persists for later Finder launch without changing task evidence',async t=>{
 const {startFromEnvironment}=require('../apps/desktop/mobile-bridge.cjs'),directory=await fixture(t),file=path.join(directory,'source.json'),env=process.env.AILO_MOBILE_CONFIG;
 await fs.writeFile(file,JSON.stringify({url:'https://example.invalid',desktopToken:'fixture',shareHistory:false}));const storage={readWorkspace:async()=>({tasks:[]})},chat={sessions:()=>[]};
 const originalFetch=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({jobs:[]})});t.after(()=>{global.fetch=originalFetch;if(env===undefined)delete process.env.AILO_MOBILE_CONFIG;else process.env.AILO_MOBILE_CONFIG=env;});
 process.env.AILO_MOBILE_CONFIG=file;const first=await startFromEnvironment({storage,chat,directory});first.stop();delete process.env.AILO_MOBILE_CONFIG;await fs.unlink(file);const second=await startFromEnvironment({storage,chat,directory});second.stop();assert.equal((await fs.stat(path.join(directory,'connection.json'))).mode&0o777,0o600);
});
test('idle sync does not replay all receipts or repeatedly download a pending photo',async t=>{
 const directory=await fixture(t),bodies=[];const server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);bodies.push(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jobs:body.pullJobs?[{id:'new-photo-fixture',text:'fixture'}]:[]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port,dir=connectionDirectory(directory,url,'fixture');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'jobs.json'),JSON.stringify(Object.fromEntries(Array.from({length:20},(_,i)=>['old-'+i,{id:'old-'+i,status:'completed',result:'fixture'}]))));
 let executed=0;const bridge=await createBridge({directory,url,key:'fixture',execute:async()=>{executed++;return {status:'completed'};}});await bridge.tick();const second=bodies.length;await bridge.tick();bridge.stop();assert.equal(executed,1);assert.equal(bodies.slice(second).filter(b=>b.update).length,0);assert.equal(bodies.filter(b=>b.pullJobs===true).length,2);assert.ok(bodies.filter(b=>b.update&&b.update.id.startsWith('old-')).every(b=>b.pullJobs===false&&!b.history));
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize}=require('../apps/desktop/mobile-payload.cjs');
test('mobile attachment protocol accepts selected small files and rejects paths, oversize or malformed input',()=>{
 const a={name:'fixture.txt',base64:Buffer.from('fixture only').toString('base64')};assert.equal(normalize({version:2,attachments:[a]}).attachments[0].name,a.name);
 for(const attachments of [[{...a,name:'../secret.txt'}],[{...a,name:'script.exe'}],[{...a,base64:'not-base64'}],Array(4).fill(a),[{...a,base64:Buffer.alloc(2100000).toString('base64')}]])assert.throws(()=>normalize({attachments}));
 assert.deepEqual(normalize({}).attachments,[]);assert.throws(()=>normalize({tools:{searchEnabled:'true'}}));assert.throws(()=>normalize({tools:{extensionIds:['x','x']}}));
 assert.deepEqual(normalize({tools:{searchEnabled:false,extensionIds:['selected']}}).tools,{searchEnabled:false,extensionIds:['selected']});
});
test('desktop capabilities expose selection metadata, not instructions or connection credentials',async()=>{
 const {desktopAdapter}=require('../apps/desktop/mobile-bridge.cjs');
 const storage={readWorkspace:async()=>({extensions:[{id:'s',name:'Fixture skill',kind:'skill',description:'fixture',enabled:true,instructions:'PRIVATE-INSTRUCTIONS'}]}),mcpConnections:{list:async()=>[{id:'c',name:'Fixture connection',connected:true,secret:'PRIVATE-TOKEN'}]}};
 const c=await desktopAdapter(storage,{sessions:()=>[]}).capabilities();assert.equal(c.protocolVersion,2);assert.equal(c.extensions[0].id,'s');assert.doesNotMatch(JSON.stringify(c),/PRIVATE/);
});
test('selected attachments become real material originals and flow into the unchanged chat permission path',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-phone-material-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const tasks=[];let seen;
 const storage={agentDirectory:directory,readWorkspace:async()=>({tasks,defaultModelId:'fixture-model',extensions:[{id:'skill',name:'fixture',enabled:true}]}),patchTask:async(id,patch,append=[])=>{let task=tasks.find(t=>t.id===id);if(!task){task={id,messages:[]};tasks.push(task);}Object.assign(task,patch);for(const m of append)if(!task.messages.some(x=>x.id===m.id))task.messages.push(m);return task;}};
 const adapter=require('../apps/desktop/mobile-bridge.cjs').desktopAdapter(storage,{sessions:()=>[],complete:async input=>{seen=input;return {content:'fixture reply'};}});
 await adapter.execute({id:'attachment-fixture',text:'read fixture',version:2,attachments:[{name:'fixture.txt',base64:Buffer.from('PRIVATE-FIXTURE-CONTENT').toString('base64')}],tools:{searchEnabled:false,extensionIds:['skill']}},async()=>{});
 assert.equal(seen.searchEnabled,false);assert.deepEqual(seen.extensionIds,['skill']);assert.equal(tasks[0].permissionMode,'standard');assert.equal(seen.messages[0].materials[0].text,'PRIVATE-FIXTURE-CONTENT');
 const material=tasks[0].materials[0];assert.equal(await fs.readFile(path.join(directory,'imports',material.sourceId),'utf8'),'PRIVATE-FIXTURE-CONTENT');
 assert.doesNotMatch(JSON.stringify(await adapter.history()),/PRIVATE-FIXTURE-CONTENT/);assert.equal((await adapter.history())[0].messages[0].attachments[0].name,'fixture.txt');
 await assert.rejects(adapter.execute({id:'invalid',text:'invalid',tools:{extensionIds:['missing']}},async()=>{}),/移除或停用/);
});
test('durable attachment receipt survives restart; missing originals fail closed and unknown execution never replays',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-attachment-restart-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const raw={version:2,id:'restart-file-001',text:'fixture',attachments:[{name:'fixture.txt',base64:Buffer.from('fixture').toString('base64')}]},metadata={...raw,attachments:[],attachmentMeta:[{name:'fixture.txt',sha256:crypto.createHash('sha256').update('fixture').digest('hex')}]};
 const server=http.createServer(async(req,res)=>{for await(const b of req){}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jobs:[metadata]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const {createBridge,connectionDirectory}=require('../apps/desktop/mobile-bridge.cjs'),url='http://127.0.0.1:'+server.address().port,key='fixture',directory=connectionDirectory(root,url,key);await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'payload-'+crypto.createHash('sha256').update(raw.id).digest('hex')+'.json');await fs.writeFile(file,JSON.stringify(raw));await fs.writeFile(path.join(directory,'jobs.json'),JSON.stringify({[raw.id]:{id:raw.id,status:'accepted',attachmentsStored:true}}));let executions=0;
 const bridge=await createBridge({directory:root,url,key,execute:async job=>{executions++;assert.equal(job.attachments[0].base64,raw.attachments[0].base64);return {status:'completed'};}});await bridge.tick();bridge.stop();assert.equal(executions,1);
 await fs.writeFile(path.join(directory,'jobs.json'),JSON.stringify({[raw.id]:{id:raw.id,status:'running',attachmentsStored:true}}));const interrupted=await createBridge({directory:root,url,key,execute:()=>assert.fail('unknown execution replay')});await interrupted.tick();interrupted.stop();assert.equal(JSON.parse(await fs.readFile(path.join(directory,'jobs.json')))[raw.id].status,'unknown');
 await fs.rm(file);await fs.writeFile(path.join(directory,'jobs.json'),'{}');const missing=await createBridge({directory:root,url,key,execute:()=>assert.fail('missing attachment must not execute')});await missing.tick();missing.stop();assert.equal(JSON.parse(await fs.readFile(path.join(directory,'jobs.json')))[raw.id].status,'failed');
});

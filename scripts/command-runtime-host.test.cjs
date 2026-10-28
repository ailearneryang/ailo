const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const runtime=require('../apps/desktop/agent/command-runtime.cjs');
const {runCommand}=require('../apps/desktop/agent/tools.cjs');
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
async function fixture(t){const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ailo-command-host-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));const root=path.join(base,'project');await fs.mkdir(root);return {base,root};}
test('the sandbox executes discovered host Node and npm without reading the user configuration',async t=>{
 const {root}=await fixture(t),discovery=await runtime.resolve();assert.equal(discovery.node.available,true,'host needs an installed Node runtime');assert.equal(discovery.npm.available,true,'host needs an installed npm CLI');
 const node=await runCommand(root,'node --version',new AbortController().signal,15000,{networkOutbound:false});assert.equal(node.exitCode,0,node.output);assert.match(node.stdout.trim(),/^v\d+\.\d+\.\d+$/);
 const npm=await runCommand(root,'npm --version',new AbortController().signal,15000,{networkOutbound:false});assert.equal(npm.exitCode,0,npm.output);assert.match(npm.stdout.trim(),/^\d+\.\d+\.\d+$/);
 const config=await runCommand(root,'npm config get userconfig',new AbortController().signal,15000,{networkOutbound:false});assert.equal(config.exitCode,0,config.output);assert.equal(config.stdout.trim(),path.join(root,'.runtime/ailo-command-config/npm-userrc'));
});
test('host Node cannot inherit parent secrets or read an outside secret through the selected toolchain grant',async t=>{
 const {base,root}=await fixture(t),secret=path.join(base,'outside-secret');await fs.writeFile(secret,'private fixture data');const marker=process.env.AILO_RUNTIME_TEST_SECRET;process.env.AILO_RUNTIME_TEST_SECRET='parent-only-fixture';t.after(()=>{if(marker===undefined)delete process.env.AILO_RUNTIME_TEST_SECRET;else process.env.AILO_RUNTIME_TEST_SECRET=marker;});
 const code="if(process.env.AILO_RUNTIME_TEST_SECRET!==undefined)process.exit(8);try{require('fs').readFileSync("+JSON.stringify(secret)+");process.exit(9)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;console.log('isolated')}";
 const result=await runCommand(root,'node -e '+quote(code),new AbortController().signal,15000,{networkOutbound:false});assert.equal(result.exitCode,0,result.output);assert.equal(result.stdout.trim(),'isolated');
});
test('a project-local npm package is usable while cache and installation prefix stay inside the project',async t=>{
 const {root}=await fixture(t),module=path.join(root,'.runtime/skill-deps/node_modules/fixture-module');await fs.mkdir(module,{recursive:true});await fs.writeFile(path.join(module,'index.js'),'module.exports="local-package-ok";');
 const code="console.log(require('./.runtime/skill-deps/node_modules/fixture-module'))";
 const result=await runCommand(root,'node -e '+quote(code),new AbortController().signal,15000,{networkOutbound:false});assert.equal(result.exitCode,0,result.output);assert.equal(result.stdout.trim(),'local-package-ok');
 const settings=await runCommand(root,'npm config get cache && npm config get prefix && npm config get globalconfig',new AbortController().signal,15000,{networkOutbound:false});assert.equal(settings.exitCode,0,settings.output);assert.deepEqual(settings.stdout.trim().split('\n'),[path.join(root,'.runtime/npm-cache'),path.join(root,'.runtime/npm-prefix'),path.join(root,'.runtime/ailo-command-config/npm-globalrc')]);
});
test('Node discovery preserves the existing network-denied boundary',async t=>{
 const {root}=await fixture(t),server=net.createServer(socket=>socket.end());await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));const port=server.address().port;
 const code="const s=require('net').connect("+port+",'127.0.0.1');s.on('connect',()=>{s.destroy();process.exitCode=9});s.on('error',e=>{if(!['EPERM','EACCES'].includes(e.code))throw e;console.log('network-blocked')});setTimeout(()=>{s.destroy();process.exitCode=8},2000).unref();";
 const result=await runCommand(root,'node -e '+quote(code),new AbortController().signal,15000,{networkOutbound:false});assert.equal(result.exitCode,0,result.output);assert.equal(result.stdout.trim(),'network-blocked');
});
test('the real sandbox command receipt is recovered beside a registered artifact when execution settles',async t=>{
 const {base}=await fixture(t),{runAgent}=require('../apps/desktop/agent/runner.cjs'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
 const task={id:'receipt-settlement',request:'生成两份说明',messages:[{id:'u',role:'user',content:'生成两份说明'}]};let next=0;
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:task.request,decisions:[],requirements:[{id:'first',text:'第一份说明完整',type:'content'},{id:'second',text:'第二份说明完整',type:'content'}],steps:[{id:'s',title:'生成和检查说明',status:'running'}]},
  {action:'write_file',path:'first.txt',content:'第一份说明'},{action:'artifact',path:'first.txt',label:'第一份说明'},
  {action:'run_command',command:'node -e '+quote("require('fs').writeFileSync('generated.txt','命令生成的第二份说明')"),purpose:'在隔离沙箱内生成第二份说明'}];
 const result=await runAgent({base,task,model:{contextWindow:131072},signal:new AbortController().signal,maxSteps:12,ask:async()=>({content:JSON.stringify(actions[next++]||{action:'blocked',text:'两份文件已生成，尚未完成内容检查。'})})});
 assert.equal(result.agentRun.status,'partial');assert.deepEqual(result.agentRun.delivery.availableArtifacts.map(f=>f.path).sort(),['first.txt','generated.txt']);assert.equal(result.agentRun.delivery.coverage.passed,0);
 const w=await createWorkspace(base,task),commands=w.run.events.filter(e=>e.type==='run_command');assert.equal(commands.length,1);assert.equal(commands[0].detail.result.exitCode,0,commands[0].detail.result.output);assert.ok(commands[0].detail.result.fileChanges.some(f=>f.path==='generated.txt'&&f.after));assert.equal(await fs.readFile(path.join(w.files,'generated.txt'),'utf8'),'命令生成的第二份说明');assert.ok(!w.run.actionJournal.some(e=>e.status==='unknown'));
});

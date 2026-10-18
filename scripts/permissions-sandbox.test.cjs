const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createPermissions}=require('../apps/desktop/permissions.cjs');
const {execute,runCommand}=require('../apps/desktop/agent/tools.cjs');
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-policy-sandbox-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const task={id:'sandbox',title:'沙箱验证',permissionMode:'scoped'},work={tasks:[task],projects:[]},external=path.join(directory,'external');await fs.mkdir(external);await fs.writeFile(path.join(external,'data'),'allowed-data');
 const policy=createPermissions({directory,base:path.join(directory,'agent'),account:async()=>null,workspace:async()=>work,patchTask:async()=>{},selectDirectory:async()=>external,confirm:async()=>'task'});return {policy,task,external};}
test('managed commands are actually offline until approved; external directory remains read-only',async t=>{
 if(process.platform!=='darwin')return t.skip('macOS sandbox');const f=await fixture(t);let hits=0;const server=http.createServer((_req,res)=>{hits++;res.end('network-confirmed');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 await f.policy.run(f.task,new AbortController().signal,async ctx=>{
  await fs.mkdir(ctx.root,{recursive:true});const workspace={files:ctx.root,run:{taskId:f.task.id}},command=`/usr/bin/curl --max-time 2 --silent --show-error http://127.0.0.1:${server.address().port}/`;
  const denied=await execute(workspace,{action:'run_command',command},ctx.signal,{permissions:ctx});assert.notEqual(denied.exitCode,0);assert.equal(hits,0);assert.ok(!denied.output.includes('network-confirmed'));
  await ctx.requestNetwork({purpose:'验证本机服务连接'},ctx.signal);const approved=await execute(workspace,{action:'run_command',command},ctx.signal,{permissions:ctx});assert.equal(approved.exitCode,0);assert.equal(approved.output,'network-confirmed');
  await ctx.directoryAccess.request(f.task.id,{path:f.external,purpose:'读取验证数据'},ctx.signal);const read=await execute(workspace,{action:'run_command',command:`/bin/cat '${f.external}/data'`},ctx.signal,{permissions:ctx});assert.equal(read.output,'allowed-data');
  const write=await execute(workspace,{action:'run_command',command:`/usr/bin/touch '${f.external}/forbidden'`},ctx.signal,{permissions:ctx});assert.notEqual(write.exitCode,0);await assert.rejects(fs.access(path.join(f.external,'forbidden')));
 });
});
test('revoking a live grant terminates the running command process',async t=>{
 if(process.platform!=='darwin')return t.skip('macOS sandbox');const f=await fixture(t);let entered;const ready=new Promise(r=>entered=r);const started=Date.now();
 const running=f.policy.run(f.task,new AbortController().signal,async ctx=>{await fs.mkdir(ctx.root,{recursive:true});await ctx.directoryAccess.request(f.task.id,{path:f.external,purpose:'测试撤销'},ctx.signal);const options=await ctx.commandOptions();return runCommand(ctx.root,'echo started; /bin/sleep 30',ctx.signal,40000,{...options,onOutput:()=>entered()});});
 const rejected=assert.rejects(running,/停止/);await ready;const state=await f.policy.read();await f.policy.revoke({ownerId:'local',id:state.grants[0].id});await rejected;assert.ok(Date.now()-started<5000,'revocation must stop the process promptly');
});

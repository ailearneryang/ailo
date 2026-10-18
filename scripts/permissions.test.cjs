const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createPermissions,within}=require('../apps/desktop/permissions.cjs');
const {allowedActions}=require('../apps/desktop/agent/protocol.cjs');
const signal=()=>new AbortController().signal;
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-permissions-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let owner='alice',choice='task',select=null,confirmHook;const prompts=[],work={tasks:[],projects:[]};
 const service=createPermissions({directory,base:path.join(directory,'agent'),account:async()=>({id:owner}),workspace:async()=>work,patchTask:async(id,p)=>Object.assign(work.tasks.find(t=>t.id===id),p),selectDirectory:async()=>select,confirm:async(request,s)=>{prompts.push(request);return confirmHook?confirmHook(request,s):choice;}});
 const task=(id,mode='standard',projectId)=>{const value={id,title:'测试 '+id,request:'测试任务',permissionMode:mode,projectId,materials:[],messages:[]};work.tasks.push(value);return value;};
 return {service,task,work,directory,prompts,setChoice:v=>choice=v,setSelected:v=>select=v,setHook:v=>confirmHook=v,setOwner:v=>owner=v};}
test('persistent permission is reused only in scoped mode and remains workspace-bound',async t=>{
 const f=await fixture(t),a=f.task('a','scoped','p'),b=f.task('b','scoped','q');f.setChoice('always');
 await f.service.run(a,signal(),async ctx=>{assert.equal((await ctx.commandOptions()).networkOutbound,false);await ctx.requestNetwork({purpose:'下载项目依赖'},signal());assert.equal((await ctx.commandOptions()).networkOutbound,true);});
 await f.service.run(a,signal(),async ctx=>{await ctx.requestNetwork({purpose:'再次下载'},signal());assert.equal((await ctx.commandOptions()).networkOutbound,true);});assert.equal(f.prompts.length,1);
 await f.service.run(b,signal(),async ctx=>assert.equal((await ctx.commandOptions()).networkOutbound,false));
 a.permissionMode='standard';await f.service.run(a,signal(),async ctx=>assert.equal((await ctx.commandOptions()).networkOutbound,false));
 f.setChoice('task');await f.service.run(a,signal(),ctx=>ctx.requestNetwork({purpose:'本任务联网'},signal()));assert.equal(f.prompts.length,2);
});
test('task permissions are temporary and do not pass to another task in the same project',async t=>{
 const f=await fixture(t),a=f.task('a','scoped','p'),b=f.task('b','scoped','p');await f.service.run(a,signal(),ctx=>ctx.requestNetwork({purpose:'下载'},signal()));
 await f.service.run(a,signal(),async ctx=>assert.equal((await ctx.commandOptions()).networkOutbound,true));await f.service.run(b,signal(),async ctx=>assert.equal((await ctx.commandOptions()).networkOutbound,false));assert.equal((await f.service.read()).grants[0].lifetime,'task');
 const files=await fs.readdir(path.join(f.directory,'permissions'));const saved=JSON.parse(await fs.readFile(path.join(f.directory,'permissions',files[0]),'utf8'));assert.equal(saved.grants.length,0);
});
test('application approvals match exact parameters and connection/tool fingerprint',async t=>{
 const f=await fixture(t),task=f.task('a','scoped','p');f.setChoice('always');const request={kind:'app',resource:'mcp:c:send',fingerprint:'revision:1',label:'应用发送',params:{recipient:'a',text:'hello'}};
 await f.service.run(task,signal(),async()=>{await f.service.approve(request,signal());await f.service.approve({...request,params:{text:'hello',recipient:'a'}},signal());await f.service.approve({...request,params:{text:'different',recipient:'a'}},signal());await f.service.approve({...request,fingerprint:'revision:2'},signal());});assert.equal(f.prompts.length,3);
 const raw=await fs.readFile(path.join(f.directory,'permissions',(await fs.readdir(path.join(f.directory,'permissions')))[0]),'utf8');assert.ok(!raw.includes('different'));assert.ok(!raw.includes('recipient'));
});
test('unfingerprinted application writes are confirmed each time and cannot retain approvals',async t=>{
 const f=await fixture(t),task=f.task('a','scoped');f.setChoice('once');await f.service.run(task,signal(),async()=>{await f.service.approve({kind:'app',resource:'feishu',params:{text:'hello'}},signal());await f.service.approve({kind:'app',resource:'feishu',params:{text:'hello'}},signal());});assert.equal(f.prompts.length,2);assert.equal((await f.service.read()).grants.length,0);assert.equal(f.prompts[0].allowAlways,false);assert.equal(f.prompts[0].allowTask,false);
});
test('revocation aborts an execution using the grant, but does not roll back its work',async t=>{
 const f=await fixture(t),task=f.task('a','scoped');let ready,release,scope;const started=new Promise(r=>ready=r),gate=new Promise(r=>release=r);
 const running=f.service.run(task,signal(),async ctx=>{scope=ctx;await ctx.requestNetwork({purpose:'请求网络'},signal());await ctx.commandOptions();ready();await gate;});await started;
 const state=await f.service.read();await f.service.revoke({ownerId:'alice',id:state.grants[0].id});assert.equal(scope.signal.aborted,true);release();await running;assert.equal((await f.service.read()).grants.length,0);
});
test('a late native approval cannot recreate a revoked grant',async t=>{
 const f=await fixture(t),task=f.task('a','scoped');let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.setHook(async()=>{entered();await gate;return 'always';});
 const pending=f.service.run(task,signal(),ctx=>ctx.requestNetwork({purpose:'下载'},signal()));const checked=assert.rejects(pending,e=>['PERMISSION_REVOKED','PERMISSION_CHANGED'].includes(e.code));await ready;await f.service.revoke({ownerId:'alice',all:true});release();await checked;assert.equal((await f.service.read()).grants.length,0);
});
test('cancelled prompts and invalid mode escalation create no grants',async t=>{
 const f=await fixture(t),task=f.task('a');f.setChoice(null);await assert.rejects(f.service.run(task,signal(),ctx=>ctx.requestNetwork({purpose:'下载'},signal())),e=>e.code==='PERMISSION_DECLINED');assert.equal((await f.service.read()).grants.length,0);
 f.setChoice('always');await assert.rejects(f.service.run(task,signal(),ctx=>ctx.requestNetwork({purpose:'下载'},signal())),/未获授权/);await assert.rejects(f.service.setMode({ownerId:'alice',taskId:'a',mode:'full'}),/模式无效/);
});
test('directory grants are read-only, contain children, and reject replaced directories',async t=>{
 const f=await fixture(t),folder=path.join(f.directory,'external'),child=path.join(folder,'child');await fs.mkdir(child,{recursive:true});f.setSelected(folder);const task=f.task('a','scoped');f.setChoice('always');
 await f.service.run(task,signal(),async ctx=>{const result=await ctx.directoryAccess.request('a',{path:folder,purpose:'分析资料'},signal());assert.equal(result.access,'read-only');await ctx.directoryAccess.request('a',{path:child,purpose:'查看子目录'},signal());assert.deepEqual((await ctx.commandOptions()).readDirectories,[await fs.realpath(folder)]);});assert.equal(f.prompts.length,1);
 await fs.rename(folder,folder+'-old');await fs.mkdir(folder);await f.service.run(task,signal(),async ctx=>assert.deepEqual((await ctx.commandOptions()).readDirectories,[]));assert.equal(within(folder,folder+'-sibling'),false);
});
test('directory addition requires explicit scope confirmation and survives restart only for persistent grants',async t=>{
 const f=await fixture(t),folder=path.join(f.directory,'external');await fs.mkdir(folder);f.setSelected(folder);f.setChoice('always');await f.service.addDirectory({ownerId:'alice'});const state=await f.service.read();assert.equal(state.grants.length,1);assert.equal(state.grants[0].lifetime,'always');assert.ok(!JSON.stringify(state).includes('signature'));
 f.setOwner('bob');assert.equal((await f.service.read()).grants.length,0);await assert.rejects(f.service.read(undefined,'alice'),/账号已切换/);
});
test('running modes cannot be changed and a new default does not change captured execution mode',async t=>{
 const f=await fixture(t),task=f.task('a');let release,ready;const started=new Promise(r=>ready=r),gate=new Promise(r=>release=r);const running=f.service.run(task,signal(),async ctx=>{ready();await gate;assert.equal((await ctx.snapshot()).mode,'standard');});await started;
 await assert.rejects(f.service.setMode({ownerId:'alice',taskId:'a',mode:'scoped'}),/先停止/);const state=await f.service.read();await f.service.settings({ownerId:'alice',revision:state.revision,defaultMode:'scoped'});release();await running;
});
test('project infrastructure approvals cannot be reused for an arbitrary root',async t=>{const f=await fixture(t),task=f.task('a','scoped');await assert.rejects(f.service.run(task,signal(),()=>f.service.approve({kind:'build',resource:'/other',label:'构建'},signal())),/不属于当前项目/);});
test('network permission request is an actual task-only protocol action',()=>{assert.equal(allowedActions({phase:'chat',permissions:{mode:'standard'}}).includes('request_network'),false);assert.equal(allowedActions({phase:'task'}).includes('request_network'),false);assert.equal(allowedActions({phase:'task',permissions:{mode:'standard'}}).includes('request_network'),true);});
test('restart retains persistent scopes and discards task grants',async t=>{
 const f=await fixture(t),task=f.task('restart','scoped');f.setChoice('always');await f.service.run(task,signal(),ctx=>ctx.requestNetwork({purpose:'持续联网'},signal()));
 const folder=path.join(f.directory,'temporary');await fs.mkdir(folder);f.setSelected(folder);f.setChoice('task');await f.service.run(task,signal(),ctx=>ctx.directoryAccess.request(task.id,{path:folder,purpose:'临时查看'},signal()));assert.equal((await f.service.read()).grants.length,2);
 const reopened=createPermissions({directory:f.directory,base:path.join(f.directory,'agent'),account:async()=>({id:'alice'}),workspace:async()=>f.work,patchTask:async()=>{},selectDirectory:async()=>null,confirm:async()=>{throw Error('persistent grant unexpectedly prompted');}});
 assert.equal((await reopened.read()).grants.length,1);await reopened.run(task,signal(),async ctx=>{assert.equal((await ctx.commandOptions()).networkOutbound,true);assert.deepEqual((await ctx.commandOptions()).readDirectories,[]);});
});

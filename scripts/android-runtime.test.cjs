const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {tasksFor}=require('../apps/desktop/agent/android-build.cjs');
const {createAndroidManager,command,findImage}=require('../apps/desktop/agent/android-device.cjs');
const {runCommand}=require('../apps/desktop/agent/tools.cjs');
const {allowedActions}=require('../apps/desktop/agent/protocol.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
async function temp(t){const p=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-android-test-'));t.after(()=>fs.rm(p,{recursive:true,force:true}));return p;}
test('Gradle tasks cannot inject shell commands or Gradle flags',()=>{
 assert.deepEqual(tasksFor({tasks:[':app:assembleDebug',':domain:logic:test']}),[':app:assembleDebug',':domain:logic:test']);
 for(const tasks of [[],['--init-script'],['test;rm'],['$(touch x)'],['test\nwhoami'],['../test'],[null]])assert.throws(()=>tasksFor({tasks}));
});
test('Android side effects are unavailable to chat routing',()=>{
 assert(!allowedActions({phase:'chat'}).includes('build_android'));assert(!allowedActions({phase:'chat'}).includes('android_device'));
 assert(allowedActions({phase:'task'}).includes('build_android'));
});
test('device authorization fails closed and status never touches personal devices',async t=>{
 const root=await temp(t);let asks=0;
 const manager=createAndroidManager({directory:path.join(root,'broker'),authorize:async()=>{asks++;return false;}});t.after(()=>manager.dispose());
 assert.equal((await manager.execute(root,{operation:'status'},new AbortController().signal)).running,false);assert.equal(asks,0);
 await assert.rejects(manager.execute(root,{operation:'start'},new AbortController().signal),e=>e.code==='ANDROID_PERMISSION');
 await assert.rejects(fs.access(path.join(root,'broker')));
 await assert.rejects(manager.execute(root,{operation:'shell',command:'rm -rf /'},new AbortController().signal),/无效/);
 assert.equal(asks,1);
});
test('SDK image selection matches host architecture and does not download images',async t=>{
 const sdk=await temp(t),arch=process.arch==='arm64'?'arm64-v8a':'x86_64';
 await assert.rejects(findImage(sdk),/系统镜像/);
 const dir=path.join(sdk,'system-images/android-34/google_apis',arch);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'system.img'),'');
 assert.equal(await findImage(sdk),`system-images;android-34;google_apis;${arch}`);
});
test('host tool cancellation never starts an already cancelled command',async()=>{
 const c=new AbortController();c.abort();await assert.rejects(command('/bin/echo',['hello'],{signal:c.signal}),/停止/);
});
test('host tool timeouts terminate bounded commands',async()=>{
 await assert.rejects(command('/bin/sleep',['5'],{timeout:20}),/超时/);
});
test('build sandbox permits loopback but preserves project file isolation',async t=>{
 const root=await temp(t),other=await temp(t),secret=path.join(other,'secret');await fs.writeFile(secret,'hidden');
 const probe="/opt/homebrew/bin/python3 -c 'import socket;s=socket.socket();s.bind((\"127.0.0.1\",0));print(\"bound\")'";
 if(process.platform!=='darwin')return t.skip('macOS sandbox');
 const signal=new AbortController().signal;
 assert.notEqual((await runCommand(root,probe,signal,10000)).exitCode,0);
 assert.equal((await runCommand(root,probe,signal,10000,{build:true})).exitCode,0);
 assert.notEqual((await runCommand(root,'cat '+secret,signal,10000,{build:true})).exitCode,0);
 assert.match(require('../apps/desktop/agent/tools.cjs').sandboxProfile(root,'/sdk',true),/network-inbound \(local ip "localhost:\*"\)/);
});
test('permission denial pauses once, does not retry three times',async t=>{
 const base=await temp(t);let n=0,calls=0;
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:'运行',decisions:[],acceptance:['启动'],steps:[{id:'s1',title:'启动',status:'pending'}]},{action:'android_device',operation:'start'}];
 const result=await runAgent({base,task:{id:'t',projectId:'p',request:'启动模拟器'},model:{contextWindow:32768},signal:new AbortController().signal,ask:async()=>({content:JSON.stringify(actions[n++])}),executeTool:async()=>{calls++;throw Object.assign(Error('没有授权'),{code:'ANDROID_PERMISSION'});}});
 assert.equal(calls,1);assert.equal(result.agentRun.status,'blocked');assert.equal(result.agentRun.inFlight,undefined);
});
test('standard build evidence supports finish without a fake shell verification',async t=>{
 const base=await temp(t);let n=0;
 const plan={action:'plan',goal:'构建',decisions:[],acceptance:['构建成功'],steps:[{id:'s',title:'构建',status:'pending'}]};
 const actions=[{action:'route',kind:'task'},plan,{action:'write_file',path:'app.apk',content:'fixture'},{action:'build_android',tasks:[':app:assembleDebug']},{action:'artifact',path:'app.apk',label:'测试产物'},{...plan,steps:[{id:'s',title:'构建',status:'done'}]}];
 const result=await runAgent({base,task:{id:'t',projectId:'p',request:'构建'},model:{contextWindow:32768},signal:new AbortController().signal,ask:async messages=>({content:JSON.stringify(actions[n++]||{action:'finish',text:'已构建',evidence:[JSON.parse(messages.at(-1).content).recentEvents.find(e=>e.type==='build_android').id]})}),executeTool:async(w,a,s)=>a.action==='build_android'?{exitCode:0,output:'BUILD SUCCESSFUL'}:require('../apps/desktop/agent/tools.cjs').execute(w,a,s)});
 assert.equal(result.agentRun.status,'completed');
});

test('build authorization is required before starting Gradle',async t=>{
 const root=await temp(t);
 await fs.writeFile(path.join(root,'gradlew'),'exit 0');
 await assert.rejects(require('../apps/desktop/agent/android-build.cjs').buildAndroid(root,{},new AbortController().signal),e=>e.code==='ANDROID_PERMISSION');
 await assert.rejects(fs.access(path.join(root,'.runtime')));
});

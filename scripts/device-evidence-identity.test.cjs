const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const identity=require('../apps/desktop/agent/action-identity.cjs'),journal=require('../apps/desktop/agent/action-journal.cjs'),proof=require('../apps/desktop/agent/evidence.cjs');
const {createAndroidManager}=require('../apps/desktop/agent/android-device.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs'),{execute}=require('../apps/desktop/agent/tools.cjs');
async function fixture(t){const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ailo-device-identity-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'identity',request:'核对受管应用截图版本'},w=await createWorkspace(path.join(base,'agent'),task);return {base,task,w};}
const display={width:1280,height:720,density:160,orientation:'landscape'};
test('broker state is an isolated read of managed sessions without authorization or host commands',async t=>{
 const {base,w}=await fixture(t),sdk=path.join(base,'sdk'),directory=path.join(base,'broker');const arch=process.arch==='arm64'?'arm64-v8a':'x86_64';await fs.mkdir(path.join(sdk,'system-images/android-35/default',arch),{recursive:true});await fs.writeFile(path.join(sdk,'system-images/android-35/default',arch,'system.img'),'fixture');
 for(const name of ['emulator/emulator','cmdline-tools/latest/bin/avdmanager']){await fs.mkdir(path.dirname(path.join(sdk,name)),{recursive:true});await fs.writeFile(path.join(sdk,name),'fixture');}
 let commands=0,authorizations=0;
 const manager=createAndroidManager({directory,authorize:async()=>{authorizations++;return true;},environment:async()=>({sdk,javaHome:path.join(base,'jdk')}),serverPortFor:async()=>5038,devicePortFor:async()=>5580,
  spawnEmulator:()=>{const child=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=null;child.signalCode=null;child.kill=()=>{child.exitCode=0;child.emit('exit',0);};return child;},
  runCommand:async(_file,args,options)=>{commands++;if(args[0]==='create'){const name=args[args.indexOf('--name')+1],dir=path.join(options.env.ANDROID_AVD_HOME,name+'.avd');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(options.env.ANDROID_AVD_HOME,name+'.ini'),'fixture');await fs.writeFile(path.join(dir,'config.ini'),'fixture=true');}return {exitCode:0,output:Buffer.from(args.includes('sys.boot_completed')?'1':'')};}});t.after(()=>manager.dispose());
 const before=await manager.state(w.files);assert.equal(before.running,false);assert.equal(commands,0);assert.equal(authorizations,0);
 await manager.execute(w.files,{operation:'start',display:{width:1280,height:720,density:160}},new AbortController().signal);const count=commands,asks=authorizations,state=await manager.state(w.files);assert.equal(state.running,true);assert.ok(state.sessionId);assert.equal(state.display.width,1280);
 state.display.width=999;assert.equal((await manager.state(w.files)).display.width,1280);const another=path.join(base,'another-project');await fs.mkdir(another);assert.equal((await manager.state(another)).running,false);assert.equal(commands,count);assert.equal(authorizations,asks);
});
test('screenshot identity binds installed APK, session and display rather than labels, filenames or global revision',async t=>{
 const {w}=await fixture(t);let state={running:true,busy:false,sessionId:'session-a',package:'fixture.app',apkPath:'app.apk',apkSha256:'installed-a',display:{...display}};
 const android={state:async()=>structuredClone(state),execute:async()=>assert.fail('identity must not execute a device operation')};
 const first=identity.fingerprint(await identity.identity(w,{action:'android_device',operation:'screenshot',purpose:'first',path:'random-one.png',name:'random-one'},{android}));w.run.revision+=50;
 const same=identity.fingerprint(await identity.identity(w,{action:'android_device',operation:'screenshot',purpose:'second',path:'random-two.png',name:'random-two',progress:{memory:'different bookkeeping'}},{android}));assert.equal(same,first);
 state.apkSha256='installed-b';const second=identity.fingerprint(await identity.identity(w,{action:'android_device',operation:'screenshot'},{android}));assert.notEqual(second,first);
 state.sessionId='session-b';const restarted=identity.fingerprint(await identity.identity(w,{action:'android_device',operation:'screenshot'},{android}));assert.notEqual(restarted,second);
 state.display.density=240;assert.notEqual(identity.fingerprint(await identity.identity(w,{action:'android_device',operation:'screenshot'},{android})),restarted);
});
test('install identity follows actual desired APK bytes while an unknown install cannot be replayed under a new version',async t=>{
 const {w}=await fixture(t),action={action:'android_device',operation:'install',path:'app.apk'},android={state:async()=>({running:true,sessionId:'s',apkSha256:'previous',display})};await fs.writeFile(path.join(w.files,'app.apk'),'apk-version-a');
 const first=identity.fingerprint(await identity.identity(w,action,{android})),entry=journal.begin(w.run,action);entry.status='unknown';await w.save();
 await fs.writeFile(path.join(w.files,'app.apk'),'apk-version-b');const second=identity.fingerprint(await identity.identity(w,action,{android}));assert.notEqual(first,second);
 assert.throws(()=>journal.begin(w.run,{...action,purpose:'new explanation',progress:{memory:'new bookkeeping'}}),error=>error.code==='ACTION_RESULT_UNKNOWN');assert.equal(w.run.actionJournal.length,1);assert.equal(w.run.actionJournal[0].status,'unknown');
});
test('missing device state is marked incomplete instead of fabricated from an old receipt',async t=>{
 const {w}=await fixture(t);w.run.events.push({type:'android_device',detail:{result:{sessionId:'old-session',apkSha256:'old-apk'}}});const result=await identity.identity(w,{action:'android_device',operation:'screenshot'});assert.equal(result.inputVersion.complete,false);assert.equal(result.inputVersion.installedApkSha256,null);assert.equal(result.inputVersion.sessionId,null);
});
test('viewing the same image gets a new identity only when its design configuration bytes change',async t=>{
 const {w}=await fixture(t),action={action:'view_image',path:'shot.png',reference:'design.png'};await fs.writeFile(path.join(w.files,'shot.png'),'same pixels');await fs.writeFile(path.join(w.files,'design.png'),'same reference');
 const missing=await identity.identity(w,action);assert.equal(missing.inputVersion.designConfigSha256,null);
 const configuration=JSON.stringify({screens:[{screenshot:''}]});await fs.writeFile(path.join(w.files,'android-design.json'),configuration);const first=identity.fingerprint(await identity.identity(w,action));assert.notEqual(first,identity.fingerprint(missing));
 w.run.revision+=100;await fs.writeFile(path.join(w.files,'android-design.json'),configuration);assert.equal(identity.fingerprint(await identity.identity(w,{...action,purpose:'different label',progress:{memory:'bookkeeping'}})),first);
 await fs.writeFile(path.join(w.files,'android-design.json'),JSON.stringify({screens:[{}]}));assert.notEqual(identity.fingerprint(await identity.identity(w,action)),first);
});
test('same pixels from a different installed APK bind to distinct real screenshot provenance without using event aliases',async t=>{
 const {w}=await fixture(t),action={action:'view_image',path:'shot.png'};await fs.writeFile(path.join(w.files,'shot.png'),'same pixels');
 const event=apk=>({operation:'screenshot',result:{path:'shot.png',apkPath:'app.apk',apkSha256:apk,sources:[{path:'shot.png',sha256:'same-pixels'},{path:'app.apk',sha256:apk}]}});
 await w.event('android_device',event('apk-a'));const first=identity.fingerprint(await identity.identity(w,action));await w.event('android_device',event('apk-b'));const second=identity.fingerprint(await identity.identity(w,action));assert.notEqual(first,second);
 await w.event('android_device',event('apk-b'));assert.equal(identity.fingerprint(await identity.identity(w,{...action,purpose:'new receipt alias'})),second);
});
test('a new installed APK permits its own bounded screenshots at the same path in the real runner',async t=>{
 const {base,task,w}=await fixture(t);await fs.writeFile(path.join(w.files,'app.apk'),'apk-version-a');let installedHash,shots=0,calls=0;const android={state:async()=>({running:true,busy:false,sessionId:'managed-session',package:'fixture.app',apkPath:'app.apk',apkSha256:installedHash,display})};
 const plan={action:'plan',goal:task.request,decisions:[],requirements:[{id:'r',text:'核对截图身份仍保留原要求',type:'content'}],steps:[{id:'s',title:'核对版本',status:'running'}]};
 const actions=[{action:'route',kind:'task'},plan,{action:'android_device',operation:'install',path:'app.apk'},{action:'android_device',operation:'screenshot'},{action:'android_device',operation:'screenshot'},{action:'write_file',path:'app.apk',content:'apk-version-b'},{action:'android_device',operation:'install',path:'app.apk'},{action:'android_device',operation:'screenshot'},{action:'android_device',operation:'screenshot'},{action:'pause',text:'已核对两个已知版本各自的截图预算，未声明验收完成'}];
 const result=await runAgent({base:path.join(base,'agent'),task,model:{contextWindow:128000},signal:new AbortController().signal,android,
  ask:async messages=>{const state=JSON.parse(messages.at(-1).content),action=actions[calls++];if(state.requiredAction==='plan_update'&&action.action!=='pause')action.progress={steps:[{id:'s',status:'running'}]};return {content:JSON.stringify(action)};},executeTool:async(workspace,action,...rest)=>{
   if(action.action!=='android_device')return execute(workspace,action,...rest);
   if(action.operation==='install'){installedHash=await proof.hashFile(path.join(workspace.files,'app.apk'));return {installed:true,apkPath:'app.apk',apkSha256:installedHash,sources:[{path:'app.apk',sha256:installedHash}],scope:{kind:'file',path:'app.apk'}};}
   shots++;const file='shot-'+shots+'.png',bytes=Buffer.from('fixture pixels');await fs.writeFile(path.join(workspace.files,file),bytes);return {path:file,apkPath:'app.apk',apkSha256:installedHash,pixelSize:{width:1280,height:720},displayCheck:{matches:true},sources:[{path:file,sha256:proof.hash(bytes)},{path:'app.apk',sha256:installedHash}],scope:{kind:'viewport',path:file,rect:{x:0,y:0,width:1280,height:720}}};
  }});
 assert.equal(result.agentRun.status,'paused');assert.equal(shots,4);assert.equal(calls,actions.length);const saved=await createWorkspace(path.join(base,'agent'),task);assert.ok(!saved.run.events.some(event=>event.type==='loop_recovery'));assert.equal(saved.run.events.filter(event=>event.type==='android_device'&&event.detail.operation==='install').length,2);
});

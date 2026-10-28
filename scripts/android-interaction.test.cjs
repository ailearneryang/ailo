const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createAndroidManager,validate}=require('../apps/desktop/agent/android-device.cjs');
const identity=require('../apps/desktop/agent/action-identity.cjs'),journal=require('../apps/desktop/agent/action-journal.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const signal=()=>new AbortController().signal;
function png(width=1280,height=720,marker=0){const bytes=Buffer.alloc(25);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);bytes[24]=marker;return bytes;}
function hierarchy(page,{clock='10:00',focused=false,checked=false}={}){return Buffer.from(`<hierarchy><node package="com.android.systemui" class="android.widget.TextView" text="${clock}" bounds="[0,0][20,20]"/><node package="com.test.weather" resource-id="com.test.weather:id/${page}" class="android.widget.TextView" text="${page}" content-desc="" bounds="[10,30][400,500]" focused="${focused}" checked="${checked}"/></hierarchy>`);}
async function broker(t){
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ailo-ui-interaction-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'managed-ui',request:'核对同一版本主页、城市和搜索界面'},w=await createWorkspace(path.join(base,'agent'),task),root=w.files,sdk=path.join(base,'sdk'),calls=[];
 const arch=process.arch==='arm64'?'arm64-v8a':'x86_64';for(const file of ['emulator/emulator','cmdline-tools/latest/bin/avdmanager','platform-tools/adb','build-tools/34.0.0/aapt',`system-images/android-34/default/${arch}/system.img`]){await fs.mkdir(path.dirname(path.join(sdk,file)),{recursive:true});await fs.writeFile(path.join(sdk,file),'fixture');}
 let page='home',clock='10:00',frameMarker=0,foreground='com.test.weather',windowPackage='com.test.weather',authorized=true,failAfterInput=false,readFailure=false,focused=false,checked=false;
 const inputs=[];
 const manager=createAndroidManager({directory:path.join(base,'broker'),authorize:async()=>authorized,environment:async()=>({sdk,javaHome:path.join(base,'jdk')}),serverPortFor:async()=>5038,devicePortFor:async()=>5580,
  spawnEmulator:()=>{const child=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=null;child.signalCode=null;child.kill=()=>{child.exitCode=0;child.emit('exit',0);};return child;},
  runCommand:async(file,args,options={})=>{
   calls.push({file,args:[...args]});let output=Buffer.alloc(0);
   if(path.basename(file)==='avdmanager'){const name=args[args.indexOf('--name')+1],dir=path.join(options.env.ANDROID_AVD_HOME,name+'.avd');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(options.env.ANDROID_AVD_HOME,name+'.ini'),'fixture');await fs.writeFile(path.join(dir,'config.ini'),'fixture=true');}
   else if(path.basename(file)==='aapt')output=Buffer.from("package: name='com.test.weather'\nlaunchable-activity: name='com.test.weather.MainActivity'");
   else if(args.includes('sys.boot_completed'))output=Buffer.from('1');
   else if(args.includes('screencap'))output=png(1280,720,(frameMarker+page.charCodeAt(0))%256);
   else if(args.includes('dumpsys'))output=Buffer.from(args.includes('window')?`mCurrentFocus=Window{fixture u0 ${windowPackage}/.MainActivity}`:`topResumedActivity=ActivityRecord{fixture u0 ${foreground}/.MainActivity t1}`);
   else if(args.includes('exec-out')&&args.includes('cat')){if(readFailure)throw Error('fixture hierarchy unavailable');output=hierarchy(page,{clock,focused,checked});}
   else if(args.at(-2)==='wm'&&args.at(-1)==='density')output=Buffer.from('Physical density: 160');
   else if(args.includes('input')){const input=args.slice(args.indexOf('input')+1);inputs.push(input);if(input[0]==='tap'&&input[1]==='10')page='cities';if(input[0]==='tap'&&input[1]==='20')page='search';if(input[0]==='keyevent')page='cities';if(input[0]==='text'){page='search-'+input[1];focused=true;}if(failAfterInput)readFailure=true;}
   return {exitCode:0,output,stderr:''};
  }});
 t.after(()=>manager.dispose());await manager.execute(root,{operation:'start',display:{width:1280,height:720,density:160}},signal());await fs.writeFile(path.join(root,'test.apk'),'fixture-apk');await manager.execute(root,{operation:'install',path:'test.apk'},signal());await manager.execute(root,{operation:'launch'},signal());
 return {base,task,w,root,manager,calls,inputs,setForeground:value=>{foreground=value;},setWindow:value=>{windowPackage=value;},setAuthorized:value=>{authorized=value;},failAfterInput:()=>{failAfterInput=true;},changeOnlySystemClock:()=>{clock='10:01';frameMarker++;},setChecked:value=>{checked=value;}};
}
test('fixed managed tap/back/type inputs observe real application state without claiming acceptance',async t=>{
 const {root,manager,calls,inputs}=await broker(t),initial=await manager.state(root);
 const cities=await manager.execute(root,{operation:'tap',x:10,y:40},signal());assert.equal(cities.stateChanged,true);assert.equal(cities.behaviorAcceptance,'unverified');assert.equal(cities.sessionId,initial.sessionId);assert.notEqual(cities.uiStateHash,initial.uiStateHash);
 const search=await manager.execute(root,{operation:'tap',x:20,y:40},signal());assert.equal(search.stateChanged,true);assert.notEqual(search.uiStateHash,cities.uiStateHash);
 const typed=await manager.execute(root,{operation:'type',text:'New York._@+-9'},signal());assert.equal(typed.stateChanged,true);assert.deepEqual(inputs.at(-1),['text','New%sYork._@+-9']);
 const back=await manager.execute(root,{operation:'back'},signal());assert.equal(back.stateChanged,true);assert.deepEqual(inputs.at(-1),['keyevent','KEYCODE_BACK']);
 for(const call of calls.filter(call=>call.args.includes('shell')||call.args.includes('exec-out')))assert.equal(call.args[call.args.indexOf('-s')+1],'emulator-5580');
 assert.ok(!calls.some(call=>call.args.some(arg=>['devices','uninstall','sh','-c'].includes(arg))));
});
test('ineffective taps, system clock pixels and randomized evidence names cannot refresh the UI identity',async t=>{
 const {root,w,manager,changeOnlySystemClock}=await broker(t),action={action:'android_device',operation:'screenshot'};
 const initial=identity.fingerprint(await identity.identity(w,action,{android:manager}));changeOnlySystemClock();
 const result=await manager.execute(root,{operation:'tap',x:100,y:100},signal());assert.equal(result.stateChanged,false);
 const shot=await manager.execute(root,{operation:'screenshot',name:'random-one',path:'ignored-one.png'},signal());assert.equal(shot.uiStateHash,result.uiStateHash);
 assert.equal(identity.fingerprint(await identity.identity(w,{...action,purpose:'new label',name:'random-two',path:'ignored-two.png'},{android:manager})),initial);
});
test('checked/focused control attributes count as actual state while state() remains a command-free read',async t=>{
 const {root,manager,calls,setChecked}=await broker(t),before=await manager.state(root);setChecked(true);const shot=await manager.execute(root,{operation:'screenshot'},signal());assert.notEqual(shot.uiStateHash,before.uiStateHash);
 const count=calls.length,state=await manager.state(root);state.display.width=999;assert.equal((await manager.state(root)).display.width,1280);assert.equal(calls.length,count);
});
test('unsafe text, invalid coordinates and device/package overrides fail before input',async t=>{
 const {root,manager,inputs}=await broker(t);
 for(const text of ['','北京','line\nnext','a;id','a&b','$(id)','a`id`','a|b','a>b','a<b','"hello"',"'hello'",'a\\b','a%b','a\tb','x'.repeat(121)])await assert.rejects(manager.execute(root,{operation:'type',text},signal()),/安全 ASCII/);
 for(const action of [{operation:'tap',x:-1,y:1},{operation:'tap',x:1.2,y:1},{operation:'tap',x:1,y:Infinity},{operation:'tap',x:1280,y:0},{operation:'tap',x:0,y:720}])await assert.rejects(manager.execute(root,action,signal()),/坐标/);
 for(const extra of [{serial:'personal-device'},{package:'com.other.app'},{command:'input tap'},{device:'usb'},{path:'test.apk'}])await assert.rejects(manager.execute(root,{operation:'back',...extra},signal()),/受管项目参数/);
 assert.throws(()=>validate({operation:'uninstall'}),/无效/);assert.equal(inputs.length,0);
});
test('interactions require a managed installed foreground application and current authorization',async t=>{
 const {base,root,manager,inputs,setForeground,setWindow,setAuthorized}=await broker(t);setForeground('com.android.launcher');await assert.rejects(manager.execute(root,{operation:'tap',x:10,y:10},signal()),error=>error.code==='ANDROID_APP_NOT_FOREGROUND');assert.equal(inputs.length,0);
 setForeground('com.test.weather.evil');await assert.rejects(manager.execute(root,{operation:'back'},signal()),error=>error.code==='ANDROID_APP_NOT_FOREGROUND');
 setForeground('com.test.weather');setWindow('com.android.systemui');await assert.rejects(manager.execute(root,{operation:'back'},signal()),error=>error.code==='ANDROID_APP_NOT_FOREGROUND');setWindow('com.test.weather');setAuthorized(false);await assert.rejects(manager.execute(root,{operation:'type',text:'London'},signal()),error=>error.code==='ANDROID_PERMISSION');assert.equal(inputs.length,0);
 setAuthorized(true);const other=path.join(base,'other');await fs.mkdir(other);await assert.rejects(manager.execute(other,{operation:'back'},signal()),/先使用 android_device start/);await manager.execute(other,{operation:'start',display:{width:1280,height:720,density:160}},signal());await assert.rejects(manager.execute(other,{operation:'back'},signal()),/先安装/);
});
test('input with unknown post-observation is journaled as unknown and cannot be replayed under a new identity',async t=>{
 const {root,w,manager,inputs,failAfterInput}=await broker(t),action={action:'android_device',operation:'tap',x:10,y:40},first=await identity.identity(w,action,{android:manager}),entry=journal.begin(w.run,action);failAfterInput();
 await assert.rejects(journal.executeWithRecovery(w,entry,action,signal(),()=>manager.execute(root,action,signal())),error=>error.code==='ACTION_RESULT_UNKNOWN');assert.equal(entry.status,'unknown');assert.equal(entry.readOnly,false);assert.equal(inputs.length,1);
 const after=await identity.identity(w,action,{android:manager});assert.notDeepEqual(after,first);assert.throws(()=>journal.begin(w.run,{...action,purpose:'different explanation',progress:{memory:'new bookkeeping'}}),error=>error.code==='ACTION_RESULT_UNKNOWN');assert.equal(inputs.length,1);
});
test('one installed APK exposes three distinct screenshot input identities from actual UI states',async t=>{
 const {root,w,manager}=await broker(t),shot={action:'android_device',operation:'screenshot'},versions=[];
 for(const x of [null,10,20]){if(x!==null)await manager.execute(root,{operation:'tap',x,y:40},signal());const first=await identity.identity(w,shot,{android:manager});versions.push(first);await manager.execute(root,{operation:'screenshot'},signal());const second=await identity.identity(w,{...shot,purpose:'another evidence filename'},{android:manager});assert.deepEqual(second,first);}
 assert.equal(new Set(versions.map(value=>identity.fingerprint(value))).size,3);assert.equal(new Set(versions.map(value=>value.inputVersion.installedApkSha256)).size,1);
});
test('real runner grants bounded screenshots to three real managed UI states in one APK',async t=>{
 const {base,task,w,manager}=await broker(t),{runAgent}=require('../apps/desktop/agent/runner.cjs');let calls=0;
 const plan={action:'plan',goal:task.request,decisions:[],requirements:[{id:'r',text:'核对同APK三种真实界面状态的截图预算',type:'content'}],steps:[{id:'s',title:'检查三屏',status:'running'}]};
 const screenshot=()=>({action:'android_device',operation:'screenshot'}),tap=x=>({action:'android_device',operation:'tap',x,y:40});
 const actions=[{action:'route',kind:'task'},plan,screenshot(),screenshot(),tap(10),screenshot(),screenshot(),tap(20),screenshot(),screenshot(),{action:'pause',text:'离线三屏采样已完成，未声明真实业务或视觉验收通过'}];
 const result=await runAgent({base:path.join(base,'agent'),task,model:{contextWindow:128000},signal:signal(),android:manager,ask:async messages=>{const state=JSON.parse(messages.at(-1).content),action=actions[calls++];assert.ok(action,'runner must not ask again after bounded fixture actions');if(state.requiredAction==='plan_update'&&action.action!=='pause')action.progress={steps:[{id:'s',status:'running'}]};return {content:JSON.stringify(action)};}});
 assert.equal(result.agentRun.status,'paused');assert.equal(calls,actions.length);const saved=await createWorkspace(path.join(base,'agent'),task),shots=saved.run.events.filter(event=>event.type==='android_device'&&event.detail.operation==='screenshot');assert.equal(shots.length,6);assert.equal(new Set(shots.map(event=>event.detail.result.uiStateHash)).size,3);assert.equal(new Set(shots.map(event=>event.detail.result.apkSha256)).size,1);assert.ok(!saved.run.events.some(event=>event.type==='loop_recovery'));assert.equal(saved.files,w.files);
});
test('every managed running-app result reports the real session provenance',async t=>{
 const {root,manager}=await broker(t),state=await manager.state(root);
 for(const action of [{operation:'start',display:{width:1280,height:720,density:160}},{operation:'install',path:'test.apk'},{operation:'launch'},{operation:'logs'},{operation:'screenshot'},{operation:'tap',x:100,y:100},{operation:'type',text:'Paris'},{operation:'back'}])assert.equal((await manager.execute(root,action,signal())).sessionId,state.sessionId);
});

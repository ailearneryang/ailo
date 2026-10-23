const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const display=require('../apps/desktop/agent/android-display.cjs');
const {createAndroidManager}=require('../apps/desktop/agent/android-device.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {hash}=require('../apps/desktop/agent/evidence.cjs');
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-display-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
function png(width,height){const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);return b;}
async function page(root,boards){const dir=path.join(root,'sketch_extract/pages');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'page.json'),JSON.stringify({_class:'page',layers:boards}));}
const board=(id,width=2560,height=1440)=>({_class:'group',do_objectID:id,name:id,frame:{width,height}});

test('display validation prevents arbitrary host options, invalid dimensions and incompatible references',async t=>{
 const root=await temp(t);await fs.writeFile(path.join(root,'design.png'),png(1280,720));
 for(const value of [{width:'1280',height:720},{width:100,height:640},{width:1280},{width:1280,height:720,density:0},{width:3840,height:3840},{width:1280,height:720,serial:'usb'},{width:1280,height:720,flags:['-wipe-data']}])assert.throws(()=>display.validate(value));
 await assert.rejects(display.resolve(root,{reference:'../outside.png'}),/不允许|相对路径/);
 await assert.rejects(display.resolve(root,{width:720,height:1280,reference:'design.png'}),/宽高比/);
 const target=await display.resolve(root,{reference:'design.png'});assert.equal(target.width,1280);assert.equal(target.orientation,'landscape');assert.equal(target.sources[0].sha256,hash(png(1280,720)));
});

test('target follows dominant source artboards, ignores symbols and cover, and accepts explicit project overrides',async t=>{
 const root=await temp(t);await page(root,[board('home'),board('search'),board('manual'),board('cover',400,400),{...board('symbol',1000,1000),_class:'symbolMaster'}]);
 const target=await display.resolve(root);assert.deepEqual([target.width,target.height,target.density],[2560,1440,160]);assert.equal(target.source,'sketch-artboards');assert.equal(target.sources.length,1);
 await fs.writeFile(path.join(root,'android-display.json'),JSON.stringify({width:1280,height:720,density:160}));
 const explicit=await display.resolve(root);assert.equal(explicit.width,1280);assert.equal(explicit.source,'project-config');
 const action=await display.resolve(root,{width:1920,height:1080,density:240});assert.equal(action.width,1920);assert.equal(action.source,'explicit');
});

test('ambiguous source sizes require a target and projects without designs get a documented phone default',async t=>{
 const root=await temp(t);assert.deepEqual(Object.values((({width,height,density})=>({width,height,density}))(await display.resolve(root))),[720,1280,320]);
 await fs.writeFile(path.join(root,'original.sketch'),'unparsed');await assert.rejects(display.resolve(root),e=>e.code==='ANDROID_DISPLAY_REQUIRED');await fs.unlink(path.join(root,'original.sketch'));
 await page(root,[board('landscape'),board('portrait',1440,2560)]);await assert.rejects(display.resolve(root),e=>e.code==='ANDROID_DISPLAY_REQUIRED');
 await fs.writeFile(path.join(root,'android-display.json'),'{broken');await assert.rejects(display.resolve(root),SyntaxError);
});

test('AVD migration preserves data settings and produces a portrait-natural framebuffer with requested startup rotation',()=>{
 const before='hw.lcd.width=320\nhw.lcd.height=640\nhw.lcd.density=160\nhw.initialOrientation=portrait\ndisk.dataPartition.size=6G\n';
 const config=display.configure(before,{width:2560,height:1440,density:160,orientation:'landscape'});
 assert.match(config,/hw.lcd.width=1440\n/);assert.match(config,/hw.lcd.height=2560\n/);assert.match(config,/hw.initialOrientation=landscape\n/);assert.match(config,/disk.dataPartition.size=6G/);assert.equal(config.match(/hw.lcd.width=/g).length,1);
 assert.equal(display.check({width:2560,height:1440,density:160},{width:320,height:640,density:160}).matches,false);
 assert.equal(display.check({width:2560,height:1440,density:160},{width:2560,height:1440,density:320}).matches,false);
});

async function broker(t){
 const base=await temp(t),root=path.join(base,'project'),sdk=path.join(base,'sdk'),directory=path.join(base,'broker'),calls=[],children=[];
 await fs.mkdir(root);const arch=process.arch==='arm64'?'arm64-v8a':'x86_64';
 for(const p of ['emulator/emulator','cmdline-tools/latest/bin/avdmanager','platform-tools/adb','build-tools/34.0.0/aapt',`system-images/android-34/google_apis/${arch}/system.img`]){await fs.mkdir(path.dirname(path.join(sdk,p)),{recursive:true});await fs.writeFile(path.join(sdk,p),'');}
 let frame={width:1280,height:720},port=5580,hierarchyBytes;
 const runCommand=async(file,args,options={})=>{
  calls.push({file,args});let output='';
  if(path.basename(file)==='avdmanager'){
   const name=args[args.indexOf('--name')+1],avd=path.join(options.env.ANDROID_AVD_HOME,name+'.avd');await fs.mkdir(avd,{recursive:true});await fs.writeFile(path.join(options.env.ANDROID_AVD_HOME,name+'.ini'),'avd');await fs.writeFile(path.join(avd,'config.ini'),'hw.lcd.width=320\nhw.lcd.height=640\nhw.lcd.density=160\n');await fs.writeFile(path.join(avd,'userdata-qemu.img'),'PRESERVE_DATA');
  }else if(path.basename(file)==='aapt')output="package: name='com.test.weather'\nlaunchable-activity: name='com.test.weather.MainActivity'";
  else if(args.includes('sys.boot_completed'))output='1';
  else if(args.includes('screencap'))return {exitCode:0,output:png(frame.width,frame.height),stderr:''};
  else if(args.includes('exec-out')&&args.includes('cat')&&hierarchyBytes)return {exitCode:0,output:hierarchyBytes,stderr:''};
  else if(args.at(-2)==='wm'&&args.at(-1)==='density')output='Physical density: 160';
  return {exitCode:0,output:Buffer.from(output),stderr:''};
 };
 const manager=createAndroidManager({directory,authorize:async()=>true,environment:async()=>({sdk,javaHome:base}),serverPortFor:async()=>5100+children.length,devicePortFor:async()=>port+=2,runCommand,spawnEmulator:(_file,args)=>{
  assert.ok(!args.includes('-wipe-data'));const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.stderr=new EventEmitter();child.kill=()=>{child.exitCode=0;child.emit('exit',0);};children.push(child);return child;
 }});
 t.after(()=>manager.dispose());return {root,directory,manager,calls,children,setFrame:value=>{frame=value;},setHierarchy:value=>{hierarchyBytes=value;}};
}

test('screenshots archive bounded project-app hierarchy evidence and report collection failures without inventing checks',async t=>{
 const {root,manager,calls,setHierarchy}=await broker(t),signal=new AbortController().signal;
 await manager.execute(root,{operation:'start',display:{width:1280,height:720,density:160}},signal);
 await fs.writeFile(path.join(root,'test.apk'),'apk');await manager.execute(root,{operation:'install',path:'test.apk'},signal);
 setHierarchy(Buffer.from('<hierarchy><node package="com.test.weather" resource-id="com.test.weather:id/card" class="android.widget.TextView" text="23" content-desc="" bounds="[40,50][100,90]"/></hierarchy>'));
 let result=await manager.execute(root,{operation:'screenshot'},signal);assert.equal(result.uiHierarchy.nodeCount,1);assert.equal(result.uiHierarchy.nodes[0].resourceId,'com.test.weather:id/card');
 assert.equal(hash(await fs.readFile(path.join(root,result.uiHierarchy.path))),result.uiHierarchy.sha256);assert.ok(result.sources.some(s=>s.path===result.uiHierarchy.path));assert.ok(calls.some(c=>c.args.includes('uiautomator')));
 setHierarchy(Buffer.from('<invalid>'));result=await manager.execute(root,{operation:'screenshot'},signal);assert.equal(result.uiHierarchy.available,false);assert.equal(result.uiHierarchy.nodes,undefined);assert.match(result.uiHierarchy.notice,/不能宣称/);
 assert.equal(calls.filter(c=>c.args.includes('install')).length,1);assert.equal(calls.filter(c=>c.args.includes('rm')).length,2);
});

test('managed emulator applies target, verifies screenshot geometry and retains installed data when resized',async t=>{
 const {root,directory,manager,calls,children,setFrame}=await broker(t),signal=new AbortController().signal;
 const start=await manager.execute(root,{operation:'start',display:{width:1280,height:720,density:160}},signal);assert.equal(start.display.orientation,'landscape');
 await fs.writeFile(path.join(root,'test.apk'),'apk-v1');await manager.execute(root,{operation:'install',path:'test.apk'},signal);await manager.execute(root,{operation:'launch'},signal);
 let screenshot=await manager.execute(root,{operation:'screenshot'},signal);assert.equal(screenshot.displayCheck.matches,true);assert.equal(screenshot.apkSha256,hash(Buffer.from('apk-v1')));assert.equal(screenshot.displayCheck.actual.density,160);
 setFrame({width:320,height:640});screenshot=await manager.execute(root,{operation:'screenshot'},signal);assert.equal(screenshot.displayCheck.matches,false);
 await manager.execute(root,{operation:'start',display:{width:1920,height:1080,density:160}},signal);assert.equal(children.length,2);
 assert.equal((await manager.execute(root,{operation:'status'},signal)).package,'com.test.weather');
 const dirs=await fs.readdir(directory),avds=await fs.readdir(path.join(directory,dirs[0],'avd')),avd=avds.find(v=>v.endsWith('.avd'));
 assert.equal(await fs.readFile(path.join(directory,dirs[0],'avd',avd,'userdata-qemu.img'),'utf8'),'PRESERVE_DATA');
 assert.ok(calls.some(c=>c.args.slice(-5).join(' ')==='settings put system user_rotation 1'));
 assert.ok(calls.filter(c=>c.args.includes('shell')||c.args.includes('exec-out')).every(c=>c.args.includes('-s')&&c.args[c.args.indexOf('-s')+1].startsWith('emulator-')));
});

test('runtime delivery rejects wrong viewport and stale APK while build-only delivery stays available',async t=>{
 const base=await temp(t),w=await createWorkspace(base,{id:'delivery',request:'安装运行并截图'}),{assertAndroidDelivery}=require('../apps/desktop/agent/android-delivery.cjs');
 await fs.writeFile(path.join(w.files,'app.apk'),'v1');await fs.writeFile(path.join(w.files,'shot.png'),png(320,640));
 w.run.artifacts=[{path:'app.apk',sha256:hash(Buffer.from('v1'))}];w.run.acceptance=['安装运行并截图'];w.run.acceptanceTypes=['behavior'];
 const target={width:1280,height:720,density:160,source:'explicit',sources:[]},sources=[{path:'app.apk',sha256:hash(Buffer.from('v1'))},{path:'shot.png',sha256:hash(png(320,640))}];
 await w.event('android_device',{operation:'screenshot',result:{path:'shot.png',pixelSize:{width:320,height:640},apkSha256:hash(Buffer.from('v1')),display:target,displayCheck:{matches:false,actual:{width:320,height:640,density:160}},sources}});
 await assert.rejects(assertAndroidDelivery(w),e=>e.code==='ANDROID_DISPLAY_MISMATCH');
 const images={prepare:async()=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,TEST'}}})};
 const observed=await require('../apps/desktop/agent/visual-observation.cjs').imageObservation(w,{path:'shot.png'},images);
 assert.equal(observed.displayCheck.matches,false); // Bad screenshots remain inspectable for repair.
 await w.event('view_image',{revision:w.run.revision,result:observed});
 await assert.rejects(require('../apps/desktop/agent/evidence.cjs').event(w,w.run.events.at(-1).id),/尺寸|密度/);

 await fs.writeFile(path.join(w.files,'shot.png'),png(1280,720));sources[1].sha256=hash(png(1280,720));
 await w.event('android_device',{operation:'screenshot',result:{path:'shot.png',pixelSize:{width:1280,height:720},apkSha256:hash(Buffer.from('v1')),display:target,displayCheck:{matches:true,actual:{width:1280,height:720,density:160}},sources}});
 await assertAndroidDelivery(w);await fs.writeFile(path.join(w.files,'app.apk'),'v2');await assert.rejects(assertAndroidDelivery(w),/变化/);
 w.run.acceptance=['构建APK'];w.run.acceptanceTypes=['content'];await assertAndroidDelivery(w);
});

// Host broker: fixed SDK binaries and argv only. No model-supplied shell,
// SDK paths, device serials, emulator flags, uninstall or data-clear commands.
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {key,resolveFile}=require('./workspace.cjs');
const {androidEnvironment,exists}=require('./android-environment.cjs');
const operations=['status','start','install','launch','logs','screenshot','stop'];
function validate(action){if(!operations.includes(action.operation))throw Error('无效的 Android 设备操作');}
function command(file,args,{env,signal,timeout=30000,input,maxBytes=24000}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('已停止执行'));
  const child=spawn(file,args,{env,stdio:['pipe','pipe','pipe']});let buffers=[],bytes=0,stderr='',timedOut=false,settled=false;
  const abort=()=>child.kill('SIGKILL');
  const timer=setTimeout(()=>{timedOut=true;abort();},timeout);
  const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',b=>{bytes+=b.length;if(bytes<=maxBytes)buffers.push(b);else abort();});
  child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-8000);});
  child.stdin.on('error',()=>{});child.stdin.end(input||'');
  child.on('error',e=>{settled=true;clean();reject(e);});
  child.on('close',exitCode=>{if(settled)return;clean();if(signal?.aborted)return reject(Error('已停止执行'));if(timedOut)return reject(Error('Android 工具执行超时'));if(bytes>maxBytes)return reject(Error('Android 工具输出超过限制'));resolve({exitCode,output:Buffer.concat(buffers),stderr});});
 });
}
async function freePort(port=0){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});}
async function emulatorPort(){for(let p=5580;p<=5680;p+=2){try{await freePort(p);await freePort(p+1);return p;}catch{}}throw Error('没有可用的模拟器端口');}
async function findImage(sdk){
 const root=path.join(sdk,'system-images'),arch=process.arch==='arm64'?'arm64-v8a':'x86_64';
 const versions=(await fs.readdir(root).catch(()=>[])).filter(x=>/^android-\d+$/.test(x)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
 for(const version of versions)for(const tag of ['google_apis','default','google_apis_playstore'])if(await exists(path.join(root,version,tag,arch,'system.img')))return `system-images;${version};${tag};${arch}`;
 throw Error('尚未安装匹配本机架构的 Android 系统镜像，请先在 Android Studio SDK Manager 安装；不会自动修改 SDK。');
}
function createAndroidManager({directory,authorize}){
 const sessions=new Map(),busy=new Set(),children=new Set();let starting=Promise.resolve(),closed=false;
 async function checked(file,args,options){const r=await command(file,args,options);if(r.exitCode!==0)throw Error('Android 工具失败：'+(r.stderr||r.output.toString()).slice(-2000));return r.output;}
 async function stop(session){
  if(!session)return;
  const child=session.child;
  if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');
  });
  children.delete(child);
  if(session.adb)await command(session.adb,['-P',String(session.serverPort),'kill-server'],{env:session.env,timeout:5000}).catch(()=>{});
  if(sessions.get(session.root)===session)sessions.delete(session.root);
 }
 async function start(root,signal,onStatus){
  // Serialize port allocation and emulator startup across projects.
  const previous=starting;let release;starting=new Promise(r=>release=r);await previous;
  let session;
  try {
   if(closed||signal.aborted)throw Error('已停止执行');
   if(sessions.has(root))return sessions.get(root);
   const {sdk,javaHome}=await androidEnvironment({required:true});
   const adb=path.join(sdk,'platform-tools/adb'),emulator=path.join(sdk,'emulator/emulator'),manager=path.join(sdk,'cmdline-tools/latest/bin/avdmanager');
   if(!await exists(emulator)||!await exists(manager))throw Error('请安装 Android Emulator 和 cmdline-tools/latest');
   const home=path.join(directory,key(root));await fs.mkdir(home,{recursive:true,mode:0o700});
   const avdHome=path.join(home,'avd'),tmp=path.join(home,'tmp');await fs.mkdir(avdHome,{recursive:true});await fs.mkdir(tmp,{recursive:true});
   const serverPort=await freePort(),port=await emulatorPort();
   const env={PATH:path.join(javaHome,'bin')+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:home,TMPDIR:tmp,JAVA_HOME:javaHome,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,ANDROID_AVD_HOME:avdHome,ANDROID_USER_HOME:path.join(home,'.android'),ANDROID_ADB_SERVER_PORT:String(serverPort),LANG:'en_US.UTF-8'};
   const name='Ailo_'+key(root).slice(0,16);
   if(!await exists(path.join(avdHome,name+'.ini'))){onStatus?.('正在创建当前项目专用模拟器…');await checked(manager,['create','avd','--name',name,'--package',await findImage(sdk)],{env,signal,timeout:90000,input:'no\n'});}
   await checked(adb,['-P',String(serverPort),'--one-device','AILO_NO_USB_'+key(root).slice(0,16),'start-server'],{env,signal});
   const child=spawn(emulator,['-avd',name,'-port',String(port),'-no-snapshot','-no-boot-anim','-no-audio'],{env,stdio:['ignore','ignore','pipe']});
   let diagnostic='';child.stderr.on('data',b=>{diagnostic=(diagnostic+b.toString()).slice(-4000);});child.on('error',e=>{diagnostic=e.message;});children.add(child);
   session={root,child,adb,serverPort,serial:`emulator-${port}`,env,name};sessions.set(root,session);
   child.once('exit',()=>{children.delete(child);if(sessions.get(root)===session)sessions.delete(root);void command(adb,['-P',String(serverPort),'kill-server'],{env,timeout:5000}).catch(()=>{});});
   const deadline=Date.now()+180000;
   while(Date.now()<deadline){
    if(closed||signal.aborted)throw Error('已停止执行');
    if(child.exitCode!==null)throw Error('模拟器启动失败：'+diagnostic.slice(-1500));
    onStatus?.('正在等待项目模拟器启动…');
    const result=await command(adb,['-P',String(serverPort),'-s',session.serial,'shell','getprop','sys.boot_completed'],{env,signal,timeout:5000}).catch(e=>{if(signal.aborted)throw e;return {output:Buffer.alloc(0)};});
    if(result.output.toString().trim()==='1')return session;
    await new Promise(r=>setTimeout(r,1500));
   }
   throw Error('模拟器在 180 秒内未启动完成');
  }catch(e){await stop(session);throw e;}finally{release();}
 }
 async function execute(root,action,signal,onStatus){
  validate(action);root=await fs.realpath(root);
  if(closed)throw Error('设备服务正在退出');
  if(action.operation==='status'){const s=sessions.get(root);return {running:!!s,device:s?.name,package:s?.package,notice:'只报告 Ailo 为当前项目管理的模拟器，不访问个人设备。'};}
  if(!authorize||!await authorize(root,signal))throw Object.assign(Error('尚未授权当前项目使用本机测试模拟器。任务已保留。'),{code:'ANDROID_PERMISSION'});
  if(signal.aborted)throw Error('已停止执行');
  if(busy.has(root))throw Error('当前项目设备正在被另一项操作使用，请稍后重试');busy.add(root);
  try {
   if(action.operation==='start'){const s=await start(root,signal,onStatus);return {device:s.name,running:true};}
   const s=sessions.get(root);if(!s)throw Error('请先使用 android_device start 启动当前项目模拟器');
   const adb=args=>checked(s.adb,['-P',String(s.serverPort),'-s',s.serial,...args],{env:s.env,signal,timeout:120000,maxBytes:24000});
   if(action.operation==='stop'){await stop(s);return {stopped:true};}
   if(action.operation==='install'){
    if(typeof action.path!=='string'||!action.path.endsWith('.apk')||action.path.split('/').includes('.runtime'))throw Error('请提供当前项目 APK 的相对路径');
    const apk=await resolveFile(root,action.path),stat=await fs.stat(apk);if(!stat.isFile()||stat.size>150*1024*1024)throw Error('APK 超过 150 MB 或不是文件');
    // Copy validated bytes into broker-owned storage before invoking host tools.
    const copy=path.join(s.env.HOME,randomUUID()+'.apk');await fs.copyFile(apk,copy);
    try {
     const versions=(await fs.readdir(path.join(s.env.ANDROID_HOME,'build-tools'))).filter(v=>/^\d+[.\d]*$/.test(v)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
     if(!versions.length)throw Error('未找到 Android build-tools');
     const aapt=path.join(s.env.ANDROID_HOME,'build-tools',versions[0],'aapt');
     const info=(await checked(aapt,['dump','badging',copy],{env:s.env,signal})).toString();
     const pkg=info.match(/package: name='([A-Za-z][A-Za-z0-9_.]+)'/)?.[1];
     const activity=info.match(/launchable-activity: name='([A-Za-z][A-Za-z0-9_.$]+)'/)?.[1];
     if(!pkg||!activity)throw Error('APK 没有有效包名或可启动 Activity');
     const output=(await adb(['install','-r',copy])).toString();s.package=pkg;s.activity=activity;
     return {installed:true,package:pkg,output,notice:'安装成功不等于功能验收通过；未清除应用数据。'};
    }finally{await fs.unlink(copy).catch(()=>{});}
   }
   if(!s.package)throw Error('请先安装当前项目 APK');
   if(action.operation==='launch')return {output:(await adb(['shell','am','start','-W','-n',s.package+'/'+s.activity])).toString(),notice:'请继续读取应用日志、截图并验证业务行为。'};
   if(action.operation==='logs'){
    const pid=(await adb(['shell','pidof',s.package]).catch(()=>Buffer.alloc(0))).toString().trim().split(/\s+/)[0];
    if(!/^\d+$/.test(pid||''))return {running:false,output:(await adb(['logcat','-d','-b','crash','-t','60'])).toString(),notice:'应用进程不存在；以下为当前项目专用模拟器的近期崩溃日志。'};
    return {running:true,output:(await adb(['logcat','-d','--pid='+pid,'-t','120'])).toString()};
   }
   if(action.operation==='screenshot'){
    const r=await command(s.adb,['-P',String(s.serverPort),'-s',s.serial,'exec-out','screencap','-p'],{env:s.env,signal,maxBytes:10*1024*1024});
    if(r.exitCode!==0||!r.output.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('未能取得有效截图');
    const relative='verification/screenshot-'+randomUUID()+'.png';
    await fs.writeFile(await resolveFile(root,relative,true),r.output,{flag:'wx',mode:0o600});
    return {path:relative,notice:'截图已保存，可登记产物供用户查看。当前模型未接收图片时，不得声称已完成视觉验收。'};
   }
  }finally{busy.delete(root);}
 }
 async function dispose(){closed=true;await Promise.allSettled([...sessions.values()].map(stop));for(const child of children)child.kill('SIGTERM');}
 return {execute,dispose};
}
module.exports={createAndroidManager,validate,operations,command,findImage};

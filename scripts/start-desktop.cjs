// Resolve Forge's output directory and verify it before starting. An older
// unversioned bundle must never shadow a new build.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const defaultDesktop=path.resolve(__dirname,'../apps/desktop');
async function resolveLaunch({desktop=defaultDesktop,platform=process.platform,arch=process.arch}={}){
 const version=JSON.parse(fs.readFileSync(path.join(desktop,'package.json'),'utf8')).version;
 const config=require(path.join(desktop,'forge.config.cjs'));
 const identifier=typeof config.buildIdentifier==='function'?await config.buildIdentifier():config.buildIdentifier;
 if(identifier!==undefined&&(typeof identifier!=='string'||!identifier||!/^[-a-zA-Z0-9._+]+$/.test(identifier)||['.','..'].includes(identifier)))throw Error('打包目录标识无效，请检查 Forge buildIdentifier 配置。');
 const directory=path.join(path.resolve(desktop,config.outDir||'out'),...(identifier?[identifier]:[]),`Ailo-${platform}-${arch}`);
 const bundle=platform==='darwin'?path.join(directory,'Ailo.app/Contents'):directory;
 const executable=platform==='darwin'?path.join(bundle,'MacOS/Ailo'):path.join(directory,platform==='win32'?'Ailo.exe':'Ailo');
 if(!fs.existsSync(executable))throw Error(`未找到当前版本 Ailo ${version}：${executable}。请先运行 npm run package；不会回退到旧包。`);
 let packedVersion;
 try{packedVersion=JSON.parse(require('../apps/desktop/node_modules/@electron/asar').extractFile(path.join(bundle,platform==='darwin'?'Resources/app.asar':'resources/app.asar'),'package.json')).version;}
 catch{throw Error('无法核对 Ailo 包内版本，请重新运行 npm run package。');}
 if(packedVersion!==version)throw Error(`Ailo 启动包版本不一致：源码 ${version}，包内 ${packedVersion}。请重新运行 npm run package；未启动旧包。`);
 if(platform==='darwin'){
  const plist=fs.readFileSync(path.join(bundle,'Info.plist'),'utf8');
  for(const field of ['CFBundleShortVersionString','CFBundleVersion']){
   const actual=plist.match(new RegExp('<key>'+field+'</key>\\s*<string>([^<]+)</string>'))?.[1];
   if(actual!==version)throw Error(`Ailo 应用版本标识与源码 ${version} 不一致，请重新运行 npm run package。`);
  }
 }
 return {desktop,version,directory,executable};
}
function launchCommand(launch,args=[],platform=process.platform,logFile){
 if(platform==='darwin'){
  if(!logFile)throw Error('macOS 应用启动需要独立日志路径');
  return {command:'/usr/bin/open',args:['-n','-W','--env','ELECTRON_RUN_AS_NODE','--stdout',logFile,'--stderr',logFile+'.stderr','-a',path.dirname(path.dirname(path.dirname(launch.executable))),'--args',...args]};
 }
 return {command:launch.executable,args};
}
function followLog(file,write=chunk=>process.stdout.write(chunk)){
 let offset=0,closed=false,failed=false,tail='';const decoder=new (require('node:string_decoder').StringDecoder)('utf8');
 const read=()=>{if(closed)return;let fd;try{fd=fs.openSync(file,'r');const size=fs.fstatSync(fd).size;if(size<offset)offset=0;if(size===offset)return;const bytes=Buffer.alloc(size-offset);fs.readSync(fd,bytes,0,bytes.length,offset);offset=size;const text=decoder.write(bytes);tail=(tail+text).slice(-150);if(tail.includes('本次未切换运行版本'))failed=true;write(text);}finally{if(fd!==undefined)fs.closeSync(fd);}};
 const timer=setInterval(read,200);timer.unref();
 return {close(){read();closed=true;clearInterval(timer);return {failed};}};
}
// Launch Services opens redirected stdio before starting the app. A log under
// Documents may be denied by TCC even when Node itself can create that file.
function createLaunchLogs({writeStdout=chunk=>process.stdout.write(chunk),writeStderr=chunk=>process.stderr.write(chunk)}={}){
 const directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'ailo-desktop-launch-'));fs.chmodSync(directory,0o700);
 const logFile=path.join(directory,'stdout.log');for(const file of [logFile,logFile+'.stderr'])fs.writeFileSync(file,'',{mode:0o600});
 const stdout=followLog(logFile,writeStdout),stderr=followLog(logFile+'.stderr',writeStderr);
 return {directory,logFile,close(){const out=stdout.close(),err=stderr.close();return {failed:out.failed||err.failed};}};
}
async function main(){
 let launch=await resolveLaunch();
 if(process.argv[2]==='--check'){console.log(`Ailo ${launch.version}\n${launch.executable}`);return;}
 if(process.platform==='darwin')launch=await require('./install-desktop.cjs').synchronizeDesktop(launch);
 let logFile,log;
 if(process.platform==='darwin'){log=createLaunchLogs();logFile=log.logFile;}
 const command=launchCommand(launch,process.argv.slice(2),process.platform,logFile);
 const child=spawn(command.command,command.args,{cwd:launch.desktop,stdio:'inherit',env:process.env});
 child.on('error',error=>{log?.close();console.error('无法启动 Ailo：',error.message);process.exitCode=1;});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
 child.on('exit',(code,signal)=>{const result=log?.close();process.exitCode=result?.failed?1:code??(signal?1:0);});
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={resolveLaunch,launchCommand,followLog,createLaunchLogs};

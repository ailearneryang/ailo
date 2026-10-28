const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto'),{createReadStream}=require('node:fs'),{execFileSync}=require('node:child_process');
const installedBundle='/Applications/Ailo.app';
async function bundleDigest(bundle){
 const rows=[];
 async function walk(relative=''){
  for(const name of (await fs.readdir(path.join(bundle,relative))).sort()){
   const entry=path.join(relative,name),file=path.join(bundle,entry),stat=await fs.lstat(file);
   if(stat.isSymbolicLink())rows.push([entry,'link',await fs.readlink(file)]);
   else if(stat.isDirectory()){rows.push([entry,'directory']);await walk(entry);}
   else if(stat.isFile()){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);rows.push([entry,'file',stat.mode&0o111,hash.digest('hex')]);}
   else throw Error('应用包包含不支持的文件类型：'+entry);
  }
 }
 await walk();return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function appMetadata(bundle){
 const stat=await fs.lstat(bundle);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('安装目标不是独立应用目录，未覆盖：'+bundle);
 const plist=await fs.readFile(path.join(bundle,'Contents/Info.plist'),'utf8');
 const value=key=>plist.match(new RegExp('<key>'+key+'</key>\\s*<string>([^<]+)</string>'))?.[1];
 const id=value('CFBundleIdentifier'),version=value('CFBundleShortVersionString');
 if(id!=='com.ailearneryang.ailo'||!version||value('CFBundleVersion')!==version||value('CFBundleExecutable')!=='Ailo')throw Error('目标不是有效的 Ailo 应用，未覆盖：'+bundle);
 const asar=require('../apps/desktop/node_modules/@electron/asar'),archive=path.join(bundle,'Contents/Resources/app.asar');
 // Atomic replacement keeps the path but changes the archive header and offsets.
 asar.uncache(archive);
 const packed=JSON.parse(asar.extractFile(archive,'package.json'));
 if(packed.version!==version)throw Error('应用包版本不一致，未安装');return {id,version};
}
async function verifyBundle(bundle,version){
 const metadata=await appMetadata(bundle);if(version&&metadata.version!==version)throw Error('安装版本与当前构建不一致');
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'pipe'});return metadata;
}
function runningBundle(bundle){
 const output=execFileSync('/bin/ps',['-axo','comm='],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 return output.split('\n').some(line=>line.trim()===path.join(bundle,'Contents/MacOS/Ailo'));
}
async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function installBundle({source,destination=installedBundle,version,verify=verifyBundle,running=runningBundle,copy=async(from,to)=>execFileSync('/usr/bin/ditto',['--rsrc','--extattr','--noqtn',from,to],{stdio:'pipe'}),smoke=async(bundle,v)=>require('./desktop-startup-check.cjs').checkDesktopStartup(path.dirname(bundle),v)}={}){
 if(path.resolve(source)===path.resolve(destination))throw Error('构建路径不能与安装路径相同');
 await verify(source,version);const sourceHash=await bundleDigest(source),hadPrevious=await exists(destination);
 if(hadPrevious){
  await verify(destination);
  if(sourceHash===await bundleDigest(destination))return {bundle:destination,version,changed:false};
  if(await running(destination))throw Object.assign(Error('应用程序中的 Ailo 仍在运行。新版本已构建，请先完全退出 Ailo（⌘Q），再运行 npm start；未替换正在运行的应用。'),{code:'DESKTOP_INSTALL_RUNNING'});
 }
 const parent=path.dirname(destination);await fs.mkdir(parent,{recursive:true});const stage=await fs.mkdtemp(path.join(parent,'.ailo-install-')),candidate=path.join(stage,'Ailo.app'),backup=path.join(stage,'previous.app');let published=false,backedUp=false,retainRecovery=false;
 try{
  await copy(source,candidate);await verify(candidate,version);
  if(await bundleDigest(candidate)!==sourceHash)throw Error('安装副本与已验证构建不同，未更新应用程序');
  if(await running(destination))throw Object.assign(Error('Ailo 在安装期间已启动，请先完全退出后重试；未替换应用。'),{code:'DESKTOP_INSTALL_RUNNING'});
  if(hadPrevious){await fs.rename(destination,backup);backedUp=true;}
  await fs.rename(candidate,destination);published=true;
  await smoke(destination,version);await verify(destination,version);
  if(await bundleDigest(destination)!==sourceHash)throw Error('安装后的应用内容发生变化，正在恢复旧版本');
  return {bundle:destination,version,changed:true};
 }catch(error){
  try{
   if(published)await fs.rm(destination,{recursive:true,force:true});
   if(backedUp)await fs.rename(backup,destination);
  }catch(rollbackError){retainRecovery=true;throw Error('安装失败且自动恢复未完成；原应用保留在 '+backup+'。'+rollbackError.message);}
  throw error;
 }finally{if(!retainRecovery)await fs.rm(stage,{recursive:true,force:true});}
}
async function synchronizeDesktop(launch){
 const root=path.resolve(launch.desktop,'../..');await require('./release-quality.cjs').assertPacked(root,launch.directory,'darwin');
 const result=await installBundle({source:path.join(launch.directory,'Ailo.app'),version:launch.version});
 // Only the installed copy should be offered in application search. This does
 // not terminate a process or modify user data and Dock preferences.
 await require('./desktop-discovery.cjs').cleanDiscovery({desktop:launch.desktop});
 return {...launch,executable:path.join(result.bundle,'Contents/MacOS/Ailo'),installed:true};
}
if(require.main===module)(async()=>{const launch=await require('./start-desktop.cjs').resolveLaunch();const result=await synchronizeDesktop(launch);console.log(`Ailo ${result.version} 已同步：${path.dirname(path.dirname(path.dirname(result.executable)))}`);})().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={installedBundle,bundleDigest,appMetadata,verifyBundle,runningBundle,installBundle,synchronizeDesktop};

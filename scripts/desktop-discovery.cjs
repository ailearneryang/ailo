// Keep build history out of Spotlight; only /Applications is a user entry point.
const fs=require('node:fs/promises'),path=require('node:path'),{execFileSync}=require('node:child_process');
const registry='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
function updateRegistration(args){
 try{return execFileSync(registry,args,{stdio:'pipe'});}
 catch(error){if(args[0]==='-u'&&String(error.stderr).includes('-10814'))return;throw error;}
}
async function cleanDiscovery({desktop,metadata,running,register=updateRegistration,installed='/Applications/Ailo.app'}={}){
 const install=require('./install-desktop.cjs');metadata??=install.appMetadata;running??=install.runningBundle;
 const out=path.join(desktop,'out'),archive=path.join(out,'.packages.noindex');
 const moved=[],skipped=[];
 // Only Forge's known legacy version/platform layout, never arbitrary apps.
 for(const version of await fs.readdir(out).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){
  if(!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))continue;
  const folder=path.join(out,version);if(!(await fs.lstat(folder)).isDirectory()||(await fs.lstat(folder)).isSymbolicLink())continue;
  for(const platform of await fs.readdir(folder)){
   if(!/^Ailo-darwin-(arm64|x64)$/.test(platform))continue;
   const parent=path.join(folder,platform);const stat=await fs.lstat(parent);if(!stat.isDirectory()||stat.isSymbolicLink())continue;
   const bundle=path.join(parent,'Ailo.app');try{await metadata(bundle);}catch{continue;}
   if(await running(bundle)){skipped.push(bundle);continue;}
   const target=path.join(archive,version,platform,'Ailo.app');await fs.mkdir(path.dirname(target),{recursive:true});
   // Never overwrite another archived build.
   let destination=target;try{await fs.lstat(target);destination=path.join(await fs.mkdtemp(path.join(archive,'retired-')),'Ailo.app');}catch(e){if(e.code!=='ENOENT')throw e;}
   await fs.rename(bundle,destination);register(['-u',bundle]);register(['-u',destination]);moved.push(destination);
  }
 }
 // Startup probes can register even a noindex app explicitly.
 async function unregisterBuilds(directory){
  for(const entry of await fs.readdir(directory,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){
   const file=path.join(directory,entry.name);if(!entry.isDirectory()||entry.isSymbolicLink())continue;
   if(entry.name==='Ailo.app'){try{await metadata(file);}catch{continue;}register(['-u',file]);}
   else await unregisterBuilds(file);
  }
 }
 await unregisterBuilds(archive);
 try{await metadata(installed);}catch{return {moved,skipped};}
 register(['-f',installed]);return {moved,skipped};
}
module.exports={cleanDiscovery};
if(require.main===module)cleanDiscovery({desktop:path.resolve(__dirname,'../apps/desktop')}).then(result=>console.log(JSON.stringify(result,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});

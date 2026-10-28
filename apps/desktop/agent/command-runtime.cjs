const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {constants}=require('node:fs');
const {resolveFile}=require('./workspace.cjs');

const SYSTEM_PATH='/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin';
const within=(root,file)=>file===root||file.startsWith(root+path.sep);
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
const version=value=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
const inaccessible=error=>['ENOENT','EACCES','EPERM','ENOTDIR','ELOOP'].includes(error.code);
function compareVersions(a,b){const left=version(a).slice(1).map(Number),right=version(b).slice(1).map(Number);return right[0]-left[0]||right[1]-left[1]||right[2]-left[2];}
async function regular(file,{executable=false}={}){
 try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())return false;if(executable)await fs.access(file,constants.X_OK);return true;}catch(error){if(inaccessible(error))return false;throw error;}
}
async function readSmall(file,maximum=1024*1024){try{if(!await regular(file))return null;const stat=await fs.stat(file);if(stat.size>maximum)return null;return await fs.readFile(file,'utf8');}catch(error){if(inaccessible(error))return null;throw error;}}
async function real(file){try{return await fs.realpath(file);}catch(error){if(inaccessible(error))return null;throw error;}}
async function discoverNode(candidate){
 const allowed=await real(candidate.root),actual=await real(candidate.file);
 if(!allowed||!actual||!within(allowed,actual)||!await regular(actual,{executable:true}))return null;
 // process.execPath is already the running Node executable, never an Electron
 // executable or a model-provided alias. Other symlinks must stay in a known
 // installation root, including the exact selected NVM version.
 if(candidate.noLink&&!await regular(candidate.file,{executable:true}))return null;
 const node={available:true,path:actual,bin:path.dirname(actual),source:candidate.source,versionHint:candidate.versionHint||null,installationRoot:allowed};
 const prefix=path.dirname(path.dirname(actual)),npmCandidates=[path.join(path.dirname(candidate.file),'npm'),path.join(path.dirname(actual),'npm'),path.join(prefix,'lib/node_modules/npm/bin/npm-cli.js')];
 let npm={available:false};
 for(const cli of [...new Set(npmCandidates)]){
  const npmCli=await real(cli);if(!npmCli||!within(allowed,npmCli)||!npmCli.endsWith(path.join('npm','bin','npm-cli.js'))||!await regular(npmCli))continue;
  const packageRoot=path.dirname(path.dirname(npmCli));
  let metadata;try{metadata=JSON.parse(await readSmall(path.join(packageRoot,'package.json'))||'null');}catch{continue;}
  if(metadata?.name!=='npm'||typeof metadata.version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(metadata.version))continue;
  npm={available:true,path:npmCli,packageRoot,versionHint:metadata.version};break;
 }
 return {schemaVersion:1,status:'discovered',node,npm,binDirectories:[node.bin],readPaths:[...new Set([node.bin,...(npm.available?[npm.packageRoot]:[])])]};
}
async function nvmCandidates(home,maxVersions){
 const parts=[path.join(home,'.nvm'),path.join(home,'.nvm/versions'),path.join(home,'.nvm/versions/node')];
 for(const directory of parts){try{const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())return [];}catch(error){if(inaccessible(error))return [];throw error;}}
 const root=parts.at(-1);let entries;try{entries=await fs.readdir(root,{withFileTypes:true});}catch(error){if(inaccessible(error))return [];throw error;}
 const names=entries.filter(entry=>entry.isDirectory()&&!entry.isSymbolicLink()&&version(entry.name)).map(entry=>entry.name).sort(compareVersions);
 let preferred=[];
 let alias;
 try{const directory=await fs.lstat(path.join(home,'.nvm/alias'));if(directory.isDirectory()&&!directory.isSymbolicLink())alias=await readSmall(path.join(home,'.nvm/alias/default'),128);}catch(error){if(!inaccessible(error))throw error;}
 let target=alias?.trim();
 if(target&&/^lts\/(?:\*|[a-z]+)$/.test(target)){
  try{const directory=path.join(home,'.nvm/alias/lts'),stat=await fs.lstat(directory);target=stat.isDirectory()&&!stat.isSymbolicLink()?(await readSmall(path.join(directory,target.slice(4)),128))?.trim():undefined;}catch(error){if(!inaccessible(error))throw error;target=undefined;}
 }
 if(target&&/^v?\d+(?:\.\d+){0,2}$/.test(target)){
  const components=target.replace(/^v/,'').split('.');preferred=names.filter(name=>components.every((part,index)=>version(name)[index+1]===part)).slice(0,1);
 }else if(target&&/^(?:node|stable)$/.test(target))preferred=names.slice(0,1);
 const selected=[...new Set([...preferred,...names.slice(0,maxVersions)])];
 const candidates=[];
 for(const name of selected){
  const installationRoot=path.join(root,name),bin=path.join(installationRoot,'bin');
  try{const stat=await fs.lstat(bin);if(!stat.isDirectory()||stat.isSymbolicLink())continue;}catch(error){if(inaccessible(error))continue;throw error;}
  candidates.push({file:path.join(bin,'node'),root:installationRoot,source:preferred.includes(name)?'nvm_default':'nvm_version',versionHint:name.replace(/^v/,''),noLink:true});
 }
 return candidates;
}
async function resolve(options={}){
 const home=options.homeDirectory===undefined?os.homedir():options.homeDirectory;
 const executable=options.execPath===undefined?(process.versions.electron?null:process.execPath):options.execPath;
 const standards=options.standardBins===undefined?[{bin:'/opt/homebrew/bin',root:'/opt/homebrew'},{bin:'/usr/local/bin',root:'/usr/local'},{bin:'/usr/bin',root:'/usr'}]:options.standardBins;
 const maximum=options.maxVersions===undefined?16:options.maxVersions;
 if(typeof home!=='string'||!path.isAbsolute(home)||!Number.isSafeInteger(maximum)||maximum<1||maximum>32||!Array.isArray(standards))throw Error('命令运行时发现配置无效');
 const candidates=[];
 if(typeof executable==='string'&&path.basename(executable)==='node')candidates.push({file:executable,root:path.dirname(path.dirname(executable)),source:'current_node',noLink:true,versionHint:executable===process.execPath&&!process.versions.electron?process.versions.node:undefined});
 for(const entry of standards){const bin=typeof entry==='string'?entry:entry.bin,root=typeof entry==='string'?path.dirname(entry):entry.root;if(typeof bin!=='string'||typeof root!=='string'||!path.isAbsolute(bin)||!path.isAbsolute(root))throw Error('命令运行时安装目录无效');candidates.push({file:path.join(bin,'node'),root,source:'standard_bin'});}
 for(const candidate of candidates){const discovery=await discoverNode(candidate);if(discovery)return discovery;}
 for(const candidate of await nvmCandidates(home,maximum)){const discovery=await discoverNode(candidate);if(discovery)return discovery;}
 return {schemaVersion:1,status:'unavailable',node:{available:false},npm:{available:false},binDirectories:[],readPaths:[]};
}
function context(discovery){
 return {version:1,status:discovery.status,node:{available:discovery.node.available,versionHint:discovery.node.versionHint||undefined},npm:{available:discovery.npm.available,versionHint:discovery.npm.versionHint||undefined},
  notice:'discovered仅表示已找到受限安装目录中的运行时文件，尚未执行验证；命令使用隔离HOME与npm配置，不读取个人npm令牌。安装项目依赖时显式使用 npm install --prefix . 包名，或指定项目内目标，避免npm沿父目录寻找安装位置。网络仍须沿用当前任务授权。'};
}
async function environment(root,discovery){
 discovery ||= await resolve();
 const directories=['.runtime/home','.runtime/tmp','.runtime/npm-cache','.runtime/npm-prefix','.runtime/ailo-command-bin','.runtime/ailo-command-config'];
 for(const directory of directories){const location=await resolveFile(root,directory,true);await fs.mkdir(location,{recursive:true,mode:0o700});}
 const userConfig=await resolveFile(root,'.runtime/ailo-command-config/npm-userrc'),globalConfig=await resolveFile(root,'.runtime/ailo-command-config/npm-globalrc');
 for(const file of [userConfig,globalConfig])await fs.writeFile(file,'',{mode:0o600,flag:constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW});
 const bin=await resolveFile(root,'.runtime/ailo-command-bin');
 for(const [name,source] of [['node',discovery.node.available?'#!/bin/sh\nexec '+quote(discovery.node.path)+' "$@"\n':null],['npm',discovery.node.available&&discovery.npm.available?'#!/bin/sh\nexec '+quote(discovery.node.path)+' '+quote(discovery.npm.path)+' "$@"\n':null]]){
  const file=await resolveFile(root,'.runtime/ailo-command-bin/'+name);
  if(source){await fs.writeFile(file,source,{mode:0o700,flag:constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW});await fs.chmod(file,0o700);}else await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
 }
 const npm={cache:path.join(root,'.runtime/npm-cache'),prefix:path.join(root,'.runtime/npm-prefix'),userconfig:userConfig,globalconfig:globalConfig};
 const env={PATH:bin+path.delimiter+SYSTEM_PATH,HOME:path.join(root,'.runtime/home'),TMPDIR:path.join(root,'.runtime/tmp')};
 for(const [key,value] of Object.entries(npm)){env['NPM_CONFIG_'+key.toUpperCase()]=value;env['npm_config_'+key]=value;}
 return {env,readPaths:[...discovery.readPaths],context:context(discovery)};
}
module.exports={resolve,context,environment,SYSTEM_PATH};

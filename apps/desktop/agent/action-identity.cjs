const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {normalizeProjectPath,resolveFile}=require('./workspace.cjs');
const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,stable(value[key])]))):value;
const hash=value=>createHash('sha256').update(value).digest('hex');
// Presentation and bookkeeping cannot create a new execution or failure identity.
function action(value){
 const result={...value};
 for(const key of ['purpose','progress','stepId','conversationTitle'])delete result[key];
 if(['list_files','read_file','write_file','edit_file','edit_spreadsheet','view_image','browser','artifact','build_android'].includes(result.action)&&typeof result.path==='string')result.path=normalizeProjectPath(result.path,['list_files','build_android'].includes(result.action));
 if(result.action==='list_files')result.path ||= '';
 if(['read_file','read_material','read_source','inspect_source','read_execution','read_history'].includes(result.action))result.offset ??= 0;
 if(result.action==='build_android')result.tasks=require('./android-build.cjs').tasksFor(result);
 // Screenshots receive a broker-generated filename; caller labels cannot make
 // the same device state into a new operation.
 if(result.action==='android_device'&&result.operation==='screenshot'){delete result.path;delete result.name;}
 return stable(result);
}
function fingerprint(value,inputVersion){return JSON.stringify(stable({...action(value),...(inputVersion===undefined?{}:{inputVersion})}));}
async function fileVersion(root,relative){
 const file=await resolveFile(root,relative);
 try{return await require('./evidence.cjs').hashFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function identity(workspace,value,{android}={}){
 const target=action(value),name=target.action;
 if(name==='finish'){
  // Actual file changes or newly validated coverage make this a different
  // delivery attempt. Reads, checkpoint text and renamed explanations do not.
  const artifacts=await Promise.all((workspace.run.artifacts||[]).map(async f=>({path:f.path,sha256:await fileVersion(workspace.files,f.path)})));
  target.inputVersion={kind:'delivery',artifacts:artifacts.sort((a,b)=>a.path.localeCompare(b.path)),checks:Object.entries(workspace.run.acceptanceResults||{}).sort(([a],[b])=>a.localeCompare(b)).map(([id,c])=>({id,status:c.status,revision:c.revision})),complete:true};
 }else if(name==='build_android'){
  const build=await require('./android-build.cjs').inputIdentity(workspace.files,target);
  target.inputVersion={kind:'android_build',sha256:build.key,complete:build.complete,sourceSignature:build.sourceSignature,environmentSignature:build.environmentSignature};
 }else if(['read_file','write_file','edit_file','edit_spreadsheet','view_image','artifact'].includes(name)&&target.path){
  target.inputVersion={kind:'file',sha256:await fileVersion(workspace.files,target.path),complete:true};
  if(name==='view_image'){
   if(target.reference)target.inputVersion.reference=await fileVersion(workspace.files,target.reference);
   target.inputVersion.designConfigSha256=await fileVersion(workspace.files,'android-design.json');
   const source=await workspace.findEvent?.(event=>event.type==='android_device'&&event.detail.result?.path===target.path&&event.detail.result?.apkSha256);
   if(source){const result=source.detail.result;target.inputVersion.deviceSource={apkPath:result.apkPath,apkSha256:result.apkSha256,sources:[...(result.sources||[])].map(({path,sha256})=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path))};}
  }
 }else if(name==='android_device'){
  const state=typeof android?.state==='function'?await android.state(workspace.files):null;
  const display=state?.display;
  target.inputVersion={kind:'android_runtime',complete:!!state,running:state?.running,busy:state?.busy,sessionId:state?.sessionId||null,
   package:state?.package||null,installedApkPath:state?.apkPath||null,installedApkSha256:state?.apkSha256||null,uiStateHash:state?.uiStateHash||null,
   display:display?Object.fromEntries(['width','height','density','orientation'].filter(key=>display[key]!==undefined).map(key=>[key,display[key]])):null};
  if(target.operation==='install'&&target.path)target.inputVersion.targetApkSha256=await fileVersion(workspace.files,target.path);
  if(target.operation==='start'){
   target.inputVersion.displayConfigSha256=await fileVersion(workspace.files,'android-display.json');
   if(target.display?.reference)target.inputVersion.referenceSha256=await fileVersion(workspace.files,target.display.reference);
  }
 }else if(name==='run_command'){
  const snapshot=await require('./file-state.cjs').inventory(workspace.files);
  target.inputVersion={kind:'files',sha256:hash(JSON.stringify(stable(snapshot))),complete:snapshot.complete};
 }else if(name==='list_files'){
  const relative=target.path||'',directory=relative?await resolveFile(workspace.files,relative):workspace.files;
  try{const entries=await fs.readdir(directory,{withFileTypes:true});target.inputVersion={kind:'directory',sha256:hash(JSON.stringify(entries.filter(entry=>entry.name!=='.runtime'&&!entry.isSymbolicLink()).map(entry=>[entry.name,entry.isDirectory()]).sort((a,b)=>a[0].localeCompare(b[0])))),complete:true};}catch(error){if(error.code!=='ENOENT')throw error;target.inputVersion={kind:'directory',sha256:null,complete:true};}
 }else if(name==='browser'){
  const observed=workspace.run.events?.findLast(event=>event.type==='browser'&&(!target.path||event.detail.result?.path===target.path))?.detail.result;
  const page=target.path||observed?.path,dependencies=[];
  for(const source of observed?.sources||[])if(source.path!==page)dependencies.push({path:source.path,sha256:await fileVersion(workspace.files,source.path)});
  target.inputVersion={kind:'page',path:page,sha256:page?await fileVersion(workspace.files,page):undefined,dependencies,
   // A capture counter increments even when nothing rendered has changed. It
   // cannot make repeated opens/inspections into new work. Interactions can use
   // the actual prior pixels/DOM to distinguish a real changed page state.
   ...((target.operation||'open')==='open'?{}:{rendered:observed?.sha256,dom:observed?.dom?hash(JSON.stringify(stable(observed.dom))):undefined}),complete:true};
 }
 return stable(target);
}
module.exports={action,normalize:action,normalized:action,identity,fingerprint,stable,fileVersion};

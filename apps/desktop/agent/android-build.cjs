const path=require('node:path');
const {resolveFile}=require('./workspace.cjs');
const active=new Set();
function tasksFor(action){
 const tasks=action.tasks||[':app:assembleDebug',':app:testDebugUnitTest',':app:lintDebug'];
 if(!Array.isArray(tasks)||!tasks.length||tasks.length>8||tasks.some(t=>typeof t!=='string'||!/^:?(?:[A-Za-z0-9_-]+:)*[A-Za-z][A-Za-z0-9_]*$/.test(t)))throw Error('构建 tasks 必须是 1–8 个 Gradle 任务名称，不能包含选项或 shell 命令');
 return tasks;
}
function diagnostics(result){
 const lines=[result.output,result.stderr].filter(v=>typeof v==='string').join('\n').split(/\r?\n/);
 const errors=[...new Set(lines.map(l=>l.trim()).filter(l=>/^(?:e:|error:|.*?\berror:|Execution failed for task|> .*?(?:failed|error|Could not|Cannot)|Could not resolve|Caused by:)/i.test(l)))];
 const selected=[];let chars=0;
 for(const line of errors){if(selected.length>=30||chars>=6000)break;const text=line.slice(0,Math.min(1000,6000-chars));selected.push(text);chars+=text.length;}
 return {errors:selected,errorCount:errors.length,errorsTruncated:selected.length<errors.length||selected.some((line,i)=>line.length<errors[i].length)};
}
async function inputIdentity(root,action,{snapshot,environment,testTrustedWrapper}={}){
 const cache=require('./build-cache.cjs');
 return cache.input(root,tasksFor(action),snapshot||await sourceSnapshot(root,{testTrustedWrapper}),environment||await cache.environmentSnapshot(root),{testTrustedWrapper});
}
async function buildAndroid(root,action,signal,{onStatus,onOutput,authorizeBuild,cacheDirectory,runBuildCommand,environmentSnapshot,testTrustedWrapper}={}) {
 const tasks=tasksFor(action),fs=require('node:fs/promises');
 root=await fs.realpath(root);
 if(!authorizeBuild||!await authorizeBuild(root,signal))throw Object.assign(Error('尚未授权当前项目使用标准 Android 构建环境，任务已保留。'),{code:'ANDROID_PERMISSION'});
 if(signal.aborted)throw Error('已停止执行');
 if(active.has(root))throw Error('当前项目已有构建正在运行，请等待或停止该任务后重试');
 await fs.access(await resolveFile(root,'gradlew'));
 if(action.path&&action.path!=='.')throw Error('Android 构建只支持当前项目根目录');
 active.add(root);
 try {
  // Test-only trust is a function capability paired with a stub executor. It
  // is never read from model actions and runAgent does not forward it.
  const testInputs={testTrustedWrapper:typeof runBuildCommand==='function'&&typeof testTrustedWrapper==='function'?testTrustedWrapper:undefined};
  const cache=require('./build-cache.cjs'),state=await cache.assertReady(root,cacheDirectory),before=await sourceSnapshot(root,testInputs),environment=await (environmentSnapshot||cache.environmentSnapshot)(root),identity=await inputIdentity(root,action,{snapshot:before,environment,...testInputs});
  const reused=await cache.reusable(root,state,identity);if(reused){onStatus?.('已核对相同输入的成功构建，正在复用现有产物与检查结果');return reused;}
  onStatus?.('正在使用标准 Gradle 构建与验证（最长 20 分钟，可停止）…');
  await cache.started(root,cacheDirectory,state,identity);
  let result;
  try{result=await (runBuildCommand||require('./tools.cjs').runCommand)(root,'/bin/sh ./gradlew --no-daemon --no-watch-fs --console=plain '+tasks.join(' '),signal,20*60*1000,{build:true,onOutput:(output,metadata)=>{onOutput?.(output,metadata);onStatus?.('Gradle：'+output.split(/\r?\n/).filter(Boolean).at(-1)?.slice(0,240));}});}catch(error){if(error.notExecuted)await cache.finished(root,cacheDirectory,state,identity,{exitCode:1});else await cache.uncertain(root,cacheDirectory,state);throw error;}
  if(result.timedOut){await cache.uncertain(root,cacheDirectory,state);return {...result,tasks,verification:'gradle',cacheKey:identity.key};}
  // Command completion is known even if artifact inspection fails afterwards.
  await cache.finished(root,cacheDirectory,state,identity,{exitCode:1});
  const evidence=result.exitCode===0?await buildEvidence(root,tasks,before,testInputs):{},afterEnvironment=await (environmentSnapshot||cache.environmentSnapshot)(root);
  const response={...result,command:'/bin/sh ./gradlew --no-daemon --no-watch-fs --console=plain '+tasks.join(' '),...evidence,...diagnostics(result),tasks,verification:'gradle',reused:false,cacheKey:identity.key,buildEnvironmentChanged:afterEnvironment.signature!==environment.signature,notice:result.exitCode===0?'所列 Gradle 任务已成功；buildArtifacts 提供本次任务对应的 APK 文件证据，不代表安装、功能或视觉验收通过。':'标准构建未通过。根据日志修复或说明环境阻塞，不要改用手工拼装 APK 冒充完整构建。'};
  if(!identity.complete){response.buildRevisionRequired=true;delete response.buildInputs;}
  if(response.buildEnvironmentChanged)response.buildInputsChanged=true;
  else await cache.finished(root,cacheDirectory,state,identity,response);
  return response;
 }finally{active.delete(root);}
}
function compilationPath(relative){
 return /(?:^|\/)(?:src|res|assets|buildSrc|build-logic|gradle)(?:\/|$)/.test(relative)||/(?:^|\/)(?:[^/]+\.gradle(?:\.kts)?|gradle\.properties|local\.properties|gradlew(?:\.bat)?|AndroidManifest\.xml|CMakeLists\.txt|[^/]+\.(?:kt|kts|java|aidl|c|cc|cpp|h|hpp|cmake|pro|jks|keystore))$/.test(relative);
}
function sourcePriority(relative){
 // These names only affect scheduling. They are never silently excluded from
 // full input coverage: an arbitrary Gradle script may read a design file too.
 if(/^(?:\.ailo-materials|sketch_output|designs?|imgs|\.gradle-home)(?:\/|$)/i.test(relative))return 2;
 return compilationPath(relative)||/^app(?:\/|$)/.test(relative)?0:1;
}
async function sourceSnapshot(root,{testTrustedWrapper}={}){
 const fs=require('node:fs/promises'),proof=require('./evidence.cjs'),metadata=require('./file-state.cjs').isMetadataPath,files=[],candidates=[],queue=[''];let complete=true,compilationUncertain=false,visited=0,bytes=0,omitted=0,omittedCompilation=0;
 // Discover paths before hashing. A broad design tree must not spend the byte
 // budget before conventional application sources are even considered.
 while(queue.length&&visited<4000){
  queue.sort((a,b)=>sourcePriority(a)-sourcePriority(b)||a.localeCompare(b));const dir=queue.shift();
  const entries=(await fs.readdir(dir?await resolveFile(root,dir):root,{withFileTypes:true})).sort((a,b)=>sourcePriority((dir?dir+'/':'')+a.name)-sourcePriority((dir?dir+'/':'')+b.name)||a.name.localeCompare(b.name));
  for(const item of entries){
   if(item.isFile()&&metadata(item.name))continue;
   if(++visited>4000){complete=false;break;}
   if(item.name==='node_modules'){complete=false;continue;}
   if(['build','.gradle','.git','.runtime','.ailo-observations'].includes(item.name)||!dir&&item.name==='verification')continue;
   const relative=dir?dir+'/'+item.name:item.name;
   if(item.isSymbolicLink()){complete=false;compilationUncertain=true;continue;}
   if(item.isDirectory()){queue.push(relative);continue;}
   if(item.isFile())candidates.push(relative);
  }
 }
 const traversalComplete=visited<=4000&&!queue.length;
 candidates.sort((a,b)=>Number(compilationPath(b))-Number(compilationPath(a))||sourcePriority(a)-sourcePriority(b)||a.localeCompare(b));
 for(const relative of candidates){
  const file=await resolveFile(root,relative),stat=await fs.stat(file);
  if(stat.size>20*1024*1024||bytes+stat.size>64*1024*1024){complete=false;omitted++;if(compilationPath(relative))omittedCompilation++;continue;}
  bytes+=stat.size;files.push({path:relative,sha256:await proof.hashFile(file)});
 }
 files.sort((a,b)=>a.path.localeCompare(b.path));
 const localFilesComplete=complete&&traversalComplete,scriptInputsKnown=await require('./build-cache.cjs').knownInputs(root,files,{testTrustedWrapper});
 return {files,complete:localFilesComplete&&scriptInputsKnown,
  compilation:{version:1,coverage:'conventional_inputs',files:files.filter(file=>compilationPath(file.path)),complete:traversalComplete&&!compilationUncertain&&omittedCompilation===0},
  coverage:{visitedEntries:visited,discoveredFiles:candidates.length,sampledBytes:bytes,omittedFiles:omitted,omittedCompilationFiles:omittedCompilation,traversalComplete,localFilesComplete,scriptInputsKnown}};
}
async function buildEvidence(root,tasks,before,{testTrustedWrapper}={}){
 const fs=require('node:fs/promises'),proof=require('./evidence.cjs'),after=await sourceSnapshot(root,{testTrustedWrapper}),artifacts=[],queue=[''];let visited=0;
 while(queue.length&&visited<5000){
  const dir=queue.shift();
  for(const item of await fs.readdir(dir?await resolveFile(root,dir):root,{withFileTypes:true})){
   if(++visited>5000)break;
   if(item.isSymbolicLink()||['.gradle','.git','.runtime','node_modules'].includes(item.name))continue;
   const relative=dir?dir+'/'+item.name:item.name;
   if(item.isDirectory()){
    if(!relative.includes('/build/')||/\/build\/outputs(?:\/apk(?:\/.*)?)?$/.test(relative))queue.push(relative);
    continue;
   }
   if(item.name!=='output-metadata.json'||!relative.includes('/build/outputs/apk/'))continue;
   const file=await resolveFile(root,relative);if((await fs.stat(file)).size>128000)throw Error('APK产物元数据超过限制');
   const metadata=JSON.parse(await fs.readFile(file,'utf8')),module=relative.split('/build/')[0].replaceAll('/',':');
   if(typeof metadata.variantName!=='string'||!Array.isArray(metadata.elements))continue;
   const matches=tasks.some(task=>{
    const parts=task.replace(/^:/,'').split(':'),name=parts.pop();
    if(parts.length&&parts.join(':')!==module)return false;
    if(['build','assemble'].includes(name))return true;
    const variant=name.match(/^(?:assemble|package)([A-Z].*)$/)?.[1];
    return variant&&metadata.variantName.toLowerCase()===variant.toLowerCase();
   });
   if(!matches)continue;
   for(const entry of metadata.elements){
    if(typeof entry.outputFile!=='string'||!/^[^/\\]+\.apk$/.test(entry.outputFile))throw Error('APK产物路径无效');
    const relativeApk=dir+'/'+entry.outputFile,apk=await resolveFile(root,relativeApk),stat=await fs.stat(apk);
    if(!stat.isFile()||stat.size<=0||stat.size>150*1024*1024)throw Error('APK产物无效或超过150MB');
    artifacts.push({path:relativeApk,sha256:await proof.hashFile(apk),size:stat.size});
   }
  }
 }
 const complete=before.complete&&after.complete&&JSON.stringify(before.files)===JSON.stringify(after.files),compilationChanged=before.compilation?.complete&&after.compilation?.complete&&JSON.stringify(before.compilation.files)!==JSON.stringify(after.compilation.files);
 return {sources:[...after.files,...artifacts.map(({path,sha256})=>({path,sha256}))],buildInputs:complete?after.files.map(f=>f.path):undefined,buildCompilationInputs:after.compilation,buildInputCoverage:after.coverage,buildInputsChanged:!!compilationChanged||before.complete&&after.complete&&JSON.stringify(before.files)!==JSON.stringify(after.files),buildRevisionRequired:!complete,buildArtifacts:artifacts,scopes:artifacts.map(a=>({kind:'file',path:a.path}))};
}
module.exports={buildAndroid,tasksFor,diagnostics,sourceSnapshot,buildEvidence,inputIdentity,compilationPath};

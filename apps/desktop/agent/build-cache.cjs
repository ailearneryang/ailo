const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {resolveFile,writeJson}=require('./workspace.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const memory=new Map();
const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,stable(value[key])]))):value;
async function stamp(file,content=false){
 try{const stat=await fs.stat(file);if(!stat.isFile())return null;return {size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,mode:stat.mode,...(content&&stat.size<=1024*1024?{sha256:hash(await fs.readFile(file))}:{})};}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
// Fingerprint the effective isolated build environment without executing host
// commands or reading user credentials. SDK package versions and binaries change
// this signature even if their installation paths stay the same.
async function environmentSnapshot(root){
 const {sdk,javaHome}=await require('./android-environment.cjs').androidEnvironment();
 const files=[],packages=[];let complete=!!sdk&&!!javaHome,cacheable=true;
 if(javaHome)for(const name of ['release','bin/java','lib/modules'])files.push({path:'jdk/'+name,stamp:await stamp(path.join(javaHome,name),name==='release')});
 if(sdk){
  packages.push('platform-tools');
  for(const directory of ['platforms','build-tools','cmdline-tools']){
   try{const entries=await fs.readdir(path.join(sdk,directory),{withFileTypes:true});if(entries.length>128)complete=false;for(const entry of entries.slice(0,128)){if(entry.isSymbolicLink()){complete=false;continue;}if(entry.isDirectory())packages.push(directory+'/'+entry.name);}}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  for(const directory of packages)for(const name of ['source.properties','android.jar','aapt','aapt2','d8','zipalign','apksigner','lib/d8.jar']){
   const info=await stamp(path.join(sdk,directory,name),name==='source.properties');if(info)files.push({path:'sdk/'+directory+'/'+name,stamp:info});
  }
 }
 // GRADLE_USER_HOME is isolated by runCommand; its explicit init/properties
 // configuration is input too. Dependency caches themselves are not credentials.
 for(const name of ['gradle.properties','init.gradle','init.gradle.kts']){const info=await stamp(path.join(root,'.runtime/gradle',name),true);if(info){files.push({path:'gradle-user/'+name,stamp:info});if(name!=='gradle.properties')cacheable=false;}}
 try{const entries=await fs.readdir(path.join(root,'.runtime/gradle/init.d'),{withFileTypes:true});if(entries.length>128)complete=false;for(const entry of entries.slice(0,128)){if(entry.isSymbolicLink()){complete=false;cacheable=false;continue;}if(entry.isFile()){cacheable=false;const info=await stamp(path.join(root,'.runtime/gradle/init.d',entry.name),true);files.push({path:'gradle-user/init.d/'+entry.name,stamp:info});}}}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const name of ['android-build.cjs','tools.cjs','android-environment.cjs'])files.push({path:'runtime/'+name,sha256:hash(await fs.readFile(path.join(__dirname,name)))});
 files.sort((a,b)=>a.path.localeCompare(b.path));
 return {complete,cacheable,sdk:sdk||null,javaHome:javaHome||null,signature:hash(JSON.stringify(stable({version:1,sdk,javaHome,files,platform:process.platform,arch:process.arch,commandVersion:1})))};
}
// This is deliberately a tiny declarative subset, not a Gradle interpreter.
// Unknown identifiers/code, interpolation, file APIs and custom build logic opt
// out of reuse; full local coverage cannot prove arbitrary script inputs.
const declarativeWords=new Set(('plugins id version apply false true repositories google mavenCentral gradlePluginPortal maven url dependencies implementation api testImplementation androidTestImplementation runtimeOnly compileOnly annotationProcessor kapt ksp android namespace compileSdk compileSdkVersion defaultConfig applicationId minSdk minSdkVersion targetSdk targetSdkVersion versionCode versionName testInstrumentationRunner buildTypes debug release minifyEnabled isMinifyEnabled compileOptions sourceCompatibility targetCompatibility JavaVersion VERSION_1_8 VERSION_11 VERSION_17 VERSION_21 kotlinOptions jvmTarget rootProject name include pluginManagement dependencyResolutionManagement repositoriesMode set RepositoriesMode FAIL_ON_PROJECT_REPOS PREFER_SETTINGS PREFER_PROJECT group description').split(' '));
function declarativeGradle(text){
 for(let i=0;i<text.length;){
  const c=text[i];if(/\s/.test(c)){i++;continue;}
  if(text.startsWith('//',i)){const end=text.indexOf('\n',i+2);i=end<0?text.length:end+1;continue;}
  if(text.startsWith('/*',i)){const end=text.indexOf('*/',i+2);if(end<0)return false;i=end+2;continue;}
  if(c==='"'||c==="'"){
   const quote=c;if(text.startsWith(quote.repeat(3),i))return false;let closed=false;i++;
   for(;i<text.length;i++){if(text[i]==='$')return false;if(text[i]==='\\'){i++;continue;}if(text[i]===quote){i++;closed=true;break;}}
   if(!closed)return false;continue;
  }
  const word=text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];if(word){if(!declarativeWords.has(word))return false;
   // A local Maven repository may read arbitrary files outside the project;
   // computed URLs likewise have no established input version.
   if(word==='url'&&!/^\s*(?:=\s*)?(?:\(\s*)?(['"])https:\/\/[^'"\s]+\1/.test(text.slice(i+word.length)))return false;
   i+=word.length;continue;}
  if(/[0-9{}().,=;]/.test(c)){i++;continue;}return false;
 }
 return true;
}
async function knownInputs(root,files,{testTrustedWrapper}={}){
 // The wrapper is executable project code too. Hashing arbitrary shell bytes
 // does not establish everything they may read from excluded runtime/cache
 // directories. Production has no trusted-wrapper allowlist. Tests can inject
 // a function through direct APIs and bind it to their exact fixture hash.
 for(const wrapper of files.filter(file=>/^gradlew(?:\.bat)?$/.test(file.path)))if(typeof testTrustedWrapper!=='function'||await testTrustedWrapper({path:wrapper.path,sha256:wrapper.sha256})!==true)return false;
 if(files.some(file=>/(?:^|\/)(?:buildSrc|build-logic)(?:\/|$)/.test(file.path)))return false;
 // Dynamic dependencies deliberately request new remote resolution; their inputs
 // cannot be established from a bounded local snapshot.
 for(const source of files.filter(file=>/(?:\.gradle(?:\.kts)?|gradle\.properties|libs\.versions\.toml)$/.test(file.path))){
  const file=await resolveFile(root,source.path),stat=await fs.stat(file);if(stat.size>2*1024*1024)return false;
  const text=await fs.readFile(file,'utf8');if(/SNAPSHOT|latest\.(?:release|integration)|(?:version\s*(?:=|:)|:[\w.-]+:)\s*['"]?[^\s'"\n]*\+/i.test(text))return false;
  if(/\.gradle(?:\.kts)?$/.test(source.path)&&!declarativeGradle(text))return false;
 }
 return true;
}
async function cacheable(root,tasks,snapshot,options){return snapshot.complete&&tasks.every(task=>/^(?:assemble\w*|test\w*UnitTest|lint\w*|compile\w*)$/.test(task.split(':').at(-1)))&&await knownInputs(root,snapshot.files,options);}
async function input(root,tasks,snapshot,environment,options){
 // Scan counters are diagnostics, not build inputs (creating an excluded build
 // directory or Finder metadata cannot alter a source identity).
 const sourceSignature=hash(JSON.stringify(stable({files:snapshot.files,complete:snapshot.complete,compilation:snapshot.compilation}))),environmentSignature=environment.signature;
 return {key:hash(JSON.stringify({version:3,tasks,sourceSignature,environmentSignature})),complete:snapshot.complete&&environment.complete&&environment.cacheable!==false,sourceSignature,environmentSignature,cacheable:snapshot.complete&&environment.complete&&environment.cacheable!==false&&await cacheable(root,tasks,snapshot,options)};
}
async function readState(root,directory){
 if(!directory)return memory.get(root)||{version:1,records:[]};
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const file=await resolveFile(directory,'state.json');
 try{const state=JSON.parse(await fs.readFile(file,'utf8'));if(state?.version!==1||!Array.isArray(state.records))throw Error('invalid build state');return state;}catch(error){if(error.code==='ENOENT')return {version:1,records:[]};throw Object.assign(Error('标准构建状态记录无法核对，禁止自动重放；请检查已有构建输出与记录。'),{code:'ACTION_RESULT_UNKNOWN',cause:error});}
}
async function saveState(root,directory,state){
 if(!directory){memory.set(root,state);if(memory.size>64){const candidate=[...memory].find(([,value])=>!value.pending);if(candidate)memory.delete(candidate[0]);}return;}
 await fs.mkdir(directory,{recursive:true,mode:0o700});await writeJson(await resolveFile(directory,'state.json'),state);
}
async function assertReady(root,directory){
 const state=await readState(root,directory);
 if(state.pending)throw Object.assign(Error('此前标准构建已中断且结果尚未核对，禁止自动重放。请先检查构建日志和产物；已完成的操作不能因续跑而重新执行。'),{code:'ACTION_RESULT_UNKNOWN',buildKey:state.pending.key});
 return state;
}
async function reusable(root,state,identity){
 if(!identity.cacheable||!identity.complete)return null;
 const record=state.records.find(entry=>entry.key===identity.key);if(!record)return null;
 const result=record.result;
 if(result?.exitCode!==0||result.timedOut||result.buildRevisionRequired||result.buildInputsChanged||!Array.isArray(result.sources)||!result.sources.length)return null;
 try{for(const source of result.sources)if(await require('./evidence.cjs').hashFile(await resolveFile(root,source.path))!==source.sha256)return null;}catch{return null;}
 return {...structuredClone(result),reused:true,changed:false,cacheKey:identity.key,originalBuildAt:record.at,notice:'复用相同完整源码、构建环境和任务的成功标准构建；当前产物哈希已核对。'+(result.notice||'')};
}
async function started(root,directory,state,identity){state.pending={key:identity.key,status:'running',at:new Date().toISOString()};await saveState(root,directory,state);}
async function finished(root,directory,state,identity,result){
 delete state.pending;
 if(identity.cacheable&&result.exitCode===0&&!result.timedOut&&!result.buildRevisionRequired&&!result.buildInputsChanged){state.records=state.records.filter(entry=>entry.key!==identity.key).concat({key:identity.key,at:new Date().toISOString(),result:structuredClone(result)}).slice(-4);}
 await saveState(root,directory,state);
}
async function uncertain(root,directory,state){if(state.pending){state.pending.status='unknown';await saveState(root,directory,state);}}
module.exports={environmentSnapshot,input,assertReady,reusable,started,finished,uncertain,knownInputs};

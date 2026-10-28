// Fixed end-to-end specification. Private source material is supplied explicitly
// at execution time; this file contains no real user task, API token or appId.
const fs=require('node:fs/promises'),path=require('node:path');
const {hash}=require('./agent-eval-config.cjs');
const rubric=Object.freeze([
 '完整Android工程经标准Gradle构建成功，APK可安装启动且无已知崩溃',
 '真实天气接口的成功、空数据、业务错误、超时均有明确可验证行为，不把旧数据冒充新数据',
 '城市搜索、选择、页面跳转和手册HTML按输入要求工作',
 '原稿目标画板与当前APK截图绑定，逐区域核对布局、间距、字体、图片、卡片及底部控件',
 '动态字段可以变化，但不得省略原稿组件、空态或失败态',
 '已知缺陷不得使用受限交付或待人工核验冒充完整交付',
 '工程、APK、当前运行证据、验证报告和使用说明可检查',
]);
const spec=Object.freeze({id:'weather-app-e2e-v1',rubric,metrics:['correct_unassisted_completion','active_and_calendar_elapsed_ms','time_to_first_runnable_artifact','model_requests','no_action_ms','process_model_ms','protocol_failures','same_failure_fingerprint_repeats','resume_outcome','false_completion'],strata:{cold:'每次新的项目与空Gradle缓存；新的项目AVD',warm:'每次新的项目，显式选定Gradle缓存种子；新的项目AVD，不宣称模拟器热启动'},grading:'机器独立功能检查与人工逐区域验收分别记录；尚未判定不能报告正确完成率'});
async function safeFile(root,relative,maxBytes=20*1024*1024){
 const file=await require('../apps/desktop/agent/workspace.cjs').resolveFile(root,relative),stat=await fs.stat(file);
 if(!stat.isFile()||stat.size===0||stat.size>maxBytes)throw Error('Benchmark material must be a nonempty regular file within its bounded size limit');return file;
}
async function fixture(materialsDirectory,environmentDirectory,stratum='cold'){
 const root=await fs.realpath(path.resolve(materialsDirectory)),environment=await require('./agent-eval-config.cjs').canonicalPath(environmentDirectory);
 if(environment===root||environment.startsWith(root+path.sep)||root.startsWith(environment+path.sep))throw Error('Benchmark environment and private materials must be separate directories');
 const manifest=JSON.parse(await fs.readFile(await safeFile(root,'benchmark.json'),'utf8'));
 if(manifest.id!==spec.id||!Array.isArray(manifest.materials)||manifest.materials.length<3||manifest.materials.length>20)throw Error('Weather benchmark.json requires id=weather-app-e2e-v1 and explicit materials');
 if(['requirements','api','design'].some(role=>!manifest.materials.some(m=>m.role===role)))throw Error('Weather benchmark requires requirements, api and design material roles');
 if(!['raw','prepared'].includes(manifest.designInput||'raw'))throw Error('designInput must be raw or prepared');
 const files=[],names=new Set();let totalBytes=0;
 for(const entry of manifest.materials){
  if(!['requirements','api','design','reference','prepared'].includes(entry.role)||typeof entry.path!=='string'||names.has(entry.path))throw Error('Invalid or duplicate weather material entry');names.add(entry.path);
  const file=await safeFile(root,entry.path,/\.sketch$/i.test(entry.path)?100*1024*1024:20*1024*1024),stat=await fs.stat(file);
  totalBytes+=stat.size;if(totalBytes>200*1024*1024)throw Error('Benchmark material set exceeds 200MB');
  const bytes=await fs.readFile(file);files.push({path:entry.path,role:entry.role,file,sha256:hash(bytes),size:bytes.length});
 }
 let skill;
 if(manifest.skillArchive){const file=await safeFile(root,manifest.skillArchive);if(!/\.zip$/i.test(file))throw Error('sketch-render skill must be an explicitly supplied ZIP package');skill={file,path:manifest.skillArchive,sha256:hash(await fs.readFile(file))};}
 if((manifest.designInput||'raw')==='prepared'&&!files.some(f=>f.role==='prepared'))throw Error('Prepared design stratum requires explicit prepared material files');
 if(manifest.request!==undefined&&(typeof manifest.request!=='string'||!manifest.request.trim()||manifest.request.length>24000))throw Error('Explicit benchmark request must contain 1–24000 characters');
 let seed,environmentFingerprint='empty-gradle-cache-fresh-project-avd';
 if(stratum==='warm'){
  seed=path.join(environment,'gradle-cache');const stat=await fs.lstat(seed);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Warm stratum needs an explicit regular environment/gradle-cache seed directory');environmentFingerprint=await cacheFingerprint(seed);
 }
 const materialFingerprint=hash({files:files.map(({path,role,sha256})=>({path,role,sha256})),skill:skill?.sha256,designInput:manifest.designInput||'raw',request:manifest.request?hash(manifest.request):undefined});
 return {id:'weather-app-'+(manifest.designInput||'raw'),category:'weather',materialFingerprint,environmentFingerprint,outputs:['app/build/outputs/apk/debug/app-debug.apk'],rubric:[...rubric],privateMaterials:files,skill,environment,seed,request:manifest.request||'根据所附需求、Sketch设计稿和API文档完成天气App。按材料规定接入真实数据，交付完整Android工程、标准Gradle构建的可运行APK、模拟器实际操作和截图、验证报告与使用说明。逐区域核对设计，并检查城市搜索、页面跳转和手册HTML。完成前修复已确认缺陷；没有凭据、环境或证据时明确保留阻塞，不伪造数据或验收。'+(skill?'使用所选sketch-render技能解析原稿。':'')};
}
async function cacheFingerprint(source){
 const entries=[];let bytes=0;
 async function scan(dir,relative=''){for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name),name=relative?relative+'/'+entry.name:entry.name,stat=await fs.lstat(file);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink>1)throw Error('Cache seed must not contain symbolic or hard links');if(entry.isDirectory())await scan(file,name);else if(entry.isFile()){bytes+=stat.size;if(entries.length>=30000||bytes>5*1024**3)throw Error('Cache seed exceeds bounded benchmark inventory');const digest=require('node:crypto').createHash('sha256');for await(const chunk of require('node:fs').createReadStream(file))digest.update(chunk);entries.push([name,stat.size,digest.digest('hex')]);}else throw Error('Cache seed contains a non-regular entry');}}
 await scan(source);return hash(entries);
}
async function seedCache(source,destination,expected){
 // Never follow a cache link into the user's real Gradle home or another task.
 const before=await cacheFingerprint(source);if(expected&&before!==expected)throw Error('Warm cache seed changed after preflight');await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.cp(source,destination,{recursive:true,errorOnExist:true,force:false});if(await cacheFingerprint(destination)!==before)throw Error('Warm cache seed changed during copy');
}
module.exports={spec,fixture,seedCache,cacheFingerprint};
if(require.main===module){
 (async()=>{const argv=process.argv.slice(2),get=name=>{const i=argv.indexOf(name);return i<0?undefined:argv[i+1];};if(!argv.includes('--preflight'))throw Error('Use Electron scripts/agent-live-eval.cjs --suite weather for execution; this entrypoint only supports --preflight');
 const f=await fixture(get('--materials-dir'),get('--environment-dir'),get('--stratum')||'cold');console.log(JSON.stringify({preflight:true,modelRequests:0,spec:spec.id,case:f.id,materialFingerprint:f.materialFingerprint,materials:f.privateMaterials.length,skill:!!f.skill,stratum:get('--stratum')||'cold',rubric},null,2));})().catch(e=>{console.error(e.message);process.exitCode=1;});
}

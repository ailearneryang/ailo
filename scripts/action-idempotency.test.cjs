const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const tools=require('../apps/desktop/agent/tools.cjs'),identity=require('../apps/desktop/agent/action-identity.cjs');
const build=require('../apps/desktop/agent/android-build.cjs');
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-idempotency-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return {base,w:await createWorkspace(base,{id:'t',request:'构建天气说明'})};}
const signal=()=>new AbortController().signal;
const trustedWrapper=content=>({path,sha256})=>path==='gradlew'&&sha256===require('../apps/desktop/agent/evidence.cjs').hash(content);
async function apk(root,variant='debug',content='valid fixture APK'){
 const directory=path.join(root,'app/build/outputs/apk',variant);await fs.mkdir(directory,{recursive:true});
 await fs.writeFile(path.join(directory,'output-metadata.json'),JSON.stringify({variantName:variant,elements:[{outputFile:'app-'+variant+'.apk'}]}));
 const file=path.join(directory,'app-'+variant+'.apk');await fs.writeFile(file,content);return file;
}
async function builder(t){
 const {base,w}=await fixture(t);await fs.writeFile(path.join(w.files,'gradlew'),'fixture wrapper');await fs.writeFile(path.join(w.files,'Main.kt'),'original source');
 let commands=0,authorizations=0,environment='env-1';const outputs=[];
 const options={testTrustedWrapper:trustedWrapper('fixture wrapper'),cacheDirectory:path.join(base,'trusted-build-cache'),authorizeBuild:async()=>{authorizations++;return true;},environmentSnapshot:async()=>({complete:true,signature:environment}),onOutput:output=>outputs.push(output),runBuildCommand:async(root,command,_signal,_timeout,options)=>{commands++;await apk(root,command.includes('assembleRelease')?'release':'debug','APK '+commands);options.onOutput?.('BUILD SUCCESSFUL',{truncated:false});return {exitCode:0,output:'BUILD SUCCESSFUL',stdout:'BUILD SUCCESSFUL',stderr:'',timedOut:false};}};
 return {base,w,options,outputs,commands:()=>commands,authorizations:()=>authorizations,setEnvironment:value=>{environment=value;}};
}
test('same-byte write is a no-op with a stable version and preserved backup',async t=>{
 const {w}=await fixture(t),a={action:'write_file',path:'same.txt',content:'before'};
 const first=await tools.execute(w,a,signal());assert.equal(first.changed,true);assert.equal(first.sha256,first.version);
 const second=await tools.execute(w,{...a,content:'after'},signal());assert.equal(second.changed,true);assert.notEqual(second.sha256,first.sha256);
 const file=path.join(w.files,'same.txt'),before=await fs.stat(file),backups=await fs.readdir(path.join(w.project,'backups'));
 assert.equal(backups.length,1);const backup=path.join(w.project,'backups',backups[0]),backupStat=await fs.stat(backup);
 const same=await tools.execute(w,{...a,content:'after'},signal());assert.equal(same.changed,false);assert.equal(same.version,second.version);assert.equal(same.bytes,5);
 assert.equal((await fs.stat(file)).mtimeMs,before.mtimeMs);assert.equal((await fs.stat(backup)).mtimeMs,backupStat.mtimeMs);assert.equal(await fs.readFile(backup,'utf8'),'before');
});
test('action and failure identities ignore bookkeeping and bind actual target bytes rather than global revision',async t=>{
 const {w}=await fixture(t),a={action:'read_file',path:'./source.txt',purpose:'first',progress:{memory:'first'},stepId:'first'};
 await fs.writeFile(path.join(w.files,'source.txt'),'version one');const first=await identity.identity(w,a);w.run.revision+=20;
 const same=await identity.identity(w,{...a,path:'source.txt',purpose:'second',progress:{memory:'entirely different'},stepId:'second',conversationTitle:'display only'});
 assert.equal(identity.fingerprint(first),identity.fingerprint(same));assert.equal(JSON.parse(identity.fingerprint(first)).action,'read_file');
 await fs.writeFile(path.join(w.files,'source.txt'),'version two');assert.notEqual(identity.fingerprint(first),identity.fingerprint(await identity.identity(w,a)));
 const missing={action:'read_file',path:'missing.txt'};assert.equal(identity.fingerprint(await identity.identity(w,missing)),identity.fingerprint(await identity.identity(w,{...missing,progress:{steps:[{id:'new',status:'running'}]}})));
});
test('complete source, tasks and environment are separate stable build inputs',async t=>{
 const {w}=await fixture(t);await fs.writeFile(path.join(w.files,'gradlew'),'wrapper');
 const a={tasks:[':app:assembleDebug']},environment={complete:true,signature:'environment-one'},testTrustedWrapper=trustedWrapper('wrapper');
 const first=await build.inputIdentity(w.files,a,{environment,testTrustedWrapper});w.run.revision+=10;
 assert.equal(first.key,(await build.inputIdentity(w.files,a,{environment,testTrustedWrapper})).key);assert.equal(first.complete,true);
 assert.notEqual(first.key,(await build.inputIdentity(w.files,{tasks:[':app:assembleRelease']},{environment,testTrustedWrapper})).key);
 assert.notEqual(first.key,(await build.inputIdentity(w.files,a,{environment:{...environment,signature:'environment-two'},testTrustedWrapper})).key);
 await fs.writeFile(path.join(w.files,'new-source.kt'),'new input');assert.notEqual(first.key,(await build.inputIdentity(w.files,a,{environment,testTrustedWrapper})).key);
});
test('browser capture counters cannot bypass deduplication while actual page and resource changes can',async t=>{
 const {w}=await fixture(t);await fs.writeFile(path.join(w.files,'page.html'),'<h1>Weather</h1>');await fs.writeFile(path.join(w.files,'style.css'),'body{color:blue}');
 const capture=()=>({type:'browser',detail:{result:{path:'page.html',sha256:'same pixels',dom:{fullText:'Weather'},sources:[{path:'page.html'},{path:'style.css'}]}}});
 w.run.events.push(capture());const open={action:'browser',operation:'open',path:'page.html'},inspect={action:'browser',operation:'inspect'};
 const beforeOpen=identity.fingerprint(await identity.identity(w,open)),beforeInspect=identity.fingerprint(await identity.identity(w,inspect));
 w.run.observationStates={capture:100};w.run.events.push(capture());assert.equal(beforeOpen,identity.fingerprint(await identity.identity(w,open)));assert.equal(beforeInspect,identity.fingerprint(await identity.identity(w,inspect)));
 w.run.events.at(-1).detail.result.sha256='actual changed pixels';assert.notEqual(beforeInspect,identity.fingerprint(await identity.identity(w,inspect)));assert.equal(beforeOpen,identity.fingerprint(await identity.identity(w,open)));
 await fs.writeFile(path.join(w.files,'style.css'),'body{color:red}');assert.notEqual(beforeOpen,identity.fingerprint(await identity.identity(w,open)));
});
test('same successful build reuses verified artifacts while retaining authorization and original streamed evidence',async t=>{
 const fixture=await builder(t),action={tasks:[':app:assembleDebug']};
 const first=await build.buildAndroid(fixture.w.files,action,signal(),fixture.options);await fs.writeFile(path.join(fixture.w.files,'.DS_Store'),'Finder metadata');const second=await build.buildAndroid(fixture.w.files,action,signal(),fixture.options);
 assert.equal(fixture.commands(),1);assert.equal(fixture.authorizations(),2);assert.equal(first.reused,false);assert.equal(second.reused,true);assert.equal(second.changed,false);assert.equal(second.cacheKey,first.cacheKey);
 assert.equal(second.buildArtifacts[0].sha256,first.buildArtifacts[0].sha256);assert.deepEqual(fixture.outputs,['BUILD SUCCESSFUL']);assert.equal(second.stdout,'BUILD SUCCESSFUL');
 await assert.rejects(build.buildAndroid(fixture.w.files,action,signal(),{...fixture.options,authorizeBuild:async()=>false}),error=>error.code==='ANDROID_PERMISSION');assert.equal(fixture.commands(),1);
});
test('source changes, added source, environment changes, altered artifact and tasks force a new build',async t=>{
 const fixture=await builder(t),root=fixture.w.files,action={tasks:[':app:assembleDebug']};
 await build.buildAndroid(root,action,signal(),fixture.options);
 await fs.writeFile(path.join(root,'Main.kt'),'changed source');assert.equal((await build.buildAndroid(root,action,signal(),fixture.options)).reused,false);
 await fs.writeFile(path.join(root,'new-source.kt'),'additional source');await build.buildAndroid(root,action,signal(),fixture.options);
 fixture.setEnvironment('env-2');await build.buildAndroid(root,action,signal(),fixture.options);
 await fs.writeFile(path.join(root,'app/build/outputs/apk/debug/app-debug.apk'),'externally altered');await build.buildAndroid(root,action,signal(),fixture.options);
 await build.buildAndroid(root,{tasks:[':app:assembleRelease']},signal(),fixture.options);assert.equal(fixture.commands(),6);
});
test('incomplete source coverage never permits successful build reuse',async t=>{
 const fixture=await builder(t),root=fixture.w.files,large=path.join(root,'uncovered.bin');await fs.writeFile(large,'large input');await fs.truncate(large,21*1024*1024);
 const snapshot=await build.sourceSnapshot(root);assert.equal(snapshot.complete,false);
 const first=await build.buildAndroid(root,{tasks:[':app:assembleDebug']},signal(),fixture.options),second=await build.buildAndroid(root,{tasks:[':app:assembleDebug']},signal(),fixture.options);
 assert.equal(first.buildRevisionRequired,true);assert.equal(second.reused,false);assert.equal(fixture.commands(),2);
});
test('dynamic dependency and non-build task requests are never silently cached',async t=>{
 const fixture=await builder(t),root=fixture.w.files;await fs.writeFile(path.join(root,'build.gradle'),"dependencies { implementation 'example:weather:1.+' }");
 await build.buildAndroid(root,{tasks:[':app:assembleDebug']},signal(),fixture.options);await build.buildAndroid(root,{tasks:[':app:assembleDebug']},signal(),fixture.options);assert.equal(fixture.commands(),2);
 await fs.unlink(path.join(root,'build.gradle'));await build.buildAndroid(root,{tasks:['clean']},signal(),fixture.options);await build.buildAndroid(root,{tasks:['clean']},signal(),fixture.options);assert.equal(fixture.commands(),4);
});
test('unknown build results survive reload and cannot replay even with changed tasks',async t=>{
 const fixture=await builder(t),root=fixture.w.files;let commands=0;
 const options={...fixture.options,runBuildCommand:async()=>{commands++;return {exitCode:null,timedOut:true,output:'interrupted build'};}};
 const first=await build.buildAndroid(root,{tasks:[':app:assembleDebug']},signal(),options);assert.equal(first.timedOut,true);
 delete require.cache[require.resolve('../apps/desktop/agent/build-cache.cjs')];
 await assert.rejects(build.buildAndroid(root,{tasks:[':app:assembleDebug']},signal(),options),error=>error.code==='ACTION_RESULT_UNKNOWN');
 await assert.rejects(build.buildAndroid(root,{tasks:[':app:assembleRelease']},signal(),options),error=>error.code==='ACTION_RESULT_UNKNOWN');assert.equal(commands,1);
});
test('known build failures never become reusable successful evidence',async t=>{
 const fixture=await builder(t);let commands=0;const options={...fixture.options,runBuildCommand:async()=>{commands++;return {exitCode:1,output:'error: source failure',timedOut:false};}};
 const first=await build.buildAndroid(fixture.w.files,{tasks:[':app:assembleDebug']},signal(),options),second=await build.buildAndroid(fixture.w.files,{tasks:[':app:assembleDebug']},signal(),options);
 assert.equal(commands,2);assert.equal(first.exitCode,1);assert.equal(second.reused,false);assert.deepEqual(second.errors,['error: source failure']);
});
test('a proven preflight failure does not create an unknown side effect or prevent a later valid build',async t=>{
 const fixture=await builder(t);let attempted=0;
 const options={...fixture.options,runBuildCommand:async()=>{attempted++;throw Object.assign(Error('missing build prerequisite'),{notExecuted:true});}};
 await assert.rejects(build.buildAndroid(fixture.w.files,{tasks:[':app:assembleDebug']},signal(),options),/missing build prerequisite/);assert.equal(attempted,1);
 const repaired=await build.buildAndroid(fixture.w.files,{tasks:[':app:assembleDebug']},signal(),fixture.options);assert.equal(repaired.exitCode,0);assert.equal(fixture.commands(),1);
});
test('environment changes during a build invalidate input evidence and do not cache that success',async t=>{
 const fixture=await builder(t),normal=fixture.options.runBuildCommand;
 const first=await build.buildAndroid(fixture.w.files,{tasks:[':app:assembleDebug']},signal(),{...fixture.options,runBuildCommand:async(...args)=>{const result=await normal(...args);fixture.setEnvironment('changed while building');return result;}});
 assert.equal(first.buildEnvironmentChanged,true);assert.equal(first.buildInputsChanged,true);
 const second=await build.buildAndroid(fixture.w.files,{tasks:[':app:assembleDebug']},signal(),fixture.options);assert.equal(second.reused,false);assert.equal(fixture.commands(),2);
});
test('excluded node_modules inputs and an unconfirmed environment prohibit build-cache reuse',async t=>{
 const fixture=await builder(t),root=fixture.w.files;await fs.mkdir(path.join(root,'node_modules'));assert.equal((await build.sourceSnapshot(root)).complete,false);
 await build.buildAndroid(root,{tasks:[':app:assembleDebug']},signal(),fixture.options);await build.buildAndroid(root,{tasks:[':app:assembleDebug']},signal(),fixture.options);assert.equal(fixture.commands(),2);
 await fs.rmdir(path.join(root,'node_modules'));const options={...fixture.options,environmentSnapshot:async()=>({complete:false,signature:'incomplete environment'})};
 await build.buildAndroid(root,{tasks:[':app:assembleDebug']},signal(),options);await build.buildAndroid(root,{tasks:[':app:assembleDebug']},signal(),options);assert.equal(fixture.commands(),4);
});
test('environment fingerprint tracks SDK/JDK versions, executable permissions and isolated Gradle configuration',async t=>{
 const {base,w}=await fixture(t),sdk=path.join(base,'sdk'),javaHome=path.join(base,'jdk');
 for(const name of ['bin','lib'])await fs.mkdir(path.join(javaHome,name),{recursive:true});
 await fs.writeFile(path.join(javaHome,'release'),'JAVA_VERSION=17');await fs.writeFile(path.join(javaHome,'bin/java'),'java fixture');await fs.writeFile(path.join(javaHome,'lib/modules'),'module fixture');
 await fs.mkdir(path.join(sdk,'build-tools/35'),{recursive:true});await fs.writeFile(path.join(sdk,'build-tools/35/source.properties'),'Pkg.Revision=35');await fs.writeFile(path.join(sdk,'build-tools/35/aapt2'),'tool fixture');
 const module=require('../apps/desktop/agent/android-environment.cjs'),original=module.androidEnvironment;module.androidEnvironment=async()=>({sdk,javaHome});t.after(()=>{module.androidEnvironment=original;});
 const cache=require('../apps/desktop/agent/build-cache.cjs'),first=await cache.environmentSnapshot(w.files);assert.equal(first.complete,true);
 await fs.writeFile(path.join(javaHome,'release'),'JAVA_VERSION=21');const second=await cache.environmentSnapshot(w.files);assert.notEqual(second.signature,first.signature);
 await fs.chmod(path.join(sdk,'build-tools/35/aapt2'),0o700);const third=await cache.environmentSnapshot(w.files);assert.notEqual(third.signature,second.signature);
 await fs.mkdir(path.join(w.files,'.runtime/gradle'),{recursive:true});await fs.writeFile(path.join(w.files,'.runtime/gradle/gradle.properties'),'org.gradle.parallel=true');const fourth=await cache.environmentSnapshot(w.files);assert.notEqual(fourth.signature,third.signature);
});

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const asar=require('../apps/desktop/node_modules/@electron/asar');
const {resolveLaunch}=require('./start-desktop.cjs');
async function fixture(t,config="module.exports={buildIdentifier:()=>require('./package.json').version}"){
 const desktop=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-start-version-'));t.after(()=>fs.rm(desktop,{recursive:true,force:true}));
 await fs.writeFile(path.join(desktop,'package.json'),JSON.stringify({version:'0.1.72'}));await fs.writeFile(path.join(desktop,'forge.config.cjs'),config);
 return {desktop,platform:'darwin',arch:'arm64'};
}
async function pack(options,{identifier='0.1.72',version='0.1.72',plistVersion=version,platform=options.platform}={}){
 const directory=path.join(options.desktop,'out',...(identifier?[identifier]:[]),`Ailo-${platform}-${options.arch}`),contents=platform==='darwin'?path.join(directory,'Ailo.app/Contents'):directory;
 const resources=path.join(contents,platform==='darwin'?'Resources':'resources'),executable=platform==='darwin'?path.join(contents,'MacOS/Ailo'):path.join(directory,platform==='win32'?'Ailo.exe':'Ailo');
 await fs.mkdir(resources,{recursive:true});await fs.mkdir(path.dirname(executable),{recursive:true});await fs.writeFile(executable,'isolated fixture, never launched');
 const source=await fs.mkdtemp(path.join(options.desktop,'archive-'));await fs.writeFile(path.join(source,'package.json'),JSON.stringify({version}));await asar.createPackage(source,path.join(resources,'app.asar'));
 if(platform==='darwin')await fs.writeFile(path.join(contents,'Info.plist'),`<plist><dict><key>CFBundleShortVersionString</key><string>${plistVersion}</string><key>CFBundleVersion</key><string>${plistVersion}</string></dict></plist>`);
 return {executable,contents};
}
test('npm start selects the new version directory even while an old unversioned 0.1.70 bundle remains',async t=>{
 const options=await fixture(t);const old=await pack(options,{identifier:'',version:'0.1.70'}),current=await pack(options);
 const result=await resolveLaunch(options);assert.equal(result.version,'0.1.72');assert.equal(result.executable,current.executable);assert.notEqual(result.executable,old.executable);assert.match(result.directory,/out\/0\.1\.72\/Ailo-darwin-arm64$/);
 // The fixture is a text file, so a mistakenly launched application would fail.
 assert.equal(await fs.readFile(current.executable,'utf8'),'isolated fixture, never launched');
});
test('a missing or mismatched new bundle is an explicit failure, never a fallback to old output',async t=>{
 const options=await fixture(t);await pack(options,{identifier:'',version:'0.1.70'});
 await assert.rejects(resolveLaunch(options),/未找到当前版本.*不会回退/);
 await pack(options,{version:'0.1.70'});await assert.rejects(resolveLaunch(options),/源码 0\.1\.72，包内 0\.1\.70/);
});
test('About metadata must agree with the package and source version',async t=>{
 const options=await fixture(t);await pack(options,{plistVersion:'0.1.70'});await assert.rejects(resolveLaunch(options),/应用版本标识与源码.*不一致/);
});
test('unversioned Forge configuration continues to work when its actual package version matches',async t=>{
 const options=await fixture(t,'module.exports={}'),built=await pack(options,{identifier:''});assert.equal((await resolveLaunch(options)).executable,built.executable);
});
test('async Forge identifiers and non-macOS output paths are resolved without choosing a different architecture',async t=>{
 for(const platform of ['win32','linux']){
  const options={...await fixture(t,"module.exports={buildIdentifier:async()=> 'release-0.1.72'}"),platform,arch:'x64'};
  const built=await pack(options,{identifier:'release-0.1.72'});assert.equal((await resolveLaunch(options)).executable,built.executable);
  await assert.rejects(resolveLaunch({...options,arch:'arm64'}),/未找到当前版本/);
 }
});
test('invalid configured output paths and unreadable ASAR files cannot silently start an old bundle',async t=>{
 const invalid=await fixture(t,"module.exports={buildIdentifier:'../old'}");await assert.rejects(resolveLaunch(invalid),/目录标识无效/);
 const options=await fixture(t),built=await pack(options);await fs.writeFile(path.join(built.contents,'Resources/app.asar'),'broken');await assert.rejects(resolveLaunch(options),/无法核对.*包内版本/);
});
test('a secondary instance exits with an actionable warning before opening storage or workers',async()=>{
 const source=await fs.readFile(path.resolve(__dirname,'../apps/desktop/main.cjs'),'utf8'),vm=require('node:vm'),warnings=[],stopped=Symbol('secondary instance exit');let storageOpened=false;
 const electron={app:{setName(){},getVersion:()=> '0.1.72',requestSingleInstanceLock:()=>false,exit:code=>{assert.equal(code,1);throw stopped;}},protocol:{registerSchemesAsPrivileged(){}}};
 assert.throws(()=>vm.runInNewContext(source,{require:name=>{if(name==='electron')return electron;if(name==='node:path'||name==='node:url')return require(name);if(name==='./storage.cjs'){storageOpened=true;throw Error('storage must not open');}return {};},process:{env:{}},console:{info(){},warn:text=>warnings.push(text)}}),error=>error===stopped);
 assert.equal(storageOpened,false);assert.equal(warnings.length,1);assert.match(warnings[0],/未切换运行版本.*完全退出旧实例.*npm start/);
});
test('macOS launch uses Launch Services and the exact validated app instead of inheriting the editor responsibility',()=>{
 const {launchCommand}=require('./start-desktop.cjs');const launch={executable:'/workspace/out/0.1.84/Ailo-darwin-arm64/Ailo.app/Contents/MacOS/Ailo'};
 const command=launchCommand(launch,['--example','literal value'],'darwin','/private/tmp/launch.log');
 assert.equal(command.command,'/usr/bin/open');assert.deepEqual(command.args,['-n','-W','--env','ELECTRON_RUN_AS_NODE','--stdout','/private/tmp/launch.log','--stderr','/private/tmp/launch.log.stderr','-a','/workspace/out/0.1.84/Ailo-darwin-arm64/Ailo.app','--args','--example','literal value']);
 assert.deepEqual(launchCommand(launch,[],'linux'),{command:launch.executable,args:[]});
});
test('Launch Services output remains visible and a duplicate-instance warning still fails startup',async t=>{
 const {followLog}=require('./start-desktop.cjs');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-launch-log-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const file=path.join(directory,'launch.log');await fs.writeFile(file,'');const chunks=[];const stream=followLog(file,text=>chunks.push(text));await fs.appendFile(file,'已有 Ailo 实例正在运行，本次未切换运行版本。');assert.equal(stream.close().failed,true);assert.equal(chunks.join(''),'已有 Ailo 实例正在运行，本次未切换运行版本。');
});
test('local development signing verifies seals and never adds entitlements or changes system trust',()=>{
 const {signLocalBundle}=require('./local-desktop-sign.cjs'),calls=[];signLocalBundle('/isolated/Ailo.app',(command,args)=>calls.push({command,args}));assert.equal(calls.length,2);assert.deepEqual(calls[0].args,['--force','--deep','--sign','-','--preserve-metadata=entitlements,flags,runtime','/isolated/Ailo.app']);assert.deepEqual(calls[1].args,['--verify','--deep','--strict','/isolated/Ailo.app']);assert.throws(()=>signLocalBundle('/isolated/Ailo.app',(_command,args)=>{if(args.includes('--verify'))throw Error('invalid seal');}),/invalid seal/);
});
test('final bundle startup probe exits before task storage, scheduler or model initialization',async()=>{
 const source=await fs.readFile(path.resolve(__dirname,'../apps/desktop/main.cjs'),'utf8'),vm=require('node:vm'),printed=[],exits=[],paths=[];
 const app={setPath:(...args)=>paths.push(args),getPath:()=>'/isolated/data',getVersion:()=> '0.1.85',getAppPath:()=>'/isolated/Ailo.app/Contents/Resources/app.asar',whenReady:()=>Promise.resolve(),exit:code=>exits.push(code)};
 vm.runInNewContext(source,{require:name=>{assert.equal(name,'electron','startup probe must not load workers or storage');return {app};},process:{argv:['Ailo','--ailo-startup-check'],env:{AILO_DATA_DIR:'/isolated/data'}},console:{info:text=>printed.push(JSON.parse(text)),error:()=>assert.fail('probe error')}});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(exits,[0]);assert.deepEqual(paths,[['userData','/isolated/data']]);assert.equal(printed[0].version,'0.1.85');assert.equal(printed[0].type,'ailo-startup-check');
});
test('production and startup checks share private system-temporary stdio logs rather than Documents',async()=>{
 const {createLaunchLogs}=require('./start-desktop.cjs'),output=[];
 const logs=createLaunchLogs({writeStdout:text=>output.push(text),writeStderr:text=>output.push(text)});
 try{
  const relative=path.relative(os.tmpdir(),logs.directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));assert.ok(!logs.directory.includes('/Documents/'));assert.equal((await fs.stat(logs.directory)).mode&0o777,0o700);
  for(const file of [logs.logFile,logs.logFile+'.stderr'])assert.equal((await fs.stat(file)).mode&0o777,0o600);
  await fs.appendFile(logs.logFile,'Ailo started\n');await fs.appendFile(logs.logFile+'.stderr','已有 Ailo 实例正在运行，本次未切换运行版本。');assert.equal(logs.close().failed,true);assert.match(output.join(''),/Ailo started/);
  const probe=await fs.readFile(path.resolve(__dirname,'desktop-startup-check.cjs'),'utf8');assert.match(probe,/createLaunchLogs/);assert.doesNotMatch(probe,/log=path.join\(directory/);
 }finally{logs.close();await fs.rm(logs.directory,{recursive:true,force:true});}
});
test('noindex Forge output is selected exactly and never falls back to visible legacy builds',async t=>{
 const options=await fixture(t,"module.exports={outDir:'out/.packages.noindex',buildIdentifier:'0.1.72'}");
 const legacy=await pack(options);await assert.rejects(resolveLaunch(options),/\.packages\.noindex/);
 const target=path.join(options.desktop,'out/.packages.noindex/0.1.72');await fs.mkdir(path.dirname(target),{recursive:true});await fs.rename(path.join(options.desktop,'out/0.1.72'),target);
 const result=await resolveLaunch(options);assert.equal(result.executable,legacy.executable.replace('/out/','/out/.packages.noindex/'));
});

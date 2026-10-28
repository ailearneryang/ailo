const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {buildDictation,checkDictation}=require('./build-dictation.cjs');
test('real compiled dictation helper exposes embedded privacy descriptions without accessing microphone or speech permissions',async t=>{
 assert.equal(process.platform,'darwin','native privacy test requires macOS');const out=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-dictation-privacy-'));t.after(()=>fs.rm(out,{recursive:true,force:true}));const binary=buildDictation({out});assert.deepEqual(checkDictation(binary),{type:'privacy',microphone:true,speechRecognition:true});
 const {execFileSync}=require('node:child_process'),{sameExecutable}=require('./macho-content.cjs'),original=await fs.readFile(binary);execFileSync('/usr/bin/codesign',['--force','--sign','-','--identifier','com.ailearneryang.test.signature',binary],{stdio:'pipe'});assert.equal(await sameExecutable(original,await fs.readFile(binary)),true);
 const changed=Buffer.from(original),index=changed.indexOf('offline-only');assert.ok(index>0);changed[index]=120;assert.equal(await sameExecutable(original,changed),false);
});
test('the macOS launcher opens an isolated app bundle through Launch Services with its own identity',async t=>{
 const {execFileSync}=require('node:child_process'),{launchCommand}=require('./start-desktop.cjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-launch-identity-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const bundle=path.join(directory,'Ailo Identity Probe.app'),contents=path.join(bundle,'Contents'),macos=path.join(contents,'MacOS');await fs.mkdir(macos,{recursive:true});
 const source=path.join(directory,'probe.swift'),executable=path.join(macos,'Probe'),identity='com.ailearneryang.ailo.test.'+require('node:crypto').randomUUID();
 await fs.writeFile(source,'import Foundation\nlet value:[String:Any] = ["bundle":Bundle.main.bundleIdentifier ?? "", "parent":getppid(), "nodeMode":!(ProcessInfo.processInfo.environment["ELECTRON_RUN_AS_NODE"] ?? "").isEmpty, "speech":!(Bundle.main.object(forInfoDictionaryKey:"NSSpeechRecognitionUsageDescription") as? String ?? "").isEmpty]\nlet data=try! JSONSerialization.data(withJSONObject:value)\nprint(String(data:data,encoding:.utf8)!)\n');
 await fs.writeFile(path.join(contents,'Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identity}</string><key>CFBundleExecutable</key><string>Probe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1.0</string><key>LSMinimumSystemVersion</key><string>12.0</string><key>LSUIElement</key><true/><key>NSSpeechRecognitionUsageDescription</key><string>Isolated non-recording launch test.</string></dict></plist>`);
 execFileSync('/usr/bin/xcrun',['swiftc','-target',(process.arch==='arm64'?'arm64':'x86_64')+'-apple-macos12.0',source,'-module-cache-path',path.join(directory,'cache'),'-o',executable],{timeout:60000});
 const {signLocalBundle}=require('./local-desktop-sign.cjs');signLocalBundle(bundle);
 await fs.appendFile(path.join(contents,'Info.plist'),'\n');assert.throws(()=>execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'pipe'}));signLocalBundle(bundle);
 const logs=require('./start-desktop.cjs').createLaunchLogs({writeStdout:()=>{},writeStderr:()=>{}});t.after(async()=>{logs.close();await fs.rm(logs.directory,{recursive:true,force:true});});const logFile=logs.logFile;const command=launchCommand({executable},[],'darwin',logFile);
 execFileSync(command.command,command.args,{timeout:30000});const result=JSON.parse(await fs.readFile(logFile,'utf8'));assert.equal(result.bundle,identity);assert.equal(result.speech,true);assert.equal(result.nodeMode,false);assert.notEqual(result.parent,process.pid,'Launch Services must not directly inherit the Node/editor parent');
 const {installBundle,bundleDigest}=require('./install-desktop.cjs'),destination=path.join(directory,'Applications/Ailo.app');
 const install=await installBundle({source:bundle,destination,version:'1.0',running:()=>false,verify:async p=>execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',p],{stdio:'pipe'}),smoke:async p=>{
  await fs.writeFile(logFile,'');const command=launchCommand({executable:path.join(p,'Contents/MacOS/Probe')},[],'darwin',logFile);execFileSync(command.command,command.args,{timeout:30000});const report=JSON.parse(await fs.readFile(logFile,'utf8'));assert.equal(report.bundle,identity);assert.equal(report.nodeMode,false);
 }});assert.equal(install.bundle,destination);assert.equal(await bundleDigest(bundle),await bundleDigest(destination));

});

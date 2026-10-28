const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const runtime=require('../apps/desktop/agent/command-runtime.cjs');
const {sandboxProfile}=require('../apps/desktop/agent/tools.cjs');
async function fixture(t){const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ailo-command-runtime-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));const home=path.join(base,'home'),project=path.join(base,'project');await fs.mkdir(home);await fs.mkdir(project);return {base,home,project};}
async function installation(prefix,{npm=true,script='#!/bin/sh\nprintf "fixture node\\n"\n'}={}){
 const bin=path.join(prefix,'bin');await fs.mkdir(bin,{recursive:true});const node=path.join(bin,'node');await fs.writeFile(node,script,{mode:0o700});
 if(npm){const root=path.join(prefix,'lib/node_modules/npm');await fs.mkdir(path.join(root,'bin'),{recursive:true});await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'npm',version:'11.4.0'}));await fs.writeFile(path.join(root,'bin/npm-cli.js'),'fixture npm CLI');await fs.symlink('../lib/node_modules/npm/bin/npm-cli.js',path.join(bin,'npm'));}
 return {node,bin,prefix};
}
const options=home=>({homeDirectory:home,execPath:null,standardBins:[]});
test('Finder-style discovery selects the installed NVM default without a login shell or inherited PATH',async t=>{
 const {home}=await fixture(t),directory=path.join(home,'.nvm/versions/node');await installation(path.join(directory,'v20.19.1'));await installation(path.join(directory,'v24.19.0'));await fs.mkdir(path.join(home,'.nvm/alias'),{recursive:true});await fs.writeFile(path.join(home,'.nvm/alias/default'),'20\n');
 const found=await runtime.resolve(options(home));assert.equal(found.node.source,'nvm_default');assert.equal(found.node.versionHint,'20.19.1');assert.equal(found.npm.available,true);assert.equal(found.npm.versionHint,'11.4.0');assert.ok(found.readPaths.every(file=>file.startsWith(path.join(directory,'v20.19.1')+path.sep)));assert.ok(!found.readPaths.includes(home));assert.ok(!found.readPaths.includes(path.join(home,'.nvm')));
 const context=runtime.context(found);assert.equal(context.status,'discovered');assert.ok(!JSON.stringify(context).includes(home));assert.match(context.notice,/尚未执行验证/);
});
test('current known Node and standard installation roots precede NVM fallback',async t=>{
 const {base,home}=await fixture(t),current=await installation(path.join(base,'current')),standard=await installation(path.join(base,'standard'));await installation(path.join(home,'.nvm/versions/node/v24.19.0'));
 assert.equal((await runtime.resolve({...options(home),execPath:current.node,standardBins:[{bin:standard.bin,root:standard.prefix}]})).node.path,current.node);
 assert.equal((await runtime.resolve({...options(home),standardBins:[{bin:standard.bin,root:standard.prefix}]})).node.path,standard.node);
});
test('missing Node and missing npm are separate capabilities rather than successful execution claims',async t=>{
 const {base,home}=await fixture(t);const absent=await runtime.resolve(options(home));assert.equal(absent.status,'unavailable');assert.equal(absent.node.available,false);assert.equal(absent.npm.available,false);assert.deepEqual(absent.readPaths,[]);
 const only=await installation(path.join(base,'node-only'),{npm:false}),found=await runtime.resolve({...options(home),execPath:only.node});assert.equal(found.node.available,true);assert.equal(found.npm.available,false);assert.deepEqual(found.readPaths,[only.bin]);
});
test('NVM default aliases cannot introduce paths and invalid versions are ignored',async t=>{
 const {base,home}=await fixture(t);await installation(path.join(home,'.nvm/versions/node/v22.18.0'));await installation(path.join(home,'.nvm/versions/node/v24.19.0'));await installation(path.join(base,'outside'));await fs.mkdir(path.join(home,'.nvm/alias'),{recursive:true});await fs.writeFile(path.join(home,'.nvm/alias/default'),'../../../../outside');
 assert.equal((await runtime.resolve({...options(home),maxVersions:1})).node.versionHint,'24.19.0');await fs.mkdir(path.join(home,'.nvm/versions/node/this-is-not-a-version'));assert.equal((await runtime.resolve(options(home))).node.versionHint,'24.19.0');
});
test('a named NVM LTS default is read as a bounded alias file rather than the newest installed version',async t=>{
 const {home}=await fixture(t);await installation(path.join(home,'.nvm/versions/node/v20.19.1'));await installation(path.join(home,'.nvm/versions/node/v24.19.0'));await fs.mkdir(path.join(home,'.nvm/alias/lts'),{recursive:true});await fs.writeFile(path.join(home,'.nvm/alias/default'),'lts/iron');await fs.writeFile(path.join(home,'.nvm/alias/lts/iron'),'v20.19.1');
 const found=await runtime.resolve({...options(home),maxVersions:1});assert.equal(found.node.source,'nvm_default');assert.equal(found.node.versionHint,'20.19.1');
});
test('an alias directory symlink cannot redirect runtime discovery outside NVM',async t=>{
 const {base,home}=await fixture(t);await installation(path.join(home,'.nvm/versions/node/v20.19.1'));await installation(path.join(home,'.nvm/versions/node/v24.19.0'));const outside=path.join(base,'alias-outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'default'),'v20.19.1');await fs.symlink(outside,path.join(home,'.nvm/alias'));
 const found=await runtime.resolve(options(home));assert.equal(found.node.source,'nvm_version');assert.equal(found.node.versionHint,'24.19.0');
});
test('symlinked NVM roots, version bins, Node executables and npm packages cannot escape the chosen installation',async t=>{
 const {base,home}=await fixture(t),outside=await installation(path.join(base,'outside'));
 await fs.symlink(path.join(base,'outside'),path.join(home,'.nvm'));assert.equal((await runtime.resolve(options(home))).node.available,false);await fs.unlink(path.join(home,'.nvm'));
 const prefix=path.join(home,'.nvm/versions/node/v24.19.0');await fs.mkdir(prefix,{recursive:true});await fs.symlink(outside.bin,path.join(prefix,'bin'));assert.equal((await runtime.resolve(options(home))).node.available,false);await fs.unlink(path.join(prefix,'bin'));
 await fs.mkdir(path.join(prefix,'bin'));await fs.symlink(outside.node,path.join(prefix,'bin/node'));assert.equal((await runtime.resolve(options(home))).node.available,false);await fs.unlink(path.join(prefix,'bin/node'));
 await fs.writeFile(path.join(prefix,'bin/node'),'#!/bin/sh\nexit 0\n',{mode:0o700});await fs.symlink(path.join(outside.prefix,'lib/node_modules/npm/bin/npm-cli.js'),path.join(prefix,'bin/npm'));
 const found=await runtime.resolve(options(home));assert.equal(found.node.available,true);assert.equal(found.npm.available,false);assert.ok(!found.readPaths.some(file=>file.startsWith(outside.prefix)));
});
test('standard symlinks remain usable only when their targets stay in the trusted standard prefix',async t=>{
 const {base,home}=await fixture(t),prefix=path.join(base,'standard'),installed=await installation(path.join(prefix,'Cellar/node/24.19.0'));await fs.mkdir(path.join(prefix,'bin'));await fs.symlink(installed.node,path.join(prefix,'bin/node'));await fs.symlink(path.join(installed.prefix,'lib/node_modules/npm/bin/npm-cli.js'),path.join(prefix,'bin/npm'));
 const found=await runtime.resolve({...options(home),standardBins:[{bin:path.join(prefix,'bin'),root:prefix}]});assert.equal(found.node.path,installed.node);assert.equal(found.npm.available,true);
 await fs.unlink(path.join(prefix,'bin/node'));const other=await installation(path.join(base,'untrusted'));await fs.symlink(other.node,path.join(prefix,'bin/node'));assert.equal((await runtime.resolve({...options(home),standardBins:[{bin:path.join(prefix,'bin'),root:prefix}]})).node.available,false);
});
test('command environment isolates npm configuration, cache and prefix without inheriting parent secrets or startup options',async t=>{
 const {base,home,project}=await fixture(t),installed=await installation(path.join(base,'node'));await fs.writeFile(path.join(home,'.npmrc'),'//registry.example/:_authToken=private-fixture-token');
 const keys=['NPM_TOKEN','OPENAI_API_KEY','NODE_OPTIONS','NODE_PATH','BASH_ENV','DYLD_INSERT_LIBRARIES'],saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));for(const key of keys)process.env[key]='parent-secret-fixture';t.after(()=>{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
 const discovery=await runtime.resolve({...options(home),execPath:installed.node}),prepared=await runtime.environment(project,discovery);
 for(const key of keys)assert.equal(prepared.env[key],undefined);for(const key of ['HOME','TMPDIR','NPM_CONFIG_CACHE','NPM_CONFIG_PREFIX','NPM_CONFIG_USERCONFIG','NPM_CONFIG_GLOBALCONFIG'])assert.ok(prepared.env[key].startsWith(project+path.sep));
 assert.equal(await fs.readFile(prepared.env.NPM_CONFIG_USERCONFIG,'utf8'),'');assert.equal(await fs.readFile(prepared.env.NPM_CONFIG_GLOBALCONFIG,'utf8'),'');assert.match(await fs.readFile(path.join(home,'.npmrc'),'utf8'),/private-fixture-token/);
 const profile=sandboxProfile(project,null,false,null,[],false,prepared.readPaths);assert.ok(profile.includes(installed.bin));assert.ok(profile.includes(path.join(installed.prefix,'lib/node_modules/npm')));assert.ok(!profile.includes('(subpath '+JSON.stringify(home)+')'));assert.ok(!profile.includes('(subpath '+JSON.stringify(installed.prefix)+')'));assert.ok(!profile.includes('allow network-outbound'));
});
test('controlled wrappers preserve arguments safely even when the selected runtime path contains shell metacharacters',async t=>{
 const {base,home,project}=await fixture(t),installed=await installation(path.join(base,"node '$()"),{script:'#!/bin/sh\nprintf "%s\\n" "$@"\n'}),prepared=await runtime.environment(project,await runtime.resolve({...options(home),execPath:installed.node}));
 const result=await promisify(execFile)(path.join(project,'.runtime/ailo-command-bin/node'),['argument with spaces','$(must-stay-text)'],{env:prepared.env});assert.equal(result.stdout,'argument with spaces\n$(must-stay-text)\n');
});
test('runtime preparation rejects redirected isolated configuration and wrapper files',async t=>{
 const {base,home,project}=await fixture(t),installed=await installation(path.join(base,'node')),discovery=await runtime.resolve({...options(home),execPath:installed.node});await runtime.environment(project,discovery);
 const target=path.join(project,'.runtime/ailo-command-config/npm-userrc'),outside=path.join(base,'private-config');await fs.writeFile(outside,'must preserve');await fs.unlink(target);await fs.symlink(outside,target);
 await assert.rejects(runtime.environment(project,discovery),/符号链接/);assert.equal(await fs.readFile(outside,'utf8'),'must preserve');
});
test('EPERM inspecting a Node candidate safely falls back or reports unavailable without weakening link checks',async t=>{
 const {base,home}=await fixture(t),denied=await installation(path.join(base,'denied')),fallback=await installation(path.join(base,'fallback')),original=fs.lstat;
 fs.lstat=async(file,...args)=>{if(file===denied.node)throw Object.assign(Error('fixture denied inspection'),{code:'EPERM'});return original(file,...args);};
 try{
  const found=await runtime.resolve({...options(home),execPath:denied.node,standardBins:[{bin:fallback.bin,root:fallback.prefix}]});assert.equal(found.node.path,fallback.node);assert.equal(found.npm.available,true);
  const absent=await runtime.resolve({...options(home),execPath:denied.node});assert.equal(absent.status,'unavailable');assert.equal(absent.node.available,false);assert.deepEqual(absent.readPaths,[]);
 }finally{fs.lstat=original;}
});
test('EPERM resolving a candidate path safely falls back or reports unavailable rather than failing ordinary discovery',async t=>{
 const {base,home}=await fixture(t),denied=await installation(path.join(base,'denied')),fallback=await installation(path.join(base,'fallback')),original=fs.realpath;
 fs.realpath=async(file,...args)=>{if(file===denied.node)throw Object.assign(Error('fixture denied resolution'),{code:'EPERM'});return original(file,...args);};
 try{
  const found=await runtime.resolve({...options(home),execPath:denied.node,standardBins:[{bin:fallback.bin,root:fallback.prefix}]});assert.equal(found.node.path,fallback.node);
  const absent=await runtime.resolve({...options(home),execPath:denied.node});assert.equal(absent.status,'unavailable');assert.equal(absent.npm.available,false);
 }finally{fs.realpath=original;}
});
test('inaccessible NVM directories and alias metadata remain optional inputs',async t=>{
 const {home}=await fixture(t),versions=path.join(home,'.nvm/versions/node');await installation(path.join(versions,'v20.19.1'));await installation(path.join(versions,'v24.19.0'));await fs.mkdir(path.join(home,'.nvm/alias'),{recursive:true});const alias=path.join(home,'.nvm/alias/default');await fs.writeFile(alias,'20');
 for(const method of ['lstat','readdir','stat','readFile']){
  const original=fs[method],target=method==='lstat'?path.join(home,'.nvm'):method==='readdir'?versions:alias;
  fs[method]=async(file,...args)=>{if(file===target)throw Object.assign(Error('fixture denied optional metadata'),{code:'EPERM'});return original(file,...args);};
  try{const found=await runtime.resolve(options(home));if(['lstat','readdir'].includes(method))assert.equal(found.status,'unavailable');else {assert.equal(found.node.available,true);assert.equal(found.node.versionHint,'24.19.0');}}
  finally{fs[method]=original;}
 }
});
test('inaccessible candidates do not make invalid discovery configuration acceptable',async()=>{
 await assert.rejects(runtime.resolve({homeDirectory:null,execPath:null,standardBins:[]}),/配置无效/);
 await assert.rejects(runtime.resolve({homeDirectory:'/valid',execPath:null,standardBins:[],maxVersions:0}),/配置无效/);
 await assert.rejects(runtime.resolve({homeDirectory:'/valid',execPath:null,standardBins:[{bin:'relative/bin',root:'/valid'}]}),/安装目录无效/);
});

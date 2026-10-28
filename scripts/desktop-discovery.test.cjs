const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {cleanDiscovery}=require('./desktop-discovery.cjs');
test('legacy builds leave search, preserve contents and canonical application; cleanup is repeatable',async t=>{
 const desktop=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-discovery-'));t.after(()=>fs.rm(desktop,{recursive:true,force:true}));
 const source=path.join(desktop,'out/0.1.88/Ailo-darwin-arm64/Ailo.app');await fs.mkdir(source,{recursive:true});await fs.writeFile(path.join(source,'marker'),'original');
 const calls=[],options={desktop,installed:'/Applications/Ailo.app',metadata:async p=>{if(p!==options.installed)assert.equal(await fs.readFile(path.join(p,'marker'),'utf8'),'original');},running:()=>false,register:a=>calls.push(a)};
 const result=await cleanDiscovery(options);assert.equal(result.moved.length,1);assert.match(result.moved[0],/\.packages\.noindex/);assert.equal(await fs.readFile(path.join(result.moved[0],'marker'),'utf8'),'original');assert.ok(calls.some(a=>a[0]==='-u'&&a[1]===source));assert.deepEqual(calls.at(-1),['-f',options.installed]);assert.equal((await cleanDiscovery(options)).moved.length,0);
});
test('running legacy builds and unrelated applications are never moved',async t=>{
 const desktop=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-discovery-'));t.after(()=>fs.rm(desktop,{recursive:true,force:true}));
 const source=path.join(desktop,'out/0.1.88/Ailo-darwin-arm64/Ailo.app');await fs.mkdir(source,{recursive:true});
 const result=await cleanDiscovery({desktop,metadata:async p=>{if(p!==source)throw Error('unrelated');},running:()=>true,register:()=>assert.fail('no registration expected')});assert.deepEqual(result.skipped,[source]);assert.ok((await fs.stat(source)).isDirectory());
});

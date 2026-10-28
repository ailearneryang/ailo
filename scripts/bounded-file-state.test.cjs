const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {inventory,changes}=require('../apps/desktop/agent/file-state.cjs');
const recovery=require('../apps/desktop/agent/decision-recovery.cjs');
const snapshot=(complete,rows)=>({complete,files:rows.map(([path,sha256])=>({path,sha256}))});
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ailo-bounded-state-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('partial snapshots cannot turn unsampled paths into asserted deletions or creations',()=>{
 const before=snapshot(false,[['old-only','a'],['common','before']]),after=snapshot(false,[['new-only','b'],['common','after']]);
 assert.deepEqual(changes(before,after),[{path:'common',kind:'modified',before:'before',after:'after'}]);
 assert.deepEqual(changes(snapshot(false,[['old-only','a']]),snapshot(false,[['new-only','b']])),[]);
});
test('absence is authoritative only on the complete side of a mixed-coverage scan',()=>{
 assert.deepEqual(changes(snapshot(true,[['a','a']]),snapshot(false,[['b','b']])),[{path:'b',kind:'created',before:null,after:'b'}]);
 assert.deepEqual(changes(snapshot(false,[['a','a']]),snapshot(true,[['b','b']])),[{path:'a',kind:'deleted',before:'a',after:null}]);
 assert.deepEqual(changes(snapshot(true,[['a','a'],['c','before']]),snapshot(true,[['b','b'],['c','after']])),[{path:'a',kind:'deleted',before:'a',after:null},{path:'c',kind:'modified',before:'before',after:'after'},{path:'b',kind:'created',before:null,after:'b'}]);
});
test('an inserted file cannot falsely delete the existing file pushed beyond the inventory limit',async t=>{
 const root=await fixture(t);for(let start=1;start<=2001;start+=64)await Promise.all(Array.from({length:Math.min(64,2002-start)},(_,offset)=>fs.writeFile(path.join(root,'f'+String(start+offset).padStart(4,'0')+'.txt'),'unchanged')));
 const before=await inventory(root);assert.equal(before.complete,false);assert.equal(before.files.length,2000);await fs.writeFile(path.join(root,'f0000.txt'),'new file');const after=await inventory(root);assert.equal(after.complete,false);assert.equal(after.files.length,2000);
 assert.equal(await fs.readFile(path.join(root,'f2000.txt'),'utf8'),'unchanged');assert.ok(before.files.some(file=>file.path==='f2000.txt'));assert.ok(!after.files.some(file=>file.path==='f2000.txt'));assert.deepEqual(changes(before,after),[]);
});
test('byte-limited scans retain exact common modifications without inventing other file changes',async t=>{
 const root=await fixture(t);await fs.writeFile(path.join(root,'common.txt'),'before');await fs.writeFile(path.join(root,'large.bin'),'large');await fs.truncate(path.join(root,'large.bin'),21*1024*1024);const before=await inventory(root);assert.equal(before.complete,false);
 await fs.writeFile(path.join(root,'common.txt'),'after');await fs.writeFile(path.join(root,'new.txt'),'new file');const after=await inventory(root),delta=changes(before,after);assert.equal(after.complete,false);assert.equal(delta.length,1);assert.equal(delta[0].path,'common.txt');assert.equal(delta[0].kind,'modified');
});
test('sampling shifts do not count as a successful repair or reset the no-action recovery budget',()=>{
 const delta=changes(snapshot(false,[['old-only','a']]),snapshot(false,[['new-only','b']])),run={inputKey:'u',steps:[{id:'s',status:'running'}]};recovery.begin(run,'MODEL_NO_ACTION_TIMEOUT',3);run.decisionRecovery.noActionFailures=3;
 recovery.progress(run,{action:'run_command',command:'read-only inspection'},{exitCode:0,fileChanges:delta,changeCoverage:'bounded'});assert.ok(run.decisionRecovery);assert.equal(run.decisionRecovery.noActionFailures,3);assert.equal(run.decisionRecovery.progressKeys.length,0);
});

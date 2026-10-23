const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const acceptance=require('../apps/desktop/agent/acceptance.cjs'),proof=require('../apps/desktop/agent/evidence.cjs');
async function setup(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-presence-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const w=await createWorkspace(base,{id:'presence',request:'交付产物'});
 w.run.requirementsManaged=true;w.run.requirements=[{id:'artifact',text:'产物存在',type:'presence'}];return w;
}
async function sized(w,name,bytes){const file=path.join(w.files,name);await fs.writeFile(file,'binary');await fs.truncate(file,bytes);return file;}
function check(name,kind='file_exists'){return {checks:[{criterionId:'artifact',kind,path:name,contains:['binary'],reason:'检查当前产物'}]};}
test('APK and other binary artifacts exceed text limits while keeping hash-based freshness',async t=>{
 const w=await setup(t);
 for(const [name,size] of [['app.apk',5823752],['archive.zip',21*1024*1024]]){
  const file=await sized(w,name,size);
  const result=await acceptance.verify(w,check(name));
  assert.equal(result.results[0].sha256,await proof.hashFile(file));
  await acceptance.assertAccepted(w);
  // Same size and path do not hide a different version.
  const handle=await fs.open(file,'r+');try{await handle.write(Buffer.from('changed'),0,7,0);}finally{await handle.close();}
  await assert.rejects(acceptance.assertAccepted(w),/变化/);
 }
});
test('presence limits do not relax parsing limits or allow file existence to prove behavior',async t=>{
 const w=await setup(t);await sized(w,'large.json',3*1024*1024);
 for(const kind of ['text_contains','json_valid'])await assert.rejects(acceptance.verify(w,check('large.json',kind)),/2 MB/);
 await sized(w,'empty.apk',0);await assert.rejects(acceptance.verify(w,check('empty.apk')),/非空/);
 await sized(w,'oversized.zip',151*1024*1024);await assert.rejects(acceptance.verify(w,check('oversized.zip')),/150 MB/);
 await fs.mkdir(path.join(w.files,'directory'));await assert.rejects(acceptance.verify(w,check('directory')),/普通文件/);
 w.run.requirements[0].type='behavior';await assert.rejects(acceptance.verify(w,check('large.json')),/运行检查证据/);
 w.run.requirements[0].type='content';await assert.rejects(acceptance.verify(w,check('large.json')),/文件存在只能核验/);
});

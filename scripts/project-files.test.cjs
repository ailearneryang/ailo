const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {listProjectFiles,projectFile}=require('../apps/desktop/agent/project-files.cjs');
test('project files include command-generated source without artifact registration, reject escapes and caches',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-files-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'files');await fs.mkdir(path.join(root,'app'),{recursive:true});await fs.writeFile(path.join(root,'app','Main.kt'),'code');
 await fs.mkdir(path.join(root,'.runtime'));await fs.writeFile(path.join(root,'.runtime','secret.txt'),'secret');
 await fs.writeFile(path.join(dir,'outside.txt'),'outside');await fs.symlink(path.join(dir,'outside.txt'),path.join(root,'escape.txt'));
 const result=await listProjectFiles(root);assert.deepEqual(result.files.map(f=>f.path),['app/Main.kt']);
 assert.equal(await fs.readFile(await projectFile(root,'app/Main.kt'),'utf8'),'code');
 for(const p of ['../outside.txt','.runtime/secret.txt','escape.txt'])await assert.rejects(projectFile(root,p));
 assert.deepEqual((await listProjectFiles(path.join(dir,'empty'))).files,[]);
});

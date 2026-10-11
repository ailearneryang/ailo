const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {readMaterial,readSource}=require('../apps/desktop/materials.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
test('unknown text and binary extensions remain usable attachments with accessible original copies',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-any-file-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const textfile=path.join(base,'schema.custom');await fs.writeFile(textfile,'自定义格式正文');
 const text=await readMaterial(textfile);assert.equal(text.text,'自定义格式正文');assert.equal((await readSource(textfile,text.name)).text,text.text);
 const binary=path.join(base,'model.bin'),bytes=Buffer.from([0,1,255,3]);await fs.writeFile(binary,bytes);
 const material=await readMaterial(binary);assert.equal(material.text,null);assert.match(material.summary,/原文件/);
 const sourceId=randomUUID();await fs.mkdir(path.join(base,'imports'));await fs.copyFile(binary,path.join(base,'imports',sourceId));
 const workspace=await createWorkspace(base,{id:'t',request:'分析文件',materials:[{...material,sourceId}]});
 const entry=workspace.catalog[0];assert.equal(entry.readable,false);assert.ok(entry.sourcePath.endsWith('.bin'));
 assert.deepEqual(await fs.readFile(path.join(workspace.files,entry.sourcePath)),bytes);
 const result=await workspace.source(entry.id);assert.equal(result.kind,'binary_original');assert.match(result.text,/尚未提取正文/);
 const {canSendMaterial}=await import('../apps/desktop/attachments.mjs');assert.equal(canSendMaterial({...material,sourceId}),true);
});

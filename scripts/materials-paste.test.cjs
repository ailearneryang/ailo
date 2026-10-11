const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { importPastedMaterials } = require('../apps/desktop/materials.cjs');
test('pasted files retain names, parsed text and private source bytes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ailo-paste-test-'));
  try {
    const entries = [{ name: '需求.txt', bytes: Buffer.from('需求正文') }, { name: 'image.png', bytes: Buffer.from([137, 80, 78, 71]) }];
    const materials = await importPastedMaterials(entries, dir);
    assert.equal(materials[0].text, '需求正文');
    assert.equal(materials[1].text, null);
    for (const [index, material] of materials.entries()) {
      assert.equal(material.name, entries[index].name);
      const filename = path.join(dir, material.sourceId);
      assert.deepEqual(await fs.readFile(filename), entries[index].bytes);
      assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
    }
    await assert.rejects(importPastedMaterials([{ name: 'valid.txt', bytes: Buffer.from('text') }, { name: 'broken.docx', bytes: Buffer.from('archive') }], dir));
    assert.equal((await fs.readdir(dir)).length, 2, 'failed batches roll back their imports');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('pasted material limits are validated before writing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ailo-paste-test-'));
  try {
    for (const input of [null, [], Array.from({ length: 11 }, () => ({ name: 'a.txt', bytes: Buffer.from('a') })), [{ name: 'invalid.txt', bytes: 'text' }]]) {
      await assert.rejects(importPastedMaterials(input, dir));
    }
    assert.deepEqual(await fs.readdir(dir), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('attachments larger than 20 MB import via both file and paste with bounded previews',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-large-material-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const bytes=Buffer.alloc(21*1024*1024,65),filename=path.join(dir,'large.txt');await fs.writeFile(filename,bytes);
 const {readMaterial,readSource,imageContent}=require('../apps/desktop/materials.cjs');
 const material=await readMaterial(filename);assert.equal(material.size,bytes.length);assert.equal(material.text.length,100000);
 const [pasted]=await importPastedMaterials([{name:'large.txt',bytes}],path.join(dir,'sources'));
 assert.equal((await fs.stat(path.join(dir,'sources',pasted.sourceId))).size,bytes.length);
 assert.equal((await readSource(path.join(dir,'sources',pasted.sourceId),pasted.name)).text.length,bytes.length);
 const image=path.join(dir,'large.png');bytes.set([137,80,78,71,13,10,26,10]);await fs.writeFile(image,bytes);
 assert.ok((await imageContent(image)).image_url.url.startsWith('data:image/png;base64,'));
});

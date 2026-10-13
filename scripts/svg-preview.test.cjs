const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {previewFile}=require('../apps/desktop/artifact-edit.cjs');
test('SVG previews use the image renderer with SVG MIME and preserve full Unicode contents',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-svg-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const content='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><text x="10" y="50">中文架构图</text></svg>';
 for(const name of ['diagram.svg','DIAGRAM.SVG']){
  const file=path.join(root,name);await fs.writeFile(file,content);
  const preview=await previewFile(file);
  assert.equal(preview.kind,'image');
  assert.ok(preview.content.startsWith('data:image/svg+xml;base64,'));
  assert.equal(Buffer.from(preview.content.split(',')[1],'base64').toString('utf8'),content);
  assert.match(preview.version,/^[a-f0-9]{64}$/);
 }
});

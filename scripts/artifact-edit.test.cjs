const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {previewFile}=require('../apps/desktop/artifact-edit.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-original-preview-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,file:path.join(root,randomUUID())};}
test('UUID originals retain the registered PDF and GIF formats instead of being decoded as binary text',async t=>{
 const f=await fixture(t);const pdf=Buffer.from('%PDF-1.4\noriginal PDF\n%%EOF');await fs.writeFile(f.file,pdf);const p=await previewFile(f.file,f.root,{displayName:'reference.pdf'});assert.equal(p.kind,'pdf');assert.deepEqual(Buffer.from(p.content,'base64'),pdf);
 const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');await fs.writeFile(f.file,gif);const g=await previewFile(f.file,f.root,{displayName:'image.gif'});assert.equal(g.kind,'image');assert.equal(g.content,'data:image/gif;base64,'+gif.toString('base64'));
});
test('spreadsheet original without extension still exposes real cell contents',async t=>{
 const f=await fixture(t),ExcelJS=require('../apps/desktop/node_modules/exceljs');const book=new ExcelJS.Workbook();book.addWorksheet('数据').getCell('B2').value='原始附件内容';await fs.writeFile(f.file,Buffer.from(await book.xlsx.writeBuffer()));
 const p=await previewFile(f.file,f.root,{displayName:'调研.xlsx'});assert.equal(p.kind,'spreadsheet');assert.deepEqual(p.sheets[0].cells,[{address:'B2',text:'原始附件内容'}]);
});
test('original preview size guard remains enforced when a display filename is supplied',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file,Buffer.alloc(10*1024*1024+1));await assert.rejects(previewFile(f.file,f.root,{displayName:'image.png'}),/文件夹/);
});

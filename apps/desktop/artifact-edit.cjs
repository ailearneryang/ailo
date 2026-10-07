const fs=require('node:fs/promises'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {resolveFile,normalizeProjectPath}=require('./agent/workspace.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const queues=new Map();
async function previewFile(file){const stat=await fs.stat(file);if(!stat.isFile()||stat.size>10*1024*1024)throw Error('此成果请在项目文件夹中查看');const data=await fs.readFile(file),ext=path.extname(file).toLowerCase(),version=hash(data);
 if(['.png','.jpg','.jpeg','.webp'].includes(ext))return {kind:'image',version,content:`data:image/${ext==='.jpg'||ext==='.jpeg'?'jpeg':ext.slice(1)};base64,${data.toString('base64')}`};
 if(ext==='.pdf')return {kind:'pdf',version,content:data.toString('base64')};
 if(ext==='.xlsx'){const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(data);const sheets=[];let total=0;book.eachSheet(sheet=>{const cells=[];sheet.eachRow(row=>row.eachCell(cell=>{if(++total<=10000)cells.push({address:cell.address,text:cell.text});}));sheets.push({name:sheet.name,cells});});return {kind:'spreadsheet',version,content:'',sheets,truncated:total>10000};}
 if(data.includes(0))throw Error('二进制成果请在项目文件夹中查看');
 return {kind:/\.html?$/i.test(file)?'html':/\.(md|markdown)$/i.test(file)?'markdown':'text',version,content:data.toString('utf8').slice(0,100000),truncated:data.length>100000};
}
async function editFile(root,backupRoot,relative,input){relative=normalizeProjectPath(relative);const queueKey=root+'\0'+relative;const next=(queues.get(queueKey)||Promise.resolve()).catch(()=>{}).then(async()=>{
 const file=await resolveFile(root,relative),data=await fs.readFile(file);if(data.length>10*1024*1024)throw Error('文件过大');if(hash(data)!==input.version)throw Error('文件已变化，请刷新预览后重试');let output;
 if(input.operation==='restore'){const backup=await fs.readFile(path.join(backupRoot,hash(Buffer.from(relative))+'.backup'));output=backup;}
 else if(/\.xlsx$/i.test(file)){const edits=input.cells||[{address:input.address,value:input.text}];if(typeof input.sheet!=='string'||!Array.isArray(edits)||!edits.length||edits.length>100||edits.some(e=>!e||!/^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/.test(e.address)||!(e.value===null||['string','number','boolean'].includes(typeof e.value))||(typeof e.value==='string'&&e.value.length>10000)||(typeof e.value==='number'&&!Number.isFinite(e.value))))throw Error('单元格修改无效');const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(data);const sheet=book.getWorksheet(input.sheet);if(!sheet)throw Error('工作表不存在');for(const e of edits){const cell=sheet.getCell(e.address);if(cell.row>1048576||cell.col>16384)throw Error('单元格超出 Excel 范围');cell.value=e.value;}output=Buffer.from(await book.xlsx.writeBuffer());}
 else {if(!/\.(md|markdown|txt|csv|tsv)$/i.test(file)||typeof input.text!=='string'||input.text.length>100000)throw Error('当前格式不支持直接编辑');output=Buffer.from(input.text);}
 await fs.mkdir(backupRoot,{recursive:true,mode:0o700});await fs.writeFile(path.join(backupRoot,hash(Buffer.from(relative))+'.backup'),data,{mode:0o600});
 const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,output,{mode:0o600});await fs.rename(temp,file);return previewFile(file);
 });queues.set(queueKey,next);return next;}
module.exports={previewFile,editFile};

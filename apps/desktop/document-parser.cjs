const fs=require('node:fs/promises');
const MAX_BYTES=20*1024*1024,MAX_CHARS=2000000;
// Each parser produces located text. OCR/vision adapters can add segments later.
async function parseDocument(file,name=file){
 const stat=await fs.stat(file);if(stat.size>MAX_BYTES)throw Error('单个材料文件请小于 20 MB');
 if(/\.pdf$/i.test(name)){
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading=getDocument({data:new Uint8Array(await fs.readFile(file)),isEvalSupported:false,useSystemFonts:true});
  const doc=await loading.promise;const segments=[];let length=0;
  try{if(doc.numPages>500)throw Error('PDF 超过 500 页，请拆分后导入');
   for(let page=1;page<=doc.numPages;page++){const p=await doc.getPage(page);const c=await p.getTextContent();const text=c.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('').trim();length+=text.length;if(length>MAX_CHARS)throw Error('PDF 正文超过 200 万字符，请拆分');segments.push({location:`第 ${page} 页`,text});p.cleanup();}
  }finally{await loading.destroy();}
  const empty=segments.filter(s=>!s.text).length;
  return {kind:'pdf_text',segments,text:segments.map(s=>`[${s.location}]\n${s.text||'此页没有可提取文字，需要 OCR 或视觉识别'}`).join('\n\n'),summary:empty===segments.length?'需要 OCR：PDF 没有可提取文字':`已读取 ${segments.length} 页文字${empty?`；${empty} 页需要 OCR`:''}；图表及图片未识别`,status:empty===segments.length?'needs_ocr':empty?'partial':'parsed'};
 }
 if(/\.xlsx$/i.test(name)){
  const ExcelJS=require('exceljs');const book=new ExcelJS.Workbook();await book.xlsx.readFile(file);const segments=[];let cells=0,length=0;
  book.eachSheet(sheet=>{const lines=[];sheet.eachRow(row=>row.eachCell(cell=>{if(++cells>100000)throw Error('表格超过 10 万个非空单元格，请拆分');let value=cell.value;let text=cell.text;if(value&&typeof value==='object'&&'formula'in value)text=`公式=${value.formula}；缓存值=${value.result??'无（未重新计算）'}`;const line=`${cell.address}: ${text}`;length+=line.length;if(length>MAX_CHARS)throw Error('表格正文超过 200 万字符');lines.push(line);}));segments.push({location:`工作表 ${sheet.name}`,text:lines.join('\n')});});
  return {kind:'spreadsheet',segments,text:segments.map(s=>`[${s.location}]\n${s.text}`).join('\n\n'),status:'parsed',summary:`已读取 ${segments.length} 个工作表、${cells} 个单元格；保留公式与缓存值，不自动重算公式`};
 }
 return null;
}
module.exports={parseDocument};

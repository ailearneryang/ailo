const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {DOMParser}=require('@xmldom/xmldom');
const A=new Set(['http://schemas.openxmlformats.org/drawingml/2006/main','http://purl.oclc.org/ooxml/drawingml/main']);
const P=new Set(['http://schemas.openxmlformats.org/presentationml/2006/main','http://purl.oclc.org/ooxml/presentationml/main']);
function xml(buffer){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('PPTX XML 不允许 DTD 或实体声明');
 return new DOMParser({onError:()=>{throw Error('PPTX XML 已损坏');}}).parseFromString(text,'application/xml');
}
function nodes(root,predicate){const result=[],stack=[root];while(stack.length){const n=stack.pop();if(predicate(n))result.push(n);for(let c=n.lastChild;c;c=c.previousSibling)if(c.nodeType===1)stack.push(c);}return result;}
function relationships(buffer,base){const result=new Map();for(const n of nodes(xml(buffer),n=>n.localName==='Relationship')){if(n.getAttribute('TargetMode')==='External')continue;const target=n.getAttribute('Target');const resolved=target.startsWith('/')?target.slice(1):path.posix.normalize(path.posix.join(base,target));if(resolved.startsWith('ppt/'))result.set(n.getAttribute('Id'),{path:resolved,type:n.getAttribute('Type')});}return result;}
function textOf(buffer,notes=false){
 const doc=xml(buffer),out=[];
 for(const paragraph of nodes(doc,n=>A.has(n.namespaceURI)&&n.localName==='p')){
  if(notes){let parent=paragraph.parentNode,skip=false;while(parent){if(P.has(parent.namespaceURI)&&parent.localName==='sp'){skip=nodes(parent,n=>P.has(n.namespaceURI)&&n.localName==='ph').some(n=>['sldNum','hdr','ftr','dt','sldImg'].includes(n.getAttribute('type')));break;}parent=parent.parentNode;}if(skip)continue;}
  const text=nodes(paragraph,n=>A.has(n.namespaceURI)&&['t','br','tab'].includes(n.localName)).map(n=>n.localName==='t'?n.textContent:n.localName==='br'?'\n':'\t').join('').trim();if(text)out.push(text);
 }
 return out.join('\n');
}
function readPackage(file){return new Promise((resolve,reject)=>{
 require('yauzl').open(file,{lazyEntries:true,autoClose:true},(error,zip)=>{
  if(error)return reject(Error('PPTX 无法读取：文件损坏、加密或不是有效的演示文稿'));
  const entries=new Map();let count=0,total=0,finished=false;
  const fail=e=>{if(finished)return;finished=true;zip.close();reject(e);};
  zip.on('error',fail);zip.on('end',()=>{if(!finished){finished=true;resolve(entries);}});
  zip.on('entry',entry=>{
   if(++count>20000)return fail(Error('PPTX 包含过多条目，请拆分'));
   if(!/^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$/.test(entry.fileName)){zip.readEntry();return;}
   total+=entry.uncompressedSize;if(entry.uncompressedSize>4*1024*1024||total>24*1024*1024)return fail(Error('PPTX 解压正文超过读取上限，请拆分'));
   if(entries.has(entry.fileName))return fail(Error('PPTX 存在重复条目'));
   zip.openReadStream(entry,(e,stream)=>{if(e)return fail(e);const chunks=[];let size=0;stream.on('error',fail);stream.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024){stream.destroy();fail(Error('PPTX 单页正文超过读取上限'));}else chunks.push(chunk);});stream.on('end',()=>{if(finished)return;entries.set(entry.fileName,Buffer.concat(chunks));zip.readEntry();});});
  });zip.readEntry();
 });
});}
async function parsePptx(file){
 const files=await readPackage(file),presentation=files.get('ppt/presentation.xml'),rels=files.get('ppt/_rels/presentation.xml.rels');
 if(!presentation||!rels)throw Error('PPTX 缺少演示文稿目录');
 const links=relationships(rels,'ppt');const slides=nodes(xml(presentation),n=>P.has(n.namespaceURI)&&n.localName==='sldId');
 if(!slides.length||slides.length>500)throw Error('PPTX 必须包含 1–500 张幻灯片');
 const segments=[];let length=0,empty=0;
 for(const [i,slide] of slides.entries()){
  const id=slide.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||slide.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships','id')||slide.getAttribute('r:id');const target=links.get(id)?.path,buffer=files.get(target);
  if(!buffer)throw Error('PPTX 幻灯片内容缺失');
  const body=textOf(buffer);if(!body)empty++;
  let notes='';const rel=files.get(path.posix.join(path.posix.dirname(target),'_rels',path.posix.basename(target)+'.rels'));
  if(rel){const note=[...relationships(rel,path.posix.dirname(target)).values()].find(r=>r.type.endsWith('/notesSlide'));if(note){if(!files.has(note.path))throw Error('PPTX 演讲者备注缺失');notes=textOf(files.get(note.path),true);}}
  const text=(body||'此页没有可提取文字，图片需要视觉识别')+(notes?'\n[演讲者备注]\n'+notes:'');length+=text.length;if(length>2000000)throw Error('PPTX 正文超过 200 万字符，请拆分');segments.push({location:`第 ${i+1} 张幻灯片`,text});
 }
 return {kind:'presentation',segments,text:segments.map(s=>`[${s.location}]\n${s.text}`).join('\n\n'),status:empty?'partial':'parsed',summary:`已读取 ${segments.length} 张幻灯片的正文、表格文字及演讲者备注；图片、图表和动画未识别${empty?`；${empty} 页没有正文文字`:''}`};
}
async function parsePresentation(file,name=file){
 if(!/\.ppt$/i.test(name))return parsePptx(file);
 const candidates=['/Applications/LibreOffice.app/Contents/MacOS/soffice','/opt/homebrew/bin/soffice','/usr/local/bin/soffice','/usr/bin/soffice'];let binary;
 for(const candidate of candidates){try{await fs.access(candidate,fs.constants.X_OK);binary=candidate;break;}catch{}}
 if(!binary)throw Error('旧版 .ppt 需要安装 LibreOffice，或在 PowerPoint 中另存为 .pptx 后添加');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-ppt-'));
 try{const input=path.join(dir,'material.ppt');await fs.copyFile(file,input);
  const user=path.join(dir,'profile','user');await fs.mkdir(user,{recursive:true});
  await fs.writeFile(path.join(user,'registrymodifications.xcu'),'<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
  await new Promise((resolve,reject)=>require('node:child_process').execFile(binary,['-env:UserInstallation='+require('node:url').pathToFileURL(path.join(dir,'profile')).href,'--headless','--convert-to','pptx','--outdir',dir,input],{timeout:30000,maxBuffer:1024*1024},e=>e?reject(Error('PPT 转换失败，请另存为 .pptx 后添加')):resolve()));
  const parsed=await parsePptx(path.join(dir,'material.pptx'));return {...parsed,summary:'已转换旧版 PPT；'+parsed.summary};
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
module.exports={parsePresentation};

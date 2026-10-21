const fs=require('node:fs/promises'),path=require('node:path');
const {resolveFile}=require('./workspace.cjs'),{hash}=require('./evidence.cjs');
// Inspect extracted Sketch pages, never execute the generated conversion script.
// Counts are diagnostics of the selected source graph, not proof of visual fidelity.
async function audit(root,htmlPath,dom,context={}){
 const queue=[{dir:'',depth:0}],candidates=[];let entries=0,truncated=false;
 while(queue.length){
  const {dir,depth}=queue.shift();
  for(const item of await fs.readdir(dir?await resolveFile(root,dir):root,{withFileTypes:true})){
   if(++entries>1500){truncated=true;break;}
   if(item.name.startsWith('.')||['node_modules','__MACOSX'].includes(item.name)||item.isSymbolicLink())continue;
   const relative=dir?dir+'/'+item.name:item.name;
   if(item.isDirectory()&&depth<4)queue.push({dir:relative,depth:depth+1});
   if(item.isFile()&&/\.json$/i.test(item.name)&&(path.posix.basename(dir)==='pages'||item.name==='document.json'))candidates.push(relative);
  }
  if(truncated)break;
 }
 const pages=[],documents=[],sources=[];let bytes=0;
 for(const relative of candidates.slice(0,64)){
  const file=await resolveFile(root,relative),stat=await fs.stat(file);
  if(stat.size>10*1024*1024||bytes+stat.size>24*1024*1024){truncated=true;continue;}
  const data=await fs.readFile(file);bytes+=data.length;
  let value;try{value=JSON.parse(data);}catch{continue;}
  if(value?._class==='page'&&Array.isArray(value.layers))pages.push(value);
  else if(value?._class==='document'&&Array.isArray(value.foreignSymbols))documents.push(value);
  else continue;
  sources.push({path:relative,sha256:hash(data)});
 }
 if(!pages.length)return {status:'unavailable',sources:[],issues:[],notice:'未发现可解析的 Sketch 页面；没有原稿完整性结论'};
 if(candidates.length>64)truncated=true;
 const html=await fs.readFile(await resolveFile(root,htmlPath),'utf8'),masters=new Map();
 const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
 function index(layer){if(layer._class==='symbolMaster'&&layer.symbolID)masters.set(layer.symbolID,layer);for(const child of layer.layers||[])index(child);}
 for(const page of pages)for(const layer of page.layers)index(layer);
 for(const document of documents)for(const imported of document.foreignSymbols)if(imported.symbolMaster)index(imported.symbolMaster);
 const selected=pages.flatMap(p=>p.layers).filter(l=>['group','artboard'].includes(l._class)&&l.name&&(html.includes(l.name)||html.includes(escape(l.name))));
 if(!selected.length)return {status:'unavailable',sources,issues:context.reproduce?['无法将 HTML 与原稿画板绑定，原稿完整性尚未核验；请保留可核对的画板名称并重新检查']:[],notice:'未能将 HTML 与具体 Sketch 画板绑定；需核对原稿与产物对应关系'};
 let bitmapInstances=0,textInstances=0,visited=0;const sizes=new Set(),unresolved=new Map();
 function walk(layer,stack=new Set(),depth=0){
  if(++visited>30000||depth>64){truncated=true;return;}
  if(layer.isVisible===false)return;
  if(layer._class==='bitmap'&&layer.image?._ref)bitmapInstances++;
  if(layer._class==='text'){
   textInstances++;
   for(const span of layer.attributedString?.attributes||[]){const size=span.attributes?.MSAttributedStringFontAttribute?.attributes?.size;if(Number.isFinite(size))sizes.add(size);}
  }
  if(layer._class==='symbolInstance'){
   const master=masters.get(layer.symbolID);
   if(!master){unresolved.set(layer.symbolID||layer.name,layer.name||layer.symbolID);return;}
   if(stack.has(master.symbolID)){truncated=true;return;}
   const next=new Set(stack);next.add(master.symbolID);
   for(const child of master.layers||[])walk(child,next,depth+1);
  }else for(const child of layer.layers||[])walk(child,stack,depth+1);
 }
 for(const layer of selected)walk(layer);
 const issues=[],render=dom.renderHealth;
 // Repeated empty inline declarations indicate conversion lost source styles.
 // Restrict this diagnostic to source-bound reproductions with many text layers.
 const inlineStyles=[...html.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi)].map(match=>match[2]);
 const emptyStyles=inlineStyles.filter(style=>/(?:^|;)\s*(?:color|background(?:-color)?|font-size)\s*:\s*(?:;|$)/i.test(style)).length;
 if(textInstances>=10&&emptyStyles>=10&&emptyStyles/inlineStyles.length>=0.5)issues.push(`Sketch 转换产生大量空样式（${emptyStyles}/${inlineStyles.length} 个内联样式）；请正确读取填充、字体和文本颜色属性，同时核对嵌套图层的父级坐标，不能将局部坐标直接平铺到画板`);
 if(render){
  if(bitmapInstances>0&&render.imageElements+render.cssImageElements+render.svgElements+render.canvasElements===0)issues.push(`原稿包含 ${bitmapInstances} 个位图实例，页面没有图片、背景图、SVG 或 Canvas；请核对图片引用路径和资源是否实际渲染`);
  if(textInstances>=10&&sizes.size>=3&&render.textSamples>=10&&render.defaultSmallText/render.textSamples>=0.9&&render.tinyLineHeightText/render.textSamples>=0.8)issues.push('原稿具有多种字号，页面文字却大面积退化为 Arial 小字号和不超过 4px 的行高；请检查 Sketch attributes 的读取层级，禁止把 lineSpacingBehaviour 当像素行高');
 }
 if(unresolved.size)issues.push(`所选原稿有 ${unresolved.size} 个组件定义无法解析，例如：${[...unresolved.values()].slice(0,5).join('、')}；请补齐原稿或组件库依赖，不能静默跳过`);
 if(truncated)issues.push('原稿检查超出扫描范围，完整性尚未确认；请缩小或拆分原稿后重新核对');
 return {status:'checked',sources,selectedPages:selected.length,bitmapInstances,textInstances,fontSizes:[...sizes].sort((a,b)=>a-b),unresolvedSymbols:unresolved.size,issues,notice:'按 HTML 中画板名称绑定原稿；静态结构检查不替代截图对照，组件实例覆盖值仍需核对'};
}
module.exports={audit};

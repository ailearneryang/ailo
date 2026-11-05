// A source bitmap cannot be implemented by a shape-only drawable. This is a
// structural preflight, never proof of image quality or exact visual fidelity.
const fs=require('node:fs/promises'),path=require('node:path');
const {resolveFile}=require('./workspace.cjs'),{hash}=require('./evidence.cjs');
function sourceBackgrounds(baseline){
 const area=baseline.width*baseline.height;
 return (baseline.bitmaps||[]).filter(b=>area>0&&b.frame?.width*b.frame?.height>=area*.8&&b.frame.x<=baseline.width*.1&&b.frame.y<=baseline.height*.1&&Math.max(0,Math.min(baseline.width,b.frame.x+b.frame.width)-Math.max(0,b.frame.x))*Math.max(0,Math.min(baseline.height,b.frame.y+b.frame.height)-Math.max(0,b.frame.y))>=area*.6);
}
async function audit(root,screen){
 const expected=sourceBackgrounds(screen.baseline);
 if(!expected.length||!/^app\/src\/main\/res\/layout[^/]*\//.test(screen.layout))return {status:'not_applicable',issues:[],sources:[]};
 const sources=[],issues=[],assignments=[],files=new Map();let truncated=false,scanned=0;
 async function read(relative){
  if(files.has(relative))return files.get(relative);
  const absolute=await resolveFile(root,relative),stat=await fs.stat(absolute);
  if(!stat.isFile()||stat.size>1024*1024){truncated=true;return '';}
  const bytes=await fs.readFile(absolute);sources.push({path:relative,sha256:hash(bytes)});const text=bytes.toString('utf8');files.set(relative,text);return text;
 }
 const layout=await read(screen.layout),rootTag=layout.replace(/<!--[\s\S]*?-->/g,'').match(/<(?!\?)([\w.]+)\b[^>]*>/)?.[0]||'';
 for(const m of rootTag.matchAll(/android:background\s*=\s*["']@(?:drawable|mipmap)\/([\w]+)["']/g))assignments.push({resource:m[1],path:screen.layout});
 // A full-screen ImageView is another normal way to implement a backdrop.
 for(const m of layout.matchAll(/<(?:[\w.]*ImageView)\b[^>]*>/g))if(/android:layout_width=["']match_parent["']/.test(m[0])&&/android:layout_height=["']match_parent["']/.test(m[0]))for(const a of m[0].matchAll(/(?:android:src|app:srcCompat)=["']@(?:drawable|mipmap)\/([\w]+)["']/g))assignments.push({resource:a[1],path:screen.layout});
 async function walk(dir,depth=0){
  if(depth>12){truncated=true;return;}
  let entries;try{entries=await fs.readdir(await resolveFile(root,dir),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const e of entries){if(++scanned>1500){truncated=true;return;}if(e.isSymbolicLink())continue;const relative=dir+'/'+e.name;if(e.isDirectory())await walk(relative,depth+1);else if(/\.(?:kt|java)$/.test(e.name)){
   const raw=await read(relative),layoutName=path.posix.basename(screen.layout,'.xml'),bindingName=layoutName.replace(/(?:^|_)([a-z])/g,(_,c)=>c.toUpperCase())+'Binding';
   if(!raw.includes(bindingName)&&!raw.includes('R.layout.'+layoutName))continue;
   const text=raw.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
   // Only root background assignments; an icon or an unused drawable cannot
   // satisfy this check. Dynamic branches are checked independently.
   for(const m of text.matchAll(/(?:binding\.root|\broot|\brootView)\.setBackgroundResource\s*\(\s*([^;\n]+)\)/g)){
    const arg=m[1],direct=[...arg.matchAll(/R\.(?:drawable|mipmap)\.(\w+)/g)];
    if(direct.length)for(const d of direct)assignments.push({resource:d[1],path:relative});
    else {const fn=arg.match(/^(\w+)\s*\(/)?.[1];if(fn){const start=text.search(new RegExp('(?:fun|int)\\s+'+fn+'\\s*\\(')),tail=start<0?'':text.slice(start),body=tail.slice(0,tail.indexOf('\n    }')<0?tail.length:tail.indexOf('\n    }'));for(const d of body.matchAll(/R\.(?:drawable|mipmap)\.(\w+)/g))assignments.push({resource:d[1],path:relative});}}
   }
  }}
 }
 await walk('app/src/main/java');await walk('app/src/main/kotlin');
 let resDirs=[];try{resDirs=(await fs.readdir(await resolveFile(root,'app/src/main/res'),{withFileTypes:true})).filter(e=>e.isDirectory()&&/^(drawable|mipmap)(?:-|$)/.test(e.name)).map(e=>'app/src/main/res/'+e.name);}catch(e){if(e.code!=='ENOENT')throw e;}
 const cache=new Map();
 async function raster(name,stack=new Set()){
  if(stack.has(name))return false;if(cache.has(name))return cache.get(name);
  const next=new Set(stack);next.add(name);let found=false,valid=true;
  for(const dir of resDirs){const entries=await fs.readdir(await resolveFile(root,dir));for(const file of entries.filter(f=>f.replace(/(?:\.9)?\.[^.]+$/,'')===name)){
   const relative=dir+'/'+file;let variant=false;
   if(/\.(png|jpe?g|webp|avif)$/i.test(file)){const bytes=await fs.readFile(await resolveFile(root,relative));sources.push({path:relative,sha256:hash(bytes)});if(bytes.length)variant=true;}
   else if(/\.xml$/.test(file)){const xml=(await read(relative)).replace(/<!--[\s\S]*?-->/g,'');for(const m of xml.matchAll(/@(?:drawable|mipmap)\/([\w]+)/g))if(await raster(m[1],next))variant=true;}
   found=true;if(!variant)valid=false;
  }}cache.set(name,found&&valid);return found&&valid;
 }
 for(const a of [...new Map(assignments.map(a=>[a.resource,a])).values()]){if(!await raster(a.resource))issues.push('原稿大面积背景为位图，但界面背景 @drawable/'+a.resource+' 未引用位图（'+a.path+'）；渐变、矢量云纹或未引用的图片不能替代原稿天空/场景图片。请核对原始组件裁剪和遮罩，接入合适图片并逐天气态运行复验。');}
 if(truncated)issues.push('背景资源检查超出有界扫描范围，不能据此认定资源已接入');
 return {status:assignments.length?'checked':'unresolved',expected,assignments,issues,sources:[...new Map(sources.map(s=>[s.path,s])).values()],notice:'仅检查已识别背景引用是否含位图，不证明图片正确、清晰或符合原稿；未识别的实现仍需真实成对图像核验。'};
}
module.exports={audit,sourceBackgrounds};

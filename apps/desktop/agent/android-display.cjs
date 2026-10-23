const fs=require('node:fs/promises'),path=require('node:path');
const {resolveFile}=require('./workspace.cjs'),{hash}=require('./evidence.cjs');
const schema={type:'object',additionalProperties:false,properties:{width:{type:'integer',minimum:320,maximum:3840},height:{type:'integer',minimum:320,maximum:3840},density:{type:'integer',minimum:80,maximum:640},reference:{type:'string',maxLength:500}},description:'项目测试屏幕的像素宽高、dpi 与可选原设计 PNG 路径；按设计指定横竖屏，不能传设备序列号或模拟器命令。'};
function validate(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['width','height','density','reference'].includes(k)))throw Error('display 仅支持 width、height、density、reference');
 if((value.width===undefined)!==(value.height===undefined))throw Error('display 宽高必须同时提供');
 for(const key of ['width','height','density'])if(value[key]!==undefined&&(!Number.isSafeInteger(value[key])||value[key]<(key==='density'?80:320)||value[key]>(key==='density'?640:3840)))throw Error('display 宽高须为320–3840像素，density 须为80–640的整数');
 if(value.width*value.height>8388608)throw Error('display 屏幕最多8388608像素');
 if(value.reference!==undefined&&(typeof value.reference!=='string'||!value.reference||value.reference.length>500))throw Error('display.reference 需要项目内 PNG 路径');
 if(value.width===undefined&&!value.reference)throw Error('display 需要宽高或设计参考 PNG');
 return {...value};
}
function pngSize(bytes){
 if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw Error('需要有效 PNG 图像');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>16384||height>16384)throw Error('PNG 尺寸无效');
 return {width,height};
}
function finish(value,source,sources=[],extra={}){
 const {width,height,density=160,reference}=value;
 validate({width,height,density,...(reference?{reference}:{})});
 return {width,height,density,orientation:width>height?'landscape':'portrait',widthDp:width*160/density,heightDp:height*160/density,source,sources,...(reference?{reference}:{}),...extra};
}
async function explicit(root,value,source,sources=[]){
 value=validate(value);
 if(value.reference){
  const file=await resolveFile(root,value.reference),stat=await fs.stat(file);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('设计参考 PNG 须为项目内20MB以内文件');
  const bytes=await fs.readFile(file),size=pngSize(bytes);sources=sources.concat({path:value.reference,sha256:hash(bytes)});
  if(!value.width)value={...value,...size};
  if(Math.abs((value.width/value.height)/(size.width/size.height)-1)>.03)throw Error('测试屏幕与设计参考的方向或宽高比不符，请修正 display');
 }
 return finish(value,source,sources);
}
async function sketchDisplay(root){
 const queue=[{dir:'',depth:0}],candidates=[],seen=new Set();let entries=0,bytes=0;
 while(queue.length&&entries<1500){
  const {dir,depth}=queue.shift();let list;try{list=await fs.readdir(dir?await resolveFile(root,dir):root,{withFileTypes:true});}catch{continue;}
  for(const item of list){
   if(++entries>1500)break;
   if(item.isSymbolicLink()||item.name.startsWith('.')||['node_modules','build','verification','__MACOSX'].includes(item.name))continue;
   const relative=dir?dir+'/'+item.name:item.name;
   if(item.isDirectory()&&depth<4)queue.push({dir:relative,depth:depth+1});
   if(!item.isFile()||path.posix.basename(dir)!=='pages'||!item.name.endsWith('.json'))continue;
   try{
    const file=await resolveFile(root,relative),stat=await fs.stat(file);if(stat.size>10*1024*1024||bytes+stat.size>24*1024*1024)continue;
    const data=await fs.readFile(file);bytes+=data.length;const page=JSON.parse(data);
    if(page._class!=='page'||!Array.isArray(page.layers))continue;
    for(const layer of page.layers){
     if(!['artboard','group'].includes(layer._class)||layer.isVisible===false)continue;
     const {width,height}=layer.frame||{};
     try{validate({width,height});}catch{continue;}
     if(width===undefined||height===undefined)continue;
     const id=JSON.stringify([layer.do_objectID||layer.name,width,height]);if(seen.has(id))continue;seen.add(id);
     candidates.push({width,height,name:layer.name,dependency:{path:relative,sha256:hash(data)}});
    }
   }catch{}
  }
 }
 if(!candidates.length)return;
 const groups=new Map();for(const c of candidates){const key=c.width+'x'+c.height;groups.set(key,[...(groups.get(key)||[]),c]);}
 const ranked=[...groups.values()].sort((a,b)=>b.length-a.length),chosen=ranked[0];
 if(ranked.length>1&&chosen.length<=candidates.length*.6)throw Object.assign(Error('设计稿包含多种屏幕规格，不能可靠选择。请用 android_device start 的 display 指定目标画板宽高或参考 PNG。'),{code:'ANDROID_DISPLAY_REQUIRED'});
 return finish(chosen[0],'sketch-artboards',[...new Map(chosen.map(c=>[c.dependency.path,c.dependency])).values()],{artboards:chosen.length,notice:'根据原稿画板推断像素尺寸与方向；默认160dpi，目标硬件密度可用 display 或 android-display.json 明确指定。此结果不是视觉还原验收。'});
}
async function resolve(root,requested,saved){
 if(requested!==undefined)return explicit(root,requested,'explicit');
 try{
  const file=await resolveFile(root,'android-display.json'),stat=await fs.stat(file);if(stat.size>10000)throw Error('android-display.json 过大');
  const data=await fs.readFile(file);return explicit(root,JSON.parse(data),'project-config',[{path:'android-display.json',sha256:hash(data)}]);
 }catch(e){if(e.code!=='ENOENT')throw e;}
 if(saved?.source==='explicit')return explicit(root,Object.fromEntries(['width','height','density','reference'].filter(k=>saved[k]!==undefined).map(k=>[k,saved[k]])),'explicit');
 const inferred=await sketchDisplay(root);if(inferred)return inferred;
 for(const relative of ['', '.ailo-materials']){
  let entries;try{entries=await fs.readdir(relative?await resolveFile(root,relative):root);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(entries.some(name=>name.toLowerCase().endsWith('.sketch')))throw Object.assign(Error('项目含 Sketch 原稿，但尚未解析到屏幕画板。先解析设计，或通过 display 指定目标宽高/参考 PNG，不能直接使用默认手机竖屏。'),{code:'ANDROID_DISPLAY_REQUIRED'});
 }
 return finish({width:720,height:1280,density:320},'default',[], {notice:'没有可推断的设计屏幕，使用720×1280、320dpi竖屏默认值；有明确原稿时须先指定目标规格。'});
}
function same(a,b){return !!a&&['width','height','density'].every(k=>a[k]===b[k]);}
function configure(text,display){
 const values={'hw.lcd.width':Math.min(display.width,display.height),'hw.lcd.height':Math.max(display.width,display.height),'hw.lcd.density':display.density,'hw.initialOrientation':display.orientation,'skin.name':Math.min(display.width,display.height)+'x'+Math.max(display.width,display.height),'skin.path':'_no_skin'};
 const lines=text.split(/\r?\n/).filter(line=>!Object.keys(values).some(k=>line.startsWith(k+'=')));
 return lines.filter(Boolean).concat(Object.entries(values).map(([k,v])=>k+'='+v)).join('\n')+'\n';
}
function check(display,size){return {expected:{width:display.width,height:display.height,density:display.density},actual:size,matches:display.width===size.width&&display.height===size.height&&(size.density===undefined||size.density===display.density),notice:'只检查截图像素尺寸与方向，不代表颜色、内容或布局还原通过'};}
module.exports={schema,validate,pngSize,resolve,configure,same,check};

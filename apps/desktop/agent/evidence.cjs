const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {resolveFile}=require('./workspace.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const scopeSchema={type:'object',additionalProperties:false,required:['kind','path'],properties:{kind:{type:'string',enum:['file','document','viewport','element','region']},path:{type:'string'},selector:{type:'string'},rect:{type:'object',additionalProperties:false,required:['x','y','width','height'],properties:Object.fromEntries(['x','y','width','height'].map(k=>[k,{type:'number'}]))}}};
function scope(value){
 if(!value||!['file','document','viewport','element','region'].includes(value.kind)||typeof value.path!=='string'||!value.path)throw Error('观察范围需要 kind 和项目路径 path');
 require('./workspace.cjs').normalizeProjectPath(value.path);
 if(value.kind==='element'&&(typeof value.selector!=='string'||!value.selector||value.selector.length>500))throw Error('元素范围需要 selector');
 if(value.kind==='region'&&(!value.rect||!['x','y','width','height'].every(k=>Number.isFinite(value.rect[k]))||value.rect.width<=0||value.rect.height<=0))throw Error('区域范围需要有效 rect');
 return structuredClone(value);
}
function covers(observed,required){
 if(!required)return true;
 if(!observed||observed.path!==required.path)return false;
 if(['file','document'].includes(observed.kind))return observed.kind===required.kind||observed.kind==='document'&&required.kind!=='file';
 if(observed.kind!==required.kind)return false;
 if(required.kind==='element')return observed.selector===required.selector;
 if(required.kind==='page')return observed.page===required.page;
 if(['region','viewport'].includes(required.kind)){
  const a=observed.rect,b=required.rect;
  if(!b)return required.kind==='viewport';
  return !!a&&a.x<=b.x&&a.y<=b.y&&a.x+a.width>=b.x+b.width&&a.y+a.height>=b.y+b.height;
 }
 return true;
}
async function assertFresh(workspace,record){
 if(record.parts){for(const part of record.parts)await assertFresh(workspace,part);return;}
 if(record.requireCurrentState&&record.rendererState&&workspace.run.observationStates?.[record.rendererState.id]!==record.rendererState.version)throw Error('页面交互状态已变化，请使用最新观察');
 if(record.fileSet){const inventory=await require('./file-state.cjs').inventory(workspace.files);if(!inventory.complete||JSON.stringify(inventory.files.map(f=>f.path).sort())!==JSON.stringify(record.fileSet))throw Error('命令检查的项目文件集合已变化，请重新验证');}
 // Legacy receipts retain conservative revision checks. New receipts carry
 // explicit dependency hashes, including missing resources (sha256:null).
 if(!Array.isArray(record.sources)||!record.sources.length){if(record.revision!==workspace.run.revision)throw Error('旧证据版本已过期，请重新检查');return;}
 for(const source of record.sources){
  const file=await resolveFile(workspace.files,source.path);let actual=null;
  try{const stat=await fs.stat(file);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('证据依赖超出文件限制');actual=hash(await fs.readFile(file));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(actual!==source.sha256)throw Error('证据依赖文件已变化，请重新观察或检查：'+source.path);
 }
}
function resolveId(run,id){
 if(run.events.some(e=>e.id===id))return id;
 let receipt=run.observationIndex?.find(o=>o.id===id);if(receipt)return receipt.eventId||id;
 const ids=[...new Set([...run.events.map(e=>e.id),...(run.observationIndex||[]).flatMap(o=>[o.id,o.eventId]).filter(Boolean)])];
 const matches=typeof id==='string'&&/^[a-f0-9-]{8,}$/i.test(id)?ids.filter(full=>full.startsWith(id)):[];
 if(matches.length===1){receipt=run.observationIndex?.find(o=>o.id===matches[0]);return receipt?.eventId||matches[0];}
 return id;
}
async function lookup(workspace,id){
 id=resolveId(workspace.run,id);
 return workspace.run.events.find(e=>e.id===id)||await workspace.archivedEvent?.(id);
}
async function event(workspace,id){
 id=resolveId(workspace.run,id);
 const run=workspace.run,e=await lookup(workspace,id);
 if(!e||!['run_command','build_android','browser','view_image'].includes(e.type))throw Error('验证证据无效或不存在');
 const r=e.detail.result;
 if(['run_command','build_android'].includes(e.type)){
  if(!r||r.exitCode!==0||r.timedOut)throw Error('命令没有成功退出，不能作为完成证据');
  await assertFresh(workspace,{revision:e.detail.revision,sources:r.sources,fileSet:r.fileSet,rendererState:r.rendererState});
 }else{
  if(e.type==='browser'&&(!r?.dom||r.errors?.length||r.dom.missingImages?.length))throw Error('网页证据无效：未观察页面、图片加载失败或存在运行错误');
  const page=e.type==='browser'?e:run.events.find(item=>item.type==='browser'&&item.detail.result?.screenshot===r?.path)||await workspace.findEvent?.(item=>item.type==='browser'&&item.detail.result?.screenshot===r?.path);
  if(page)require('./html-delivery.cjs').assertPageHealth(page.detail.result);
  const receipt=run.visualObservations?.find(o=>o.eventId===id&&o.delivered);
  if(!receipt&&e.type==='view_image')throw Error('图像尚未传给模型');
  await assertFresh(workspace,{revision:e.detail.revision,sources:r.sources,fileSet:r.fileSet,rendererState:r.rendererState});
  if(receipt)await assertFresh(workspace,{revision:receipt.revision,sources:[...(receipt.sources||[]),{path:receipt.path,sha256:receipt.sha256}]});
 }
 return e;
}
module.exports={hash,scopeSchema,scope,covers,assertFresh,event,resolveId,lookup};

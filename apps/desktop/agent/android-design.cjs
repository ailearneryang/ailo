const fs=require('node:fs/promises');
const {resolveFile}=require('./workspace.cjs'),{hash}=require('./evidence.cjs');
const configPath='android-design.json';
const instruction='先将目标画板与 Android 实现绑定：写 android-design.json，格式 {"screens":[{"boardId":"原稿画板ID","layout":"app/src/main/res/layout/activity_main.xml","reference":"原稿渲染PNG相对路径","screenshot":"运行截图相对路径，截图后填写"}]}。每项对应一个需还原的界面；实现必须使用原稿的背景、组件、文字样式和底栏。运行截图尺寸一致或无法自动看图都不能代替这些实现。';
function color(c){
 if(!c||!['red','green','blue'].every(k=>Number.isFinite(c[k])))return;
 return '#'+[c.red,c.green,c.blue,c.alpha??1].map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');
}
function androidColor(c){const rgba=color(c);return rgba?'#'+rgba.slice(7,9)+rgba.slice(1,7):undefined;}
function describe(board,masters){
 const regions=[],texts=[],bitmaps=[],elements=[],palette=new Set(),unresolved=new Set();let visited=0,truncated=false;
 function walk(layer,parent,scale,stack,depth,overrides={},regionId,instancePath=''){
  if(layer.isVisible===false)return;
  if(++visited>30000||depth>64){truncated=true;return;}
  const f=layer.frame||{},frame={x:parent.x+(f.x||0)*scale.x,y:parent.y+(f.y||0)*scale.y,width:(f.width||0)*scale.x,height:(f.height||0)*scale.y};
  for(const k of Object.keys(frame))frame[k]=Math.round(frame[k]*100)/100;
  const fills=(layer.style?.fills||[]).filter(f=>f.isEnabled!==false).map(f=>({type:f.fillType,color:color(f.color),androidColor:androidColor(f.color),image:f.image?._ref}));
  for(const f of fills)if(f.color)palette.add(f.color);
  const name=String(layer.name||'').slice(0,120),id=layer.do_objectID||'layer_'+visited;
  const parentPath=instancePath;instancePath+=(instancePath?'/':'')+id;
  if(depth===1){regionId=id;if(regions.length<32)regions.push({id,name,type:layer._class,frame,fills});else truncated=true;}
  if(elements.length<2000)elements.push({instanceId:instancePath,parent:parentPath,regionId,type:layer._class,frame,image:layer.image?._ref,prototype:['symbolInstance','group'].includes(layer._class)?'container:'+Math.round(frame.width)+':'+Math.round(frame.height):['shapeGroup','rectangle'].includes(layer._class)&&fills.length?layer._class+':'+Math.round(frame.width)+':'+Math.round(frame.height):undefined});else truncated=true;
  if(layer._class==='text'&&texts.length<60){
   const attributes=layer.attributedString?.attributes?.[0]?.attributes||{},font=attributes.MSAttributedStringFontAttribute?.attributes;
   const textColor=color(attributes.MSAttributedStringColorAttribute);if(textColor)palette.add(textColor);
   texts.push({id,name,frame,text:String(overrides[id+'_stringValue']??layer.attributedString?.string??'').slice(0,160),font:font?{name:font.name,size:font.size*scale.y,sourceSize:font.size}:undefined,color:textColor,androidColor:androidColor(attributes.MSAttributedStringColorAttribute)});
  }
  const image=overrides[id+'_image']?._ref||layer.image?._ref;
  if(layer._class==='bitmap'&&image&&bitmaps.length<24)bitmaps.push({id,name,frame,image});
  for(const fill of fills)if(fill.image&&bitmaps.length<24)bitmaps.push({id,name,frame,image:fill.image});
  if(layer._class==='symbolInstance'){
   const master=masters.get(layer.symbolID);
   if(!master){unresolved.add(layer.symbolID||name);return;}
   if(stack.has(layer.symbolID)){truncated=true;return;}
   const next=new Set(stack);next.add(layer.symbolID);
   const values={...overrides};for(const v of layer.overrideValues||[])values[v.overrideName]=v.value;
   const scaled={x:frame.width/(master.frame?.width||frame.width||1),y:frame.height/(master.frame?.height||frame.height||1)};
   for(const child of master.layers||[])walk(child,frame,scaled,next,depth+1,values,regionId,instancePath);
  }else for(const child of layer.layers||[])walk(child,frame,scale,stack,depth+1,overrides,regionId,instancePath);
 }
 // Sketch page coordinates are not screen coordinates. Start at the board origin.
 for(const layer of board.layers||[])walk(layer,{x:0,y:0},{x:1,y:1},new Set(),1);
 const baseline={id:board.do_objectID,name:board.name,width:board.frame?.width,height:board.frame?.height,regions,texts,bitmaps,palette:[...palette].slice(0,24),unresolvedSymbols:[...unresolved],truncated,notice:'frame 为画板内的轴向像素包围框；旋转、蒙版、复杂组件覆盖仍需查原文和截图。color/palette 为 #RRGGBBAA；Android 必须使用 androidColor（#AARRGGBB）。按目标密度转换px/dp/sp，处理系统栏、字体留白和溢出。动态值可变化，加载/空/失败状态也须保留组件；未知车载数据不冒充实况气温。'};
 baseline.designManifest=require('./design-regions.cjs').manifest(baseline,elements);
 if(baseline.designManifest.regions.some(r=>r.repeats.length>64||r.repeats.some(g=>g.count>1000)))baseline.truncated=true;
 return baseline;
}
async function inspect(root){
 const graph=await require('./sketch-fidelity.cjs').readSource(root);
 if(!graph.pages.length)return {status:'unavailable',sources:[],issues:[]};
 const boards=new Map(),masters=new Map();
 function index(l){if(l._class==='symbolMaster'&&l.symbolID)masters.set(l.symbolID,l);for(const c of l.layers||[])index(c);}
 for(const page of graph.pages){for(const layer of page.layers){index(layer);if(['group','artboard'].includes(layer._class)&&layer.isVisible!==false&&layer.frame?.width>=320&&layer.frame?.height>=320)boards.set(layer.do_objectID||layer.name,layer);}}
 for(const doc of graph.documents)for(const f of doc.foreignSymbols||[])if(f.symbolMaster)index(f.symbolMaster);
 if(!boards.size)return {status:'unavailable',sources:graph.sources,issues:[]};
 const candidates=[...boards.values()].map(b=>({id:b.do_objectID,name:b.name,width:b.frame.width,height:b.frame.height}));
 const sources=[...graph.sources],issues=graph.truncated?['原稿扫描不完整，请缩小提取目录后重新检查']:[];
 let config;
 try{const file=await resolveFile(root,configPath);if((await fs.stat(file)).size>16000)throw Error('android-design.json 不能超过16KB');const data=await fs.readFile(file);config=JSON.parse(data);sources.push({path:configPath,sha256:hash(data)});}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!config)return {status:'binding_required',candidates:candidates.slice(0,60),sources,sourceBaseline:graph.sources,issues:['尚未绑定原稿画板与 Android 界面，不能确认实现了哪一版设计',...issues],instruction};
 if(!Array.isArray(config.screens)||!config.screens.length||config.screens.length>12)throw Error('android-design.json screens 需要1–12个界面');
 const screens=[],seen=new Set();
 for(const entry of config.screens){
  const board=boards.get(entry.boardId);
  if(!board||seen.has(entry.boardId))throw Error('android-design.json boardId 必须是原稿中真实且不重复的画板ID');seen.add(entry.boardId);
  const baseline=describe(board,masters),screen={...entry,baseline};
  for(const key of ['layout','reference']){
   if(typeof entry[key]!=='string'||!entry[key])throw Error('设计绑定须提供 layout 与 reference 相对路径');
   const file=await resolveFile(root,entry[key]);let stat;
   try{stat=await fs.stat(file);}catch(e){if(e.code!=='ENOENT')throw e;issues.push(`${board.name} 的 ${key} 文件尚不存在：${entry[key]}`);sources.push({path:entry[key],sha256:null});continue;}
   if(!stat.isFile()||stat.size>(key==='reference'?20*1024*1024:1024*1024))throw Error('设计绑定文件过大或不是普通文件');
   const data=await fs.readFile(file);sources.push({path:entry[key],sha256:hash(data)});
   if(key==='reference'){
    const size=require('./android-display.cjs').pngSize(data);
    if(Math.abs((size.width/size.height)/(baseline.width/baseline.height)-1)>.03)throw Error('原稿参考 PNG 与绑定画板宽高比不符');
   }
  }
  if(entry.screenshot!==undefined){await resolveFile(root,entry.screenshot);if(entry.screenshot===entry.reference)throw Error('原稿参考与运行截图不能使用同一文件');}
  if(baseline.unresolvedSymbols.length)issues.push(`${board.name} 有 ${baseline.unresolvedSymbols.length} 个组件定义未解析，不能静默略过`);
  if(baseline.truncated)issues.push(`${board.name} 图层展开超出限制，请缩小原稿后检查`);
  screens.push(screen);
 }
 return {status:'bound',screens,sources,sourceBaseline:graph.sources,issues,instruction};
}
function failure(message){return Object.assign(Error('Android 设计实现尚未完成：'+message+'。请修复实现、重建 APK 并重新截图；视觉能力限制只适用于尚未确认的细节，不能跳过已知差异。'),{code:'ANDROID_DESIGN_MISMATCH'});}
async function assertDelivery(workspace,images){
 const criteria=require('./requirements.cjs').current(workspace.run);
 if(!criteria.some(c=>c.type==='visual'))return;
 require('./design-regions.cjs').assertNoIssues(workspace.run);
 const saved=workspace.run.androidDesignSourceBaseline;
 if(saved&&saved.inputKey===workspace.run.inputKey){try{await require('./evidence.cjs').assertFresh(workspace,{sources:saved.sources});}catch{throw failure('先前读取的原稿数据已修改或删除，不能通过省略原稿来跳过对照检查');}}
 const design=await inspect(workspace.files);
 if(design.status==='unavailable')return;
 if(design.issues.length)throw failure(design.issues.join('；')+'；'+(design.status==='binding_required'?instruction:''));
 for(const original of design.screens){
  const observed=workspace.run.visualComparisons?.find(o=>o.designBinding?.boardId===original.boardId&&o.designBinding.reference===original.reference&&o.designBinding.layout===original.layout);
  if(observed)await require('./evidence.cjs').assertFresh(workspace,observed);
  const screen={...original,screenshot:observed?.path||original.screenshot};
  if(!screen.screenshot)throw failure(`${screen.baseline.name} 尚无绑定的最终运行截图`);
  const event=await workspace.findEvent(e=>e.type==='android_device'&&e.detail.result?.path===screen.screenshot&&e.detail.result?.pixelSize);
  if(!event||!workspace.run.artifacts.some(a=>/\.apk$/i.test(a.path)&&a.sha256===event.detail.result.apkSha256))throw failure(`${screen.baseline.name} 截图没有匹配当前 APK 的运行凭据`);
  await require('./evidence.cjs').assertFresh(workspace,{sources:[...design.sources,...event.detail.result.sources],revision:event.detail.revision});
  if(workspace.run.observationCapabilities?.images!==false&&screen.baseline.designManifest.regions.length){
   const review=Object.values(workspace.run.designRegionReviews||{}).find(r=>r.boardId===screen.boardId&&r.manifestId===screen.baseline.designManifest.id&&r.sha256===observed?.sha256);
   if(!review)throw require('./design-regions.cjs').error(`${screen.baseline.name} 尚无当前结果的逐区域验收记录；先成对观察，再 verify.checks[].regions`);
   await require('./evidence.cjs').assertFresh(workspace,review);
  }
  if(images?.compare){
   const reference=await fs.readFile(await resolveFile(workspace.files,screen.reference)),actual=await fs.readFile(await resolveFile(workspace.files,screen.screenshot));
   const comparison=await images.compare(reference,actual);
   if(comparison.grossMismatch)throw failure(`${screen.baseline.name} 与原稿存在大面积外观差异（粗略色块差异 ${Math.round(comparison.changedFraction*100)}%，平均色差 ${comparison.meanDifference.toFixed(2)}），请检查背景、内容区域和底栏`);
  }
 }
 if(workspace.run.executionState)workspace.run.executionState.gaps=(workspace.run.executionState.gaps||[]).filter(g=>!g.startsWith('Android 设计：'));
}
function rememberFailure(workspace,error){
 if(!['ANDROID_DESIGN_MISMATCH','VISUAL_DESIGN_MISMATCH','DESIGN_REGION_MISMATCH'].includes(error.code))return;
 const run=workspace.run;
 const label=['ANDROID_DESIGN_MISMATCH','DESIGN_REGION_MISMATCH'].includes(error.code)?'Android 设计：':'视觉对照：';
 run.executionState={...run.executionState,gaps:[(label+error.message).slice(0,1600),...(run.executionState?.gaps||[]).filter(g=>!g.startsWith(label))].slice(0,12),nextAction:error.code==='ANDROID_DESIGN_MISMATCH'?'依据 androidDesign 的原稿区域、样式和资源修复 Android 界面，再构建、安装并截图':'依据原稿与结果的差异修复实现，重新渲染并用 reference 成对检查',expectedResult:'原稿组件已实际实现，大面积外观差异已消除；尚未核验的细节保持未核验',updatedAt:new Date().toISOString()};
 if(run.steps.length&&run.steps.every(s=>s.status==='done'))run.steps[run.steps.length-1]={...run.steps.at(-1),status:'running'};
 run.actionsSincePlan=0;
}
function recordComparison(workspace,observation){
 const run=workspace.run;
 if(observation.reference&&!observation.transform?.crop){
  const previous=run.visualComparisons||[];
  if(!previous.some(o=>o.reference.path===observation.reference.path)&&previous.length>=12)throw Error('对照对象已达12个，请完成当前对象的核验后再开启新任务，不能丢弃尚未修复的差异');
  const prior=previous.find(o=>o.reference.path===observation.reference.path);
  if(!prior?.comparison?.grossMismatch||observation.comparison)run.visualComparisons=[...previous.filter(o=>o.reference.path!==observation.reference.path),observation];
 }
 if(require('./design-regions.cjs').issues(run).length)rememberFailure(workspace,require('./design-regions.cjs').error('仍有未修复的区域差异'));
 if(!observation.comparison?.grossMismatch)return;
 const ids=require('./requirements.cjs').current(run).filter(c=>c.type==='visual').map(c=>c.id);
 for(const id of ids)if(run.acceptanceResults)delete run.acceptanceResults[id];
 const message=`${observation.path} 与 ${observation.reference.path} 存在大面积差异，不能以截图成功代替还原`;
 rememberFailure(workspace,observation.designBinding?failure(message):Object.assign(Error(message),{code:'VISUAL_DESIGN_MISMATCH'}));
}
function context(design,target){
 return {...design,screens:design.screens?.map((screen,i)=>i<2?{...screen,coordinateMapping:Number.isFinite(target?.widthDp)&&Number.isFinite(target?.heightDp)?{sourcePixels:{width:screen.baseline.width,height:screen.baseline.height},targetPixels:{width:target.width,height:target.height},targetDp:{width:target.widthDp,height:target.heightDp},dpPerSourcePixel:{x:target.widthDp/screen.baseline.width,y:target.heightDp/screen.baseline.height},notice:'区域/间距由画板像素换算dp，字号按相同纵向比例换算后核对sp字体缩放；先扣除实际系统栏占用，不把默认文字留白当设计间距。'}:undefined}:{boardId:screen.boardId,layout:screen.layout,reference:screen.reference,screenshot:screen.screenshot,baseline:{id:screen.baseline.id,name:screen.baseline.name,width:screen.baseline.width,height:screen.baseline.height},notice:'完整图层请按原稿ID定点读取；当前上下文仅展开前两个界面'})};
}
function rememberSource(run,design){
 if(design.sourceBaseline?.length&&(!run.androidDesignSourceBaseline||run.androidDesignSourceBaseline.inputKey!==run.inputKey))run.androidDesignSourceBaseline={inputKey:run.inputKey,sources:design.sourceBaseline};
}
module.exports={inspect,context,describe,assertDelivery,rememberFailure,rememberSource,recordComparison,configPath,color,androidColor};

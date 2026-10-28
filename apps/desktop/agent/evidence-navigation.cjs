// Read-only navigation over recorded proof. Availability is never an approval;
// acceptance still checks type, freshness, scope, regions and known differences.
const fs=require('node:fs/promises');
const proof=require('./evidence.cjs'),{resolveFile}=require('./workspace.cjs');
const MAX_IMAGES=96,MAX_PAIRED=4,MAX_RUNTIME=12,MAX_NODES=120,MAX_STRUCTURE_NODES=128;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const compactText=value=>String(value||'').replace(/[\r\n\t]+/g,' ').slice(0,60);
const apkSource=image=>(image.sources||[]).find(s=>/\.apk$/i.test(s.path||'')&&sha(s.sha256));
const imageApk=image=>image.designBinding?.apkSha256||apkSource(image)?.sha256;
const referenceKey=value=>value?.path&&sha(value.sha256)?JSON.stringify([value.path,value.sha256]):null;
const targetKey=value=>value?.path&&sha(value.sha256)&&sha(imageApk(value)||value.apkSha256)?JSON.stringify([value.path,value.sha256,imageApk(value)||value.apkSha256]):null;
async function context(workspace){
 const run=workspace.run,all=run.visualObservations||[],images=all.slice(-MAX_IMAGES).reverse(),hashes=new Map(),freshness=new Map();let currentDesign;
 const fileHash=async path=>{if(!hashes.has(path))hashes.set(path,(async()=>{const file=await resolveFile(workspace.files,path);let stat;try{stat=await fs.stat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}if(!stat.isFile()||stat.size>(/\.apk$/i.test(path)?150:20)*1024**2)throw Error('bounded evidence file required');return proof.hashFile(file);})());return hashes.get(path);};
 const uniqueSources=sources=>[...new Map(sources.map(s=>[JSON.stringify([s.path,s.sha256]),s])).values()].sort((a,b)=>a.path.localeCompare(b.path)||String(a.sha256).localeCompare(String(b.sha256)));
 const currentApks=new Map();
 async function currentApk(image){const source=apkSource(image);if(!source||!sha(imageApk(image)))return !image.designBinding;try{const actual=await fileHash(source.path);currentApks.set(source.path,actual);return actual===source.sha256&&actual===imageApk(image);}catch{return false;}}
 async function fresh(image,event){
  const result=event?.detail?.result||{},sources=uniqueSources([...(result.sources||[]),...(image.sources||[]),{path:image.path,sha256:image.sha256},...(image.reference?[{path:image.reference.path,sha256:image.reference.sha256}]:[])]);
  const key=JSON.stringify([event?.id,sources,image.revision,image.path,image.sha256,image.reference,image.rendererState,image.historicalReplay,image.replayKind,image.displayCheck,image.designBinding,image.designManifest?.id]);
  if(!freshness.has(key))freshness.set(key,(async()=>{
   if(!sha(image.sha256)||!image.path||image.historicalReplay&&image.replayKind!=='user_continuation'||result.displayCheck?.matches===false||image.displayCheck?.matches===false||!await currentApk(image))return false;
   try{
    if(!image.sources?.length&&image.revision!==run.revision||!result.sources?.length&&event.detail.revision!==run.revision)return false;
    // Match proof.assertFresh's explicit source hashes with a per-context file
    // cache. Several IDs may refer to identical pixels; never rehash the APK
    // once per duplicate receipt. Conflicting expected hashes remain failures.
    for(const record of [image,result]){
     if(record.requireCurrentState&&record.rendererState&&run.observationStates?.[record.rendererState.id]!==record.rendererState.version)return false;
     if(record.buildInputs||record.buildInputsChanged||record.buildRevisionRequired||record.fileSet||record.parts)await proof.assertFresh(workspace,record);
    }
    for(const source of sources)if(await fileHash(source.path)!==source.sha256)return false;
    if(event.type==='browser'){if(!result.dom||result.errors?.length||result.dom.missingImages?.length)return false;require('./html-delivery.cjs').assertPageHealth(result);}
    await require('./android-delivery.cjs').assertAssistedImageEvidence(workspace,event);
    if(image.designBinding){currentDesign??=require('./android-design.cjs').inspect(workspace.files);const design=await currentDesign,screen=design.screens?.find(s=>s.boardId===image.designBinding.boardId&&s.layout===image.designBinding.layout&&s.reference===image.reference?.path);if(!screen||design.issues?.length||image.designManifest?.id!==screen.baseline?.designManifest?.id)return false;}
    return true;}catch{return false;}
  })());return freshness.get(key);
 }
 const referencePaths=new Set(all.flatMap(o=>o.reference?.path?[o.reference.path]:[])),paired=[],prepared=[],preview=[],standalone=[],rejected=[];
 let checked=0,unknown=0;const targets=new Map();
 for(const image of all){const key=targetKey(image);if(key){const target=targets.get(key)||{total:0,scanned:0,unknown:0,references:new Map()};target.total++;targets.set(key,target);}}
 for(const image of images){
  const target=targets.get(targetKey(image));if(target)target.scanned++;
  // Old APK receipts need no archive lookup. Their known version mismatch
  // cannot make coverage of current-image candidates artificially unknown.
  if(!await currentApk(image)){rejected.push({eventId:image.eventId,reason:'not_current_or_fresh'});checked++;continue;}
  const event=await proof.lookup(workspace,image.eventId);checked++;
  const devicePreview=event?.type==='android_device'&&event.detail?.operation==='screenshot'&&image.previewOnly===true;
  if(!event||!['view_image','browser'].includes(event.type)&&!devicePreview){unknown++;if(target)target.unknown++;continue;}
  const recorded=event.detail?.result,recordedPath=event.type==='browser'?recorded?.screenshot:recorded?.path||recorded?.screenshot;
  if(recordedPath!==image.path||recorded?.sha256&&recorded.sha256!==image.sha256){rejected.push({eventId:image.eventId,reason:'observation_identity_mismatch'});continue;}
  if(!await fresh(image,event)){rejected.push({eventId:image.eventId,reason:'not_current_or_fresh'});continue;}
  const item={eventId:image.eventId,path:image.path,sha256:image.sha256,scope:image.scope,reference:image.reference?{path:image.reference.path,sha256:image.reference.sha256}:undefined,apkSha256:imageApk(image),delivered:image.delivered===true,fresh:true,grossMismatch:image.comparison?.grossMismatch===true,...(image.historicalReplay?{historicalReplay:true,replayKind:image.replayKind,runtimeEvidence:false}:{}),allowedKinds:[],status:image.delivered?'structurally_available':'awaiting_delivery'};
  if(image.previewOnly||devicePreview){preview.push({...item,status:'preview_only',reason:'not_a_paired_review'});continue;}
  if(!image.reference&&referencePaths.has(image.path)){rejected.push({eventId:image.eventId,reason:'reference_image_only'});continue;}
  if(image.reference){
   if(!referenceKey(image.reference)||image.reference.path===image.path){rejected.push({eventId:image.eventId,reason:'invalid_reference_pair'});continue;}
   if(image.designBinding&&image.designBinding.reference!==image.reference.path){rejected.push({eventId:image.eventId,reason:'design_reference_identity_mismatch'});continue;}
   item.designBinding=image.designBinding?{boardId:image.designBinding.boardId,layout:image.designBinding.layout,reference:image.designBinding.reference}:undefined;
   if(image.delivered){item.allowedKinds=['visual'];paired.push({...item,_image:image});if(target)target.references.set(referenceKey(image.reference),item.reference);}else prepared.push(item);
  }else if(!image.designBinding){
   // Browser / ordinary non-design visual observations remain valid for their
   // existing contract. Known reference-only images were excluded above.
   if(image.delivered)standalone.push({...item,allowedKinds:['visual']});else prepared.push(item);
  }
 }
 // Prefer the latest pair; expose bounded nodes from that exact proof only.
 let primaryNodes;
 if(paired[0]){
  const image=paired[0]._image,hierarchy=image.uiHierarchy;let nodes,complete=false;
  if(hierarchy?.path&&sha(hierarchy.sha256))try{
   const bytes=await fs.readFile(await resolveFile(workspace.files,hierarchy.path));if(proof.hash(bytes)===hierarchy.sha256){const parsed=require('./android-hierarchy.cjs').parse(bytes,hierarchy.package);nodes=parsed.nodes;complete=parsed.complete===true;}
  }catch{}
  // Do not trust an inline node array independently of its source tree hash.
  primaryNodes=nodes?{complete:complete&&nodes.length<=MAX_NODES,total:nodes.length,returned:Math.min(MAX_NODES,nodes.length),sourcePath:hierarchy.path,sourceSha256:hierarchy.sha256,items:nodes.slice(0,MAX_NODES).map(n=>({id:n.id,resourceId:String(n.resourceId||'').slice(0,160),text:compactText(n.text),bounds:n.bounds})),notice:nodes.length>MAX_NODES?'节点仅为有界样本；未列出的真实节点仍可从完整控件树读取，不能据缺席认定不存在。':'节点来自此图的哈希核验控件树；resourceId/text用于定位，不得当作nodeId。'}:undefined;
 }
 const publicPairs=paired.slice(0,MAX_PAIRED).map(({_image,...item},i)=>({...item,...(i===0&&primaryNodes?{nodes:primaryNodes}:{})}));
 const runtime=[];const eventPool=[...(run.events||[])].reverse().filter(e=>['run_command','build_android','android_device','browser'].includes(e.type));
 // Never scan the entire archive for an absent browser/command on every turn.
 // Only an explicit recent receipt event ID may cause an archived lookup.
 for(const type of ['build_android','run_command','browser']){const receipt=(run.observationIndex||[]).findLast(o=>o.action===type&&o.eventId);if(receipt&&!eventPool.some(e=>e.id===receipt.eventId)){const found=await proof.lookup(workspace,receipt.eventId);if(found&&found.type===type)eventPool.push(found);}}
 for(const event of eventPool.slice(0,MAX_RUNTIME*2)){
  if(runtime.length>=MAX_RUNTIME)break;
  try{const result=event.detail?.result;if(result?.apkPath&&result.apkSha256&&await fileHash(result.apkPath)!==result.apkSha256)continue;if(result?.buildArtifacts?.some(a=>a.path&&a.sha256)){
    let current=true;for(const artifact of result.buildArtifacts.slice(0,4))if(artifact.path&&artifact.sha256&&await fileHash(artifact.path)!==artifact.sha256)current=false;if(!current)continue;
   }
   await proof.event(workspace,event.id);const kinds=['run_command','build_android'].includes(event.type)?['command']:['observation'];runtime.push({eventId:event.id,eventType:event.type,operation:event.detail?.operation,scope:result?.scope,apkSha256:result?.apkSha256,allowedKinds:kinds,status:'structurally_available',notice:'真实成功记录只提供证据候选，不证明该记录覆盖全部验收要求。'});}catch{}
 }
 // Text-only models can use a captured hierarchy without pretending that any
 // model received pixels. This diagnostic has no visual/behavior pass role.
 let androidStructure={status:'unavailable',allowedKinds:[],visualAcceptance:'unverified',behaviorAcceptance:'unverified',notice:'尚无绑定当前APK及哈希核验控件树的运行截图。几何信息不可用，不应编造节点或反复看图来获得不存在的图像理解能力。'};
 for(const captured of eventPool.filter(e=>e.type==='android_device'&&['screenshot','check'].includes(e.detail?.operation)).slice(0,MAX_RUNTIME*2)){
  try{
   let event=captured;
   if(captured.detail.operation==='check'){
    const id=captured.detail.result?.checks?.find(item=>item.operation==='screenshot')?.eventId;if(!id)continue;
    event=await proof.lookup(workspace,id);
    if(event?.detail?.result?.path!==captured.detail.result.path||event.detail.result.apkSha256!==captured.detail.result.apkSha256)continue;
   }
   if(event?.type!=='android_device'||event.detail?.operation!=='screenshot')continue;
   const result=event.detail.result,hierarchy=result?.uiHierarchy,size=result?.pixelSize;
   if(!result?.path||!result.apkPath||!sha(result.apkSha256)||!hierarchy?.path||!sha(hierarchy.sha256)||!hierarchy.package||result.package!==undefined&&result.package!==hierarchy.package||result.displayCheck?.matches!==true||![size?.width,size?.height].every(v=>Number.isSafeInteger(v)&&v>0))continue;
   const screenshot=result.sources?.find(s=>s.path===result.path),apk=result.sources?.find(s=>s.path===result.apkPath&&s.sha256===result.apkSha256);
   if(!sha(screenshot?.sha256)||!apk||!result.sources.some(s=>s.path===hierarchy.path&&s.sha256===hierarchy.sha256)||await fileHash(result.apkPath)!==result.apkSha256)continue;
   if(!await fresh({path:result.path,sha256:screenshot.sha256,sources:result.sources,revision:event.detail.revision,displayCheck:result.displayCheck},event))continue;
   const file=await resolveFile(workspace.files,hierarchy.path);if((await fs.stat(file)).size>2*1024**2)continue;
   const bytes=await fs.readFile(file);if(proof.hash(bytes)!==hierarchy.sha256)continue;
   const parsed=require('./android-hierarchy.cjs').parse(bytes,hierarchy.package);
   const {DOMParser}=require(require('node:path').join(__dirname,'../node_modules/@xmldom/xmldom'));
   const xmlNodes=new DOMParser().parseFromString(bytes.toString('utf8'),'text/xml').getElementsByTagName('node');
   const density=result.displayCheck.actual?.density;
   androidStructure={status:'available',eventId:event.id,capturedAt:event.at,screenshot:{path:result.path,sha256:screenshot.sha256,pixelSize:size},apk:{path:result.apkPath,sha256:result.apkSha256},sessionId:result.sessionId,uiStateHash:result.uiStateHash,
    uiHierarchy:{path:hierarchy.path,sha256:hierarchy.sha256,package:hierarchy.package},
    coordinateSystem:{units:'screen_pixels',width:size.width,height:size.height,...(Number.isSafeInteger(density)&&density>0?{density,dpPerPixel:160/density}:{}),notice:'bounds是截图当时控件树的屏幕像素，原点为屏幕左上角；结合androidDesign画板尺寸/坐标映射换算，系统栏和内容区须单独核对，不能盲减固定高度。'},
    nodes:{complete:parsed.complete===true&&parsed.nodes.length<=MAX_STRUCTURE_NODES,total:parsed.nodes.length,returned:Math.min(MAX_STRUCTURE_NODES,parsed.nodes.length),truncated:parsed.nodes.length>MAX_STRUCTURE_NODES,items:parsed.nodes.slice(0,MAX_STRUCTURE_NODES).map(node=>{
     const bounds=node.bounds,raw=xmlNodes.item(Number(node.id.slice(5))),visible=raw?.getAttribute('visible-to-user');
     return {id:node.id,resourceId:String(node.resourceId||'').slice(0,160),class:String(node.class||'').slice(0,160),text:compactText(node.text),bounds,...(['true','false'].includes(visible)?{visible:visible==='true'}:{}),hasPositiveBounds:bounds.width>0&&bounds.height>0,withinViewport:bounds.x>=0&&bounds.y>=0&&bounds.width>0&&bounds.height>0&&bounds.x+bounds.width<=size.width&&bounds.y+bounds.height<=size.height};
    })},allowedKinds:[],visualAcceptance:'unverified',behaviorAcceptance:'unverified',notice:'这是当前APK对应截图时的真实控件几何诊断，独立于图像是否传给模型。截图与控件树是相邻采样，不代表当前设备状态或业务行为；自绘内容可能缺失，节点缺席/几何符合均不证明视觉还原。可结合原稿frame定点修布局，不能自动匹配语义、编造节点或声称视觉通过。'};
   break;
  }catch{}
 }
 const completeVisual=all.length<=MAX_IMAGES&&unknown===0&&paired.length<=MAX_PAIRED&&standalone.length<=MAX_PAIRED;
 // Reference inference concerns this exact screenshot and APK, not unrelated
 // old pictures. Omitted or unknown records of this target remain blocking.
 const targetCoverage=[...new Map(publicPairs.map(item=>{const key=targetKey(item),target=targets.get(key);return [key,{path:item.path,sha256:item.sha256,apkSha256:item.apkSha256,complete:!!target&&target.scanned===target.total&&target.unknown===0,scanned:target?.scanned||0,total:target?.total||0,referenceCount:target?.references.size||0,...(target?.references.size===1?{reference:[...target.references.values()][0]}:{})}];})).values()];
 return {version:1,androidStructure,visual:{currentApkSha256:publicPairs[0]?.apkSha256||[...currentApks.values()][0],paired:publicPairs,awaitingDelivery:prepared.slice(0,MAX_PAIRED),preview:preview.slice(0,MAX_PAIRED),targetCoverage,standalone:standalone.slice(0,MAX_PAIRED),coverage:{complete:completeVisual,scanned:checked,total:all.length,omittedPairs:Math.max(0,paired.length-MAX_PAIRED),nodeSampleComplete:primaryNodes?.complete??false},notice:'候选可引用不等于验收通过。grossMismatch=true须修复实现；preview/reference-only不能替代成对核验。'},runtime,byKind:{visual:[...publicPairs,...standalone.slice(0,MAX_PAIRED)].map(x=>x.eventId),observation:runtime.filter(x=>x.allowedKinds.includes('observation')).map(x=>x.eventId),command:runtime.filter(x=>x.allowedKinds.includes('command')).map(x=>x.eventId)},constraints:{complete:{visual:completeVisual,observation:false,command:false},excludedVisualIds:[...preview.map(x=>x.eventId),...rejected.filter(x=>x.reason==='reference_image_only').map(x=>x.eventId)]},notice:'证据导航只读且有界；省略不等于证据不存在，验收仍核对原要求、范围、新鲜度与区域。'};
}
function focusValue(focus){return focus?.navigation||focus?.evidenceNavigation||focus;}
async function pairedForPending(workspace,focus,options={}){
 const target=focusValue(focus);if(target?.issue!=='paired_image_required'||!target.path||!sha(target.sha256)||!sha(target.apkSha256))return;
 const nav=options.context||await context(workspace),matches=nav.visual.paired.filter(c=>c.delivered&&c.fresh&&c.designBinding?.boardId&&c.designBinding.layout&&c.designBinding.reference===c.reference?.path&&c.path===target.path&&c.sha256===target.sha256&&c.apkSha256===target.apkSha256&&(!target.boardId||target.boardId===c.designBinding.boardId)&&(!target.layout||target.layout===c.designBinding.layout));
 const reference=referenceKey(target.reference);
 if(reference)return matches.find(c=>referenceKey(c.reference)===reference);
 // Legacy preview records have no reference. Resolve only a uniquely verified
 // reference under complete candidate coverage, never guess from wording.
 const coverage=nav.visual.targetCoverage?.find(c=>c.path===target.path&&c.sha256===target.sha256&&c.apkSha256===target.apkSha256);
 if(coverage?(!coverage.complete||coverage.referenceCount!==1||referenceKey(coverage.reference)!==referenceKey(matches[0]?.reference)):!nav.visual.coverage.complete)return;
 if(new Set(matches.map(c=>referenceKey(c.reference))).size!==1)return;
 return matches[0];
}
function pendingNavigation(image,check){return {issue:'paired_image_required',waitFor:'paired_image_delivery',criterionId:check.criterionId,evidenceId:check.evidenceId,path:image.path,sha256:image.sha256,...(image.reference?{reference:{path:image.reference.path,sha256:image.reference.sha256}}:{}),apkSha256:imageApk(image)};}
module.exports={context,pairedForPending,pendingNavigation,MAX_NODES};

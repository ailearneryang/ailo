// Source-backed review ledger. Counts and geometry come from the selected
// design, never from task-specific names or a model-authored checklist.
const {hash}=require('./evidence.cjs');
function grid(frames){
 const distinct=(values,tolerance)=>{const groups=[];for(const v of values.sort((a,b)=>a-b))if(!groups.some(g=>Math.abs(g-v)<=tolerance))groups.push(v);return groups.length;};
 return {rows:distinct(frames.map(f=>f.y+f.height/2),Math.max(2,Math.min(...frames.map(f=>f.height))*.15)),columns:distinct(frames.map(f=>f.x+f.width/2),Math.max(2,Math.min(...frames.map(f=>f.width))*.15))};
}
function manifest(baseline,elements){
 const regions=baseline.regions.map(region=>{
  const children=elements.filter(e=>e.regionId===region.id),groups=new Map();
  for(const e of children){
   if(!e.prototype||e.frame.width<24||e.frame.height<24)continue;
   const key=JSON.stringify([e.parent,e.prototype]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);
  }
  // Exporters mix symbol instances with detached groups. Equal-sized sibling
  // containers still form the same grid; overlapping compositing layers do not.
  const repeats=[...groups.entries()].filter(([,items])=>items.length>=2&&new Set(items.map(e=>JSON.stringify([Math.round((e.frame.x+e.frame.width/2)/Math.max(2,e.frame.width*.15)),Math.round((e.frame.y+e.frame.height/2)/Math.max(2,e.frame.height*.15))]))).size===items.length).map(([key,items])=>({id:'repeat_'+hash(key).slice(0,16),basis:'equal_size_sibling_geometry',count:items.length,...grid(items.map(e=>e.frame)),frames:items.map(e=>e.frame),sourceIds:items.map(e=>e.instanceId)}));
  return {id:region.id,name:region.name,frame:region.frame,repeats,textCount:children.filter(e=>e.type==='text').length,imageCount:children.filter(e=>e.image).length};
 });
 return {version:1,id:hash(JSON.stringify([baseline.id,regions,elements])),width:baseline.width,height:baseline.height,regions,notice:'清单来自原稿；重复组数量与排列不可省略。动态值可变化，加载/空/失败状态仍须保留组件。核对后在 verify 的 regions 逐区提交状态与差异；色差不是验收。'};
}
const text={type:'string',minLength:1,maxLength:800};
const schema={type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:false,required:['id','status','reason'],properties:{id:text,status:{type:'string',enum:['matched','mismatch','unverified']},reason:text,nodeIds:{type:'array',maxItems:128,items:{type:'string'}},repeats:{type:'array',maxItems:64,items:{type:'object',additionalProperties:false,required:['id','observedCount','rows','columns','basis'],properties:{id:text,observedCount:{type:'integer',minimum:0,maximum:1000},rows:{type:'integer',minimum:0,maximum:1000},columns:{type:'integer',minimum:0,maximum:1000},basis:{type:'string',enum:['hierarchy','image']},nodeIds:{type:'array',maxItems:128,items:{type:'string'}},reason:text}}}}}};
function issues(run){return Object.values(run.designRegionIssues||{}).filter(i=>i.status==='open');}
function issueKey(binding,id){return hash(JSON.stringify([binding.boardId,binding.layout,binding.reference,id]));}
function error(message){return Object.assign(Error('设计区域尚未核验：'+message+'。依据 designManifest 修复或补齐逐区证据，低色差不能替代验收。'),{code:'DESIGN_REGION_MISMATCH'});}
async function assess(workspace,image,reports){
 const m=image.designManifest;if(!m?.regions.length)return;
 if(image.transform?.crop||image.scope?.kind!=='viewport'||!image.reference)throw error('逐区域验收需要完整运行截图与成对原稿，局部裁剪不能替代');
 const cached=workspace.run.designRegionReviews?.[issueKey(image.designBinding,'review')];
 if(reports===undefined&&cached?.evidenceId===image.eventId&&cached.manifestId===m.id&&cached.sha256===image.sha256&&!issues(workspace.run).some(i=>i.boardId===image.designBinding.boardId&&i.layout===image.designBinding.layout&&i.reference===image.reference.path))return cached;
 if(!Array.isArray(reports)||reports.length>32||reports.length!==m.regions.length)throw error('必须逐项覆盖 '+m.regions.length+' 个原稿区域');
 const ids=new Set(),failures=[],checked=[];
 let nodes;
 if(image.uiHierarchy?.path){
  const {resolveFile}=require('./workspace.cjs'),fs=require('node:fs/promises');
  const bytes=await fs.readFile(await resolveFile(workspace.files,image.uiHierarchy.path));
  if(hash(bytes)!==image.uiHierarchy.sha256)throw error('控件树已变化');
  nodes=require('./android-hierarchy.cjs').parse(bytes,image.uiHierarchy.package).nodes;
 }
 for(const report of reports){
  const region=m.regions.find(r=>r.id===report?.id);
  if(!region||ids.has(report.id)||!['matched','mismatch','unverified'].includes(report.status)||typeof report.reason!=='string'||!report.reason.trim()||report.reason.length>800)throw error('区域 ID、状态或说明无效');ids.add(report.id);
  let problem=report.status==='matched'?'':report.reason;
  const repeats=report.repeats||[],expected=region.repeats;
  if(!Array.isArray(repeats)||repeats.length>64)throw error('重复组核对须为不超过64项的数组');
  if(repeats.length!==expected.length||new Set(repeats.map(r=>r.id)).size!==repeats.length)problem||='重复组件组核对不完整';
  for(const target of expected){
   const actual=repeats.find(r=>r.id===target.id);
   if(!actual||!['image','hierarchy'].includes(actual.basis)||actual.observedCount!==target.count||actual.rows!==target.rows||actual.columns!==target.columns){problem||='重复组件数量或排列不符：'+target.id;continue;}
   if(actual.basis==='hierarchy'){
    const selected=selectNodes(nodes,actual.nodeIds);
    if(!selected||selected.length!==target.count||JSON.stringify(grid(selected.map(n=>n.bounds)))!==JSON.stringify({rows:target.rows,columns:target.columns})||!aligned(selected.map(n=>n.bounds),target.frames,image.pixelSize,m))problem||='控件树未证明重复组件的数量、位置与排列：'+target.id;
   }else if(typeof actual.reason!=='string'||!actual.reason.trim()||actual.reason.length>800)problem||='图像核对重复组须说明可见组件及排列，不能只复述预期数量';
  }
  if(report.nodeIds?.length){const selected=selectNodes(nodes,report.nodeIds);if(!selected||selected.some(n=>!inside(n.bounds,region.frame,image.pixelSize,m)))problem||='关联控件不在原稿区域内或不可见';}
  const key=issueKey(image.designBinding,region.id),prior=workspace.run.designRegionIssues?.[key];
  if(!problem&&prior?.status==='open'&&prior.sha256===image.sha256)problem='同一张结果图不能关闭已确认的区域差异';
  checked.push({id:region.id,status:problem?(report.status==='unverified'?'unverified':'mismatch'):'matched',reason:problem||report.reason,repeats});
  if(problem)failures.push({key,boardId:image.designBinding.boardId,layout:image.designBinding.layout,reference:image.reference.path,regionId:region.id,region:region.name,status:'open',finding:report.status==='unverified'?'unverified':'mismatch',reason:problem,eventId:image.eventId,sha256:image.sha256,sources:image.sources});
 }
 if(failures.length){
  workspace.run.designRegionIssues||={};for(const item of failures)workspace.run.designRegionIssues[item.key]=item;
  const visualIds=require('./requirements.cjs').current(workspace.run).filter(r=>r.type==='visual').map(r=>r.id);for(const id of visualIds)if(workspace.run.acceptanceResults)delete workspace.run.acceptanceResults[id];
  await workspace.event('design_region_mismatch',{message:'设计区域核对未通过：'+failures.map(f=>f.region+'：'+f.reason).join('；').slice(0,1000),regions:failures.map(({regionId,region,reason})=>({regionId,region,reason})),evidenceId:image.eventId});
  const e=error(failures.map(f=>f.region+'：'+f.reason).join('；'));require('./android-design.cjs').rememberFailure(workspace,e);await workspace.save();throw e;
 }
 return {manifestId:m.id,boardId:image.designBinding.boardId,evidenceId:image.eventId,regions:checked,basis:'model_assessment_with_optional_hierarchy',sources:image.sources};
}
function selectNodes(nodes,ids){if(!nodes||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)return;const selected=ids.map(id=>nodes.find(n=>n.id===id));return selected.every(n=>n&&n.bounds.width>0&&n.bounds.height>0)?selected:undefined;}
function normalized(frame,size){return {x:frame.x/size.width,y:frame.y/size.height,width:frame.width/size.width,height:frame.height/size.height};}
function inside(actual,expected,size,m){
 if(!size?.width||!size?.height)return false;const a=normalized(actual,size),b=normalized(expected,m),cx=a.x+a.width/2,cy=a.y+a.height/2;
 return a.x>=0&&a.y>=0&&a.x+a.width<=1.01&&a.y+a.height<=1.01&&cx>=b.x-.025&&cx<=b.x+b.width+.025&&cy>=b.y-.025&&cy<=b.y+b.height+.025;
}
function aligned(actual,expected,size,m){
 if(!size?.width||!size?.height)return false;const used=new Set();
 return expected.every(frame=>{const b=normalized(frame,m);const i=actual.findIndex((a,i)=>{
  if(used.has(i)||!inside(a,frame,size,m))return false;const n=normalized(a,size);
  return Math.abs(n.x+n.width/2-b.x-b.width/2)<=Math.max(.025,b.width*.15)&&Math.abs(n.y+n.height/2-b.y-b.height/2)<=Math.max(.025,b.height*.15)&&n.width>=b.width*.65&&n.width<=b.width*1.5&&n.height>=b.height*.65&&n.height<=b.height*1.5;
 });if(i<0)return false;used.add(i);return true;});
}
function commit(run,review,image){
 if(!review)return;
 for(const region of review.regions){const old=run.designRegionIssues?.[issueKey(image.designBinding,region.id)];if(old)Object.assign(old,{status:'verified',verifiedEventId:image.eventId});}
 run.designRegionReviews||={};run.designRegionReviews[issueKey(image.designBinding,'review')]={...review,sha256:image.sha256};
}
function assertNoIssues(run){const open=issues(run);if(open.length)throw error(open.map(i=>i.region+'：'+i.reason).join('；'));}
module.exports={manifest,grid,schema,assess,commit,issues,assertNoIssues,error};

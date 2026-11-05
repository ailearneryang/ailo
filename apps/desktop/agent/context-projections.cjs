// Inference projections only. The design spec and failure ledger remain the
// authoritative inputs for acceptance and recovery; summaries never replace them.
const {createHash}=require('node:crypto');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const text=(value,max)=>typeof value==='string'?value.slice(0,max):undefined;
const id=value=>typeof value==='string'&&value.length<=160?value:undefined;
const number=value=>Number.isFinite(value)?Math.round(value*100)/100:undefined;
const frame=value=>Object.fromEntries(['x','y','width','height'].filter(k=>Number.isFinite(value?.[k])).map(k=>[k,number(value[k])]));
function details(reference,kind){
 return uuid(reference)?{available:true,observationId:reference,tool:'read_execution',view:'result',content:kind,complete:false,notice:'当前仅为导航摘要；完整原文在该真实归档中，按 next 读取。摘要不代表已经完整阅读或验收。'}:{available:false,complete:false,content:kind,notice:'当前仅为导航摘要；完整原文尚无可用归档引用，不能假定已完整提供。'};
}
function designContext(design={},target,{detailsObservationId,focusTargetIds=[]}={}){
 let remaining=48,targetRemaining=16;
 const selectedScreens=(design.screens||[]).slice(0,12),focus=new Set(focusTargetIds);
 const screens=selectedScreens.map((screen,screenIndex)=>{
  const baseline=screen.baseline||{},manifest=baseline.designManifest||{},all=manifest.regions||baseline.regions||[],selected=all.slice(0,Math.min(32,remaining));remaining-=selected.length;
  const regions=selected.map(region=>({id:id(region.id),name:text(region.name,60),frame:frame(region.frame),repeatGroupCount:region.repeats?.length||0,...(region.repeats?.length?{repeats:region.repeats.slice(0,4).map(group=>({id:id(group.id),count:number(group.count),rows:number(group.rows),columns:number(group.columns)})),repeatNavigationTruncated:region.repeats.length>4}:{} )}));
  const availableTargets=(manifest.targets||[]).filter(t=>typeof t.id==='string'&&t.id.length<=300);
  const targetBudget=Math.min(targetRemaining,Math.max(1,Math.ceil(targetRemaining/(selectedScreens.length-screenIndex))));
  const byRegion=new Map();for(const t of availableTargets){const group=byRegion.get(t.regionId)||[];group.push(t);byRegion.set(t.regionId,group);}
  const chosen=availableTargets.filter(t=>focus.has(t.id)).slice(0,targetBudget),used=new Set(chosen.map(t=>t.id));
  while(chosen.length<targetBudget){let added=false;for(const group of byRegion.values()){const t=group.find(t=>!used.has(t.id));if(!t)continue;chosen.push(t);used.add(t.id);added=true;if(chosen.length>=targetBudget)break;}if(!added)break;}
  const targets=chosen.map(t=>({id:t.id,regionId:id(t.regionId),type:text(t.type,40),frame:frame(t.frame)}));targetRemaining-=targets.length;
  const totalTargets=manifest.targetCoverage?.total??manifest.targets?.length??0;
  const targetCoverage={total:totalTargets,provided:targets.length,truncated:totalTargets>targets.length};
  const mapping=Number.isFinite(target?.widthDp)&&Number.isFinite(target?.heightDp)&&baseline.width>0&&baseline.height>0?{sourcePixels:{width:baseline.width,height:baseline.height},targetPixels:{width:target.width,height:target.height},targetDp:{width:target.widthDp,height:target.heightDp},dpPerSourcePixel:{x:target.widthDp/baseline.width,y:target.heightDp/baseline.height},notice:'按画板像素换算dp/sp并扣除系统栏；字体、颜色、资源与完整重复组需回查原始spec。'}:undefined;
  return {boardId:id(screen.boardId),layout:text(screen.layout,500),reference:text(screen.reference,500),screenshot:text(screen.screenshot,500),baseline:{id:id(baseline.id),name:text(baseline.name,120),width:number(baseline.width),height:number(baseline.height),truncated:baseline.truncated===true,unresolvedSymbolCount:baseline.unresolvedSymbols?.length||0,bitmapSources:(baseline.bitmaps||[]).filter(b=>(b.frame?.width||0)*(b.frame?.height||0)>=(baseline.width||0)*(baseline.height||0)*.2).sort((a,b)=>(b.frame?.width||0)*(b.frame?.height||0)-(a.frame?.width||0)*(a.frame?.height||0)).slice(0,3).map(b=>({id:id(b.id),name:text(b.name,120),image:text(b.image,500),frame:frame(b.frame)})),bitmapSourceCount:baseline.bitmaps?.length||0,designManifest:{id:id(manifest.id),version:manifest.version,regionCount:all.length,regions,targets,targetCoverage,navigationTruncated:all.length>regions.length}},...(mapping?{coordinateMapping:mapping}:{})};
 });
 const provenance=design.sourceBaseline||design.sources||[];
 return {status:text(design.status,80),screenCount:design.screens?.length||0,screens,navigationTruncated:(design.screens?.length||0)>screens.length||screens.some(s=>s.baseline.designManifest.navigationTruncated),candidates:design.candidates?.slice(0,20).map(c=>({id:id(c.id),name:text(c.name,120),width:number(c.width),height:number(c.height)})),candidateCount:design.candidates?.length||0,issues:(design.issues||[]).slice(0,12).map(issue=>text(issue,300)),issueCount:design.issues?.length||0,sourceCount:design.sources?.length||0,sourcesSummary:{sourceBaselineCount:design.sourceBaseline?.length||0,examples:provenance.slice(0,3).map(source=>({path:text(source.path,500),sha256:text(source.sha256,64)})),truncated:provenance.length>3,notice:'仅列少量真实来源导航；完整 sources/sourceBaseline 位于 details 归档。'},details:details(detailsObservationId,'完整设计spec：baseline、manifest、字体、颜色、资源、重复组及来源'),instruction:text(design.instruction,1200),notice:'targets为全局最多16个真实细组件导航，targetCoverage标明未列出的数量；未列出不表示不存在，按details及其来源路径回查。保留原稿要求和验收范围。此处是有界导航，不能据摘要省略组件或宣称视觉通过；按 details 回查完整spec，并用实际成对图像和逐区域记录验收。bitmapSources是组件原图引用和画板位置导航，不是已合格素材；使用前须检查原始图片与组件裁剪、遮罩、导出效果的关系，发现原图标识或原稿与导出不一致时保留问题，不凭文件名复用。'};
}
function failureTarget(target={}){
 const result={};
 for(const field of ['action','operation','path','id','entry','pointer'])if(target[field]!==undefined)result[field]=text(target[field],field==='path'||field==='entry'||field==='pointer'?500:160);
 for(const field of ['offset','limit'])if(Number.isSafeInteger(target[field]))result[field]=target[field];
 if(Array.isArray(target.criterionIds))result.criterionIds=target.criterionIds.slice(0,12).map(id);
 if(Array.isArray(target.tasks))result.tasks=target.tasks.slice(0,8).map(t=>text(t,120));
 if(typeof target.command==='string')result.commandIdentity={sha256:createHash('sha256').update(target.command).digest('hex'),chars:target.command.length};
 return result;
}
function errorReference(run,episode){
 if(uuid(episode.lastEventId))return episode.lastEventId;
 const target=episode.target||{},last=Date.parse(episode.lastAt);
 const event=(run.events||[]).slice().reverse().find(e=>{
  const d=e.detail||{};
  if(e.type!=='tool_error'||!uuid(e.id)||d.action!==target.action||String(d.message||'').slice(0,1600)!==episode.message)return false;
  if(Number.isFinite(last)&&(!Number.isFinite(Date.parse(e.at))||Date.parse(e.at)>last))return false;
  return ['command','path','id','entry','offset'].every(field=>target[field]===undefined||d[field]===target[field]);
 });
 return event?.id;
}
function failureContext(run,records){
 return records.filter(e=>e.status==='open').slice(-8).map(episode=>({id:episode.id,target:failureTarget(episode.target),errorClass:text(episode.errorClass,100),failures:episode.failures,recoveries:episode.recoveries,message:text(episode.message,320),messageTruncated:(episode.message?.length||0)>320,details:details(errorReference(run,episode),'原始工具错误、参数与执行记录')}));
}
module.exports={designContext,failureContext,errorReference};

const {createHash}=require('node:crypto');
const prefix='资源加载失败：';
const idFor=(path,description)=>'diagnostic_'+createHash('sha256').update(JSON.stringify([path,description])).digest('hex').slice(0,16);
function record(workspace,event,requirements){
 const run=workspace.run,result=event.detail.result;
 if(event.type!=='browser'||!result?.path)return;
 run.issues ||= [];
 const health=result.dom?.imageHealth;
 const items=health?.items||[];
 // Complete inventories prevent a duplicate URL outside the scan from hiding
 // a failed image. Absence also requires a nonempty, fully loaded inventory.
 const complete=health&&!health.truncated&&health.total===items.length;
 const fullyLoaded=complete&&items.length>0&&items.every(i=>i.status==='loaded');
 for(const issue of run.issues){
  if(!complete||issue.status!=='open'||issue.scope?.path!==result.path||!issue.description?.startsWith(prefix)||issue.id!==idFor(result.path,issue.description))continue;
  const src=issue.description.slice(prefix.length),matches=items.filter(i=>i.src===src);
  if(!(matches.length&&matches.every(i=>i.status==='loaded'))&&!(fullyLoaded&&!matches.length))continue;
  issue.status='resolved';issue.evidenceId=event.id;
  issue.reason=matches.length?'最新浏览器观察确认此图片已成功加载':'最新完整图片清单已全部加载，旧图片引用已移除或替换';
  issue.history=[...(issue.history||[]),{status:'resolved',evidenceId:event.id,reason:issue.reason,at:event.at}];
 }
 run.browserDiagnostics={path:result.path,eventId:event.id,imageInventoryComplete:!!complete,loaded:items.filter(i=>i.status==='loaded').length,pending:items.filter(i=>i.status==='pending').length,failed:items.filter(i=>i.status==='failed').length,
  instruction:'以最新浏览器检查与 issues 当前状态为准，旧摘要中的失败数量不代表当前错误。pending 表示尚未加载，不能据此认定路径错误；只针对当前仍失败的资源诊断，不凭文件名含中文推断编码问题。'};
 const failures=health?items.filter(i=>i.status==='failed').map(i=>i.src):result.dom?.missingImages||[];
 const descriptions=[...new Set(failures.filter(s=>typeof s==='string'&&s).map(src=>prefix+src)),...(result.errors||[]).map(text=>'页面运行错误：'+text)];
 const ids=requirements.filter(r=>['visual','behavior'].includes(r.type)).map(r=>r.id);
 for(const description of descriptions){
  const id=idFor(result.path,description),old=run.issues.find(i=>i.id===id);
  const issue={id,status:'open',description,requirementIds:ids.length?ids:requirements.map(r=>r.id),scope:result.scope,detectedBy:event.id};
  if(old){Object.assign(old,issue);delete old.evidenceId;delete old.reason;}else run.issues.push(issue);
 }
}
module.exports={record,idFor};

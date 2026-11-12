// Search metadata is presentation only; it does not grant acceptance evidence.
function searchReceipt(event){
 if(event.type!=='web_search')return {};
 const d=event.detail||{},result=d.result,rows=Array.isArray(result?.sources)?result.sources:null;
 const query=typeof d.query==='string'?d.query.slice(0,500):undefined;
 const sourceCount=rows?rows.length:Number.isInteger(d.sourceCount)&&d.sourceCount>=0?d.sourceCount:undefined;
 const sources=(rows||(Array.isArray(d.sources)?d.sources:[])).slice(0,5).flatMap(row=>{
  try{const url=new URL(row.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return [];
   return [{title:String(row.title||url.hostname).slice(0,160),domain:url.hostname}];
  }catch{return typeof row.domain==='string'&&/^[a-z0-9.-]+$/i.test(row.domain)?[{title:String(row.title||row.domain).slice(0,160),domain:row.domain.slice(0,253)}]:[];}
 });
 return {...(query?{query}:{}),...(sourceCount!==undefined?{sourceCount,sources}:{})};
}
// A presentation trace, independent of the runtime's evidence and budgets.
function createExecutionActivity(startedAt,{limit=200}={}) {
 const start=Date.parse(startedAt),events=new Map(),seen=new Set();let count=0,loadedExtensions=[],statuses=[];
 function capture(run){
  if(Array.isArray(run?.loadedExtensions))loadedExtensions=structuredClone(run.loadedExtensions);
  for(const event of run?.events||[]){
   if(!event?.id||!Number.isFinite(Date.parse(event.at))||Date.parse(event.at)<start)continue;
   if(!seen.has(event.id)){seen.add(event.id);count++;}
   else if(!events.has(event.id))continue;
   const detail=searchReceipt(event);
   if(event.type==='run_command')detail.feedback=Array.isArray(event.detail?.feedback)?event.detail.feedback.filter(v=>typeof v==='string'&&/^(?:操作超时，结果待确认|输出提示需要认证或认证失败|输出提示访问被拒绝|输出提示地址不存在或不可见|输出提示网络连接失败|当前目录不是 Git 仓库|HTTP \d{3}(?: \/ \d{3}){0,3}|命令已结束（退出码 0）|命令失败（退出码 -?\d+）)$/.test(v)).slice(0,4):require('./operation-feedback.cjs').operationFeedback(event.detail);
   for(const key of ['reason','field','issue'])if(typeof event.detail?.[key]==='string')detail[key]=event.detail[key].slice(0,80);
   for(const field of ['actionId','operation','purpose','message','path','name','agentId','agentType','state','action','entry','command','output','startedAt','durationMs','exitCode','timedOut','outputTruncated']){
    const v=event.detail?.[field];if(typeof v==='string')detail[field]=field==='output'?v.slice(-4000):v.slice(0,field==='command'?10000:600);else if(typeof v==='number'||typeof v==='boolean')detail[field]=v;
   }
   if(typeof event.detail?.output==='string'){detail.outputLimit=4000;if(event.detail.output.length>4000)detail.outputTruncated=true;}
   events.set(event.id,{id:event.id,type:event.type,at:event.at,detail});
   if(events.size>limit)events.delete(events.keys().next().value);
  }
  return {events:[...events.values()],loadedExtensions,statuses:structuredClone(statuses),eventCount:count,eventsTruncated:count>events.size};
 }
 function status(message){
  if(typeof message!=='string'||!message.trim())return capture();
  const text=message.trim().slice(0,1000),last=statuses.at(-1),key=text.replace(/[\d,.]+/g,'#');
  if(last&&last.message.replace(/[\d,.]+/g,'#')===key){last.message=text;last.updatedAt=new Date().toISOString();}
  else statuses.push({id:require('node:crypto').randomUUID(),at:new Date().toISOString(),message:text});
  statuses=statuses.slice(-40);return capture();
 }
 function skills(items){loadedExtensions=(items||[]).map(e=>({id:e.id,name:e.name,kind:e.kind}));return capture();}
 return {capture,status,skills};
}
module.exports={createExecutionActivity,searchReceipt};

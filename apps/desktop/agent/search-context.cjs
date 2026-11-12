// Navigation for successful searches survives the recent-tool window. Raw results
// stay in the immutable observation archive; this projection is never verification.
function project(result,id,budget=4800){
 if(!Array.isArray(result?.sources))return;
 const sources=result.sources.slice(0,20).map((s,index)=>({index,title:String(s.title||'').slice(0,180),url:String(s.url||'').slice(0,1600),date:typeof s.date==='string'?s.date.slice(0,80):undefined,content:String(s.content||'').slice(0,400)}));
 // Keep source identities and links before allocating excerpt space.
 for(const source of sources){if(JSON.stringify(sources).length<=budget)break;source.content='';}
 while(sources.length&&JSON.stringify(sources).length>budget)sources.pop();
 return {observationId:id,query:String(result.query||'').slice(0,200),searchedAt:result.searchedAt,sources,totalSources:result.sources.length,complete:false,read:{action:'read_execution',id,view:'result',offset:0},notice:'真实搜索回执的来源导航与摘录，不是全文或事实核验。需要更多内容时直接读取此原始归档并按 next 翻页，不反复读取分页的归档。'};
}
function createContext(workspace){
 const cache=new Map();
 return async()=>{
  const run=workspace.run,prior=new Set(run.inputTurn?.followup?run.inputTurn.observationIds||[]:[]),rows=[];
  const receipts=(run.observationIndex||[]).filter(r=>r.action==='web_search'&&!r.error&&!prior.has(r.id)).slice(-3);
  for(const receipt of receipts){
   let record=cache.get(receipt.id);
   if(!record){try{record=await workspace.observationRecord(receipt.id,{archiveOnly:true});cache.set(receipt.id,record);}catch{continue;}}
   if(record.executionId&&record.executionId!==run.executionId||record.response?.error||record.response?.result?.notExecuted)continue;
   const value=project(record.response?.result,record.id);if(value)rows.push(value);
  }
  return rows.length?{results:rows,notice:'本次执行已取得以下搜索结果；历史文件仅作回顾。不得因近期工具窗口不再显示搜索而声称尚未搜索；资料不足仍如实说明。'}:undefined;
 };
}
module.exports={project,createContext};

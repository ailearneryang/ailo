const {normalizeProjectPath,resolveFile}=require('./workspace.cjs');
const MAX_CHARS=48000;

// These are exact source characters, not tool previews or model summaries.
// Offsets always refer to the file version identified by sha256.
function remember(run,result,observationId){
 if(!result||result.notExecuted||result.error||typeof result.text!=='string'||!result.text.length)return;
 let relative;try{relative=normalizeProjectPath(result.path);}catch{return;}
 if(!/^[a-f0-9]{64}$/.test(result.sha256)||!Number.isSafeInteger(result.offset)||result.offset<0||!Number.isSafeInteger(result.total)||result.total<result.offset+result.text.length)return;
 const entries=run.sourceFragments||[],old=entries.find(f=>f.path===relative&&f.sha256===result.sha256&&f.total===result.total);
 const ranges=[...(old?.ranges||[]),{offset:result.offset,text:result.text,observationId}].sort((a,b)=>a.offset-b.offset),merged=[];
 for(const range of ranges){
  const previous=merged.at(-1),end=previous&&previous.offset+previous.text.length;
  if(previous&&range.offset<=end){
   const overlap=Math.min(end-range.offset,range.text.length);
   if(previous.text.slice(range.offset-previous.offset,range.offset-previous.offset+overlap)!==range.text.slice(0,overlap))return;
   previous.text+=range.text.slice(overlap);
   previous.observationId=range.observationId||previous.observationId;
  }else merged.push({...range});
 }
 // Retain recent ranges when a single very large file exceeds the cache bound.
 while(merged.reduce((n,r)=>n+r.text.length,0)>MAX_CHARS){
  const range=merged[0],excess=merged.reduce((n,r)=>n+r.text.length,0)-MAX_CHARS;
  if(range.text.length<=excess)merged.shift();else{range.offset+=excess;range.text=range.text.slice(excess);}
 }
 const next=entries.filter(f=>f.path!==relative).concat({path:relative,sha256:result.sha256,total:result.total,ranges:merged});
 while(next.length>8||next.reduce((n,f)=>n+f.ranges.reduce((m,r)=>m+r.text.length,0),0)>MAX_CHARS)next.shift();
 run.sourceFragments=next;
}

function missing(total,ranges){
 const gaps=[];let cursor=0;
 for(const range of ranges){if(range.offset>cursor)gaps.push({offset:cursor,end:range.offset});cursor=Math.max(cursor,range.offset+range.text.length);}
 if(cursor<total)gaps.push({offset:cursor,end:total});return gaps;
}

function context(run,budget=24000){
 const files=[];
 for(const file of [...(run.sourceFragments||[])].reverse()){
  const ranges=[];
  for(const range of file.ranges){
   if(budget<=0)break;
   const text=range.text.slice(0,budget);budget-=text.length;
   ranges.push({...range,text,end:range.offset+text.length});
  }
  if(!ranges.length)continue;
  const gaps=missing(file.total,ranges);
  files.push({path:file.path,sha256:file.sha256,total:file.total,ranges,missingRanges:gaps,complete:gaps.length===0});
 }
 return {files,instruction:'ranges.text 是当前文件版本的精确原文，offset/end 按字符计数。complete=true 表示全文已在此处，不再 read_file 或翻读归档；直接使用 sha256 和原文构造 edit_file。missingRanges 才是未提供范围，确需时定点读取。不要混用归档 JSON 的偏移量与文件偏移量。'};
}

function covered(context,source){
 const file=context?.files.find(f=>f.path===source.path&&f.sha256===source.sha256);
 return !!file&&file.ranges.some(r=>r.offset<=source.offset&&r.end>=source.end);
}

async function archivedSource(workspace,id,depth=0){
 if(depth>=4||!id||['state','observations'].includes(id))return;
 let record;try{record=await workspace.observationRecord(id);}catch{return;}
 const result=record.response?.result;
 if(record.response?.error||record.response?.notExecuted||result?.notExecuted)return;
 if(record.action?.action==='read_file'&&result?.sha256)return {...result,path:record.action.path,observationId:id};
 if(record.action?.action==='read_execution')return archivedSource(workspace,record.action.id,depth+1);
}

async function readSource(workspace,action,identity){
 if(action.action==='read_file'&&identity.version){
  const file=(workspace.run.sourceFragments||[]).find(f=>f.path===identity.path&&f.sha256===identity.version);
  if(file)return {path:file.path,sha256:file.sha256,offset:identity.offset,end:Math.min(file.total,identity.offset+identity.limit)};
 }
 // Explicit record view is for auditing tool arguments, not source rereading.
 if(action.action==='read_execution'&&action.view!=='record'){
  const source=await archivedSource(workspace,action.id);
  if(source)return {path:normalizeProjectPath(source.path),sha256:source.sha256,offset:source.offset,end:source.offset+source.text.length};
 }
}

async function hydrate(workspace){
 const run=workspace.run;
 // Read existing receipts once at startup, including tasks created before this
 // cache existed. No tools are replayed and the task files are never modified.
 for(const entry of (run.observationIndex||[]).filter(o=>o.action==='read_file').slice(-32)){
  const source=await archivedSource(workspace,entry.id);if(source)await rememberCurrent(workspace,source,entry.id);
 }
}
async function rememberCurrent(workspace,source,id){
 try{
  const fs=require('node:fs/promises'),file=await resolveFile(workspace.files,source.path),stat=await fs.stat(file);
  if(!stat.isFile()||stat.size>2*1024*1024)return;
  const hash=require('node:crypto').createHash('sha256').update(await fs.readFile(file)).digest('hex');
  if(hash===source.sha256)remember(workspace.run,source,id);
 }catch{} // Stale/foreign archives must not evict current source fragments.
}
module.exports={remember,context,covered,archivedSource,readSource,hydrate,rememberCurrent,missing};

const fs=require('node:fs/promises'),path=require('node:path');
const {fileURLToPath}=require('node:url');
const {createHash}=require('node:crypto');
const {resolveFile}=require('./workspace.cjs');

// Supply current, bounded source excerpts rather than making the model page
// through a JSON archive containing progress, stdout and duplicated stderr.
async function collect(workspace,build){
 const result=build?.detail?.result;
 if(!result||result.exitCode===0)return;
 const {errors,errorCount}=require('./android-build.cjs').diagnostics(result);
 if(!errors.length)return;
 const targets=new Map();
 for(const error of errors){
  const match=error.match(/(?:^e:\s*|^)(file:\/\/\/.+?|\/?[^\r\n]+?\.(?:kt|java|xml)):(\d+)(?::\d+)?/);
  if(!match)continue;
  try{
   const source=match[1].startsWith('file:')?fileURLToPath(match[1]):match[1];
   const relative=path.isAbsolute(source)?path.relative(workspace.files,source):source;
   // resolveFile enforces project boundaries and rejects symlinks/hardlinks.
   await resolveFile(workspace.files,relative);
   if(!targets.has(relative))targets.set(relative,[]);
   targets.get(relative).push(Number(match[2]));
  }catch{} // Foreign paths and malformed diagnostics are data, never authority.
 }
 const files=[];let remaining=24000;
 async function source(relative,lines=[]){
  if(files.some(f=>f.path===relative)||files.length>=4||remaining<500)return;
  try{
   const file=await resolveFile(workspace.files,relative),stat=await fs.stat(file);
   if(!stat.isFile()||stat.size>2*1024*1024)return;
   const bytes=await fs.readFile(file),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   const sha256=createHash('sha256').update(bytes).digest('hex');
   const budget=Math.min(remaining,12000),windows=[];
   if(text.length<=budget)windows.push({offset:0,end:text.length});
   else if(lines.length){
    const rows=text.split('\n'),starts=[0];for(const row of rows)starts.push(starts.at(-1)+row.length+1);
    for(const line of lines)windows.push({offset:starts[Math.max(0,line-9)]||0,end:Math.min(text.length,starts[Math.min(rows.length,line+8)]||text.length)});
   }else{
    // A related layout has no compiler line number. Show multiple regions,
    // including its end; never silently substitute only its first 17 lines.
    const size=Math.floor(budget/3);
    for(const offset of [0,Math.max(0,Math.floor(text.length/2-size/2)),Math.max(0,text.length-size)])windows.push({offset,end:Math.min(text.length,offset+size)});
   }
   const merged=[];for(const window of windows.sort((a,b)=>a.offset-b.offset)){
    const previous=merged.at(-1);if(previous&&window.offset<=previous.end)previous.end=Math.max(previous.end,window.end);else merged.push({...window});
   }
   const bounded=[];let available=budget;
   for(const window of merged){
    if(!available)break;const end=Math.min(window.end,window.offset+available),excerpt=text.slice(window.offset,end);available-=excerpt.length;remaining-=excerpt.length;
    bounded.push({line:text.slice(0,window.offset).split('\n').length,offset:window.offset,end,text:excerpt});
   }
   const missingRanges=require('./source-memory.cjs').missing(text.length,bounded);
   files.push({path:relative,sha256,total:text.length,excerpts:bounded,complete:missingRanges.length===0,missingRanges,notice:'当前源码；offset/end 按字符计数，line 按行计数。complete=false 时仅 missingRanges 尚未提供。edit_file 使用 sha256 与所给精确原文。'});
   // Kotlin resource IDs often fail because the corresponding layout differs.
   if(files.length<4&&remaining>=500){const layout=text.match(/setContentView\s*\(\s*R\.layout\.([A-Za-z0-9_]+)\s*\)/)?.[1];if(layout)await source('app/src/main/res/layout/'+layout+'.xml');}
  }catch{} // Missing sources stay visible in errors; model can inspect explicitly.
 }
 for(const [relative,lines] of targets)await source(relative,lines);
 return {eventId:build.id,buildRevision:build.detail.revision,currentRevision:workspace.run.revision,errors,errorCount,files,
  instruction:'先对照错误和当前源码/布局修复，再构建。这里已提供的原文不必再从 read_execution 分页读取；缺少的范围才 read_file。旧构建错误不表示当前源码已验证失败，修复后必须重新构建。'};
}
module.exports={collect};

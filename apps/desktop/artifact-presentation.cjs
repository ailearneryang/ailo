// Presentation does not change artifact ownership, validation or delivery status.
// Keep complete files in the ledger; show user-facing outputs before support code.
function isDevelopment(file){
 const name=String(file.path||'').replace(/\\/g,'/'),base=name.split('/').at(-1)||'';
 if(/(?:^|\/)(?:\.ailo[^/]*|node_modules|\.git|schedule-history|_extract|gradle|src|res|drawable[^/]*|mipmap[^/]*)(?:\/|$)/i.test(name))return true;
 if(/(?:^|\/)(?:verification|build-cache)\//i.test(name)&&! /\.(?:png|jpe?g|webp)$/i.test(name))return true;
 return /\.(?:[cm]?[jt]sx?|d\.ts|py|rb|go|rs|kt|kts|java|swift|c|cc|cpp|h|hpp|cs|xml|css|scss|less|json|jsonl|ya?ml|toml|ini|properties|gradle|lock|map|sh|bat|ps1)$/i.test(base)||/^(?:package-lock|pnpm-lock|yarn\.lock|Dockerfile|Makefile|CMakeLists\.txt|gradlew|README(?:\.[^/]*)?)$/i.test(base);
}
function sourceRequested(request){const text=String(request||'');return !/(?:不要|无需|不需要|不用|避免).{0,12}(?:输出|展示|提供|列出).{0,8}(?:代码|源码|工程文件)/.test(text)&&/(?:提供|交付|输出|展示|列出|查看|下载|给我).{0,10}(?:完整源码|源代码|源码|代码文件|工程文件|项目文件)|完整(?:代码|工程|项目)|source code/i.test(text);}
function previewRank(file){
 const p=String(file.path||'');
 if(/\.html?$/i.test(p))return 0;
 if(/\.(?:png|jpe?g|webp|svg)$/i.test(p)&&/预览|效果|运行截图|最终|成品|preview|screenshot/i.test((file.label||'')+' '+p))return 1;
 if(/\.pdf$/i.test(p))return 2;
 if(/\.(?:png|jpe?g|webp|svg)$/i.test(p))return 3;
 if(/\.(?:md|markdown)$/i.test(p))return 4;
 return 99;
}
function groupArtifacts(files,options={}){
 const unique=(files||[]).filter((f,i,list)=>f&&typeof f.path==='string'&&list.findIndex(other=>other.path===f.path)===i),explicit=sourceRequested(options.request);
 const primary=unique.filter(f=>explicit||!isDevelopment(f)),development=unique.filter(f=>!primary.includes(f));
 const changed=Array.isArray(options.changedPaths)?new Set(options.changedPaths):null;
 const current=changed?primary.filter(f=>changed.has(f.path)):primary;
 const shown=current.length?current:primary;
 const featured=shown.filter(f=>previewRank(f)<99).slice().sort((a,b)=>previewRank(a)-previewRank(b))[0];
 return {primary,development,current,shown,featured,retained:!!changed&&!current.length&&primary.length>0,sourceRequested:explicit};
}
function summaryLines(files,options={}){
 const g=groupArtifacts(files,options),limit=options.max||3,out=[];
 if(g.shown.length){out.push(g.retained?'可查看的已有成果（本轮沿用，未计为新增）：':'成果：',...g.shown.slice(0,limit).map(f=>'- '+(f.label||f.path)+'（'+f.path+'）'));if(g.shown.length>limit)out.push(`其余 ${g.shown.length-limit} 项成果可在成果区查看。`);}
 if(g.development.length)out.push(`${g.development.length} 项源码与开发文件已保留，在成果区展开“开发文件”查看。`);
 return out;
}
module.exports={isDevelopment,sourceRequested,previewRank,groupArtifacts,summaryLines};

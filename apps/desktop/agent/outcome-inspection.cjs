// Bounded local metadata checks only. Existence is not proof of successful execution.
const fs=require('node:fs/promises');
const {resolveFile,normalizeProjectPath}=require('./workspace.cjs');
function targets(action){
 return [...new Set([action.path,...[action.scope,...(Array.isArray(action.scopes)?action.scopes:[])].filter(s=>s?.kind==='file').map(s=>s.path)].filter(p=>typeof p==='string'))].slice(0,3);
}
async function inspect(workspace,entry){
 if(entry.status!=='unknown')return;
 const rows=[];
 for(const candidate of (entry.resultPaths||[entry.path].filter(Boolean)).slice(0,3)){
  let path;try{path=normalizeProjectPath(candidate);}catch{continue;}
  try{
   const file=await resolveFile(workspace.files,path),stat=await fs.lstat(file);
   rows.push({path,state:stat.isFile()?'file':stat.isDirectory()?'directory':'unavailable',...(stat.isFile()?{bytes:stat.size}:{})});
  }catch(error){rows.push({path,state:error.code==='ENOENT'?'missing':'unavailable'});}
 }
 entry.resultInspection={at:new Date().toISOString(),rows};
}
module.exports={targets,inspect};

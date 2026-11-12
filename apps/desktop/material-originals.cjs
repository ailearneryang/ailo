const fs=require('node:fs/promises'),path=require('node:path');
const {workspacePath}=require('./agent/workspace-path.cjs');
// Follow only recorded conversation lineage. Never search unrelated workspaces
// by filename or accept an arbitrary filesystem path from an attachment.
function materialOrigins(task,tasks=[]){
 if(!task)return [];
 const known=new Map(tasks.map(t=>[t.id,t])),queue=[task],seen=new Set(),origins=[];
 for(let i=0;i<queue.length&&origins.length<128;i++){
  const current=queue[i];if(!current||typeof current.id!=='string'||!current.id)continue;
  const key=JSON.stringify([current.id,current.projectId||'']);if(seen.has(key))continue;seen.add(key);
  origins.push({id:current.id,projectId:current.projectId});
  const full=known.get(current.id)||current;
  queue.push(...(current.resourceOrigins||[]),...(full===current?[]:full.resourceOrigins||[]));
  for(const id of [full.parentAssistantId,full.branchOf?.id])if(typeof id==='string'&&id)queue.push(known.get(id)||{id});
 }
 return origins;
}
function withMaterialOrigins(task,tasks){if(!task)return task;return {...task,resourceOrigins:materialOrigins(task,tasks).slice(1)};}
async function findMaterialOriginal(base,task,sourceId){
 if(typeof sourceId!=='string'||!/^[a-f0-9-]{36}$/.test(sourceId))throw Error('材料来源标识无效');
 const roots=[path.join(base,'imports'),...materialOrigins(task).map(scope=>path.join(workspacePath(base,scope),'originals'))];
 for(const root of [...new Set(roots)]){
  try{
   const directory=await fs.lstat(root);if(directory.isSymbolicLink()||!directory.isDirectory())throw Error('材料原件目录必须为独立目录');
   const file=await require('./agent/workspace.cjs').resolveFile(root,sourceId),stat=await fs.stat(file);
   if(!stat.isFile())throw Error('材料原文件必须为普通文件');return file;
  }catch(error){if(error.code==='ENOENT')continue;if(/符号链接|硬链接/.test(error.message))throw Error('材料原文件必须为已导入的独立文件，不允许访问符号链接或硬链接');throw error;}
 }
 return null;
}
module.exports={materialOrigins,withMaterialOrigins,findMaterialOriginal};

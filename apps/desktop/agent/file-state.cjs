const fs=require('node:fs/promises');
const {resolveFile}=require('./workspace.cjs'),{hash}=require('./evidence.cjs');
// Bounded inventories explicitly report incomplete coverage. Such a command
// keeps conservative revision invalidation instead of claiming freshness.
async function inventory(root){
 const files=[],queue=[''];let bytes=0,complete=true;
 while(queue.length){
  const relative=queue.shift(),entries=await fs.readdir(relative?await resolveFile(root,relative):root,{withFileTypes:true});
  for(const e of entries){
   if(['.runtime','.ailo-observations','.git'].includes(e.name))continue;
   if(e.name==='node_modules'){complete=false;continue;}
   const path=relative?relative+'/'+e.name:e.name;
   if(e.isSymbolicLink())continue;
   if(e.isDirectory()){queue.push(path);continue;}
   if(!e.isFile())continue;
   if(files.length>=2000){complete=false;break;}
   const file=await resolveFile(root,path),stat=await fs.stat(file);
   if(stat.size>20*1024*1024||bytes+stat.size>64*1024*1024){complete=false;continue;}
   bytes+=stat.size;files.push({path,sha256:hash(await fs.readFile(file))});
  }
  if(files.length>=2000)break;
 }
 if(queue.length)complete=false;
 return {files,complete};
}
function changes(before,after){
 const old=new Map(before.files.map(f=>[f.path,f.sha256])),next=new Map(after.files.map(f=>[f.path,f.sha256]));
 return [...new Set([...old.keys(),...next.keys()])].filter(p=>old.get(p)!==next.get(p)).map(path=>({path,kind:!old.has(path)?'created':!next.has(path)?'deleted':'modified',before:old.get(path)||null,after:next.get(path)||null}));
}
module.exports={inventory,changes};

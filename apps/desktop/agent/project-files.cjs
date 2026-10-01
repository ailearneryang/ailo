const fs=require('node:fs/promises');
const path=require('node:path');
const {resolveFile,normalizeProjectPath}=require('./workspace.cjs');
function visible(relative) {
 return relative.split('/').every(p=>!p.startsWith('.')&&!['node_modules','build','dist','out'].includes(p));
}
async function projectFile(root,relative) {
 relative=normalizeProjectPath(relative);
 if(!visible(relative))throw Error('此文件不在项目文件列表中');
 const file=await resolveFile(root,relative);
 const stat=await fs.stat(file);
 if(!stat.isFile())throw Error('请选择项目文件');
 return file;
}
async function listProjectFiles(root) {
 const files=[];let truncated=false,visited=0;
 async function walk(dir,prefix='') {
  let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
   if(++visited>3000||files.length>=500){truncated=true;return;}
   const relative=prefix+e.name;
   if(!visible(relative)||e.isSymbolicLink())continue;
   if(e.isDirectory()){await resolveFile(root,relative);await walk(path.join(dir,e.name),relative+'/');}
   else if(e.isFile()) {
    try{const file=await projectFile(root,relative);const stat=await fs.stat(file);files.push({path:relative,label:e.name,size:stat.size,sha256:`${stat.mtimeMs}:${stat.size}`});}catch(e){if(e.code==='ENOENT'||/符号链接|硬链接/.test(e.message))continue;throw e;}
   }
  }
 }
 await walk(root);return {files,truncated};
}
module.exports={listProjectFiles,projectFile};

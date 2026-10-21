const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {resolveFile,normalizeProjectPath}=require('./workspace.cjs'),{hash}=require('./evidence.cjs');
const locks=new Map();
const schema={type:'array',minItems:1,maxItems:24,items:{type:'object',additionalProperties:false,required:['oldText','newText'],properties:{oldText:{type:'string',minLength:1,maxLength:20000},newText:{type:'string',maxLength:30000}}}};
async function edit(workspace,action){
 const relative=normalizeProjectPath(action.path);
 if(relative.split('/').includes('.runtime'))throw Error('运行目录不允许修改');
 if(!/^[a-f0-9]{64}$/.test(action.version)||!Array.isArray(action.edits)||!action.edits.length||action.edits.length>24)throw Error('局部编辑需要当前 SHA-256 version 和1–24条 edits');
 const key=workspace.files+':'+relative,previous=locks.get(key)||Promise.resolve();
 const job=previous.catch(()=>{}).then(async()=>{
  const file=await resolveFile(workspace.files,relative),stat=await fs.stat(file);
  if(!stat.isFile()||stat.size>2*1024*1024)throw Error('局部编辑仅支持2MB以内的 UTF-8 文本');
  const before=await fs.readFile(file),actual=hash(before);
  if(actual!==action.version)throw Object.assign(Error('文件版本冲突；未修改。请读取当前片段和版本后重新编辑。当前 SHA-256：'+actual),{code:'EDIT_CONFLICT'});
  let text=new TextDecoder('utf-8',{fatal:true}).decode(before);
  // Every edit addresses the original version; overlaps and ambiguous matches
  // fail atomically, including accidental dependencies between edits.
  const replacements=action.edits.map(e=>{
   if(!e||typeof e.oldText!=='string'||!e.oldText||e.oldText.length>20000||typeof e.newText!=='string'||e.newText.length>30000)throw Error('编辑片段无效');
   const start=text.indexOf(e.oldText);
   if(start<0||text.indexOf(e.oldText,start+1)>=0)throw Object.assign(Error('片段未找到或出现多次；未修改。请提供唯一的上下文。'),{code:'EDIT_CONFLICT'});
   return {start,end:start+e.oldText.length,newText:e.newText};
  }).sort((a,b)=>a.start-b.start);
  for(let i=1;i<replacements.length;i++)if(replacements[i].start<replacements[i-1].end)throw Error('编辑片段重叠；未修改');
  for(const r of replacements.slice().reverse())text=text.slice(0,r.start)+r.newText+text.slice(r.end);
  if(Buffer.byteLength(text)>2*1024*1024)throw Error('编辑后超过2MB限制');
  const temp=file+'.'+randomUUID()+'.tmp';
  try{
   await fs.writeFile(temp,text,{mode:stat.mode&0o777,flag:'wx'});
   if(await resolveFile(workspace.files,relative)!==file||hash(await fs.readFile(file))!==actual)throw Object.assign(Error('提交前文件已改变；未修改，请重新读取'),{code:'EDIT_CONFLICT'});
   const backupDir=path.join(workspace.project,'backups');await fs.mkdir(backupDir,{recursive:true,mode:0o700});
   await fs.writeFile(path.join(backupDir,hash(relative)+'.backup'),before,{mode:0o600});
   await fs.rename(temp,file);
  }finally{await fs.rm(temp,{force:true});}
  return {path:relative,previousVersion:actual,sha256:hash(text),bytes:Buffer.byteLength(text),editedFragments:replacements.length,changed:text!==before.toString('utf8'),notice:'片段已按原版本原子替换；需检查实际结果。上一版本已保留。'};
 });
 locks.set(key,job);try{return await job;}finally{if(locks.get(key)===job)locks.delete(key);}
}
module.exports={edit,schema};

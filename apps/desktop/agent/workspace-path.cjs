const path=require('node:path');
const {createHash}=require('node:crypto');
function workspacePath(base,task){
 if(!task||typeof task.id!=='string'||!task.id)throw Error('会话 ID 无效');
 const project=typeof task.projectId==='string'&&task.projectId;
 return path.join(base,project?'projects':'conversations',createHash('sha256').update(project||task.id).digest('hex'));
}
module.exports={workspacePath};
// Root grants live outside renderer-supplied project/task fields.
const fs=require('node:fs/promises');
const rootGrant=(base,id)=>path.join(base,'project-roots',createHash('sha256').update(id).digest('hex')+'.json');
async function bindLocalRoot(base,id,folder){
 const root=await fs.realpath(folder);if(!(await fs.stat(root)).isDirectory())throw Error('请选择文件夹');
 await fs.mkdir(path.dirname(rootGrant(base,id)),{recursive:true,mode:0o700});
 await fs.writeFile(rootGrant(base,id),JSON.stringify({root}),{mode:0o600,flag:'wx'});return root;
}
async function workspaceFiles(base,task){
 if(task.projectId){
  let grant;try{grant=JSON.parse(await fs.readFile(rootGrant(base,task.projectId),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(grant){const root=await fs.realpath(grant.root);if(root!==grant.root||!(await fs.stat(root)).isDirectory())throw Error('本地项目目录已变更，请重新打开文件夹');return root;}
 }
 return path.join(workspacePath(base,task),'files');
}
module.exports.workspaceFiles=workspaceFiles;
module.exports.bindLocalRoot=bindLocalRoot;

const path=require('node:path');
const {json,writeJson,key}=require('./agent/workspace.cjs');
const {workspacePath}=require('./agent/workspace-path.cjs');
const queues=new Map();
function location(base,id){if(typeof id!=='string'||!id)throw Error('项目不存在');return path.join(workspacePath(base,{id:'memory',projectId:id}),'memory.json');}
async function readMemory(base,project,tasks){
 const saved=await json(location(base,project.id),{revision:0,notes:''});const records=[];
 for(const task of tasks.filter(t=>t.projectId===project.id).slice(-100)){
  const run=await json(path.join(workspacePath(base,task),'runs',key(task.id)+'.json'),null);if(!run||(saved.hiddenTaskIds||[]).includes(task.id))continue;
  records.push({taskId:task.id,title:task.title,goal:run.goal||task.request,status:run.status,decisions:run.decisions||[],steps:(run.steps||[]).map(s=>({title:s.title||s.name||s.description,status:s.status})),updatedAt:run.updatedAt});
 }
 records.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
 return {...saved,records:records.slice(0,20),description:project.description||''};
}
function saveMemory(base,id,input){const file=location(base,id);const next=(queues.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{const old=await json(file,{revision:0,notes:''});if(input.revision!==old.revision)throw Error('项目记忆已更新，请刷新后重试');if(typeof input.notes!=='string'||input.notes.length>12000)throw Error('项目补充最多 12000 字符');if(input.hiddenTaskIds!==undefined&&(!Array.isArray(input.hiddenTaskIds)||input.hiddenTaskIds.length>1000||input.hiddenTaskIds.some(id=>typeof id!=='string'||id.length>200)))throw Error('记忆来源无效');const result={revision:old.revision+1,notes:input.notes,hiddenTaskIds:input.hiddenTaskIds||old.hiddenTaskIds||[],updatedAt:new Date().toISOString()};await writeJson(file,result);return result;});queues.set(file,next);return next;}
module.exports={readMemory,saveMemory};

const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {workspacePath,workspaceFiles}=require('./agent/workspace-path.cjs');
const {json,writeJson,resolveFile}=require('./agent/workspace.cjs');
const key=id=>createHash('sha256').update(id).digest('hex');
async function copyFiles(source,destination,overwrite=false){
 let entries;try{entries=await fs.readdir(source,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
 await fs.mkdir(destination,{recursive:true});
 if(!(await fs.lstat(destination)).isDirectory()||(await fs.lstat(destination)).isSymbolicLink())throw Error('历史迁移目标不是普通目录');
 for(const entry of entries){
  if(entry.name.startsWith('.')||entry.name==='node_modules'||entry.name==='schedule-history')continue;
  const from=path.join(source,entry.name),to=path.join(destination,entry.name);
  if(entry.isDirectory())await copyFiles(from,to,overwrite);
  else if(entry.isFile()){
   if(overwrite)try{if(!(await fs.lstat(to)).isFile())throw Error('历史归档目标不是普通文件');}catch(e){if(e.code!=='ENOENT')throw e;}
   try{await fs.copyFile(from,to,overwrite?0:require('node:fs').constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
  }
 }
}
async function prepareScheduleContext(base,task,tasks,now=Date.now()){
 if(!task.scheduledTaskId)return undefined;
 const files=await workspaceFiles(base,task),root=path.join(base,'schedules',key(task.scheduledTaskId)),historyRoot=`schedule-history/${key(task.scheduledTaskId)}`,manifestFile=path.join(root,'legacy-imports.json');
 await fs.mkdir(files,{recursive:true});
 const manifest=await json(manifestFile,[]);
 const related=tasks.filter(t=>t.scheduledTaskId===task.scheduledTaskId).sort((a,b)=>Date.parse(a.scheduledAt||a.created)-Date.parse(b.scheduledAt||b.created));
 // Latest legacy files populate the canonical directory first. Every version is
 // archived separately; later executions never overwrite shared files during import.
 for(const prior of [...related].reverse()){
  if(manifest.includes(prior.id))continue;
  // Project-bound schedules already use the project's files, not isolated legacy roots.
  if(prior.projectId){manifest.push(prior.id);await writeJson(manifestFile,manifest);continue;}
  const source=path.join(workspacePath(base,prior),'files');
  const archive=path.dirname(await resolveFile(files,`${historyRoot}/${key(prior.runRecordId||prior.id)}/placeholder`,true));
  await copyFiles(source,archive);
  await copyFiles(source,files);
  manifest.push(prior.id);await writeJson(manifestFile,manifest);
 }
 const ledgerFile=path.join(root,'history-ledger.json');
 const records=await json(ledgerFile,[]);
 for(const prior of related.filter(t=>t.id!==task.id)){
  const run=await json(path.join(workspacePath(base,prior),'runs',key(prior.runRecordId||prior.id)+'.json'),null);
  const reply=prior.messages?.filter(m=>m.role==='assistant').at(-1)?.content||prior.answer||'';
  const detailPath=`${historyRoot}/${key(prior.runRecordId||prior.id)}/execution.json`;
  await writeJson(await resolveFile(files,detailPath,true),{taskId:prior.id,date:prior.scheduledAt||prior.created,messages:prior.messages||[],run:run?{status:run.status,goal:run.goal,steps:run.steps,decisions:run.decisions,acceptance:run.acceptance,artifacts:run.artifacts}:prior.agentRun,error:prior.lastError});
  const entry={taskId:prior.id,date:prior.scheduledAt||prior.created,status:run?.status||prior.agentRun?.status||(prior.lastError?'failed':'unknown'),summary:reply.slice(0,2500),goal:run?.goal,artifacts:run?.artifacts||prior.agentRun?.artifacts||[],detailPath,archive:`${historyRoot}/${key(prior.runRecordId||prior.id)}`,error:prior.lastError};
  const index=records.findIndex(r=>r.taskId===prior.id);if(index<0)records.push(entry);else records[index]=entry;
 }
 records.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 await writeJson(ledgerFile,records);
 const historyRecords=records.filter(r=>r.taskId!==task.id);
 await writeJson(await resolveFile(files,`${historyRoot}/index.json`,true),{scheduleId:task.scheduledTaskId,updatedAt:new Date(now).toISOString(),records:historyRecords});
 const mode=task.scheduledContextMode||'continuity',recent=historyRecords.filter(r=>Date.parse(r.date)>=now-30*86400000);
 return {mode,historyStatus:mode==='independent'?'not_loaded':historyRecords.length?'available':'first_run',previousRunCount:historyRecords.length,historyIndex:`${historyRoot}/index.json`,recentRunCount:recent.length,recentRuns:mode==='independent'?[]:recent.slice(-12).map(({taskId,date,status,summary,detailPath})=>({taskId,date,status,summary:summary.slice(0,1200),detailPath})),instruction:mode==='independent'?'本次独立执行，按当前指令处理，不自动延续历史计划。文件工作空间仍固定共享，避免覆盖历史成果。':'同一定时任务共享文件工作空间；这是新一期执行，不重放旧执行计划。选题前读取现有进度和历史索引，近30天完整记录及更早记录可通过 read_file 分页回查；recentRuns 只是部分摘要，不代表全部历史。优先沿用已有课程地图和进度，不重新创刊。目录为空不等于首次运行；previousRunCount>0 时不得声称首期或已完成历史去重。历史文件存在多个版本时核对最新进度并保留历史。历史读取失败应说明缺口，要求去重的任务不得跳过检查直接交付。生成、验收、发送分别依据实际证据，不把生成成功当成发送成功。'};
}
async function archiveScheduleRun(base,task,result){
 if(!task.scheduledTaskId)return;
 const files=await workspaceFiles(base,task);
 const archive=path.dirname(await resolveFile(files,`schedule-history/${key(task.scheduledTaskId)}/${key(task.runRecordId||task.id)}/placeholder`,true));
 if(task.projectId){
  const run=await json(path.join(workspacePath(base,task),'runs',key(task.runRecordId||task.id)+'.json'),null);
  const paths=new Set([...(run?.artifacts||[]).map(a=>a.path),...(run?.events||[]).filter(e=>['write_file','edit_spreadsheet'].includes(e.type)).map(e=>e.detail.path)].filter(Boolean));
  for(const relative of paths){
   const source=await resolveFile(files,relative),destination=await resolveFile(archive,relative,true);
   if((await fs.stat(source)).isFile())await fs.copyFile(source,destination);
  }
 }else await copyFiles(files,archive,true);
 if(result){
  const detailPath=`schedule-history/${key(task.scheduledTaskId)}/${key(task.runRecordId||task.id)}/execution.json`;
  await writeJson(await resolveFile(files,detailPath,true),{taskId:task.id,date:task.scheduledAt||task.created,messages:[...(task.messages||[]),{role:'assistant',content:result.content}],run:result.agentRun});
  const ledgerFile=path.join(base,'schedules',key(task.scheduledTaskId),'history-ledger.json'),records=await json(ledgerFile,[]);
  const entry={taskId:task.id,date:task.scheduledAt||task.created,status:result.agentRun?.status||'unknown',summary:result.content?.slice(0,2500)||'',goal:result.agentRun?.goal,artifacts:result.agentRun?.artifacts||[],detailPath,archive:path.posix.dirname(detailPath)};
  const index=records.findIndex(r=>r.taskId===task.id);if(index<0)records.push(entry);else records[index]=entry;
  await writeJson(ledgerFile,records);
 }
}
// Historical previews must show that run's artifact, even if later runs reuse a path.
async function scheduleArtifactRoot(base,task,artifactPath){
 const files=await workspaceFiles(base,task);
 if(!task.scheduledTaskId)return files;
 const run=await json(path.join(workspacePath(base,task),'runs',key(task.runRecordId||task.id)+'.json'),null);
 if(run?.status!=='completed'&&artifactPath)try{await fs.access(await resolveFile(files,artifactPath));return files;}catch(e){if(e.code!=='ENOENT')throw e;}
 const archive=path.dirname(await resolveFile(files,`schedule-history/${key(task.scheduledTaskId)}/${key(task.runRecordId||task.id)}/placeholder`));
 if(artifactPath)try{await fs.access(await resolveFile(archive,artifactPath));return archive;}catch(e){if(e.code!=='ENOENT')throw e;}
 const legacy=path.join(workspacePath(base,task),'files');
 try{if((await fs.lstat(legacy)).isDirectory())return legacy;}catch(e){if(e.code!=='ENOENT')throw e;}
 return files;
}
module.exports={prepareScheduleContext,archiveScheduleRun,scheduleArtifactRoot};

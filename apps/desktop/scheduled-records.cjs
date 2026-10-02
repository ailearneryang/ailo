// Associate old execution conversations using saved IDs first. Title inference
// requires the old execution marker and a unique schedule, never title alone.
function associateScheduledRecords(tasks,schedules){
 const byTask=new Map();for(const schedule of schedules)for(const run of schedule.runs||[])byTask.set(run.taskId,{schedule,run});
 return tasks.map(task=>{
  const known=byTask.get(task.id);
  if(known)return {...task,scheduledTaskId:known.schedule.id,scheduledRunId:known.run.id,scheduledAt:known.run.at,scheduledArchived:false};
  if(task.scheduledTaskId)return {...task,scheduledArchived:!schedules.some(s=>s.id===task.scheduledTaskId)};
  if(!task.title?.startsWith('定时 · ')||!task.request?.includes('[定时执行时间：'))return task;
  const matches=schedules.filter(s=>'定时 · '+s.title===task.title);
  if(matches.length!==1)return task;
  return {...task,scheduledTaskId:matches[0].id,scheduledRunId:task.id,scheduledAt:task.created,scheduledArchived:false};
 });
}
module.exports={associateScheduledRecords};

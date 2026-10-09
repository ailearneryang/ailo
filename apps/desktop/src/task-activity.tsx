import React,{useEffect,useState} from 'react';
import { Pet } from './pet';
import { taskPetState } from './pet-state';
import type {Task} from './types';
const actions:Record<string,string>={mcp:'正在使用应用工具',feishu:'正在操作飞书',build_android:'正在构建 Android 应用',android_device:'正在验证项目模拟器',write_file:'正在写入文件',read_file:'正在读取文件',list_files:'正在检查项目文件',read_material:'正在读取材料',read_source:'正在读取原始材料',inspect_source:'正在分析材料结构',search_materials:'正在搜索材料',read_history:'正在回查对话',read_execution:'正在回查执行记录',run_command:'正在执行命令'};
const completed:Record<string,string>={mcp:'应用工具操作已结束',feishu:'飞书操作已结束',repeat_warning:'正在纠正重复读取',output_limit:'正在调整输出额度',batch_continue:'已保存进度，自动继续任务',build_android:'构建已结束',android_device:'模拟器操作已结束',write_file:'已写入',read_file:'已读取',read_material:'已读取材料',read_source:'已读取原始材料',inspect_source:'已分析材料结构',plan:'已更新任务计划',checkpoint:'已保存任务摘要',run_command:'命令已结束'};
export function TaskActivity({task,status}:{task:Task;status:string}) {
  const queued=status.startsWith('等待执行');
  const operation=queued?undefined:task.agentRun?.inFlight;
  const target=operation?.purpose||operation?.path||[operation?.name,operation?.entry].filter(Boolean).join(' / ');
  const label=operation?.action==='build_android'&&status.startsWith('Gradle：')?status:operation?`${actions[operation.action]||'正在处理'}${target?' · '+target:''}`:status||'正在决定下一步…';
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{
    const start=operation?.at?Date.parse(operation.at):Date.now();
    const update=()=>setElapsed(Math.max(0,Math.floor((Date.now()-start)/1000)));
    update();const timer=setInterval(update,1000);return ()=>clearInterval(timer);
  },[queued,operation?.action,operation?.at]);
  const event=task.agentRun?.events.filter(e=>completed[e.type]||e.type==='tool_error').at(-1);
  const recent=event?(event.detail.message?event.detail.message:`${completed[event.type]}${event.detail.path||event.detail.name?' · '+(event.detail.path||event.detail.name):''}${event.detail.exitCode!==undefined?' · 退出码 '+event.detail.exitCode:''}`):undefined;
  return <div className="task-activity" aria-label="当前任务活动">
    <div className="task-activity-current"><Pet size="mini" state={taskPetState(task,status)} /><span role="status" title={label}>{label}</span>{!label.includes("已等待") && <small aria-label="当前活动用时">{elapsed} 秒</small>}</div>
    {!queued&&recent&&<div className="task-activity-recent" title={recent}>最近：{recent}</div>}
  </div>;
}

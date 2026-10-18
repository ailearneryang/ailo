import type {AgentRun} from './types';
const actions:Record<string,string>={mcp:'正在使用应用工具',feishu:'正在处理飞书内容',build_android:'正在构建并验证应用',android_device:'正在验证应用',write_file:'正在更新文件',edit_file:'正在修改文件',read_file:'正在读取文件',list_files:'正在检查项目文件',read_material:'正在读取材料',read_source:'正在读取原始材料',inspect_source:'正在分析材料',search_materials:'正在搜索材料',read_history:'正在回查对话',read_execution:'正在核对执行记录',run_command:'正在执行操作'};
const recovery:Record<string,string>={output_limit:'本次处理遇到输出长度限制，系统将自动重试，无需操作。',tool_argument_limit:'本次处理内容过多，系统正在拆分后重试，无需操作。',protocol_error:'本次执行指令未能正确生成，系统正在自动重试，无需操作。',empty_response:'本次未收到有效响应，系统正在自动重试，无需操作。'};
const progressTypes=new Set(['plan','write_file','edit_file','run_command','read_file','read_material','read_source','artifact','acceptance_check','build_android','android_device']);
export function activityPresentation(run:AgentRun|undefined,status:string) {
 const queued=status.startsWith('等待执行');
 const event=run?.events.at(-1);
 const lastProgress=run?.events.filter(e=>progressTypes.has(e.type)).at(-1);
 const progressAt=lastProgress?.at;
 if(queued)return {label:'等待执行',detail:'前面的任务结束后将自动开始。',progressAt:undefined,expanded:false};
 if(run&&['waiting_user','waiting_permission','blocked','failed'].includes(run.status))return {label:({waiting_user:'等待你确认',waiting_permission:'等待授权',blocked:'任务需要处理',failed:'执行已中断'} as Record<string,string>)[run.status],detail:run.status==='waiting_user'?'请查看任务中的问题并回复。':run.status==='waiting_permission'?'请在本轮任务提示中核对所需授权。':'请查看任务提示后继续。',progressAt,expanded:true};
 if(run?.status==='paused')return {label:'任务已暂停',detail:undefined,progressAt,expanded:false};
 const retryEvent=!run?.inFlight&&event&&recovery[event.type]?event:undefined;
 const exhausted=retryEvent&&/已用尽|重试失败/.test(retryEvent.detail.message||'');
 if(retryEvent)return {label:exhausted?'恢复执行未成功':'正在恢复执行',detail:exhausted?'自动重试未能完成，请查看任务提示。':recovery[retryEvent.type],progressAt,expanded:true};
 if(run?.inFlight)return {label:actions[run.inFlight.action]||'正在处理任务',detail:run.inFlight.purpose,progressAt,expanded:false};
 // Model heartbeats and budget diagnostics are retained in execution details.
 if(/输出.*(?:额度|上限)|自动.*重试|增加生成额度|正在自动续写/.test(status))return {label:'正在恢复执行',detail:'本次处理需要调整，系统正在自动重试，无需操作。',progressAt,expanded:true};
 if(run?.mode==='task')return {label:'正在准备下一步操作',detail:undefined,progressAt,expanded:false};
 return {label:status.startsWith('正在决定下一步')?'正在准备回复':status||'正在准备回复',detail:undefined,progressAt,expanded:false};
}

export function formatProgressAge(seconds:number):string {
 const value=Math.max(0,Math.floor(seconds));
 if(value<5)return '进展刚刚更新';
 if(value<60)return `上次更新于 ${value} 秒前`;
 if(value<3600)return `上次更新于 ${Math.floor(value/60)} 分${value%60?` ${value%60} 秒`:''}前`;
 return `上次更新于 ${Math.floor(value/3600)} 小时${Math.floor(value%3600/60)?` ${Math.floor(value%3600/60)} 分`:''}前`;
}

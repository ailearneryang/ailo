import type {AgentRun} from './types';
const actions:Record<string,string>={web_search:'正在搜索网页',knowledge:'正在查询知识库',amap:'正在查询地图',assistant:'正在处理个人事务',subagent:'正在协调子 Agent',edit_spreadsheet:'正在编辑表格',mcp:'正在使用应用工具',feishu:'正在处理飞书内容',build_android:'正在构建并验证应用',android_device:'正在验证应用',write_file:'正在更新文件',edit_file:'正在修改文件',read_file:'正在读取文件',list_files:'正在检查项目文件',read_material:'正在读取材料',read_source:'正在读取原始材料',inspect_source:'正在分析材料',search_materials:'正在搜索材料',read_history:'正在回查对话',read_execution:'正在核对执行记录',run_command:'正在执行命令',request_directory:'正在申请目录授权',request_network:'正在申请联网授权',batch_read:'正在批量读取资料',browser:'正在检查网页',view_image:'正在查看图片',verify:'正在检查验收结果'};
const recovery:Record<string,string>={output_limit:'本次处理遇到输出长度限制，系统将自动重试，无需操作。',tool_argument_limit:'本次处理内容过多，系统正在拆分后重试，无需操作。',protocol_error:'本次执行指令未能正确生成，系统正在自动重试，无需操作。',empty_response:'本次未收到有效响应，系统正在自动重试，无需操作。',no_action_recovery:'本次尚未生成可执行操作，系统正在自动重试。',loop_recovery:'系统正在调整执行方式，避免重复无效操作。',tool_recovery:'系统正在分析操作失败的原因并调整执行方式。'};
const progressTypes=new Set(['plan','write_file','edit_file','run_command','read_file','read_material','read_source','artifact','acceptance_check','build_android','android_device']);
// Bookkeeping must not displace the latest concrete action, blocker or recovery.
const internalTypes=new Set(['attached_progress','checkpoint','plan','plan_update','route','intent','execution_state','steering','visual_analysis','model_route']);
function brief(value:unknown,max=64):string {
 if(typeof value!=='string')return '';
 const text=value.replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').replace(/^[\s#*•]+/,'').trim();
 return text.length>max?text.slice(0,max-1)+'…':text;
}
function pathName(value:unknown):string {
 return typeof value==='string'?brief(value.split(/[\\/]/).filter(Boolean).slice(-2).join('/'),48):'';
}
function blockerText(value:unknown):string {
 if(typeof value==='string')return brief(value);
 if(value&&typeof value==='object'){
  const item=value as {message?:unknown;reason?:unknown;path?:unknown;exitCode?:unknown;timedOut?:unknown};
  return brief(item.message)||brief(item.reason)||(item.timedOut?'命令执行超时':typeof item.exitCode==='number'?`命令退出码 ${item.exitCode}${item.path?` · ${pathName(item.path)}`:''}`:'');
 }
 return '';
}
function currentStep(run:AgentRun|undefined):string {
 const step=run?.steps?.find(s=>s.status==='running'||s.status==='blocked');
 return brief(step?.title)||brief(run?.goal);
}
function operationContext(run:AgentRun|undefined,detail?:{purpose?:string;path?:string;name?:string}):string {
 // Long tool purposes can be instructions rather than a usable activity title.
 const purpose=detail?.purpose?.trim();
 return purpose&&purpose.length<=96?brief(purpose):pathName(detail?.path)||brief(detail?.name)||currentStep(run)||brief(purpose);
}
function withContext(context:string,phase:string):string {return context?`${context} · ${phase}`:phase;}
export function activityPresentation(run:AgentRun|undefined,status:string) {
 const queued=status.startsWith('等待执行');
 const events=run?.events||[];
 const event=events.filter(e=>!internalTypes.has(e.type)).at(-1);
 const lastProgress=events.filter(e=>progressTypes.has(e.type)).at(-1);
 const progressAt=lastProgress?.at;
 const context=currentStep(run);
 if(queued)return {label:withContext(context,'等待执行'),detail:'前面的任务结束后将自动开始。',progressAt:undefined,expanded:false};
 if(run&&['waiting_user','waiting_permission','blocked','failed'].includes(run.status)){
  const reason=blockerText(run.executionState?.blocker)||brief(event?.detail.message)||operationContext(run,event?.detail);
  const phase=run.taskContinuation?.taskOpen?'等待处理 · 任务保留':({waiting_user:'等待你确认',waiting_permission:'等待授权',blocked:'任务受阻',failed:'执行已中断'} as Record<string,string>)[run.status];
  return {label:withContext(reason,phase),detail:run.status==='waiting_user'?'请查看任务中的问题并回复。':run.status==='waiting_permission'?'请在本轮任务提示中核对所需授权。':'请查看任务提示后继续。',progressAt,expanded:true};
 }
 if(run?.status==='paused')return {label:withContext(context,'任务已暂停'),detail:undefined,progressAt,expanded:false};
 if(run?.inFlight){
  const operation=run.inFlight;
  const title=operationContext(run,operation);
  return {label:title?withContext(title,actions[operation.action]||'正在执行操作'):actions[operation.action]||'正在执行工具操作',detail:operation.purpose,progressAt,expanded:false};
 }
 const retryEvent=event&&recovery[event.type]?event:undefined;
 const exhausted=retryEvent&&/已用尽|重试失败/.test(retryEvent.detail.message||'');
 if(retryEvent)return {label:withContext(context,exhausted?'恢复执行未成功':'正在恢复执行'),detail:exhausted?'自动重试未能完成，请查看任务提示。':recovery[retryEvent.type],progressAt,expanded:true};
 // Heartbeats are not proof of progress; the main row retains its task context.
 if(/输出.*(?:额度|上限)|自动.*重试|增加生成额度|正在自动续写/.test(status))return {label:withContext(context,'正在恢复执行'),detail:'本次处理需要调整，系统正在自动重试，无需操作。',progressAt,expanded:true};
 if(run?.mode==='task'){
  const lastContext=operationContext(run,event?.detail);
  if(event?.type==='permission_requested')return {label:withContext(lastContext,'正在核对授权请求'),detail:undefined,progressAt,expanded:false};
  if(event?.type==='permission_required')return {label:withContext(brief(event.detail.message)||lastContext,'已记录授权阻塞，正在分析'),detail:undefined,progressAt,expanded:false};
  if(event?.type==='request_directory'||event?.type==='request_network')return {label:withContext(context||pathName(event.detail.path),event.type==='request_directory'?'目录授权申请已返回，正在分析结果':'联网授权申请已返回，正在分析结果'),detail:undefined,progressAt,expanded:false};
  if(event?.type==='tool_error'||event?.detail.exitCode!==undefined&&event.detail.exitCode!==0||event?.detail.timedOut)return {label:withContext(lastContext,'操作未通过，正在分析原因'),detail:brief(event?.detail.message)||undefined,progressAt,expanded:false};
  if(event?.type==='command_interrupted')return {label:withContext(lastContext,'操作已中断，结果待核对'),detail:undefined,progressAt,expanded:false};
  if(event&&actions[event.type])return {label:withContext(lastContext,event.type==='run_command'||event.type==='build_android'?'命令已结束，正在分析结果':'操作已返回，正在分析结果'),detail:undefined,progressAt,expanded:false};
  const blocker=blockerText(run.executionState?.blocker);
  if(blocker)return {label:withContext(blocker,'已记录阻塞，正在分析'),detail:undefined,progressAt,expanded:false};
  const next=run.executionState?.nextAction;
  if(next&& !/^[a-z_]+$/.test(next))return {label:withContext(brief(next),'计划下一步'),detail:undefined,progressAt,expanded:false};
  return {label:withContext(context,context?'正在分析执行方案':'正在分析任务，尚无工具执行记录'),detail:undefined,progressAt,expanded:false};
 }
 return {label:status.startsWith('正在决定下一步')?'正在准备回复':status||'正在准备回复',detail:undefined,progressAt,expanded:false};
}

export function formatProgressAge(seconds:number):string {
 const value=Math.max(0,Math.floor(seconds));
 if(value<5)return '进展刚刚更新';
 if(value<60)return `上次更新于 ${value} 秒前`;
 if(value<3600)return `上次更新于 ${Math.floor(value/60)} 分${value%60?` ${value%60} 秒`:''}前`;
 return `上次更新于 ${Math.floor(value/3600)} 小时${Math.floor(value%3600/60)?` ${Math.floor(value%3600/60)} 分`:''}前`;
}

const userOperations=new Set([...Object.keys(actions),'tool_error','command_interrupted','artifact','acceptance_check','web_search','knowledge','amap','assistant','subagent','edit_spreadsheet']);
export function isActivityOperation(event:AgentRun['events'][number]):boolean {return userOperations.has(event.type);}
// Display text only. Original instructions, model errors and evidence remain in diagnostics.
export function userActivityText(value:unknown,max=44):string {
 if(typeof value!=='string')return '';
 let text=value.replace(/(?:并|及)?提交\s*verify\s*证据/gi,'')
  .replace(/逐区对照/g,'核对各区域效果')
  .replace(/(?<![\w./-])verify(?![\w./-])/gi,'检查')
  .replace(/(?<![\w./-])artifacts?(?![\w./-])/gi,'成果文件');
 if(/输出预算|决策上下文|可执行操作|未产出动作|收敛无效|tool_calls|eventId|no_action|协议错误|动作格式|token预算/i.test(text)||/\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b/.test(text))return '';
 return brief(text,max);
}
function userStep(run:AgentRun|undefined):string {
 const active=run?.steps?.filter(s=>s.status==='running'||s.status==='blocked')||[];
 return userActivityText(active.length===1?active[0].title:undefined)||userActivityText(run?.goal);
}
const operationNames:Record<string,string>={run_command:'运行项目命令',subagent:'汇总子 Agent 调查',write_file:'保存文件',edit_file:'修改文件',read_file:'读取文件',list_files:'查看项目文件',build_android:'构建应用',android_device:'检查应用运行情况',read_execution:'回看执行记录',read_history:'回看对话',request_directory:'申请目录访问权限',request_network:'申请联网',verify:'检查结果',acceptance_check:'检查结果',browser:'检查网页效果',view_image:'查看图片',tool_error:'操作未成功',command_interrupted:'操作已中断',artifact:'保存成果文件',batch_read:'读取资料'};
export function userOperationTitle(event:AgentRun['events'][number]):string {
 const d=event.detail;
 const device=event.type==='android_device'?({start:'准备项目模拟器',install:'安装当前 APK',launch:'启动应用',logs:'读取运行日志',screenshot:'获取运行截图',check:'核对应用运行结果',status:'检查模拟器状态',stop:'停止项目模拟器'} as Record<string,string>)[d.operation||'']:undefined;
 return (event.type==='web_search'?['搜索网页',userActivityText(d.query,120)].filter(Boolean).join('：'):'')||userActivityText(d.purpose)||device||[operationNames[event.type]||actions[event.type]?.replace(/^正在/, '')||'处理任务',pathName(d.path)||userActivityText(d.name)].filter(Boolean).join('：');
}
export function userActivityPresentation(run:AgentRun|undefined,status:string,now=Date.now()) {
 const operations=run?.events?.filter(isActivityOperation)||[];
 const last=operations.at(-1),context=userStep(run);
 const base=activityPresentation(run,status);
 const progressAt=last?.at;
 const result=(label:string,detail:string,tone:'normal'|'waiting'|'attention'='normal')=>({label,detail,tone,progressAt});
 const taskContext=context?`当前步骤：${context}。`:'';
 const error=blockerText(run?.executionState?.blocker)||brief([...run?.events||[]].reverse().find(e=>e.type==='permission_required'||e.type==='tool_error')?.detail.message);
 const reason=userActivityText(error,80);
 if(status.startsWith('等待执行'))return result('正在排队',context?`轮到后将继续「${context}」。`:'前面的任务结束后会自动开始。');
 if(run?.status==='waiting_permission')return result('需要你授权后才能继续',reason?`${reason}。请查看本轮授权提示。`:'请查看本轮授权提示，确认后才能继续。','attention');
 if(run?.status==='waiting_user')return result('有个问题需要你确认','请回复本轮问题，收到回答后再继续。','attention');
 if(run?.status==='blocked'||run?.status==='failed')return result('任务暂时无法继续',reason||'请展开查看遇到的问题，处理后再继续。','attention');
 if(run?.status==='paused')return result('任务已暂停',taskContext||'需要时可以继续这项任务。','waiting');
 const live=run?.inFlight;
 if(live){
  const title=(live.action==='web_search'?userOperationTitle({id:'live',type:live.action,at:live.at,detail:live}):'')||userActivityText(live.purpose)||[operationNames[live.action]||actions[live.action]?.replace(/^正在/, '')||context||'处理任务',pathName(live.path)||userActivityText(live.name)].filter(Boolean).join('：');
  return result(title.startsWith('正在')?title:`正在${title}`,['run_command','build_android'].includes(live.action)?'展开可查看命令的实时输出。':taskContext&& !title.includes(context)?taskContext:'有新结果时会更新到这里。');
 }
 const event=run?.events?.filter(e=>!internalTypes.has(e.type)).at(-1);
 const latest=run?.events?.at(-1);
 const phaseAdvanced=event?.type==='protocol_error'&&latest&&['intent','plan','plan_update'].includes(latest.type)&&(!event||Date.parse(latest.at)>=Date.parse(event.at));
 const retry=!phaseAdvanced&&(event&&!!recovery[event.type]||base.label.includes('正在恢复执行'));
 if(retry){
  const exhausted=/已用尽|重试失败/.test(event?.detail.message||'');
  if(exhausted)return result('这一步还没能完成','自动重试没有成功。请查看详情后继续。','attention');
  const firstRetryAt=run?.events.find(e=>!!recovery[e.type])?.at;
  const lastAt=Date.parse(progressAt||firstRetryAt||''),wait=Number.isFinite(lastAt)?Math.max(0,Math.floor((now-lastAt)/60000)):0;
  return result('这一步暂时遇到问题',`${context?`正在重新尝试：${context}`:'正在自动重试'}。${wait>=1?`已 ${wait} 分钟没有新结果。`:''}暂不需要你操作。`,'waiting');
 }
 if(run?.mode==='task'){
  if(last?.type==='command_interrupted'||last?.detail.timedOut)return result('上一步的结果还需要确认',`${userOperationTitle(last)}没有正常结束，正在核对结果。`,'waiting');
  if(last?.type==='tool_error'||last?.detail.exitCode!==undefined&&last.detail.exitCode!==0)return result('正在处理刚才遇到的问题',`${userOperationTitle(last)}未成功，正在分析原因。暂不需要你操作。`,'waiting');
  if(last?.type==='request_directory'||last?.type==='request_network')return result('正在查看授权申请的结果',taskContext||'申请已返回，是否获得权限还需要核对。');
  if(last)return result('正在分析刚才的结果',`最近操作：${userOperationTitle(last)}。`);
  return result(context?`正在处理：${context}`:'正在梳理你的要求','暂时没有新的操作结果，有进展时会更新到这里。');
 }
 return result(base.label,base.detail?userActivityText(base.detail,80):'');
}

// The compact activity row keeps the operation itself as the headline.
function compactSubject(value:unknown):string {
 const text=userActivityText(value,120);
 const clause=text.split(/[，,；;。\n]/)[0];
 return brief(clause.length>=8?clause:text,34);
}
export function compactActivityPresentation(run:AgentRun|undefined,status:string) {
 const view=userActivityPresentation(run,status);
 if(!run?.inFlight&&!['waiting_permission','waiting_user','paused','blocked','failed','completed'].includes(run?.status||'')){
  if(status.startsWith('正在查看图片 ·')||status.includes('暂时不可用，已切换到'))return {...view,label:brief(status,76),detail:status};
 }
 const last=run?.events?.filter(isActivityOperation).at(-1);
 const context=compactSubject(run?.inFlight?.purpose)||
  (run?.inFlight?compactSubject(userOperationTitle({id:'live',type:run.inFlight.action,at:run.inFlight.at,detail:run.inFlight})):compactSubject(last?.detail.purpose)||compactSubject(userStep(run)))||
  (last?compactSubject(userOperationTitle(last)):'');
 const reason=compactSubject(blockerText(run?.executionState?.blocker));
 let phase:string;
 if(status.startsWith('等待执行'))phase='等待执行';
 else if(run?.status==='waiting_permission')phase='等待授权';
 else if(run?.status==='waiting_user')phase='等待你确认';
 else if(run?.status==='paused')phase='已暂停';
 else if(run?.status==='blocked'||run?.status==='failed')phase='暂时受阻';
 else if(run?.inFlight)phase='执行中';
 else if(view.label==='这一步还没能完成')phase='自动重试未成功';
 else if(view.label==='这一步暂时遇到问题')phase='自动重试中';
 else if(last?.type==='command_interrupted'||last?.detail.timedOut)phase='结果待确认';
 else if(last?.type==='tool_error'||last?.detail.exitCode!==undefined&&last.detail.exitCode!==0)phase='分析问题中';
 else if(last)phase='分析结果中';
 else phase='分析方案中';
 const attention=['waiting_permission','waiting_user','blocked','failed'].includes(run?.status||'');
 const subject=attention?(reason||context):context;
 return {label:subject?`${subject} · ${phase}`:run?.mode==='task'?phase:view.label,detail:view.detail,tone:view.tone,progressAt:view.progressAt};
}
export type ActivityTimelineEntry={kind:'operation';event:AgentRun['events'][number]}|{kind:'recovery';id:string;events:AgentRun['events']};
export function activityTimeline(events:AgentRun['events']):ActivityTimelineEntry[] {
 const timeline:ActivityTimelineEntry[]=[];
 for(const event of events){
  if(isActivityOperation(event))timeline.push({kind:'operation',event});
  else if(recovery[event.type]||event.type==='action_retry'){
   const last=timeline.at(-1);
   if(last?.kind==='recovery')last.events.push(event);
   else timeline.push({kind:'recovery',id:event.id,events:[event]});
  }
 }
 return timeline;
}

// Conservative routing for an explicit reminder addressed to the user in Ailo.
// History is context, never an instruction to create artifacts or send elsewhere.
function reminderDelivery(task){
 if(!task?.scheduledTaskId)return;
 const original=String(task.request||'').replace(/\n\n\[定时执行时间：[\s\S]*\]$/,'').trim();
 // URLs identify reference material, not an instruction to send externally.
 const instruction=original.replace(/https?:\/\/[^\s）)。，；;]+/g,'');
 const reminder=/^(?:请)?(?:提醒我|提醒用户|向用户发送[^。！？\n：:]{0,40}提醒[：:])/.test(instruction);
 const summary=/(?:总结|汇总|摘要|简报|消息.*整理|整理.*消息)/.test(instruction);
 if(!reminder&&!summary)return;
 const scope=instruction.replace(/^向用户发送[^。！？\n：:]{0,40}提醒[：:]/,'').replace(/(?:请)?告知我删除本提醒/g,'');
 // Keep real files, writing projects and external side effects on task routing.
 if(reminder&&/飞书|钉钉|Slack|微信|邮件/i.test(scope))return;
 if(/文件|文档|报告|附件|代码|脚本|网页|网站|应用|APK|PDF|HTML|MD格式|表格|书稿|章节|写作|保存|写入|创建|下载|上传|安装|执行命令|运行命令|删除|修改|发送|发给|发到|发邮件|归档|提交|同步|API|浏览器|模拟器/i.test(scope))return;
 const latest=task.messages?.findLast(m=>m.role==='user');
 if(latest?.content&&latest.content!==task.request&&latest.content.trim()!==original&&!/^(?:继续(?:原任务|任务|执行)?[。！!\s]*(?:已处理的条件或补充信息[：:]?\s*)?|请从已保存的任务状态继续，先检查已有成果，不重复执行已完成步骤。)$/.test(latest.content.trim()))return;
 return {kind:'message',...(summary&&!reminder?{sourceRequired:true}:{}),instruction:'本期是在当前对话展示的文字提醒或总结，使用 reply 交付原要求中的内容。总结消息、网页或资料时先用已授权工具读取真实来源，缺少权限或范围不全时如实说明，不能凭历史摘要编造当天结果。无需为回复创建文件、plan、verify 或浏览器验收证据；历史仅用于用户要求的回顾，不把历史计划、工具错误或交付约束当成本期指令。不声称已发送到外部应用，不把邀请用户归档当作已经归档。'};
}
function reminderResume(task,run){
 if(!reminderDelivery(task)||!run?.taskContinuation?.taskOpen||!['blocked','failed','waiting_user'].includes(run.status)||(run.runtimeRepairs||[]).includes('scheduled-message-v1'))return;
 if(run.inFlight||run.taskContinuation.state==='waiting_result_check'||run.taskContinuation.retained?.unknownActions>0||(run.actionJournal||[]).some(e=>['unknown','running','pending'].includes(e.status)))return;
 const blocker=run.waitingError||run.executionState?.blocker||{code:run.taskContinuation.code,message:run.taskContinuation.gap};
 if(!/交付任务不能用聊天正文替代执行|运行观察证据无效|observation.*证据无效/.test(String(typeof blocker==='string'?blocker:blocker.message||'')))return;
 return {id:'scheduled-message-v1'};
}
module.exports={reminderDelivery,reminderResume};

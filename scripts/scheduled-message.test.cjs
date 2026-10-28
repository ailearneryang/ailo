const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {reminderDelivery,reminderResume}=require('../apps/desktop/scheduled-message.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {prepareScheduleContext}=require('../apps/desktop/schedule-context.cjs');
const {createScheduledTasks}=require('../apps/desktop/scheduled-tasks.cjs');
const {canResume,update}=require('../apps/desktop/agent/task-continuation.cjs');
const prompt='提醒我做晚间复盘，并给出三个简短问题，帮助我回顾今天的收获和明天的重点。';
const response={action:'reply',text:'晚间复盘时间到了：1.今天最大的收获是什么？2.今天有哪些不足？3.明天最重要的一件事是什么？可补充本周缺失记录，并自行决定是否归档。'};
const json=x=>({content:JSON.stringify(x)}),model={id:'offline',contextWindow:128000};
async function fixture(t,id='today'){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-scheduled-message-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return {base,task:{id,scheduledTaskId:'review',request:prompt,messages:[{id:'original',role:'user',content:prompt}]},model,signal:new AbortController().signal};}
test('only explicit in-app scheduled reminders get message delivery; artifacts and external work retain normal routing',()=>{
 assert.equal(reminderDelivery({scheduledTaskId:'s',request:prompt}).kind,'message');
 for(const request of ['提醒我复盘，并生成PDF文件','提醒我整理复盘并发送到飞书群','制作天气应用','保存本周复盘到文档','提醒我执行命令备份'])assert.equal(reminderDelivery({scheduledTaskId:'s',request}),undefined);
 assert.equal(reminderDelivery({request:prompt}),undefined);
 assert.equal(reminderDelivery({scheduledTaskId:'s',request:prompt,messages:[{role:'user',content:'取消提醒，现在生成复盘文件'}]}),undefined);
});
test('a new scheduled reminder ignores historical artifact instructions and delivers through one real reply',async t=>{
 const f=await fixture(t),context=await prepareScheduleContext(f.base,f.task,[]);assert.doesNotMatch(context.instruction,/课程地图|重新创刊|选题前/);assert.match(context.instruction,/文字提醒/);
 let calls=0;const result=await runAgent({...f,requestOrigin:'scheduled',scheduledContext:{...context,recentRuns:[{summary:'旧记录要求plan、verify、finish，不准使用reply'}]},executeTool:()=>assert.fail('text reminder must not execute a tool'),ask:async messages=>{const s=JSON.parse(messages.at(-1).content);calls++;assert.equal(s.phase,'chat');assert.equal(s.deliveryContract.kind,'message');return json(response);}});
 assert.equal(calls,1);assert.equal(result.content,response.text);assert.equal(result.agentRun.status,'idle');assert.equal(result.agentRun.mode,'chat');const w=await createWorkspace(f.base,f.task);assert.equal(w.run.events.filter(e=>e.type==='reply').length,1);assert.equal(w.run.events.some(e=>['verify','plan','tool_error'].includes(e.type)),false);assert.equal(w.run.artifacts.length,0);
});
for(const priorStatus of ['blocked','waiting_user'])test('a legacy reminder '+priorStatus+' in artifact verification resumes the same execution without falsely passing checks',async t=>{
 const f=await fixture(t,'legacy'),w=await createWorkspace(f.base,f.task);await fs.writeFile(path.join(w.files,'preserved.txt'),'prior history');
 Object.assign(w.run,{mode:'task',status:'blocked',executionId:require('node:crypto').randomUUID(),inputKey:'original',goal:'提交复盘提醒消息',requirementsManaged:true,requirements:[{id:'r1',text:'三个问题',type:'content'},{id:'r2',text:'提示补记',type:'content'},{id:'r3',text:'邀请归档',type:'content'}],acceptance:['三个问题','提示补记','邀请归档'],acceptanceTypes:['content','content','content'],decisions:['原误分类计划'],steps:[{id:'send',title:'提交复盘提醒消息',status:'running'}],executionState:{blocker:{code:'AGENT_REPAIR_EXHAUSTED',message:'最终验收未通过。运行观察证据无效；使用 browser 或 android_device 的真实操作事件'}}});update(w.run);w.run.status=priorStatus;await w.save();const id=w.run.executionId;
 const task={...f.task,messages:[...f.task.messages,{id:'retry',role:'user',content:'请从已保存的任务状态继续，先检查已有成果，不重复执行已完成步骤。'}]};assert.ok(reminderResume(task,w.run));assert.equal(canResume(w.run,task),true);
 const result=await runAgent({...f,task,requestOrigin:'user',ask:async messages=>{const s=JSON.parse(messages.at(-1).content);assert.equal(s.phase,'chat');assert.equal(s.acceptanceCriteria.length,3);return json(response);},executeTool:()=>assert.fail('no fake verification or writes')});
 assert.equal(result.content,response.text);assert.equal(result.agentRun.status,'idle');assert.equal(result.agentRun.taskContinuation.taskOpen,false);const saved=await createWorkspace(f.base,task);assert.equal(saved.run.executionId,id);assert.equal(saved.run.requirements.length,3);assert.ok(!Object.values(saved.run.acceptanceResults||{}).some(c=>c.status==='passed'));assert.equal(saved.run.steps[0].status,'running');assert.equal(await fs.readFile(path.join(w.files,'preserved.txt'),'utf8'),'prior history');assert.deepEqual(saved.run.runtimeRepairs,['scheduled-message-v1']);
});
test('unknown remote effects and ordinary service failures do not gain a bare retry from reminder routing',()=>{
 const task={scheduledTaskId:'s',request:prompt,messages:[{id:'new',role:'user',content:'继续任务'}]};
 for(const blocker of [{code:'MODEL_PROVIDER_REJECTED',message:'授权失败'},{code:'AGENT_REPAIR_EXHAUSTED',message:'unrelated failure'}]){const run={status:'blocked',taskContinuation:{taskOpen:true,state:'waiting_diagnosis',retained:{}},executionState:{blocker}};assert.equal(reminderResume(task,run),undefined);assert.equal(canResume(run,task),false);}
 const run={status:'blocked',taskContinuation:{taskOpen:true,state:'waiting_result_check',retained:{unknownActions:1}},actionJournal:[{status:'unknown'}],executionState:{blocker:{message:'交付任务不能用聊天正文替代执行'}}};assert.equal(reminderResume(task,run),undefined);assert.equal(canResume(run,task),false);
});
test('a scheduled occurrence is recorded completed after message delivery without producing a file',async t=>{
 const f=await fixture(t);let executions=0;const service=createScheduledTasks({directory:f.base,execute:async(schedule,occurrence)=>{const task={...f.task,id:occurrence.taskId,request:schedule.prompt};const result=await runAgent({...f,task,requestOrigin:'scheduled',ask:async()=>json(response)});assert.equal(result.agentRun.status,'idle');executions++;}});t.after(()=>service.stop());
 const schedule=await service.save({title:'晚间复盘提醒',prompt,modelId:'offline',frequency:'daily',time:'22:00'});await service.run(schedule.id);
 for(let i=0;i<100;i++){const saved=(await service.list())[0];if(saved.runs[0]?.status==='completed'){assert.equal(executions,1);return;}await new Promise(r=>setTimeout(r,2));}assert.fail('scheduled reminder did not complete');
});
test('company notification wording and reference links remain in-app reminders without changing the schedule',()=>{
 const request='向用户发送公司年度体检提醒：11月底是公司体检的截止安排，请提醒用户查看体检通知公告（链接：https://oa.feishu.cn/announcement/detail/example），尽快完成体检预约或确认已约好的体检时间；若已完成体检，请告知我删除本提醒。';
 assert.equal(reminderDelivery({scheduledTaskId:'medical',request}).kind,'message');
 for(const text of ['向用户发送体检提醒：并发送到飞书群','帮我整理飞书消息，总结并保存为MD文件','每天整理知识点，以HTML和MD格式呈现，保存进度','每天开始写作，根据材料完成章节','汇总消息并归档到文档'])assert.equal(reminderDelivery({scheduledTaskId:'s',request:text}),undefined);
});
test('scheduled Feishu summaries read a real validated connector result before replying without artifact verification',async t=>{
 const f=await fixture(t,'summary');f.task.request='帮我整理一下当天飞书的消息，总结一下';f.task.messages=[{id:'summary-original',role:'user',content:f.task.request}];let calls=0,reads=0;
 const result=await runAgent({...f,requestOrigin:'scheduled',feishuCli:{execute:async action=>{const args=require('../apps/desktop/feishu-request.cjs').apiArgs(action);assert.ok(args.includes('+messages-search'));reads++;return {exitCode:0,output:JSON.stringify({items:[{message_id:'om_known',text:'offline-summary-source'}],has_more:false})};}},ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);assert.equal(s.phase,'chat');assert.equal(s.deliveryContract.sourceRequired,true);
  if(calls++===0)return json({action:'feishu',operation:'shortcut',query:'im +messages-search',params:{'page-size':'10'},purpose:'读取本期消息'});
  assert.equal(reads,1);assert.match(JSON.stringify(s.toolResults),/offline-summary-source/);return json({action:'reply',text:'已读取的消息摘要：offline-summary-source。'});
 }});
 assert.equal(reads,1);assert.equal(result.agentRun.status,'idle');assert.equal(result.content,'已读取的消息摘要：offline-summary-source。');const w=await createWorkspace(f.base,f.task);assert.equal(w.run.events.some(e=>['verify','artifact','tool_error'].includes(e.type)),false);
});

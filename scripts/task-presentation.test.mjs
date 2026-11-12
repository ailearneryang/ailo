import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const deliverySource=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/desktop/src/delivery-status.ts',import.meta.url),'utf8'));const deliveryModule='data:text/javascript;base64,'+Buffer.from(deliverySource).toString('base64');const source=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/desktop/src/task-presentation.ts',import.meta.url),'utf8')).replace("'./delivery-status'",JSON.stringify(deliveryModule));const {taskPresentation,mergeSessionSnapshot,syncLiveTaskRuns,activityForSession}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const task={id:'t',messages:[{id:'old',role:'user',content:'任务'},{id:'answer',role:'assistant',content:'暂停'},{id:'new',role:'user',content:'需要什么材料'}],agentRun:{mode:'task',status:'paused',progressInputId:'old',events:[],steps:[],artifacts:[]}};
const session={id:'request',taskId:'t',inputId:'new',content:'',status:'正在检查上下文',phase:'preparing'};
test('My Ailo shows the same real execution state as other conversations without borrowing another task activity',()=>{
 const assistant={id:'my-ailo-assistant',messages:[]};assert.equal(taskPresentation(assistant).animating,false);
 const live={...session,taskId:assistant.id};assert.equal(taskPresentation(assistant,live).animating,true);
 const waiting={...live,phase:'running',run:{status:'waiting_permission',currentIntent:'task'}};assert.equal(taskPresentation(assistant,waiting).animating,false);
 assert.equal(taskPresentation(assistant,{...live,phase:'queued'}).animating,false);
});
test('a new request overrides an old paused plan without presenting old timestamps as current work',()=>{const view=taskPresentation(task,session);assert.equal(view.state,'preparing');assert.equal(view.activityRun,undefined);assert.equal(view.historical,true);assert.equal(view.progressStatus,'paused');});
test('queue and chat intent remain separate from a preserved paused plan',()=>{assert.equal(taskPresentation(task,{...session,status:'等待执行：项目占用',phase:'queued'}).state,'queued');const run={...task.agentRun,currentIntent:'chat',currentInputId:'new'};const view=taskPresentation({...task,agentRun:run},{...session,phase:'running',run});assert.equal(view.state,'replying');assert.equal(view.activityRun,undefined);assert.equal(view.historical,true);});
test('current task running, authorization, confirmation and genuine pauses share the same state',()=>{for(const state of ['running','waiting_permission','waiting_user','paused','failed','blocked']){const run={...task.agentRun,progressInputId:'new',currentIntent:'task',currentInputId:'new',status:state};const view=taskPresentation({...task,agentRun:run},{...session,phase:'running',run});assert.equal(view.state,state);assert.equal(view.progressStatus,state);assert.equal(view.activityRun,run);assert.equal(view.historical,false);}});
test('reply completion does not falsely claim a preserved task plan has resumed; chat clarification remains actionable',()=>{const run={...task.agentRun,currentIntent:'chat',currentInputId:'new',currentOutcome:'reply'};assert.equal(taskPresentation({...task,agentRun:run}).state,'idle');assert.equal(taskPresentation({...task,agentRun:{...run,currentOutcome:'clarify',status:'waiting_user'}}).state,'waiting_user');assert.equal(taskPresentation(task).state,'paused');});
test('a late poll cannot revive a finished request or overwrite a newly submitted request',()=>{const old={...session,id:'old',attached:true};const done=new Set(['old']);assert.deepEqual(mergeSessionSnapshot({},[old],done),{});const current={t:{...session,id:'new',attached:false}};assert.equal(mergeSessionSnapshot(current,[old],done).t.id,'new');assert.deepEqual(mergeSessionSnapshot({t:old},[],done),{});});

test('activity age and in-flight descriptions belong to the current request, not yesterday’s plan',()=>{const run={...task.agentRun,events:[{type:'plan',at:'2026-10-17T00:00:00Z'},{type:'write_file',at:'2026-10-18T11:00:00Z'}],inFlight:{action:'write_file',at:'2026-10-17T00:00:00Z'}};const view=activityForSession(run,{...session,startedAt:'2026-10-18T10:00:00Z'});assert.equal(view.events.length,1);assert.equal(view.inFlight,undefined);assert.equal(run.events.length,2);});

test('attaching to a scheduled run restores its live plan without renaming the conversation',()=>{
 const scheduled={...task,id:'scheduled',title:'定时 · 每天学一点AI',scheduledTaskId:'daily',agentRun:undefined};
 const run={...task.agentRun,status:'running',conversationTitle:'模型生成的标题',steps:[{id:'step',title:'读取课程',status:'completed'}]};
 const sessions=mergeSessionSnapshot({},[{...session,taskId:scheduled.id,run}],new Set());
 const [updated]=syncLiveTaskRuns([scheduled],sessions);
 assert.equal(updated.agentRun,run);assert.equal(updated.title,scheduled.title);assert.equal(scheduled.agentRun,undefined);
 const finished=mergeSessionSnapshot(sessions,[],new Set([session.id]));
 assert.equal(syncLiveTaskRuns([scheduled],finished)[0],scheduled);
});


test('sidebar animation belongs only to a live working session and stops while queued or waiting',()=>{
 for(const state of ['running','understanding','waiting_permission','waiting_user','paused','failed','blocked','completed']){
  const run={...task.agentRun,currentIntent:'task',status:state,currentOutcome:undefined};
  const current=taskPresentation({...task,agentRun:run},{...session,phase:'running',run});
  assert.equal(current.animating,['running','understanding'].includes(state),state);
  assert.equal(taskPresentation({...task,agentRun:run}).animating,false,'stored '+state);
 }
 for(const status of ['waiting_permission','waiting_user','blocked','paused','failed'])assert.equal(taskPresentation(task,{...session,phase:'running',run:{...task.agentRun,currentIntent:'chat',status}}).animating,false,'chat '+status);
 assert.equal(taskPresentation(task,{...session,phase:'queued'}).animating,false);
 assert.equal(taskPresentation(task,session).animating,true);
 assert.equal(taskPresentation(task,{...session,phase:'settling',run:{...task.agentRun,currentIntent:'chat'}}).animating,true);
});

test('source-only stopped work and unverified effects use the same truthful label in navigation and result cards',()=>{const run={...task.agentRun,status:'partial',delivery:{status:'settled',outcome:'partial',hasNewDeliverable:false,changes:{changedArtifacts:['android-design.json']}}};assert.equal(taskPresentation({...task,agentRun:run}).label,'修改待核验');run.delivery.hasNewDeliverable=true;run.resultPreview={available:true};assert.equal(taskPresentation({...task,agentRun:run}).label,'当前效果待核验');});

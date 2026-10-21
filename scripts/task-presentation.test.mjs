import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/desktop/src/task-presentation.ts',import.meta.url),'utf8'));const {taskPresentation,mergeSessionSnapshot,syncLiveTaskRuns,activityForSession}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const task={id:'t',messages:[{id:'old',role:'user',content:'任务'},{id:'answer',role:'assistant',content:'暂停'},{id:'new',role:'user',content:'需要什么材料'}],agentRun:{mode:'task',status:'paused',progressInputId:'old',events:[],steps:[],artifacts:[]}};
const session={id:'request',taskId:'t',inputId:'new',content:'',status:'正在检查上下文',phase:'preparing'};
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

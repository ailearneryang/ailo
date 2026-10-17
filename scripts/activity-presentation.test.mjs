import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const js=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/desktop/src/activity-presentation.ts',import.meta.url),'utf8'),{mode:'strip'});
const {activityPresentation}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const at='2026-10-16T09:00:00Z';
const run={mode:'task',events:[{type:'plan',at,detail:{}},{type:'output_limit',at:'2026-10-16T09:01:00Z',detail:{message:'将提高额度至 32768 并自动重试'}}]};
test('retry explanation uses real recovery events and last actual progress time',()=>{
 const result=activityPresentation(run,'正在决定下一步 · 已等待 27 秒（最长 10 分钟）');
 assert.equal(result.label,'正在恢复执行');assert.equal(result.progressAt,at);
 assert.match(result.detail,/输出长度限制.*自动重试/);assert.doesNotMatch(JSON.stringify(result),/32768|10 分钟/);
});
test('completed retries no longer claim recovery and in-flight work takes precedence',()=>{
 assert.equal(activityPresentation({...run,events:[...run.events,{type:'write_file',at,detail:{}}]},'正在决定下一步').label,'正在准备下一步操作');
 assert.equal(activityPresentation({...run,inFlight:{action:'write_file',purpose:'同步目录',at}},'正在决定下一步').label,'正在更新文件');
 assert.equal(activityPresentation({...run,events:[{type:'output_limit',at,detail:{message:'自动重试已用尽'}}]},'').label,'恢复执行未成功');
});
test('queue and task without recorded progress do not invent progress timestamps',()=>{
 assert.equal(activityPresentation(run,'等待执行：其他任务').label,'等待执行');
 assert.equal(activityPresentation({mode:'task',events:[]},'').progressAt,undefined);
});
test('normal activity stays inline while recovery and user action expose explanations',()=>{
 const normal=activityPresentation({mode:'task',status:'running',events:[]},'正在决定下一步 · 模型仍在思考 · 已等待 100 秒（最长 10 分钟）');
 assert.equal(normal.label,'正在准备下一步操作');assert.equal(normal.detail,undefined);assert.equal(normal.expanded,false);
 assert.equal(activityPresentation(run,'').expanded,true);
 const confirmation=activityPresentation({...run,status:'waiting_user'},'');
 assert.equal(confirmation.label,'等待你确认');assert.equal(confirmation.expanded,true);
 assert.equal(activityPresentation({...run,status:'paused'},'').label,'任务已暂停');
});
test('progress age uses readable minutes without claiming a completion deadline',async()=>{
 const {formatProgressAge}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 assert.equal(formatProgressAge(0),'进展刚刚更新');
 assert.equal(formatProgressAge(27),'上次更新于 27 秒前');
 assert.equal(formatProgressAge(60),'上次更新于 1 分前');
 assert.equal(formatProgressAge(100),'上次更新于 1 分 40 秒前');
 assert.equal(formatProgressAge(3661),'上次更新于 1 小时 1 分前');
});

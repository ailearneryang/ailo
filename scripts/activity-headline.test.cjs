const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module');
const js=stripTypeScriptTypes(fs.readFileSync(require('node:path').join(__dirname,'../apps/desktop/src/activity-presentation.ts'),'utf8'),{mode:'strip'});
const presentation=import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const at='2026-10-24T08:54:53Z';
const deployment={mode:'task',status:'running',goal:'部署本地模型',steps:[{id:'move',title:'将模型部署到本机目录',status:'running'}],events:[]};
const event=(type,detail={})=>({id:type,type,at,detail});
test('incident: recovery and verbose authorization logs leave a concrete, truthful folded headline',async()=>{
 const {activityPresentation}=await presentation;
 const run={...deployment,events:[event('no_action_recovery',{message:'自动恢复：精简决策上下文、缩小单次动作'}),event('request_directory',{path:'/Users/xing/ai',purpose:'你已明确指示：权重已下载好，直接移动到本机部署。'.repeat(10)}),event('attached_progress')]};
 const result=activityPresentation(run,'正在决定下一步');
 assert.equal(result.label,'将模型部署到本机目录 · 目录授权申请已返回，正在分析结果');
 assert.doesNotMatch(result.label,/正在准备下一步|你已明确指示|已获授权|部署完成/);
 assert.equal(result.progressAt,undefined);
 const waiting=activityPresentation({...run,status:'waiting_permission',executionState:{blocker:{message:'目标目录目前只有只读权限'}}},'');
 assert.equal(waiting.label,'目标目录目前只有只读权限 · 等待授权');
});
test('recovery survives bookkeeping but ends when a concrete new operation returns',async()=>{
 const {activityPresentation}=await presentation;
 const run={...deployment,events:[event('no_action_recovery'),event('attached_progress'),event('checkpoint')]};
 assert.equal(activityPresentation(run,'').label,'将模型部署到本机目录 · 正在恢复执行');
 const resumed={...run,events:[...run.events,event('read_file',{path:'models/config.json'}),event('attached_progress')]};
 assert.equal(activityPresentation(resumed,'').label,'models/config.json · 操作已返回，正在分析结果');
 assert.equal(activityPresentation(resumed,'').progressAt,at);
});
test('finished, failed, timed-out and interrupted commands are never labeled as still executing or task complete',async()=>{
 const {activityPresentation}=await presentation;
 for(const [type,detail,phase] of [
  ['run_command',{exitCode:0},'命令已结束，正在分析结果'],
  ['run_command',{exitCode:1},'操作未通过，正在分析原因'],
  ['run_command',{exitCode:0,timedOut:true},'操作未通过，正在分析原因'],
  ['command_interrupted',{},'操作已中断，结果待核对']
 ]){
  const result=activityPresentation({...deployment,events:[event(type,{purpose:'核对模型文件',output:'POLL_DL10_DONE',...detail}),event('attached_progress')]},'');
  assert.equal(result.label,'核对模型文件 · '+phase);assert.doesNotMatch(result.label,/正在执行命令|已完成|POLL_DL10_DONE/);
 }
});
test('live work identifies its object; model plans remain plans and blockers remain explicit',async()=>{
 const {activityPresentation}=await presentation;
 assert.equal(activityPresentation({...deployment,inFlight:{action:'read_file',path:'src/main.tsx',at}},'').label,'src/main.tsx · 正在读取文件');
 assert.equal(activityPresentation({...deployment,inFlight:{action:'request_directory',path:'/Users/xing/ai/models',purpose:'请给予目录读写授权。'.repeat(20),at}},'').label,'ai/models · 正在申请目录授权');
 const failed=activityPresentation({...deployment,status:'failed',executionState:{blocker:{message:'缺少模型分片'}}},'');assert.equal(failed.label,'缺少模型分片 · 执行已中断');
 assert.equal(activityPresentation({...deployment,executionState:{nextAction:'核对模型目录的写入权限'}},'').label,'核对模型目录的写入权限 · 计划下一步');
 assert.equal(activityPresentation({...deployment,executionState:{nextAction:'read_file'}},'').label,'将模型部署到本机目录 · 正在分析执行方案');
 assert.equal(activityPresentation({mode:'task',events:[],steps:[]},'').label,'正在分析任务，尚无工具执行记录');
});
test('user-facing incident: verification and recovery internals become a clear task message without implying progress',async()=>{
 const {userActivityPresentation}=await presentation;
 const run={...deployment,steps:[{id:'check',title:'逐区对照并提交verify证据',status:'running'}],events:[event('output_limit',{message:'未产出动作，将精简请求并适配输出预算与决策时间后继续'}),event('no_action_recovery',{message:'自动恢复：精简决策上下文、缩小单次动作，保留已授权工具并适配输出预算。'}),event('intent')]};
 const view=userActivityPresentation(run,'执行中',Date.parse(at)+125000);
 assert.equal(view.label,'这一步暂时遇到问题');assert.equal(view.tone,'waiting');
 assert.equal(view.detail,'正在重新尝试：核对各区域效果。已 2 分钟没有新结果。暂不需要你操作。');
 assert.doesNotMatch(view.label+view.detail,/verify|未产出动作|输出预算|决策上下文|恢复执行|已完成/);
 assert.equal(view.progressAt,undefined);
});
test('user-facing results keep their time across repeated diagnostics; a new real result ends recovery',async()=>{
 const {userActivityPresentation}=await presentation;
 const result=event('read_file',{path:'models/config.json'}),retry={...event('no_action_recovery'),at:'2026-10-24T08:55:53Z'};
 const run={...deployment,events:[result,retry,event('attached_progress')]};
 const view=userActivityPresentation(run,'',Date.parse(at)+185000);
 assert.equal(view.progressAt,at);assert.match(view.detail,/3 分钟没有新结果/);
 const resumed=userActivityPresentation({...run,events:[...run.events,{...result,id:'new',at:'2026-10-24T08:57:53Z'}]},'',Date.parse(at)+185000);
 assert.equal(resumed.label,'正在分析刚才的结果');assert.match(resumed.detail,/config.json/);assert.doesNotMatch(resumed.detail,/重试|没有新结果/);
});
test('user-facing waiting states clearly distinguish user action from automatic work',async()=>{
 const {userActivityPresentation}=await presentation;
 const auth=userActivityPresentation({...deployment,status:'waiting_permission',executionState:{blocker:{message:'目标目录目前只有只读权限'}}},'');
 assert.equal(auth.label,'需要你授权后才能继续');assert.match(auth.detail,/只读权限/);assert.equal(auth.tone,'attention');assert.doesNotMatch(auth.detail,/暂不需要/);
 const user=userActivityPresentation({...deployment,status:'waiting_user'},'');assert.equal(user.label,'有个问题需要你确认');
 const stopped=userActivityPresentation({...deployment,status:'paused',inFlight:{action:'run_command',purpose:'移动模型',at}},'');assert.equal(stopped.label,'任务已暂停');
 const exhausted=userActivityPresentation({...deployment,events:[event('no_action_recovery',{message:'自动重试已用尽'})]},'');assert.equal(exhausted.label,'这一步还没能完成');assert.doesNotMatch(exhausted.detail,/正在自动重试|暂不需要/);
 const failed=userActivityPresentation({...deployment,status:'failed',executionState:{blocker:{message:'MODEL_NO_ACTION_BUDGET 输出预算不足'}}},'');assert.equal(failed.label,'任务暂时无法继续');assert.doesNotMatch(failed.detail,/MODEL_|输出预算/);
});
test('compact screenshot baseline keeps a short specific operation rather than a two-line generic status',async()=>{
 const {compactActivityPresentation}=await presentation;
 const purpose='对照最新模拟器截图与设计原稿，确认城市名称、实时气温、预警、编组四个修复区域控件位置差异';
 const run={...deployment,steps:[{id:'visual',title:purpose,status:'running'}],events:[event('android_device',{operation:'screenshot',purpose}),event('attached_progress')]};
 const view=compactActivityPresentation(run,'执行中');
 assert.equal(view.label,'对照最新模拟器截图与设计原稿 · 分析结果中');assert.ok(view.label.length<40);assert.equal(view.progressAt,at);
 const live=compactActivityPresentation({...run,inFlight:{action:'android_device',purpose:'安装当前 APK',at}},'');assert.equal(live.label,'安装当前 APK · 执行中');
 const retry=compactActivityPresentation({...run,events:[...run.events,event('no_action_recovery')]},'');assert.equal(retry.label,'对照最新模拟器截图与设计原稿 · 自动重试中');assert.equal(retry.progressAt,at);
 const auth=compactActivityPresentation({...run,status:'waiting_permission',executionState:{blocker:{message:'目标目录目前只有只读权限'}}},'');assert.match(auth.label,/只读权限 · 等待授权/);
});
test('chronological recovery groups merge adjacent diagnostics but never swallow real work or mutate evidence',async()=>{
 const {activityTimeline,userOperationTitle}=await presentation;
 const records=[event('output_limit',{message:'预算调整'}),event('no_action_recovery',{message:'精简上下文'}),event('attached_progress'),{...event('android_device',{operation:'install'}),id:'install'},event('output_limit',{message:'第二次调整'}),event('no_action_recovery',{message:'第二次恢复'}),{...event('android_device',{operation:'launch'}),id:'launch'}];
 // IDs are unique in persisted events; keep the two recovery rounds distinct here too.
 records.forEach((e,i)=>e.id='event-'+i);
 const before=JSON.stringify(records),timeline=activityTimeline(records);
 assert.deepEqual(timeline.map(e=>e.kind),['recovery','operation','recovery','operation']);
 assert.deepEqual(timeline.filter(e=>e.kind==='recovery').map(e=>e.events.length),[2,2]);
 assert.equal(userOperationTitle(timeline[1].event),'安装当前 APK');assert.equal(userOperationTitle(timeline[3].event),'启动应用');
 assert.equal(JSON.stringify(records),before);
 assert.deepEqual(timeline.filter(e=>e.kind==='recovery').flatMap(e=>e.events.map(x=>x.detail.message)),['预算调整','精简上下文','第二次调整','第二次恢复']);
});

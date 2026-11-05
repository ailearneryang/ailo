const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {pendingOutcomeMessage,isInternalPendingReply}=require('../apps/desktop/task-outcome.cjs');
test('unknown result names the actual operation and does not delegate technical reconciliation to the user',()=>{
 const run={status:'blocked',taskContinuation:{state:'waiting_result_check'},events:[{type:'run_command',detail:{actionId:'clone',timedOut:true}}],actionJournal:[{id:'clone',status:'unknown',action:'run_command',purpose:'克隆示例仓库'}]},before=structuredClone(run);
 const text=pendingOutcomeMessage(run);assert.match(text,/尚未确认「克隆示例仓库」是否完成/);assert.match(text,/操作超时/);assert.match(text,/Ailo 尚未完成结果核查/);assert.doesNotMatch(text,/请核对|回执|本轮执行已结束|任务已完成|部分文件|密码|APK/);assert.deepEqual(run,before);
 assert.equal(pendingOutcomeMessage({status:'completed'}),undefined);assert.equal(isInternalPendingReply('此前操作的结果尚未核对，禁止自动重放；先检查文件'),true);assert.equal(isInternalPendingReply('查询完成，共找到 3 项任务'),false);
});
test('an earlier timeout must not become the cause of a different unknown operation',()=>{
 const run={events:[{type:'run_command',detail:{actionId:'old',result:{timedOut:true}}}],actionJournal:[{id:'old',status:'succeeded'},{id:'new',status:'unknown',purpose:'发布报告'}]};
 assert.doesNotMatch(pendingOutcomeMessage(run),/超时/);assert.match(pendingOutcomeMessage(run),/发布报告/);
});
test('timeout inspection reads only bounded local metadata and never replays or resolves unknown side effects',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-outcome-inspection-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(base,{id:'inspection'}),journal=require('../apps/desktop/agent/action-journal.cjs');
 w.run.steps=[];await fs.writeFile(path.join(w.files,'report.md'),'private contents');await fs.mkdir(path.join(w.files,'repo'));
 const action={action:'run_command',command:'isolated fixture only',purpose:'生成报告',scopes:[{kind:'file',path:'report.md'},{kind:'file',path:'repo'},{kind:'file',path:'missing.md'}]},entry=journal.begin(w.run,action);let calls=0;
 await journal.executeWithRecovery(w,entry,action,new AbortController().signal,async()=>{calls++;return {timedOut:true,output:'private command output'};});
 assert.equal(calls,1);assert.equal(entry.status,'unknown');assert.deepEqual(entry.resultInspection.rows.map(r=>r.state),['file','directory','missing']);
 const text=pendingOutcomeMessage(w.run);assert.match(text,/已自动检查/);assert.match(text,/report.md：文件存在/);assert.match(text,/repo：目录存在/);assert.match(text,/missing.md：检查时未找到/);assert.doesNotMatch(text,/private contents|private command output|克隆成功/);
 assert.throws(()=>journal.begin(w.run,action),e=>e.code==='ACTION_RESULT_UNKNOWN');await journal.reconcile(w);assert.equal(entry.status,'unknown');assert.equal(calls,1);
 // Path traversal and symlinks never inspect external content or expose its metadata.
 await fs.symlink(base,path.join(w.files,'outside'));
 entry.resultPaths=['../secret','outside','/etc/passwd'];await require('../apps/desktop/agent/outcome-inspection.cjs').inspect(w,entry);
 assert.deepEqual(entry.resultInspection.rows.map(r=>({path:r.path,state:r.state})),[{path:'outside',state:'unavailable'}]);
});

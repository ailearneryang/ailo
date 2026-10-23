const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const acceptance=require('../apps/desktop/agent/acceptance.cjs'),journal=require('../apps/desktop/agent/action-journal.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const task={id:'t',projectId:'p',request:'交付文件',messages:[{role:'user',content:'交付文件'}]};
async function setup(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-reliability-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const w=await createWorkspace(base,task);w.run.acceptance=['包含标题与案例','有效 JSON'];return {base,w};}
test('acceptance checks bind each requirement, fail atomically, and reject stale or changed files',async t=>{
 const {w}=await setup(t);await fs.writeFile(path.join(w.files,'lesson.md'),'标题');await fs.writeFile(path.join(w.files,'progress.json'),'{}');
 const checks=[{criterionId:acceptance.criterionId(w.run.acceptance[0]),kind:'text_contains',path:'lesson.md',contains:['标题','案例'],reason:'核验两个必需章节'},{criterionId:acceptance.criterionId(w.run.acceptance[1]),kind:'json_valid',path:'progress.json',reason:'验证进度JSON格式'}];
 await assert.rejects(acceptance.verify(w,{checks}),/未匹配到原文/);assert.equal(w.run.acceptanceResults,undefined);
 await fs.writeFile(path.join(w.files,'lesson.md'),'标题 案例');await acceptance.verify(w,{checks});await acceptance.assertAccepted(w);
 await fs.writeFile(path.join(w.files,'lesson.md'),'changed');await assert.rejects(acceptance.assertAccepted(w),/已变化/);
 w.run.revision++;await assert.rejects(acceptance.assertAccepted(w),/尚未核验|依赖文件已变化/);
});
test('a successful command does not satisfy requirements until explicitly bound, invalid evidence rejected',async t=>{
 const {w}=await setup(t);w.run.acceptance=['构建成功'];await w.event('run_command',{revision:w.run.revision,result:{exitCode:0},command:'build'});
 const commandId=w.run.events.at(-1).id;
 await assert.rejects(acceptance.assertAccepted(w),/尚未核验/);
 const check={criterionId:acceptance.criterionId('构建成功'),kind:'command',evidenceId:'fake',reason:'真实构建验证'};
 await assert.rejects(acceptance.verify(w,{checks:[check]}),/证据无效/);
 check.evidenceId=commandId;await acceptance.verify(w,{checks:[check]});await acceptance.assertAccepted(w);
});
test('interrupted writes recover from actual hashes, unknown commands are never blindly replayed',async t=>{
 const {w}=await setup(t),action={action:'write_file',path:'out.md',content:'finished'};
 const entry=journal.begin(w.run,action);await fs.writeFile(path.join(w.files,'out.md'),'finished');await w.save();
 await journal.reconcile(w);assert.equal(entry.status,'succeeded');assert.equal(entry.recovered,true);
 const command={action:'run_command',command:'perform-write',purpose:'写入'};const uncertain=journal.begin(w.run,command);await journal.reconcile(w);assert.equal(uncertain.status,'unknown');
 assert.throws(()=>journal.begin(w.run,{...command,purpose:'换个描述'}),e=>e.code==='ACTION_RESULT_UNKNOWN');
});
test('read retries are bounded and cancellation never retries a side effect',async t=>{
 const {w}=await setup(t),read={action:'read_file',path:'progress.json'},entry=journal.begin(w.run,read);let calls=0;
 await journal.executeWithRecovery(w,entry,read,new AbortController().signal,async()=>{if(++calls<3)throw Object.assign(Error('temporary'),{code:'EBUSY'});return {text:'{}'};});
 assert.equal(calls,3);assert.equal(entry.retries,2);assert.equal(entry.status,'succeeded');
 const controller=new AbortController(),write={action:'run_command',command:'write'},mutation=journal.begin(w.run,write);calls=0;
 await assert.rejects(journal.executeWithRecovery(w,mutation,write,controller.signal,async()=>{calls++;controller.abort();throw Error('stopped');}));
 assert.equal(calls,1);assert.equal(mutation.status,'unknown');
});
test('persisted unknown commands block on resume before tool invocation',async t=>{
 const {base,w}=await setup(t);w.run.acceptance=['交付'];w.run.steps=[{id:'s',title:'执行',status:'running'}];w.run.mode='task';
 const command={action:'run_command',command:'unknown-write',purpose:'执行'};journal.begin(w.run,command);await w.save();let calls=0;
 const result=await runAgent({base,task,model:{contextWindow:32768},signal:new AbortController().signal,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);assert.equal(s.actionRecovery[0].status,'unknown');return {content:JSON.stringify(calls++?command:{action:'route',kind:'task'})};
 },executeTool:()=>assert.fail('unknown mutation must not execute')});
 assert.equal(result.agentRun.status,'blocked');assert.match(result.content,/禁止自动重放/);
});
test('project memory selects newest tasks when more than 100 exist',async t=>{
 const {base}=await setup(t),tasks=Array.from({length:105},(_,i)=>({...task,id:'task'+i,title:'t'+i,created:new Date(Date.UTC(2026,0,105-i)).toISOString()}));
 for(const item of [tasks[0],tasks.at(-1)]){const w=await createWorkspace(base,item);w.run.goal=item.title;await w.save();}
 const memory=await require('../apps/desktop/project-memory.cjs').readMemory(base,{id:'p'},tasks);assert.ok(memory.records.some(r=>r.taskId===tasks[0].id));assert.ok(!memory.records.some(r=>r.taskId===tasks.at(-1).id));
});

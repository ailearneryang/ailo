const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {prepareScheduleContext,archiveScheduleRun,scheduleArtifactRoot}=require('../apps/desktop/schedule-context.cjs');
const {workspacePath,workspaceFiles}=require('../apps/desktop/agent/workspace-path.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const key=id=>createHash('sha256').update(id).digest('hex');
async function setup(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-schedule-context-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return base;}
const old={id:'yesterday',scheduledTaskId:'course',created:'2026-10-11T01:00:00Z',messages:[{role:'assistant',content:'Transformer 已完成，下一课 KV Cache'}]};
const today={id:'today',scheduledTaskId:'course',created:'2026-10-12T01:00:00Z',messages:[{role:'user',content:'继续课程'}]};
test('scheduled runs share files but retain separate execution state and schedule isolation',async t=>{
 const base=await setup(t),a=await createWorkspace(base,old),b=await createWorkspace(base,today);
 assert.equal(a.files,b.files);assert.notEqual(workspacePath(base,old),workspacePath(base,today));
 a.run.goal='昨天的计划';await a.save();assert.notEqual((await createWorkspace(base,today)).run.goal,'昨天的计划');
 await fs.writeFile(path.join(a.files,'progress.json'),'昨天已完成 Transformer');
 assert.equal(await fs.readFile(path.join(b.files,'progress.json'),'utf8'),'昨天已完成 Transformer');
 assert.notEqual(await workspaceFiles(base,{...today,scheduledTaskId:'other'}),a.files);
 assert.notEqual(await workspaceFiles(base,{id:'ordinary'}),a.files);
});
test('legacy versions are archived and latest files imported without overwriting shared progress',async t=>{
 const base=await setup(t);
 for(const [task,text] of [[old,'old'],[today,'new']]){
  const files=path.join(workspacePath(base,task),'files');await fs.mkdir(files,{recursive:true});await fs.writeFile(path.join(files,'progress.md'),text);
 }
 const context=await prepareScheduleContext(base,today,[old,today],Date.parse(today.created));
 const files=await workspaceFiles(base,today);
 assert.equal(context.historyStatus,'available');assert.equal(context.previousRunCount,1);
 assert.match(context.recentRuns[0].summary,/Transformer/);
 assert.equal(await fs.readFile(path.join(files,'progress.md'),'utf8'),'new');
 assert.equal(await fs.readFile(path.join(files,'schedule-history',key(old.scheduledTaskId),key(old.id),'progress.md'),'utf8'),'old');
 assert.equal(await fs.readFile(path.join(workspacePath(base,old),'files','progress.md'),'utf8'),'old');
 await fs.writeFile(path.join(files,'progress.md'),'advanced');
 await prepareScheduleContext(base,today,[old,today],Date.parse(today.created));
 assert.equal(await fs.readFile(path.join(files,'progress.md'),'utf8'),'advanced');
 const details=JSON.parse(await fs.readFile(path.join(files,context.recentRuns[0].detailPath),'utf8'));
 assert.match(details.messages[0].content,/Transformer/);
});
test('all history remains queryable beyond scheduler retention while injected summaries are bounded',async t=>{
 const base=await setup(t),records=Array.from({length:40},(_,i)=>({...old,id:'past-'+i,created:new Date(Date.parse(today.created)-(i+1)*86400000).toISOString()}));
 const context=await prepareScheduleContext(base,today,[...records,today],Date.parse(today.created));
 assert.equal(context.previousRunCount,40);assert.equal(context.recentRunCount,30);assert.equal(context.recentRuns.length,12);
 const index=JSON.parse(await fs.readFile(path.join(await workspaceFiles(base,today),context.historyIndex),'utf8'));
 assert.equal(index.records.length,40);
 const independent=await prepareScheduleContext(base,{...today,scheduledContextMode:'independent'},records,Date.parse(today.created));
 assert.equal(independent.historyStatus,'not_loaded');assert.deepEqual(independent.recentRuns,[]);
 const first=await prepareScheduleContext(base,{...today,scheduledTaskId:'new'},[],Date.parse(today.created));assert.equal(first.historyStatus,'first_run');
});
test('unreadable history fails explicitly instead of treating it as first execution',async t=>{
 const base=await setup(t),runs=path.join(workspacePath(base,old),'runs');await fs.mkdir(runs,{recursive:true});await fs.writeFile(path.join(runs,key(old.id)+'.json'),'invalid');
 await assert.rejects(prepareScheduleContext(base,today,[old,today]),SyntaxError);
});
test('completion ledger survives deleted conversations and artifact snapshots survive subsequent writes',async t=>{
 const base=await setup(t);await prepareScheduleContext(base,old,[old]);
 const files=await workspaceFiles(base,old);await fs.writeFile(path.join(files,'lesson.md'),'Transformer');
 await archiveScheduleRun(base,old,{content:'Transformer 已讲授，下次 KV Cache',agentRun:{status:'completed',artifacts:[{path:'lesson.md'}]}});
 const w=await createWorkspace(base,old);w.run.status='completed';await w.save();
 await fs.writeFile(path.join(files,'lesson.md'),'KV Cache');
 assert.equal(await fs.readFile(path.join(await scheduleArtifactRoot(base,old,'lesson.md'),'lesson.md'),'utf8'),'Transformer');
 const context=await prepareScheduleContext(base,today,[today],Date.parse(today.created));
 assert.equal(context.previousRunCount,1);assert.match(context.recentRuns[0].summary,/Transformer/);
});
test('schedules bound to the same project keep their history indexes isolated',async t=>{
 const base=await setup(t),a={...today,projectId:'p'},b={...today,id:'second',projectId:'p',scheduledTaskId:'other'};
 const ca=await prepareScheduleContext(base,a,[a]),cb=await prepareScheduleContext(base,b,[b]);
 assert.equal(await workspaceFiles(base,a),await workspaceFiles(base,b));assert.notEqual(ca.historyIndex,cb.historyIndex);
});
test('migration skips source symlinks and refuses destination directory symlinks',async t=>{
 const base=await setup(t),source=path.join(workspacePath(base,old),'files'),files=await workspaceFiles(base,today);
 await fs.mkdir(path.join(source,'course'),{recursive:true});await fs.writeFile(path.join(source,'course','progress.md'),'progress');await fs.symlink('/etc/passwd',path.join(source,'secret'));
 const external=path.join(base,'external');await fs.mkdir(external);await fs.mkdir(files,{recursive:true});await fs.symlink(external,path.join(files,'course'));
 await assert.rejects(prepareScheduleContext(base,today,[old,today]),/普通目录/);
 await fs.unlink(path.join(files,'course'));await prepareScheduleContext(base,today,[old,today]);
 await assert.rejects(fs.access(path.join(files,'secret')));assert.deepEqual(await fs.readdir(external),[]);
});

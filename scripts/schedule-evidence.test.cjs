const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {prepareScheduleContext,archiveScheduleRun}=require('../apps/desktop/schedule-context.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const proof=require('../apps/desktop/agent/evidence.cjs');
const {inventory}=require('../apps/desktop/agent/file-state.cjs');
const key=id=>createHash('sha256').update(id).digest('hex');
const yesterday={id:'old',scheduledTaskId:'course',created:'2026-10-25T01:00:00Z',request:'生成前一期课程',messages:[{id:'u-old',role:'user',content:'生成前一期课程'}]};
const today={id:'now',scheduledTaskId:'course',created:'2026-10-26T01:00:00Z',request:'根据历史继续课程',messages:[{id:'u-now',role:'user',content:'根据历史继续课程'}]};
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-history-proof-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const old=await createWorkspace(base,yesterday);await fs.writeFile(path.join(old.files,'lesson.md'),'上一期 Transformer，本期继续 KV Cache');
 Object.assign(old.run,{status:'completed',goal:yesterday.request,steps:[{id:'s',title:'生成课程',status:'done'}],decisions:['保留课程连续性'],acceptance:['包含 Transformer']});await old.save();
 const result={content:'Transformer 已完成，下一期 KV Cache',agentRun:{status:'completed',goal:old.run.goal,steps:old.run.steps,decisions:old.run.decisions,acceptance:old.run.acceptance,artifacts:[{path:'lesson.md',label:'前一期课程'}],events:[{id:'old-check',type:'acceptance_verified',detail:{results:[{status:'passed'}]}}],performance:{modelRequests:4,wallMs:1200}}};
 await archiveScheduleRun(base,yesterday,result);const w=await createWorkspace(base,today);
 return {base,w,result,detail:`schedule-history/${key(today.scheduledTaskId)}/${key(yesterday.id)}/execution.json`,index:`schedule-history/${key(today.scheduledTaskId)}/index.json`};
}
async function commandEvidence(w){
 const state=await inventory(w.files);assert.equal(state.complete,true);await w.event('run_command',{command:'fixture-read-only-check',revision:w.run.revision,result:{exitCode:0,sources:state.files,fileSet:state.files.map(f=>f.path).sort(),scope:{kind:'file',path:'lesson.md'}}});return w.run.events.at(-1).id;
}
test('loading schedule context preserves archived execution bytes and an existing command proof',async t=>{
 const {base,w,result,detail}=await fixture(t),before=await fs.readFile(path.join(w.files,detail));const inputProof={sources:[{path:detail,sha256:proof.hash(before)}]};
 // No historical execution ran or changed; only load the next task's context.
 await prepareScheduleContext(base,today,[yesterday,today],Date.parse(today.created));
 assert.deepEqual(await fs.readFile(path.join(w.files,detail)),before);const record=JSON.parse(before);assert.deepEqual(record.run.events,result.agentRun.events);assert.equal(record.run.performance.modelRequests,4);
 // A new history index is an actual new file; bind a new proof after first import.
 const current=await commandEvidence(w);await prepareScheduleContext(base,today,[yesterday,today],Date.parse(today.created));await proof.event(w,current);
 await proof.assertFresh(w,inputProof);
});
test('a later context load does not alter history bytes or invalidate proof merely because the clock advanced',async t=>{
 const {base,w,index,detail}=await fixture(t);const now=Date.parse(today.created);
 await prepareScheduleContext(base,today,[yesterday,today],now);const before=await fs.readFile(path.join(w.files,index)),detailBefore=await fs.readFile(path.join(w.files,detail));const id=await commandEvidence(w);
 await prepareScheduleContext(base,today,[yesterday,today],now+3600000);
 assert.deepEqual(await fs.readFile(path.join(w.files,index)),before);assert.deepEqual(await fs.readFile(path.join(w.files,detail)),detailBefore);await proof.event(w,id);
});
test('a real archive update or changed artifact still invalidates its old proof and new evidence must be captured',async t=>{
 const {base,w,result,detail}=await fixture(t);await prepareScheduleContext(base,today,[yesterday,today],Date.parse(today.created));
 const historyProof={sources:[{path:detail,sha256:proof.hash(await fs.readFile(path.join(w.files,detail)))}]};
 await archiveScheduleRun(base,yesterday,{...result,content:'更正：前一期尚有章节未完成',agentRun:{...result.agentRun,status:'blocked'}});
 await assert.rejects(proof.assertFresh(w,historyProof),/证据依赖文件已变化/);
 const id=await commandEvidence(w);await proof.event(w,id);await fs.writeFile(path.join(w.files,'lesson.md'),'真实课程内容已变化');await assert.rejects(proof.event(w,id),/证据依赖文件已变化/);
 const newId=await commandEvidence(w);await proof.event(w,newId);
});
test('context loads do not overwrite changed history to make an old hash appear fresh',async t=>{
 const {base,w,detail}=await fixture(t);await prepareScheduleContext(base,today,[yesterday,today]);const before={sources:[{path:detail,sha256:proof.hash(await fs.readFile(path.join(w.files,detail)))}]};
 const changed=JSON.parse(await fs.readFile(path.join(w.files,detail),'utf8'));changed.messages.push({role:'assistant',content:'新记录'});await fs.writeFile(path.join(w.files,detail),JSON.stringify(changed));
 await prepareScheduleContext(base,today,[yesterday,today]);assert.equal(JSON.parse(await fs.readFile(path.join(w.files,detail),'utf8')).messages.at(-1).content,'新记录');await assert.rejects(proof.assertFresh(w,before),/证据依赖文件已变化/);
});
test('unreadable historical execution snapshots remain explicit failures',async t=>{
 const {base,w,detail}=await fixture(t);await fs.writeFile(path.join(w.files,detail),'invalid');await assert.rejects(prepareScheduleContext(base,today,[yesterday,today]),SyntaxError);
});
test('continuation can verify an unchanged report with its original command proof after context reload, without replay',async t=>{
 const {base,w}=await fixture(t),{runAgent}=require('../apps/desktop/agent/runner.cjs');const now=Date.parse(today.created);
 await prepareScheduleContext(base,today,[yesterday,today],now);const id=await commandEvidence(w);
 Object.assign(w.run,{status:'paused',mode:'task',goal:today.request,requirementsManaged:true,requirements:[{id:'history-check',text:'课程已经依据历史做过检查',type:'behavior',scope:{kind:'file',path:'lesson.md'}}],acceptance:['课程已经依据历史做过检查'],acceptanceTypes:['behavior'],decisions:[],steps:[{id:'s',title:'核验课程并交付',status:'running'}]});await w.save();
 await prepareScheduleContext(base,today,[yesterday,today],now+3600000);let calls=0;
 const result=await runAgent({base,task:today,model:{id:'company',contextWindow:131072},signal:new AbortController().signal,executeTool:()=>assert.fail('do not replay the command or reread unchanged input'),ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);assert.ok(++calls<10);
  if(s.phase==='route')return {content:JSON.stringify({action:'route',kind:'task'})};
  if(calls===2)return {content:JSON.stringify({action:'artifact',path:'lesson.md',label:'课程'})};
  if(calls===3)return {content:JSON.stringify({action:'verify',checks:[{criterionId:'history-check',kind:'command',evidenceId:id,reason:'绑定原成功检查及其未变化的课程和历史依赖',scope:{kind:'file',path:'lesson.md'}}],progress:{steps:[{id:'s',status:'done'}]}})};
  return {content:JSON.stringify({action:'finish',text:'已核验并交付',review:{summary:'课程及历史依赖未变化，原成功检查证据仍有效',issues:[],unverified:[]}})};
 }});
 assert.equal(result.agentRun.status,'completed');const saved=await createWorkspace(base,today);assert.equal(saved.run.events.filter(e=>e.type==='run_command').length,1);assert.equal(saved.run.events.filter(e=>e.type==='validation_failed').length,0);assert.equal(saved.run.acceptanceResults['history-check'].status,'passed');
});
test('a real changed history dependency becomes a precise repair target and cannot be cleared by rereading old output',async t=>{
 const {w,detail}=await fixture(t),acceptance=require('../apps/desktop/agent/acceptance.cjs'),recovery=require('../apps/desktop/agent/validation-recovery.cjs');
 w.run.requirementsManaged=true;w.run.requirements=[{id:'r',text:'检查课程与历史一致',type:'behavior'}];const id=await commandEvidence(w);
 const check={criterionId:'r',kind:'command',evidenceId:id,reason:'核对课程与历史'};await acceptance.verify(w,{checks:[check]});
 const record=JSON.parse(await fs.readFile(path.join(w.files,detail),'utf8'));record.messages.push({role:'assistant',content:'真实更正记录'});await fs.writeFile(path.join(w.files,detail),JSON.stringify(record));
 await assert.rejects(acceptance.verify(w,{checks:[check]}),e=>e.code==='EVIDENCE_SOURCE_CHANGED'&&e.evidenceChange.path===detail);
 const target=recovery.pending(w.run)[0];assert.equal(target.observation.changedDependency.path,detail);assert.equal(target.observation.changedDependency.status,'modified');assert.match(target.observation.instruction,/读取旧命令输出.*不刷新原证据/);assert.equal(w.run.acceptanceResults.r,undefined);
 await w.observation(id);await assert.rejects(acceptance.assertAccepted(w),/尚未核验/);
 const fresh=await commandEvidence(w);await acceptance.verify(w,{checks:[{...check,evidenceId:fresh}]});assert.equal(recovery.pending(w.run).length,0);
});
test('a migrated legacy snapshot refreshes on a real source change and stops refreshing after a full result is archived',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-legacy-history-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const prior={...yesterday,messages:[{role:'assistant',content:'之前的真实记录'}]},context=await prepareScheduleContext(base,today,[prior,today]);const w=await createWorkspace(base,today),relative=context.recentRuns[0].detailPath;
 const before={sources:[{path:relative,sha256:proof.hash(await fs.readFile(path.join(w.files,relative)))}]};
 const changed={...prior,messages:[...prior.messages,{role:'assistant',content:'真实补充的执行结果'}]};await prepareScheduleContext(base,today,[changed,today]);
 assert.equal(JSON.parse(await fs.readFile(path.join(w.files,relative),'utf8')).messages.at(-1).content,'真实补充的执行结果');await assert.rejects(proof.assertFresh(w,before),e=>e.code==='EVIDENCE_SOURCE_CHANGED');
 await archiveScheduleRun(base,changed,{content:'正式归档的完整结果',agentRun:{status:'completed',events:[{id:'full-event'}],artifacts:[]}});const full=await fs.readFile(path.join(w.files,relative));
 await prepareScheduleContext(base,today,[changed,today]);assert.deepEqual(await fs.readFile(path.join(w.files,relative)),full);
});

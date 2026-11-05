const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..'),catalog=require('./agent-eval-quality-cases.cjs'),scenarios=require('./agent-eval-scenarios.cjs'),{createChat}=require('../apps/desktop/chat.cjs'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const model={id:'m',model:'controlled-offline',baseUrl:'https://offline.invalid/v1',contextWindow:131072,maxOutputTokens:8192,imageInput:'disabled'};
// These controlled content tasks exercise the four real chat/runner adapter
// boundaries without pretending that Node-only tests grade browser/VLM quality.
async function exercise(t,id){
 const trial=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-scenario-'));t.after(()=>fs.rm(trial,{recursive:true,force:true}));const base=path.join(trial,'workspace'),fixture=structuredClone(catalog.cases.find(c=>c.id===id));
 if(id==='live-material-amendment'){fixture.request='根据 initial.txt 生成 report.md 库存说明，执行时采纳新附件。';fixture.outputs=['report.md'];fixture.scenario.followup.content='根据新附件更新 report.md，说明茶杯库存不足时不再减少。';}
 if(id==='independent-new-goal'){fixture.request='根据 first.txt 整理 old.md 内容文档，核验后交付。';fixture.files={'first.txt':'原有任务已核对内容'};}
 const task={id:'eval',projectId:'eval',request:fixture.request,messages:[{id:'input',role:'user',content:fixture.request}],materials:[]},w=await createWorkspace(base,task);for(const [p,text]of Object.entries(fixture.files))await fs.writeFile(path.join(w.files,p),text);
 let calls=0;const storage={agentDirectory:base,modelCredentials:async()=>model,readWorkspace:async()=>({tasks:[task],projects:[{id:'eval'}],extensions:[]}),patchTask:async(_id,patch,append=[])=>{Object.assign(task,patch);task.messages.push(...append.filter(m=>!task.messages.some(old=>old.id===m.id)));}};
 const fetch=async(_url,options)=>{
  assert.ok(++calls<50,'controlled decision sequence must converge');const messages=JSON.parse(options.body).messages;let s;try{s=JSON.parse(messages.at(-1).content);}catch{throw Error('Unexpected non-agent request in controlled harness');}
  let action;const latest=task.messages.findLast(m=>m.role==='user'),isNew=latest.id==='eval-new-goal',amended=task.messages.some(m=>m.id==='eval-followup');
  const names=isNew?['lesson.html','lesson.md']:id==='independent-new-goal'?['old.md']:id==='unknown-effect'?['receipt.md']:['report.md'];
  const text=isNew?'幂等：重复操作不额外改变结果，超时未知结果先核对。':amended?'茶杯库存不足时不再减少。':id==='unknown-effect'?'计数最终为1；已按真实文件内容核对。':'A组20人，成功16人，成功率80%，样本小不能外推总体。';
  if(s.phase==='route')action={action:'route',kind:'task'};
  else if(!s.acceptanceCriteria?.length||s.materialInput&&s.materialInput.status!=='adopted')action={action:'plan',goal:isNew?'整理幂等知识文档':'整理本轮实际内容',decisions:[],requirements:names.map((p,i)=>({id:'r'+i,text:p+(amended?'包含茶杯库存不足时不再减少的规则':'包含本轮实际内容'),type:'content'})),steps:[{id:'s',title:'生成与核对本轮内容',status:'running'}],...(s.materialInput?.materials?.length?{materialUse:s.materialInput.materials.map(m=>({id:m.id,role:'data',reason:'采用当前附件实际正文',requirementIds:['r0']}))}:{})};
  else if(id==='unknown-effect'&&await fs.readFile(path.join(w.files,'counter.txt'),'utf8')==='0')action={action:'write_file',path:'counter.txt',content:'1'};
  else{
   let missing;for(const p of names){const content=p.endsWith('.html')?'<!doctype html><html><head><title>幂等知识</title></head><body><h1>幂等</h1><p>'+text+'</p></body></html>':text;if(await fs.readFile(path.join(w.files,p),'utf8').catch(()=>null)!==content){missing={action:'write_file',path:p,content};break;}}
   if(missing)action=missing;
   else if(names.some(p=>!s.artifacts?.some(a=>a.path===p)))action={action:'artifact',path:names.find(p=>!s.artifacts?.some(a=>a.path===p)),label:'本轮内容'};
   else if(s.acceptanceCriteria.some(c=>c.check?.status!=='passed'))action={action:'verify',checks:names.map((p,i)=>({criterionId:'r'+i,kind:'text_contains',path:p,contains:[text],reason:'核对当前文件的实际正文'})),progress:{steps:[{id:'s',status:'done'}]}};
   else action={action:'finish',text:'本轮实际内容已完成。',review:{summary:'已核对本轮文件正文和要求',issues:[],unverified:[]}};
  }
  return Response.json({choices:[{message:{tool_calls:[{id:'call-'+calls,type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},finish_reason:'tool_calls'}]});
 };
 const chat=createChat(storage,fetch,{retryDelay:0}),adapter=scenarios.install({source:root,fixture,task,base,trial});adapter.attach(chat);let result,evidence;
 try{result=await adapter.drive({complete:async()=>{try{return await chat.complete({id:'trial',taskId:'eval',modelId:model.id,messages:task.messages,executionOrigin:'evaluation'});}catch(e){return {content:e.taskMessage||e.message,agentRun:e.agentRun,_evaluationError:{code:e.code}};}},persistTask:async(input,prior)=>{task.messages.push({id:'assistant-'+task.messages.length,role:'assistant',content:prior.content||'已有阶段成果'},input);task.materials.push(...(input.materials||[]));}});evidence=await adapter.finish();}finally{adapter.restore();}
 return {result,evidence,calls,w,task};
}
for(const id of ['live-material-amendment','independent-new-goal','explicit-continue','unknown-effect'])test('actual createChat/runAgent isolated adapter: '+id,async t=>{const f=await exercise(t,id);assert.equal(f.result.agentRun?.status,'completed',JSON.stringify({status:f.result.agentRun?.status,gap:f.result.agentRun?.taskContinuation?.gap,evidence:f.evidence}));assert.equal(f.evidence.complete,true,JSON.stringify(f.evidence.checks));assert.ok(f.calls>0);if(id==='unknown-effect'){assert.equal(f.evidence.counterWrites.length,1);assert.equal(await fs.readFile(path.join(f.w.files,'counter.txt'),'utf8'),'1');}if(id==='live-material-amendment')assert.match(await fs.readFile(path.join(f.w.files,'report.md'),'utf8'),/茶杯库存不足/);});
test('canonical and legacy budget projections preserve nonzero failure budgets without mutation',()=>{for(const run of [{executionRecovery:{version:1,repair:{stagnant:7},remaining:{turns:4},failures:{records:[{id:'f',failures:3,recoveries:2}]}}},{repairValue:{stagnant:7},resultRecovery:{turns:4},failureEpisodes:{records:[{id:'f',failures:3,recoveries:2}]}}]){const before=JSON.stringify(run),a=scenarios.budgets(run);assert.equal(a.repairValueStagnant,7);assert.equal(a.remainingDecisions,4);assert.equal(a.episodes[0].failures,3);assert.equal(JSON.stringify(run),before);assert.equal(scenarios.preserved(a,{...a,repairValueStagnant:0}),false);}});

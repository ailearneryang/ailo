const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const recovery=require('../apps/desktop/agent/decision-recovery.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {createOutputBudget}=require('../apps/desktop/agent/output-budget.cjs');
const company={id:'company',baseUrl:'https://company.example/v1',model:'GLM-5.2',contextWindow:131072,maxOutputTokens:65536};
const reply=action=>({content:JSON.stringify(action),providerUsage:{outputTokens:50}});
async function setup(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-continuation-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'t',request:'继续验证应用',messages:[{id:'u',role:'user',content:'继续验证应用'}]},w=await createWorkspace(base,task);
 Object.assign(w.run,{inputKey:'u',mode:'task',status:'blocked',goal:'继续验证应用',acceptance:['报告包含 OK'],steps:[{id:'runtime',title:'运行与验收',status:'running'}]});
 recovery.begin(w.run,'MODEL_OUTPUT_LIMIT',3);w.run.decisionRecovery.noActionFailures=3;w.run.decisionRecovery.maxOutputTokens=22528;
 const policy=createOutputBudget(company,65536);w.run.outputBudget=policy.snapshot();w.run.outputBudget.stages.action.preferred=11264;
 await w.save();return {base,task,w};
}
test('managed Android effects and successful checks count as progress but status, log reads and renamed screenshots do not',()=>{
 const run={inputKey:'u',steps:[{id:'s',status:'running'}]};recovery.begin(run,'MODEL_OUTPUT_LIMIT',3);
 for(const operation of ['status','logs','stop'])recovery.progress(run,{action:'android_device',operation},{running:true,output:'log changed'});
 recovery.progress(run,{action:'android_device',operation:'launch'},{output:'Error: Activity not started'});
 assert.equal(run.decisionRecovery.progressKeys.length,0);
 for(const p of ['shot1.png','shot2.png'])recovery.progress(run,{action:'android_device',operation:'screenshot',purpose:p},{path:p,apkSha256:'apk',sources:[{path:p,sha256:'same pixels'}]});
 assert.equal(run.decisionRecovery.progressKeys.length,1);
 recovery.progress(run,{action:'verify'},{results:[{criterionId:'r',kind:'command',evidenceId:'real command'}]});assert.equal(run.decisionRecovery,undefined);
});
test('recovery budget remains available after small successes and respects configured/context ceilings',()=>{
 const state={maxOutputTokens:22528};
 assert.equal(recovery.budget(11264,100000,65536,state),22528);
 assert.equal(recovery.budget(8192,100000,12000,state),12000);
 assert.equal(recovery.budget(8192,4000,65536,state),4000);
 assert.equal(recovery.budget(65536,100000,65536,state),32768);
 assert.equal(recovery.budget(8192,100000,65536),8192);
});
test('continuing saved failure budget allows runtime work and a later isolated failure does not terminate the task',async t=>{
 const {base,task}=await setup(t),budgets=[],executed=[];let calls=0;
 const result=await runAgent({base,task,model:company,signal:new AbortController().signal,executeTool:async(w,a,signal,options)=>{
  executed.push(a.action+':'+(a.operation||''));
  if(a.action==='android_device')return a.operation==='install'?{installed:true,package:'test.app',apkSha256:'apk'}:{output:'Status: ok',apkSha256:'apk'};
  return require('../apps/desktop/agent/tools.cjs').execute(w,a,signal,options);
 },ask:async(messages,budget)=>{
  const s=JSON.parse(messages.at(-1).content);budgets.push(budget);calls++;
  if(calls===1){assert.equal(s.decisionRecovery.noActionFailures,0);return reply({action:'route',kind:'task'});}
  if(calls===2)throw Object.assign(Error('reasoning exhausted'),{code:'MODEL_OUTPUT_LIMIT',diagnostics:{contentChars:0,reasoningChars:40000}});
  if(calls===3)return reply({action:'android_device',operation:'install',path:'app.apk'});
  if(calls===4)return reply({action:'android_device',operation:'launch'});
  if(calls===5){assert.equal(s.decisionRecovery,undefined);throw Object.assign(Error('empty'),{code:'MODEL_EMPTY_RESPONSE'});}
  if(calls===6)return reply({action:'write_file',path:'report.txt',content:'OK'});
  if(calls===7)return reply({action:'artifact',path:'report.txt',label:'验证报告'});
  if(calls===8)return reply({action:'verify',checks:[{criterionId:s.acceptanceCriteria[0].id,kind:'text_contains',path:'report.txt',contains:['OK'],reason:'核对报告'}],progress:{steps:[{id:'runtime',status:'done'}]}});
  return reply({action:'finish',text:'完成',review:{summary:'已核验报告',issues:[],unverified:[]}});
 }});
 assert.equal(result.agentRun.status,'completed');assert.equal(calls,9);
 assert.ok(budgets.slice(0,4).every(b=>b>=22528));
 assert.deepEqual(executed.slice(0,2),['android_device:install','android_device:launch']);
 assert.equal(result.agentRun.events.find(e=>e.type==='empty_response').detail.message.includes('继续'),true);
});
test('an explicit continuation receives a fresh bounded failure window rather than stopping on its first failure',async t=>{
 const {base,task}=await setup(t);let failures=0;
 const result=await runAgent({base,task,model:company,signal:new AbortController().signal,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(s.phase==='route')return reply({action:'route',kind:'task'});
  failures++;throw Object.assign(Error('no action'),{code:'MODEL_NO_ACTION_TIMEOUT'});
 }});
 assert.equal(failures,4);assert.equal(result.agentRun.status,'blocked');
});
test('direct recovery bounds exact source context and preserves missing ranges and requirements',()=>{
 const {context}=require('../apps/desktop/agent/source-memory.cjs'),snapshot={decisionRecovery:{stage:'direct_action'},acceptanceCriteria:[{id:'r',text:'原要求不可删',type:'content'}],sourceContext:context({sourceFragments:[{path:'a.kt',sha256:'a',total:20000,ranges:[{offset:0,text:'a'.repeat(20000)}]}]}),knownFileContents:[],toolResults:[]};
 const compact=recovery.compact(snapshot,require('../apps/desktop/agent/working-context.cjs').preview);
 assert.equal(compact.sourceContext.files[0].ranges[0].text.length,16000);assert.equal(compact.sourceContext.files[0].complete,false);
 assert.deepEqual(compact.sourceContext.files[0].missingRanges,[{offset:16000,end:20000}]);assert.deepEqual(compact.acceptanceCriteria,snapshot.acceptanceCriteria);
});

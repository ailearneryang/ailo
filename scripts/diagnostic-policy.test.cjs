const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const segments=require('../apps/desktop/agent/execution-segments.cjs');
test('diagnostic limits can reduce an evaluation but cannot enlarge a user or stored policy',()=>{
 assert.equal(segments.evaluationPolicy({executionOrigin:'user',evaluationPolicy:{maxDecisions:120}},undefined),undefined);
 const policy=segments.evaluationPolicy({executionOrigin:'evaluation',evaluationPolicy:{maxDecisions:8}},{segmentSteps:4,maxSegments:2});assert.equal(policy.segmentSteps,4);assert.equal(policy.maxSegments,1);
 for(const evaluationPolicy of [{maxDecisions:0},{maxDecisions:121},{maxDecisions:8,maxSegments:8}])assert.throws(()=>segments.evaluationPolicy({executionOrigin:'evaluation',evaluationPolicy}));
});
test('chat honors an evaluation decision cap even after genuine progress that could otherwise continue',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-diagnostic-policy-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const storage=require('../apps/desktop/storage.cjs').createStorage(base,{});storage.agentDirectory=path.join(base,'agent');storage.modelCredentials=async()=>({id:'configured',model:'company-model',baseUrl:'https://company.example/v1',contextWindow:1048576,maxOutputTokens:32768});
 const task=await storage.patchTask('limited',{request:'写入并核验说明',materials:[]});let calls=0;
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:task.request,decisions:[],acceptance:['说明可读取'],steps:[{id:'s',title:'写入说明',status:'running'}]},{action:'write_file',path:'report.txt',content:'已写入实际内容'}];
 const chat=require('../apps/desktop/chat.cjs').createChat(storage,async()=>{assert.ok(calls<3,'a fourth model request exceeds the diagnostic policy');return Response.json({choices:[{message:{tool_calls:[{id:'call',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(actions[calls++])}}]},finish_reason:'tool_calls'}]});});
 const result=await chat.complete({id:'limited',taskId:task.id,modelId:'configured',executionOrigin:'evaluation',evaluationPolicy:{maxDecisions:3},messages:[{role:'user',content:task.request}]});
 assert.equal(calls,3);assert.equal(result.agentRun.status,'paused');assert.equal(result.agentRun.performance.automaticContinuations||0,0);
});
test('a diagnostic cannot inflate full task or unassisted completion rates even if its tiny fixture completes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-diagnostic-report-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const dir=path.join(root,'candidate','tiny-1');await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(root,'configuration.json'),JSON.stringify({schemaVersion:2,evaluationPurpose:'bounded_diagnostic',stratum:'cold',repeats:1,configurationFingerprint:'pilot',cases:[{id:'tiny'}]}));
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({configurationFingerprint:'pilot',evaluationPurpose:'bounded_diagnostic',elapsedMs:100,checks:[{passed:true}],externalChecks:[],humanAcceptance:'passed',interventionEvidence:{complete:true,events:[]},result:{agentRun:{status:'completed',delivery:{outcome:'complete'}}}}));
 const report=await require('./agent-eval-report.cjs').summarize(root,{print:false}),v=report.versions.candidate;assert.equal(v.boundedDiagnosticTrials,1);assert.equal(v.verifiedSuccess,0);assert.equal(v.declaredComplete,0);assert.equal(v.coldVerifiedSuccess,0);assert.equal(v.verifiedCompletionRate,null);assert.equal(v.unassistedVerifiedCompletionRate,null);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {serviceFailure}=require('./agent-eval-service.cjs');
test('provider quota failures are separate from no-action pauses and protocol/task failures',()=>{
 assert.equal(serviceFailure([{httpStatus:429}],{code:'MODEL_HTTP_ERROR'}),true);
 assert.equal(serviceFailure([{httpStatus:503}],{code:'MODEL_HTTP_ERROR'}),true);
 assert.equal(serviceFailure([{httpStatus:200}],{code:'MODEL_NO_ACTION_BUDGET'}),false);
 assert.equal(serviceFailure([{httpStatus:400}],{code:'AGENT_PROTOCOL'}),false);
 assert.equal(serviceFailure([{httpStatus:429},{httpStatus:200}],undefined),false);
});
test('a fast service failure never becomes a valid trial or speed gain, while paused tasks remain failures',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-eval-report-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 async function put(version,name,result,requests){const dir=path.join(root,version,name);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result));await fs.writeFile(path.join(dir,'requests.json'),JSON.stringify(requests));}
 const base={elapsedMs:10000,checks:[{passed:true}],externalChecks:[],humanAcceptance:'pending',result:{agentRun:{status:'completed'}}};
 await put('baseline','web-normal-1',base,[{httpStatus:200,providerUsage:{inputTokens:20,outputTokens:10}}]);
 await put('candidate','web-normal-1',{...base,elapsedMs:1,result:undefined,error:{code:'MODEL_HTTP_ERROR'}},[{httpStatus:429}]);
 await put('candidate','web-repair-1',{...base,result:{agentRun:{status:'paused'}}},[{httpStatus:200}]);
 // Missing external checks are pending, never a false-completion finding.
 await put('baseline','data-normal-1',{...base,externalChecks:undefined},[{httpStatus:200}]);
 await promisify(execFile)(process.execPath,[path.join(__dirname,'agent-eval-report.cjs'),root]);
 const report=JSON.parse(await fs.readFile(path.join(root,'report.json'),'utf8'));
 assert.equal(report.versions.candidate.attempted,2);assert.equal(report.versions.candidate.finished,1);assert.equal(report.versions.candidate.serviceBlocked,1);assert.equal(report.versions.candidate.declaredComplete,0);assert.equal(report.versions.candidate.medianDeclaredCompletionMs,null);assert.equal(report.versions.baseline.knownFalseCompletion,0);assert.equal(report.versions.baseline.verifiedSuccess,0);
});

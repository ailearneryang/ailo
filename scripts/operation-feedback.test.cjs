const {test}=require('node:test'),assert=require('node:assert/strict');
const {operationFeedback,repositoryContext}=require('../apps/desktop/operation-feedback.cjs');
const {deduplicate}=require('../apps/desktop/agent/decision-projection.cjs');
test('command summaries distinguish auth, address, network, timeout and shell completion without quoting secrets',()=>{
 const output="fatal: could not read Username for 'https://user:SECRET@example.invalid': terminal prompts disabled\nHTTP/1.1 401 Unauthorized\nAuthorization: Bearer PRIVATE_TOKEN";
 const f=operationFeedback({exitCode:0,output});assert.ok(f.includes('输出提示需要认证或认证失败'));assert.doesNotMatch(JSON.stringify(f),/SECRET|TOKEN|已结束/);
 assert.match(operationFeedback({output:'HTTP/1.1 404 Not Found'}).join(),/不存在或不可见/);
 assert.match(operationFeedback({output:'fatal: unable to access: Could not resolve host: example.invalid'}).join(),/网络连接失败/);
 assert.match(operationFeedback({exitCode:0,timedOut:true,output:''}).join(),/结果待确认/);
 assert.deepEqual(operationFeedback({exitCode:0,output:'ok'}),['命令已结束（退出码 0）']);assert.deepEqual(operationFeedback({}),[]);
 assert.deepEqual(operationFeedback({output:'The docs describe 401 and 403 errors'}),[]);
});
test('repository planning uses actual receipts and does not assume a server or manufacture clone URLs',()=>{
 const state={currentRequest:'克隆 http://git.example.invalid/admin/repos/org/team/repo,general',toolResults:[{action:'run_command',observationId:'receipt-1',result:{exitCode:128,output:'fatal: could not read Username for repo'}}]};
 const original=structuredClone(state),ctx=repositoryContext(state);assert.equal(ctx.pageLike,true);assert.equal(ctx.receipts[0].observationId,'receipt-1');assert.match(ctx.instruction,/不枚举猜测/);assert.match(ctx.instruction,/clarify/);assert.deepEqual(state,original);
 assert.equal(repositoryContext({currentRequest:'总结天气'}),undefined);assert.equal(repositoryContext({currentRequest:'clone https://git.example.invalid/org/repo.git'}).pageLike,false);
});
test('duplicate command and stream text is referenced once, preserving evidence and unknown effects exactly',()=>{
 const command='git ls-remote '+ 'x'.repeat(1000),output='response '.repeat(600);
 const state={permissions:{network:false},actionRecovery:[{id:'unknown',status:'unknown'}],requirements:[{id:'r',text:'必须验收'}],toolResults:[{observationId:'o',eventId:'e',arguments:{command},result:{output,stdout:output,stderr:'error'}}],recentEvents:[{id:'e',type:'run_command',detail:{command,result:{exitCode:1}}}]},original=structuredClone(state);
 const {state:wire,savedBytes}=deduplicate(state);assert.ok(savedBytes>5000);assert.equal(wire.toolResults[0].result.output,output);assert.equal(wire.toolResults[0].result.stderr,'error');assert.equal(wire.toolResults[0].result.stdoutRef,'output');assert.equal(wire.recentEvents[0].detail.commandRef.observationId,'o');assert.deepEqual(state,original);assert.deepEqual(wire.actionRecovery,state.actionRecovery);assert.deepEqual(wire.requirements,state.requirements);assert.deepEqual(wire.permissions,state.permissions);
 const different={toolResults:[{eventId:'e',observationId:'o',arguments:{command:'different'},result:{output:'a',stdout:'b'}}],recentEvents:state.recentEvents};assert.equal(deduplicate(different).state.recentEvents[0].detail.command,command);
});
test('task menu advertises existing network permission tool without a discovery round or widening permissions',async()=>{
 const {buildDecisionRequest}=require('../apps/desktop/agent/decision-request.cjs'),{promptForState}=await import('../apps/desktop/agent/prompt.mjs');
 const state={phase:'task',steps:[{id:'s',status:'running'}],permissions:{network:false},currentRequest:'克隆仓库'},messages=[{role:'system',content:promptForState(state)},{role:'user',content:JSON.stringify(state)}];
 const request=await buildDecisionRequest({state,messages});assert.ok(request.menu.includes('request_network'));assert.equal(JSON.parse(request.wireMessages.at(-1).content).permissions.network,false);assert.ok(request.requestComposition.systemBytes>0);assert.ok(request.requestComposition.toolSchemaBytes>0);
 const route=await buildDecisionRequest({state:{phase:'route'},messages:[{role:'system',content:promptForState({phase:'route'})},{role:'user',content:'{}'}]});assert.ok(!route.menu.includes('request_network'));assert.match(route.wireMessages[0].content,/不要附带 progress/);
});

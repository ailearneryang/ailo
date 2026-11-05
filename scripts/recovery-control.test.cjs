const {test}=require('node:test'),assert=require('node:assert/strict');
const control=require('../apps/desktop/agent/recovery-control.cjs'),value=require('../apps/desktop/agent/repair-value.cjs'),rounds=require('../apps/desktop/agent/execution-rounds.cjs');
function run(){return {executionId:'same',inputKey:'u1',status:'partial',mode:'task',goal:'修复当前界面',events:[],observations:[],artifacts:[],steps:[{id:'fix',status:'running'}],acceptance:[],readAttempts:[['same-read',2]],visualQuality:{constraints:[{id:'gap',status:'open',description:'当前问题'}]}};}
test('plain continuations and segment reloads keep the original repair budget and read evidence',()=>{
 const r=run();for(let i=0;i<16;i++)value.tick(r);assert.equal(r.repairValue.stagnant,16);
 const task={messages:[{id:'u1',role:'user',content:'修复当前界面'},{id:'u2',role:'user',content:'继续任务'}]};rounds.beginRound(r,task,s=>structuredClone(s));const before=structuredClone(r.repairValue);const next=value.tick(r);
 assert.equal(r.executionId,'same');assert.equal(r.requestScope.kind,'continuation');assert.equal(next.stagnant,17);assert.equal(next.exhausted,true);assert.deepEqual(r.readAttempts,[['same-read',2]]);assert.deepEqual(r.repairValue.seen,before.seen);
 const reloaded=JSON.parse(JSON.stringify(r));rounds.beginRound(reloaded,task,s=>structuredClone(s));assert.equal(value.tick(reloaded).stagnant,18);
});
test('legacy input-key-scoped windows migrate without dropping failure counts or earned validation grace',()=>{
 const r=run();r.inputKey='u2';r.repairValue={scope:JSON.stringify(['same','u1']),seen:[],stagnant:21,redirected:true,graceGranted:true,graceActive:true};const next=value.tick(r);assert.equal(next.stagnant,22);assert.equal(next.exhausted,false);assert.equal(r.repairValue.graceGranted,true);assert.equal(r.repairValue.executionId,'same');
});
test('new verified progress renews the value window while writes and bookkeeping cannot',()=>{
 const r=run();for(let i=0;i<16;i++)value.tick(r);r.progressEvidence=['unrelated-write'];r.workingMemory='summary';assert.equal(value.tick(r).exhausted,true);
 r.visualQuality.constraints[0].status='verified';r.problemFreshIds=['gap'];r.visualQuality.constraints.push({id:'remaining',status:'open',description:'另一个问题'});assert.equal(value.tick(r).stagnant,0);
});
test('the single decision arbiter gives cancellation and unknown results priority over every exhausted budget',()=>{
 const r=run();r.resultRecovery={stage:'remaining',idleTurns:13,maxTurns:12};const repair={exhausted:true,redirect:true};assert.equal(control.beforeDecision(r,{repair}).code,'AGENT_REPAIR_EXHAUSTED');
 r.actionJournal=[{status:'unknown'}];assert.deepEqual(control.beforeDecision(r,{repair}),{action:'reconcile',reason:'unknown_result'});assert.deepEqual(control.beforeDecision(r,{repair,signal:{aborted:true}}),{action:'cancel',reason:'user_cancelled'});
});
test('new input adoption precedes exhausted old work without mutating or laundering its budget',()=>{
 const r=run();r.resultRecovery={stage:'remaining',idleTurns:13,maxTurns:12,turns:20};const before=JSON.stringify(r);assert.equal(control.beforeDecision(r,{repair:{exhausted:true},pendingInput:true}).action,'adopt_input');assert.equal(JSON.stringify(r),before);assert.equal(control.beforeDecision(r,{repair:{exhausted:true}}).action,'settle');
});
test('only real effects reset the remaining-work idle counter and both windows use one exit priority',()=>{
 const r=run();r.resultRecovery={stage:'remaining',turns:12,idleTurns:12,maxTurns:12};control.advanceRemaining(r);assert.equal(control.beforeDecision(r,{repair:{redirect:true}}).action,'settle');control.progress(r,{fresh:true,readOnly:true});assert.equal(r.resultRecovery.idleTurns,13);control.progress(r,{fresh:false});assert.equal(r.resultRecovery.idleTurns,13);control.progress(r,{fresh:true});assert.equal(r.resultRecovery.idleTurns,0);assert.equal(control.beforeDecision(r,{repair:{redirect:true}}).action,'refocus');
});
test('failure arbitration is pure, preserves episode budgets, and cannot retry external conditions',()=>{
 const r=run(),e={failures:3,recoveries:0},before=JSON.stringify(e);assert.deepEqual(control.afterFailure(r,e,{invalid:3,error:{code:'MISSING_FILE'}}),{action:'recover',reason:'episode_recovery',recoveries:1});assert.equal(JSON.stringify(e),before);
 e.recoveries=2;assert.equal(control.afterFailure(r,e,{error:{code:'MISSING_FILE'}}).action,'exhausted');assert.equal(control.afterFailure(r,e,{error:{code:'MODEL_PROVIDER_REJECTED'}}).reason,'service');r.actionJournal=[{status:'unknown'}];assert.equal(control.afterFailure(r,e,{error:{code:'MISSING_FILE'}}).reason,'unknown_result');
});
test('input adoption is bounded across continuation and only one committed real change can open a new window',()=>{
 const r=run();r.pendingTaskChange={inputId:'new',executionId:'same'};for(let i=0;i<13;i++)control.advance(r,{pendingInput:true});assert.equal(control.beforeDecision(r,{pendingInput:true}).code,'INPUT_ADOPTION_EXHAUSTED');assert.equal(r.pendingTaskChange.adoptionDecisions,13);
 r.inputKey='new';r.repairValue={stagnant:16};const fake={inputId:'new',executionId:'same',opensRepairWindow:true};assert.equal(control.adopt(r,fake),false);assert.equal(r.repairValue.stagnant,16);
 const receipt={inputId:'new',executionId:'same',opensRepairWindow:true};r.taskChangeAdoptions=[receipt];assert.equal(control.adopt(r,receipt),true);assert.equal(r.repairValue,undefined);r.repairValue={stagnant:9};assert.equal(control.adopt(r,receipt),false);assert.equal(r.repairValue.stagnant,9);
});

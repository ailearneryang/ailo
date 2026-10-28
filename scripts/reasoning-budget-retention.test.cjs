const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createOutputBudget,outputBudgetPressure}=require('../apps/desktop/agent/output-budget.cjs');
const recovery=require('../apps/desktop/agent/decision-recovery.cjs');
const model={id:'company',baseUrl:'https://company.example/v1',model:'GLM-5.2',contextWindow:1048576};
const medium={reasoningControlSent:true,enableThinking:true,reasoningEffort:'medium'};
const low={reasoningControlSent:true,enableThinking:true,reasoningEffort:'low'};
const none={reasoningControlSent:true,enableThinking:false,reasoningEffort:'none'};
const reload=p=>createOutputBudget(model,65536,JSON.parse(JSON.stringify(p.snapshot())));

test('0.1.67 censored 8192 reasoning survives successful edit/build and two cheap operations',()=>{
 let p=createOutputBudget(model,65536);
 assert.equal(p.budget(100000,'action',medium),8192);
 // Sanitized usage sequence from the failed weather resume, not live material.
 assert.equal(p.limited(8192,{finishReason:'length',completionTokens:8192,reasoningTokens:8190,reasoningChars:28607,contentChars:2,toolArgumentChars:0},'action',medium),'action');
 assert.equal(p.budget(100000,'action',medium),16384);
 p.succeeded({outputTokens:710,reasoningTokens:329},'action',medium);
 p.succeeded({outputTokens:344,reasoningTokens:100},'action',medium);
 p=reload(p);
 p.succeeded({outputTokens:497,reasoningTokens:250},'action',medium);
 p.succeeded({outputTokens:374,reasoningTokens:86},'action',medium);
 assert.equal(p.budget(100000,'action',medium),16384);
 // A second actual exhaustion may establish a higher bounded requirement.
 p.limited(16384,{finishReason:'length',completionTokens:16384,reasoningTokens:16382,contentChars:2},'action',medium);
 for(let i=0;i<20;i++)p.succeeded({outputTokens:100},'action',medium);
 assert.equal(reload(p).budget(100000,'action',medium),32768);
});

test('observed mixed reasoning and large action usage retain combined headroom, capped per stage',()=>{
 let p=createOutputBudget(model,65536);
 p.succeeded({outputTokens:24000,reasoningTokens:10000},'action',medium);
 assert.equal(p.budget(100000,'action',medium),30720);
 for(let i=0;i<20;i++)p.succeeded({outputTokens:20},'action',medium);
 assert.equal(reload(p).budget(100000,'action',medium),30720);
 p.limited(30720,{finishReason:'length',contentChars:20000,toolArgumentChars:20000},'action',medium);
 p.limited(61440,{finishReason:'length',contentChars:20000,toolArgumentChars:20000},'action',medium);
 assert.equal(p.budget(100000,'action',medium),65536);
 assert.equal(p.budget(100000,'route',medium),4096);
 assert.equal(p.budget(100000,'summary',medium),8192);
 p.succeeded({outputTokens:40000,reasoningTokens:30000},'review',medium);
 assert.equal(p.budget(100000,'review',medium),32768);
 assert.equal(p.budget(900,'action',medium),900);
});

test('actual none, low, medium, and unknown controls never shrink or inherit one another',()=>{
 let p=createOutputBudget(model,65536);
 p.limited(8192,{finishReason:'length',reasoningChars:30000,contentChars:0},'action',medium);
 p.limited(16384,{finishReason:'length',reasoningChars:30000,contentChars:0},'action',medium);
 for(const controls of [none,low,{reasoningControlSent:false},undefined]){
  assert.equal(p.budget(100000,'action',controls),8192);
  for(let i=0;i<4;i++)p.succeeded({outputTokens:10},'action',controls);
 }
 p=reload(p);assert.equal(p.budget(100000,'action',medium),32768);
 assert.equal(p.budget(100000,'action',none),8192);
 assert.equal(p.budget(100000,'route',medium),4096);
 assert.equal(createOutputBudget({...model,model:'different'},65536,p.snapshot()).budget(100000,'action',medium),8192);
 // Output/context configuration changes are separate observations.
 assert.equal(createOutputBudget({...model,contextWindow:131072},65536,p.snapshot()).budget(100000,'action',medium),8192);
 assert.equal(createOutputBudget(model,4096,p.snapshot()).budget(100000,'action',medium),4096);
});

test('confirmed pressure is metadata only; incomplete JSON never becomes an executable action',()=>{
 const p=createOutputBudget(model,65536),usage={outputTokens:8192,reasoningTokens:8087};
 const pressure=p.pressured(8192,usage,{reason:'invalid_json'},'action',medium);
 assert.deepEqual(pressure,{pressured:true,atLimit:true,truncated:false,outputTokens:8192,reasoningTokens:8087,reason:'usage_near_limit'});
 assert.equal(p.budget(100000,'action',medium),16384);
 assert.equal(Object.hasOwn(pressure,'action'),false);
 assert.equal(Object.hasOwn(pressure,'content'),false);
 assert.equal(outputBudgetPressure(8192,{outputTokens:3031,reasoningTokens:2700}).pressured,false);
 assert.equal(outputBudgetPressure(8192,undefined).pressured,false);
 assert.equal(outputBudgetPressure(8192,{outputTokens:NaN}).pressured,false);
 assert.equal(outputBudgetPressure(8192,{outputTokens:0}).pressured,false);
 assert.equal(outputBudgetPressure(8192,undefined,{finishReason:'length'}).pressured,true);
});

test('small configured models and reasoning-only recovery retain their hard caps',()=>{
 const p=createOutputBudget(model,65536);
 const budgets=[];
 for(let i=0;i<4;i++){
  const b=p.budget(100000,'action',medium);budgets.push(b);
  assert.equal(p.limited(b,{contentChars:0,reasoningTokens:8000},'action',medium),'reasoning');
 }
 assert.deepEqual(budgets,[8192,16384,32768,32768]);
 assert.equal(recovery.budget(p.budget(100000,'action',medium),100000,65536,{maxOutputTokens:65536}),32768);
 assert.equal(recovery.budget(p.budget(100000,'action',medium),4000,65536,{maxOutputTokens:65536}),4000);
 const small=createOutputBudget(model,2048);
 small.limited(2048,{finishReason:'length',contentChars:0,reasoningTokens:2048},'action',medium);
 for(let i=0;i<3;i++)small.succeeded({outputTokens:99999},'action',medium);
 assert.equal(small.budget(100000,'action',medium),2048);
});

test('legacy transient preferences can decay, but unknown usage cannot invent durable evidence',()=>{
 const oldKey=createOutputBudget(model,65536).snapshot().key;
 let p=createOutputBudget(model,65536,{version:2,key:oldKey,stages:{action:{preferred:32768,smallSuccesses:0}}});
 assert.equal(p.budget(100000),32768);
 p.succeeded({outputTokens:10});p.succeeded({outputTokens:10});assert.equal(p.budget(100000),16384);
 p.succeeded();p.succeeded({outputTokens:NaN});assert.equal(p.budget(100000),16384);
 p=reload(p);p.succeeded({outputTokens:10});p.succeeded({outputTokens:10});assert.equal(p.budget(100000),8192);
 assert.equal(p.budget(100000,'action',medium),8192);
});

test('saved profiles are bounded and malformed learning cannot exceed model caps',()=>{
 const p=createOutputBudget(model,65536),saved=p.snapshot();
 saved.stages.action={preferred:Infinity,floor:Infinity,smallSuccesses:-1};
 saved.profiles={['a'.repeat(64)]:{action:{preferred:Number.MAX_SAFE_INTEGER,floor:Number.MAX_SAFE_INTEGER}}};
 const safe=createOutputBudget(model,65536,saved);assert.equal(safe.budget(100000),8192);
 for(let i=0;i<100;i++)safe.limited(8192,{finishReason:'length',contentChars:100},'action',{reasoningEffort:'mode'+i});
 assert.equal(Object.keys(safe.snapshot().profiles).length,32);
 assert.ok(Object.values(safe.snapshot().profiles).every(stages=>stages.action.preferred<=65536));
 assert.ok(!JSON.stringify(safe.snapshot()).includes(model.baseUrl));
});

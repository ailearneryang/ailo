const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createOutputBudget}=require('../apps/desktop/agent/output-budget.cjs');
test('learns limits and successful usage with headroom, bounded by configured cap and context',()=>{
 const p=createOutputBudget({id:'m'},20000);
 assert.equal(p.budget(100000),8192);
 assert.equal(p.limited(8192,{contentChars:0,toolCalls:0,reasoningChars:30000}),'reasoning');
 assert.equal(p.budget(100000),16384);
 p.succeeded({outputTokens:16000});assert.equal(p.budget(100000),20000);assert.equal(p.budget(900),900);
 p.succeeded({outputTokens:1});assert.equal(p.budget(100000),20000);
});
test('persists per model and respects lower configuration and adaptive ceiling',()=>{
 const p=createOutputBudget({id:'m'},131053);p.limited(8192);p.limited(16384);p.limited(32768);p.limited(65536);
 assert.equal(p.budget(1000000),65536);
 assert.equal(createOutputBudget({id:'m'},131053,p.snapshot()).budget(100000),65536);
 assert.equal(createOutputBudget({id:'other'},131053,p.snapshot()).budget(100000),8192);
 assert.equal(createOutputBudget({id:'m'},4096,p.snapshot()).budget(100000),4096);
});
test('missing usage does not invent consumption and partial actions retain action recovery',()=>{
 const p=createOutputBudget({},32768);
 p.succeeded();p.succeeded({outputTokens:NaN});assert.equal(p.budget(100000),8192);
 assert.equal(p.limited(8192,{contentChars:0,toolCalls:1,toolArgumentChars:500}),'action');
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validatePlan,fields}=require('../apps/desktop/agent/plan.cjs');
const plan=step=>({goal:'交付书稿',decisions:[],acceptance:['校验通过'],steps:[{id:'s1',title:'修改正文',status:'running',...step}]});
test('plan accepts legacy steps and explicit detail and confirmation dependencies',()=>{
 assert.doesNotThrow(()=>validatePlan(plan({})));
 assert.doesNotThrow(()=>validatePlan(plan({detail:'已完成：重新编号\n正在处理：目录同步',requiresConfirmation:true})));
 assert.equal(fields.steps.items.properties.requiresConfirmation.type,'boolean');
});
test('step detail and confirmation dependencies are validated',()=>{
 assert.throws(()=>validatePlan(plan({detail:'x'.repeat(801)})),/detail/);
 assert.throws(()=>validatePlan(plan({requiresConfirmation:'true'})),/requiresConfirmation/);
});
test('serial plans require one actual running step and can defer synchronization',()=>{
 const action=plan({summary:'章节已重新编号，正在清理旧引用。'});
 action.steps.push({id:'s2',title:'同步清单',status:'running'});
 assert.throws(()=>validatePlan(action),/只能有一个 running/);
 action.steps[0].status='waiting_sync';assert.doesNotThrow(()=>validatePlan(action));
 assert.throws(()=>validatePlan(plan({summary:'x'.repeat(161)})),/summary/);
});

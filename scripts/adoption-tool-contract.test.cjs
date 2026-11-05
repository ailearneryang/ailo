const test=require('node:test'),assert=require('node:assert/strict');
const protocol=require('../apps/desktop/agent/protocol.cjs'),menu=require('../apps/desktop/agent/tool-menu.cjs');
test('batch reads publish the same bounded item ID format used by runtime validation',()=>{
 const state={phase:'task',steps:[]},named=protocol.actionTools(state,['batch_read'])[0].function.parameters,merged=protocol.menuTool(state,['batch_read'],false).function.parameters,json=protocol.jsonActionContract(state,['batch_read'],false).parametersSchema,branch=json.oneOf.find(b=>b.properties.action.const==='batch_read'),items=json.$defs[branch.properties.items.$ref.split('/').at(-1)];
 for(const schema of [named.properties.items,merged.properties.items,items])assert.deepEqual(schema.items.properties.itemId,{type:'string',minLength:1,maxLength:40,pattern:'^[a-zA-Z0-9_-]+$'});
});
const current={phase:'task',steps:[{id:'old_step',title:'旧任务核验',status:'running'}],currentInput:{followup:true,requirementsRecorded:false},inputCoverage:{inputs:[{inputId:'earlier',status:'planned'},{inputId:'attachment_input',status:'received'},{inputId:'text_input',status:'received'}]},materialInput:{required:true,status:'inspected',materials:[{id:'real_html_material',name:'效果图总览.html'},{id:'real_zip_material',name:'mcp-materials.zip'}]},repairContext:{error:'old build error'},repairTargets:[{criterionId:'old_requirement'}],executionState:{nextAction:'build_android',blocker:'旧视觉缺口'},pendingVisualReview:{reason:'old screenshot pending'},acceptanceCriteria:[{id:'old_requirement',type:'visual'}]};
test('new unadopted inputs expose the complete plan contract before stale repair and finish menus',()=>{
 for(const extraState of [{},{requiredAction:'finish_review'},{requiredAction:'plan_update'}]){
  const state={...current,...extraState},selected=menu.select(state,protocol.allowedActions(state));
  assert.equal(selected[0],'plan');for(const action of ['read_material','read_source','inspect_source','read_file','batch_read','read_execution','clarify'])assert.ok(selected.includes(action),action);
  for(const action of ['edit_file','write_file','build_android','run_command','android_device','verify','finish'])assert.ok(!selected.includes(action),action+' is old work, not adoption');
  assert.ok(protocol.allowedActions(state).includes('build_android'),'menu narrowing never expands or replaces execution authorization');
  assert.deepEqual(menu.select(state,protocol.allowedActions(state),['run_command']).filter(n=>n==='run_command'),['run_command'],'explicit tool discovery remains available, runtime gates still decide');
 }
});
test('single text followup and unadopted material independently select source-to-plan work',()=>{
 const states=[{phase:'task',steps:current.steps,inputCoverage:{inputs:[{inputId:'text',status:'received'}]}},{phase:'task',steps:current.steps,materialInput:current.materialInput},{phase:'task',steps:current.steps,currentInput:current.currentInput}];
 for(const state of states){assert.equal(menu.pendingAdoption(state),true);assert.equal(menu.select(state,protocol.allowedActions(state))[0],'plan');}
});
test('named, merged and JSON plan contracts require the same actual adoption inputs and material IDs',()=>{
 const selected=['plan','read_source','clarify'],named=protocol.actionTools(current,selected).find(t=>t.function.name==='plan').function.parameters,merged=protocol.menuTool(current,selected,false).function.parameters,json=protocol.jsonActionContract(current,selected,false).parametersSchema,branch=json.oneOf.find(b=>b.properties.action.const==='plan');
 assert.ok(named.required.includes('materialUse'));assert.ok(named.required.includes('inputUse'));
 assert.deepEqual(merged.allOf.find(b=>b.if?.properties?.action?.const==='plan'&&b.then?.required).then.required,named.required);
 assert.deepEqual(branch.required,['action',...named.required]);
 for(const field of ['materialUse','inputUse']){
  assert.deepEqual(merged.properties[field],named.properties[field]);assert.deepEqual(json.$defs[branch.properties[field].$ref.split('/').at(-1)],named.properties[field]);
 }
 assert.equal(named.properties.materialUse.minItems,2);assert.equal(named.properties.materialUse.maxItems,2);assert.deepEqual(named.properties.materialUse.items.properties.id.enum,['real_html_material','real_zip_material']);
 assert.equal(named.properties.inputUse.minItems,2);assert.deepEqual(named.properties.inputUse.items.allOf[0].then.properties.inputId.enum,['earlier','attachment_input','text_input']);
 assert.equal(named.properties.inputUse.items.properties.inputId.enum,undefined,'explicit superseded can still name a verified historical input');assert.equal(named.properties.inputUse.items.properties.inputId.maxLength,160);
 assert.equal(named.properties.inputUse.items.properties.requirementIds.items.enum,undefined,'new requirements must not be limited to old IDs');
 assert.equal(merged.required.includes('materialUse'),false,'source reads must not require plan fields');
});
test('ordinary work, pure continuation and chat do not acquire adoption-only required fields',()=>{
 const settled={...current,currentInput:{followup:true,requirementsRecorded:true},inputCoverage:{inputs:[{inputId:'done',status:'planned'}]},materialInput:{...current.materialInput,status:'adopted'}};
 assert.equal(menu.pendingAdoption(settled),false);assert.ok(menu.select(settled,protocol.allowedActions(settled)).includes('edit_file'));
 for(const state of [{phase:'task',steps:[]},settled,{phase:'task',steps:current.steps,currentInput:{followup:true,requirementsRecorded:true},inputCoverage:{inputs:[{inputId:'continue',status:'continuation'}]}}]){
  const plan=protocol.actionTools(state,['plan'])[0].function.parameters;
  assert.equal(plan.required.includes('materialUse'),false);assert.equal(plan.required.includes('inputUse'),false);
 }
 const chat={...current,phase:'chat'};assert.equal(menu.pendingAdoption(chat),false);assert.ok(!menu.select(chat,protocol.allowedActions(chat)).includes('plan'));assert.equal(protocol.actionTools(chat,['plan']).length,0);
 const single={phase:'task',steps:current.steps,inputCoverage:{inputs:[{inputId:'one',status:'received'}]}};assert.equal(protocol.actionTools(single,['plan'])[0].function.parameters.required.includes('inputUse'),false,'single-input implicit mapping remains supported');
});
test('explicit source-backed withdrawal can still refer to an already verified historical input',()=>{
 const schema=protocol.actionTools(current,['plan'])[0].function.parameters.properties.inputUse.items;
 assert.equal(schema.properties.inputId.enum,undefined);assert.equal(schema.properties.inputId.maxLength,160);assert.equal(schema.allOf[0].if.properties.disposition.const,'requirements');assert.ok(!schema.allOf[0].then.properties.inputId.enum.includes('verified_history'));
 const coverage=require('../apps/desktop/agent/input-coverage.cjs'),run={executionId:'e',requirementsManaged:true,requirements:[{id:'old',text:'原要求',type:'content'}],inputCoverage:{executionId:'e',version:1,entries:[{inputId:'verified_history',status:'verified',requirementIds:['old']},{inputId:'attachment_input',status:'received',requirementIds:[]},{inputId:'text_input',status:'received',requirementIds:[]}]}},task={messages:[{id:'verified_history',role:'user',content:'原要求'},{id:'attachment_input',role:'user',content:'新要求'},{id:'text_input',role:'user',content:'取消之前的要求，按本次新要求执行'}]},action={inputUse:[{inputId:'verified_history',disposition:'superseded',requirementIds:[],supersededBy:'text_input',sourceQuote:'取消之前的要求'},{inputId:'attachment_input',disposition:'requirements',requirementIds:['new']},{inputId:'text_input',disposition:'requirements',requirementIds:['new']}]};
 coverage.plan(run,task,action,[{id:'new',text:'新要求',type:'content'}])();assert.equal(run.inputCoverage.entries[0].status,'superseded');
});
test('every response channel preserves explicit mappings and never fabricates missing material adoption',()=>{
 const action={action:'plan',goal:'按天气切换背景',decisions:['按本次参考实现天气背景'],requirements:[{id:'background',text:'晴天与雨天使用对应背景',type:'behavior'}],steps:[{id:'background_step',title:'实现背景切换并核验',status:'running'}],inputUse:[{inputId:'attachment_input',disposition:'requirements',requirementIds:['background']},{inputId:'text_input',disposition:'requirements',requirementIds:['background']}],materialUse:[{id:'real_html_material',role:'reference',reason:'参考天气场景',requirementIds:['background']},{id:'real_zip_material',role:'design',reason:'采用设计稿',requirementIds:['background']}]};
 const channels=value=>[{content:JSON.stringify(value)},{toolCalls:[{function:{name:'ailo_action',arguments:JSON.stringify(value)}}]},{toolCalls:[{function:{name:'plan',arguments:JSON.stringify(Object.fromEntries(Object.entries(value).filter(([k])=>k!=='action')))}}]}];
 for(const response of channels(action))assert.deepEqual(protocol.decodeAction(response,{boundActionContract:true,steps:current.steps}),action);
 const absent={...action};delete absent.materialUse;
 const run={materialInput:{...current.materialInput,materials:current.materialInput.materials.map(m=>({...m,reads:[{kind:'text',text:'source'}]}))}};
 for(const response of channels(absent)){
  const decoded=protocol.decodeAction(response,{boundActionContract:true,steps:current.steps});assert.equal(decoded.materialUse,undefined);
  assert.throws(()=>require('../apps/desktop/agent/material-input.cjs').checkPlan(run,decoded,action.requirements),e=>e.code==='MATERIAL_INPUT_PENDING');
 }
});
test('active adoption instructions override the ordinary old-step progress rule and retain initial-step safety',async()=>{
 const {promptForState}=await import('../apps/desktop/agent/prompt.mjs'),prompt=promptForState(current);
 assert.match(prompt,/本次输入待纳入计划/);assert.match(prompt,/先读取本批真实来源/);assert.match(prompt,/materialUse必须逐项/);assert.doesNotMatch(prompt,/已有计划：普通进度变化/);assert.match(prompt,/plan:/);
 const initial=promptForState({phase:'task',steps:[],inputCoverage:{inputs:[{inputId:'first',status:'received'}]}});assert.match(initial,/前置读取只能附progress.memory/);assert.match(initial,/不得填写不存在的步骤ID/);
 const chat=promptForState({...current,phase:'chat'});assert.doesNotMatch(chat,/本次输入待纳入计划：/);
});

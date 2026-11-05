const test=require('node:test'),assert=require('node:assert/strict');
const protocol=require('../apps/desktop/agent/protocol.cjs'),menu=require('../apps/desktop/agent/tool-menu.cjs');
const catalog=[{id:'installed-jira',name:'Jira',description:'查询工作项与当前待办'},{id:'builtin-writing',name:'写作',description:'整理面向读者的文字材料'}];
const state=(phase='route',extra={})=>({phase,steps:[],skillCatalog:catalog,loadedSkills:[],...extra});
const channels=action=>[{content:JSON.stringify(action)},{toolCalls:[{function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},{toolCalls:[{function:{name:action.action,arguments:JSON.stringify(Object.fromEntries(Object.entries(action).filter(([key])=>key!=='action')))}}]}];
test('automatic skill tools are absent without a catalog and do not alter ordinary direct replies',()=>{
 assert.deepEqual(protocol.allowedActions({phase:'route'}),['route','reply']);
 assert.equal(protocol.actionTools({phase:'route'},['route'])[0].function.parameters.properties.skillIds,undefined);
 for(const phase of ['route','chat','task'])assert.equal(protocol.allowedActions({phase,skillCatalog:[]}).includes('load_skill'),false);
 const reply={action:'reply',text:'你好'};for(const response of channels(reply))assert.deepEqual(protocol.decodeAction(response),reply);
});
test('routing selects new and already loaded automatic skills while manual choices stay separate',()=>{
 const s=state('route',{loadedSkills:[{id:'previous-auto',source:'auto'},{id:'manual-git',source:'manual'}]});
 assert.deepEqual(protocol.allowedActions(s),['route','reply','load_skill']);
 const tools=protocol.actionTools(s),route=tools.find(t=>t.function.name==='route').function.parameters,load=tools.find(t=>t.function.name==='load_skill').function.parameters;
 assert.deepEqual(route.properties.skillIds.items.enum,['installed-jira','builtin-writing','previous-auto']);
 assert.deepEqual(route.required,['kind']);assert.equal(route.properties.skillIds.maxItems,5);assert.equal(route.properties.skillIds.uniqueItems,true);assert.equal(route.properties.progress,undefined);
 assert.deepEqual(load.properties.id.enum,['installed-jira','builtin-writing']);assert.deepEqual(load.required,['id','purpose']);assert.equal(load.properties.progress,undefined);assert.equal(load.properties.stepId,undefined);
 const onlyLoaded=state('route',{skillCatalog:[],loadedSkills:[{id:'previous-auto',source:'auto'}]});
 assert.equal(protocol.allowedActions(onlyLoaded).includes('load_skill'),false);
 assert.deepEqual(protocol.actionTools(onlyLoaded,['route'])[0].function.parameters.properties.skillIds.items.enum,['previous-auto']);
});
test('merged native and JSON skill contracts retain per-action requirements and catalog identifiers',()=>{
 const s=state(),selection=['route','load_skill'],merged=protocol.menuTool(s,selection,false).function.parameters,json=protocol.jsonActionContract(s,selection,false).parametersSchema;
 assert.deepEqual(merged.required,['action'],'loading at route must not require route.kind');
 const branch=merged.allOf.find(item=>item.if?.properties.action.const==='load_skill');
 assert.deepEqual(branch.then.required,['id','purpose']);assert.deepEqual(branch.then.properties.id.enum,catalog.map(x=>x.id));assert.ok(branch.then.not);
 const load=json.oneOf.find(item=>item.properties.action.const==='load_skill'),route=json.oneOf.find(item=>item.properties.action.const==='route');
 assert.deepEqual(load.required,['action','id','purpose']);assert.deepEqual(route.required,['action','kind']);
 assert.equal(json.$defs[route.properties.skillIds.$ref.split('/').at(-1)].maxItems,5);
 assert.deepEqual(json.$defs[load.properties.id.$ref.split('/').at(-1)].enum,catalog.map(x=>x.id));
});
test('dynamic skill loading appears in chat and task menus including pending user input',()=>{
 for(const s of [state('chat'),state('task'),state('task',{steps:[{id:'s1'}]}),state('task',{steps:[{id:'s1'}],inputCoverage:{inputs:[{status:'received'}]}})]){
  const allowed=protocol.allowedActions(s);assert.ok(allowed.includes('load_skill'));assert.ok(menu.select(s,allowed).includes('load_skill'));
 }
 assert.equal(protocol.allowedActions(state('chat')).includes('run_command'),false,'skills do not authorize chat host commands');
});
test('loading never opens strict plan, checkpoint, pending-artifact or completion gates',()=>{
 for(const extra of [{requiredAction:'plan_or_clarify'},{requiredAction:'plan_update'},{requiredAction:'checkpoint'},{requiredAction:'finish_review'},{pendingArtifactUpdates:['artifact']}]){
  const s=state('task',extra),allowed=protocol.allowedActions(s);assert.equal(allowed.includes('load_skill'),false);assert.equal(menu.select(s,allowed).includes('load_skill'),false);
 }
});
test('valid route selections retain omitted versus empty meaning in all response channels',()=>{
 for(const action of [{action:'route',kind:'task'},{action:'route',kind:'task',skillIds:[]},{action:'route',kind:'chat',skillIds:['installed-jira']},{action:'load_skill',id:'installed-jira',purpose:'查询当前用户今日待办'}]){
  for(const response of channels(action))assert.deepEqual(protocol.decodeAction(response,{boundActionContract:true,steps:[]}),action);
 }
});
test('malformed skill metadata is rejected atomically in every response channel, even outside bounded-contract mode',()=>{
 const bad=[...['installed-jira',null,{},['installed-jira','installed-jira'],[''],[' installed-jira'],[5],['1','2','3','4','5','6']].map(skillIds=>({action:'route',kind:'task',skillIds})),{action:'reply',text:'回答',skillIds:[]},{action:'load_skill',id:'installed-jira'},{action:'load_skill',id:'installed-jira',purpose:' '},{action:'load_skill',id:null,purpose:'读取'},{action:'load_skill',id:'installed-jira',purpose:'读取',progress:{memory:'不能静默删除这条动作所附带的错误状态字段。'}},{action:'load_skill',id:'installed-jira',purpose:'读取',stepId:'s1'}];
 for(const action of bad){const before=structuredClone(action);for(const response of channels(action))assert.throws(()=>protocol.decodeAction(response),error=>error.code==='AGENT_PROTOCOL'&&error.reason==='invalid_parameter'&&error.diagnostics.expected==='skill_selection');assert.deepEqual(action,before);}
});
test('skill error recovery is actionable without disclosing submitted parameter content',()=>{
 const privatePurpose='PRIVATE_PARAMETER_SENTINEL';
 try{protocol.decodeAction({content:JSON.stringify({action:'load_skill',id:42,purpose:privatePurpose})});assert.fail('invalid id accepted');}catch(error){assert.equal(error.diagnostics.field,'id');assert.doesNotMatch(JSON.stringify(error.diagnostics),/PRIVATE_PARAMETER_SENTINEL/);assert.match(protocol.parameterHint(error.diagnostics),/skillCatalog/);assert.match(protocol.parameterHint(error.diagnostics),/不附stepId\/progress/);}
});
test('prompts request semantic automatic selection in the existing route and preserve authorization boundaries',async()=>{
 const {promptForState,toolGuidanceForState}=await import('../apps/desktop/agent/prompt.mjs');
 for(const phase of ['route','chat','task']){const prompt=promptForState(state(phase));assert.match(prompt,/语义、目标和用途/);assert.match(prompt,/手动选择.*优先/);assert.match(prompt,/无需另发分类请求/);assert.match(prompt,/不在加载前声称已使用/);assert.match(prompt,/不是?指令或授权|不能提供.*授权/);assert.match(prompt,/系统自带与用户安装技能使用同样规则/);}
 const plain=promptForState({phase:'route'});assert.doesNotMatch(plain,/skillCatalog|skillIds|load_skill/);assert.match(plain,/直接提交 reply/);
 const guidance=toolGuidanceForState(state('task'),['load_skill']);assert.match(guidance,/load_skill:/);assert.match(guidance,/不附stepId\/progress/);
});
test('request projections preserve newly loaded instructions through named, alias, JSON and text channels',async()=>{
 const {promptForState}=await import('../apps/desktop/agent/prompt.mjs');
 const {buildDecisionRequest}=require('../apps/desktop/agent/decision-request.cjs');
 const s=state('chat',{skillCatalog:[catalog[1]],loadedSkills:[{id:catalog[0].id,name:'Jira',source:'auto'}]}),body='已加载技能正文：先核对真实服务端返回，再整理用户要求的工作项。';
 const messages=[{role:'system',content:promptForState(s)+'\n当前已加载的专家与技能：\n'+body},{role:'user',content:JSON.stringify(s)}];
 for(const options of [{formatMode:'tools',namedActions:true},{formatMode:'tools',namedActions:false},{formatMode:'json'},{formatMode:'text'}]){
  const request=await buildDecisionRequest({messages,state:s,...options});
  assert.ok(request.wireMessages[0].content.includes(body));assert.ok(request.menu.includes('load_skill'));
  const projected=JSON.parse(request.wireMessages.at(-1).content);assert.deepEqual(projected.loadedSkills,s.loadedSkills);assert.deepEqual(projected.skillCatalog,s.skillCatalog);
  if(options.formatMode==='tools'&&options.namedActions)assert.deepEqual(request.format.tools.find(t=>t.function.name==='load_skill').function.parameters.properties.id.enum,['builtin-writing']);
 }
 assert.equal(messages[0].content,promptForState(s)+'\n当前已加载的专家与技能：\n'+body,'wire projection must not mutate the runtime context');
});

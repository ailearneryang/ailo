const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {requestVisual}=require('../apps/desktop/visual-request.cjs');
const {createVisualRouter}=require('../apps/desktop/model-routing.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const image={role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,fixture'}}]};
const model={id:'visual-incident',model:'fixture',contextWindow:131072,maxOutputTokens:32768};
const truncated=()=>Object.assign(Error('visual output truncated'),{code:'MODEL_OUTPUT_LIMIT',diagnostics:{finishReason:'length',contentChars:0,completionTokens:4096}});
const reply=a=>({content:JSON.stringify(a)});
test('visual truncation increases bounded allowance on the same model and retries only read-only observation',async()=>{
 const budgets=[];const result=await requestVisual({...model,id:'escalation'},async(_messages,budget)=>{budgets.push(budget);if(budgets.length<3)throw truncated();return {content:'valid',providerUsage:{outputTokens:12000}};},[image]);
 assert.deepEqual(budgets,[8192,16384,32768]);assert.equal(result.content,'valid');
});
test('exhausted visual truncation remains local, strips pixels, retains failure and does not reset on repeat reads',async()=>{
 let calls=0;const router={enabled:true,run:async(_lane,f)=>({result:await f({...model,id:'exhausted'}),model})};
 const prepare=createVisualRouter(router);const request=(messages,actual)=>requestVisual(actual,async()=>{calls++;throw truncated();},messages);
 const first=await prepare([image],request);assert.equal(calls,3);assert.equal(first.reviews.length,0);assert.equal(first.failures[0].code,'MODEL_OUTPUT_LIMIT');assert.equal(typeof first.messages[0].content,'string');
 await prepare([image],request);assert.equal(calls,3);
});
test('cancellation and credential failures cannot be converted into visual observations',async()=>{
 const router={enabled:true,run:async(_lane,f)=>({result:await f(model),model})};
 for(const code of ['ABORT_ERR','MODEL_PROVIDER_REJECTED'])await assert.rejects(createVisualRouter(router)([image],async()=>{throw Object.assign(Error(code),{code});}),{code});
});
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-input-turn-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'incident',request:'实现页面',messages:[{id:'u1',role:'user',content:'实现页面'}]};const w=await createWorkspace(base,task);Object.assign(w.run,{executionId:'original',inputKey:'u1',acceptanceInputKey:'u1',mode:'task',status:'partial',goal:task.request,requirementsManaged:true,requirements:[{id:'layout',text:'页面包含蓝色背景',type:'content'},{id:'visual',text:'视觉符合原稿',type:'visual'}],acceptance:['页面包含蓝色背景','视觉符合原稿'],steps:[{id:'page',title:'修改并核对页面',status:'running'}]});await execute(w,{action:'write_file',path:'page.txt',content:'old'});w.run.artifacts.push({path:'page.txt',label:'旧页面',sha256:require('node:crypto').createHash('sha256').update('old').digest('hex')});await w.event('run_command',{result:{output:'OLD WEATHER OUTPUT',exitCode:0}});await w.save();task.messages.push({id:'a1',role:'assistant',content:'已有旧页面'},{id:'u2',role:'user',content:'参考设计稿把背景改为蓝色'});return {base,task,model,signal:new AbortController().signal};}
test('followup survives failed visual preflight, performs actual edits and preserves unmet visual acceptance',async t=>{
 const f=await fixture(t);let n=0;const actions=[{action:'plan',goal:'修改蓝色背景并核对设计',decisions:[],requirements:[{id:'layout',text:'页面包含蓝色背景并符合本次配色要求',type:'content'},{id:'visual',text:'视觉符合原稿',type:'visual'}],steps:[{id:'page',title:'修改并核对页面',status:'running'}]},{action:'write_file',path:'page.txt',content:'blue'},{action:'artifact',path:'page.txt',label:'本轮蓝色页面'},{action:'blocked',text:'视觉核验尚未完成'}];
 const prepare=createVisualRouter({enabled:true,run:async()=>{throw truncated();}});
 const result=await runAgent({...f,prepareModelMessages:messages=>prepare([image,...messages],()=>{}),ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return reply({action:'route',kind:'task'});return reply(actions[Math.min(n++,actions.length-1)]);}});
 assert.equal(await fs.readFile(path.join((await createWorkspace(f.base,f.task)).files,'page.txt'),'utf8'),'blue');assert.equal(result.agentRun.executionId,'original');assert.equal(result.agentRun.status,'partial');assert.deepEqual(result.agentRun.delivery.changes.changedArtifacts,['page.txt']);assert.ok(result.agentRun.acceptanceCriteria.every(c=>c.status!=='passed'));assert.doesNotMatch(result.content,/OLD WEATHER OUTPUT/);
});
test('a no-progress followup cannot advertise old files as new delivery or summarize old unrelated output',async t=>{
 const f=await fixture(t);const result=await runAgent({...f,ask:async messages=>reply(JSON.parse(messages.at(-1).content).phase==='route'?{action:'route',kind:'task'}:{action:'blocked',text:'没有取得本次要求的进展'})});
 assert.equal(result.agentRun.status,'blocked');assert.deepEqual(result.agentRun.delivery.changes.changedArtifacts,[]);assert.deepEqual(result.agentRun.delivery.changes.retainedArtifacts,['page.txt']);assert.match(result.content,/本轮尚未取得/);assert.doesNotMatch(result.content,/OLD WEATHER OUTPUT|已整理 1 项当前成果/);
});
test('old accepted work cannot finish a new request before its requirements are recorded',async t=>{
 const f=await fixture(t);let attempted=false,observed=false;
 const result=await runAgent({...f,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return reply({action:'route',kind:'task'});
  if(!attempted){attempted=true;return reply({action:'finish',text:'沿用旧页面完成',review:{summary:'沿用旧文件',issues:[],unverified:[]}});}
  if(s.toolResults?.at(-1)?.error){assert.match(s.toolResults.at(-1).error,/本次补充要求尚未纳入计划/);observed=true;}
  return reply({action:'blocked',text:'本轮要求尚未实现'});
 }});
 assert.equal(observed,true);assert.equal(result.agentRun.status,'blocked');assert.ok(result.agentRun.acceptanceCriteria.every(c=>c.status!=='passed'));
});
test('a changed request does not erase failure budgets, and a repeated input does not move its accounting boundary',()=>{
 const turn=require('../apps/desktop/agent/input-turn.cjs');const run={inputKey:'u2',acceptanceInputKey:'u1',currentRequest:'修改颜色',events:[{id:'old'}],observationIndex:[],artifacts:[],failureEpisodes:{records:[{failures:5,recoveries:2}]}};
 const first=turn.begin(run);run.events.push({id:'new'});assert.equal(turn.begin(run),first);assert.equal(run.failureEpisodes.records[0].failures,5);assert.deepEqual(turn.events(run).map(e=>e.id),['new']);
 run.inputKey='u3';run.currentRequest='继续，同时改成红色';turn.begin(run);assert.equal(turn.context(run).requirementsRecorded,false);assert.equal(run.failureEpisodes.records[0].recoveries,2);
});
test('acknowledging a followup plan requires an actual requirement change, not the same old check list',()=>{
 const turn=require('../apps/desktop/agent/input-turn.cjs');const old={id:'layout',text:'页面存在',type:'content'};const run={inputKey:'u2',acceptanceInputKey:'u1',currentRequest:'把背景改成蓝色',requirements:[old],events:[],observationIndex:[],artifacts:[]};turn.begin(run);
 assert.throws(()=>turn.assertPlan(run,[old]),{code:'INPUT_REQUIREMENTS_PENDING'});
 turn.assertPlan(run,[old,{id:'blue',text:'背景按本次要求改为蓝色',type:'visual'}]);assert.equal(run.requirements.length,1);
});
test('real chat transport expands a truncated HTTP 200 visual request without switching models',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-visual-http-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),sourceId=require('node:crypto').randomUUID();await fs.mkdir(path.join(base,'imports'));await fs.writeFile(path.join(base,'imports',sourceId),png);
 const messages=[{id:'u1',role:'user',content:'检查图片背景颜色',materials:[{sourceId,name:'reference.png',text:null,size:png.length}]}];
 const task={id:'temporary-visual',temporary:true,request:messages[0].content,messages,materials:messages[0].materials};
 const models=[{...model,id:'primary-http',name:'primary',baseUrl:'https://primary.example/v1',imageInput:'disabled'},{...model,id:'vision-http',name:'vision',baseUrl:'https://vision.example/v1',imageInput:'enabled'}];
 const state={tasks:[task],models,autoModel:{primaryModelId:'primary-http',visionModelId:'vision-http',failover:false}};
 const storage={agentDirectory:base,isTemporary:()=>true,readWorkspace:async()=>state,modelCredentials:async id=>models.find(m=>m.id===id)};
 const budgets=[];const result=await require('../apps/desktop/chat.cjs').createChat(storage,async(_url,options)=>{
  const body=JSON.parse(options.body);
  if(body.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'))){budgets.push(body.max_tokens);if(budgets.length===1)return Response.json({choices:[{message:{content:'{"summary":'},finish_reason:'length'}],usage:{completion_tokens:body.max_tokens}});return Response.json({choices:[{message:{content:JSON.stringify({summary:'背景为蓝色',observations:['背景为蓝色'],uncertainties:['不能确认行为']})},finish_reason:'stop'}]});}
  assert.doesNotMatch(JSON.stringify(body.messages),/image_url|data:image/);return Response.json({choices:[{message:{content:'图片背景为蓝色，行为尚未验证。'},finish_reason:'stop'}]});
 },{retryDelay:0}).complete({id:'http-request',modelId:'auto',taskId:task.id,messages});
 assert.deepEqual(budgets,[8192,16384]);assert.match(result.content,/蓝色/);assert.equal(result.replyDetails.visualReviews[0].modelId,'vision-http');
});
test('legacy settled recovery records regain a finite remaining-work window without resetting an active failure budget',()=>{
 const settlement=require('../apps/desktop/agent/result-settlement.cjs');const run={executionId:'same',resultRecovery:{executionId:'same',stage:'resuming',turns:0,idleTurns:9,failures:[]},actionJournal:[]};
 const state=settlement.begin(run,{code:'FAILED',message:'same issue'});assert.equal(state.maxTurns,12);assert.equal(state.idleTurns,0);state.idleTurns=7;settlement.begin(run,{code:'FAILED',message:'same issue'});assert.equal(state.idleTurns,7);assert.equal(state.failures.length,2);
});
test('summary and visual recovery share bounded budget logic but keep learned phase preferences separate',async()=>{
 const {requestSummary}=require('../apps/desktop/visual-request.cjs');const selected={...model,id:'separate-summary'};const budgets=[];
 await requestSummary(selected,async(_m,b)=>{budgets.push(b);if(budgets.length===1)throw truncated();return {content:'{}'};},[{role:'user',content:'本轮变更'}]);assert.deepEqual(budgets,[8192,16384]);
 let visualBudget;await requestVisual(selected,async(_m,b)=>{visualBudget=b;return {content:'{}'};},[image]);assert.equal(visualBudget,8192);
});

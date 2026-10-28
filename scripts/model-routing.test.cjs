const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createModelRouter,createVisualRouter,validateRouting,visionCapable,mayFailover}=require('../apps/desktop/model-routing.cjs');
const {createChat}=require('../apps/desktop/chat.cjs');
const models=['p','pb','v','vb','unused'].map(id=>({id,name:id,model:id,baseUrl:'https://'+id+'.example/v1',imageInput:id.startsWith('v')?'enabled':'disabled',contextWindow:131072,maxOutputTokens:8192}));
const autoModel={primaryModelId:'p',visionModelId:'v',primaryFallbackId:'pb',visionFallbackId:'vb',failover:true};
const input={id:'req',modelId:'auto',messages:[{role:'user',content:'请分析需求'}]};
const reply=content=>Response.json({choices:[{message:{content},finish_reason:'stop'}]});
const action=value=>Response.json({choices:[{message:{tool_calls:[{id:'call',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(value)}}]},finish_reason:'tool_calls'}]});
function fixture(config=autoModel){
 const records=[],loaded=[],state={tasks:[],models:structuredClone(models),autoModel:structuredClone(config)};
 const storage={readWorkspace:async()=>structuredClone(state),modelCredentials:async id=>{loaded.push(id);return {...state.models.find(m=>m.id===id),apiKey:'key-'+id};},recordModelRequest:async r=>records.push(structuredClone(r))};
 return {storage,state,records,loaded};
}
const image={role:'user',content:[{type:'text',text:'工具观察 event-1；原稿与实际截图'},...['reference','current'].map(text=>({type:'image_url',image_url:{url:'data:image/png;base64,'+Buffer.from(text).toString('base64')}}))]};
const visualResult={summary:'按钮位置偏低',observations:['当前截图的编辑按钮比原稿低8像素'],uncertainties:['截图无法证明点击行为']};
test('Auto configuration requires existing explicit vision choices and does not promote an accepting endpoint',()=>{
 assert.deepEqual(validateRouting(autoModel,models),autoModel);
 for(const change of [{primaryModelId:'auto'},{visionModelId:'p'},{visionModelId:'unused'},{primaryFallbackId:'p'},{visionFallbackId:'v'},{failover:'yes'}])assert.throws(()=>validateRouting({...autoModel,...change},models));
 assert.equal(visionCapable({model:'unknown',imageInput:'auto'}),false);
 assert.equal(visionCapable({model:'glm-5.2',baseUrl:'https://dashscope.aliyuncs.com/v1',imageInput:'enabled'}),false);
 assert.throws(()=>validateRouting({...autoModel,visionModelId:undefined},models));
});
test('only transient service failures may switch; invalid protocol, evidence, auth and unknown effects cannot',()=>{
 for(const code of ['MODEL_HTTP_TRANSIENT','MODEL_RATE_LIMIT','MODEL_CONNECT_TIMEOUT','MODEL_STREAM_INTERRUPTED'])assert.equal(mayFailover({code}),true);
 for(const code of ['AGENT_PROTOCOL','MODEL_NO_ACTION_TIMEOUT','MODEL_NO_ACTION_BUDGET','MODEL_OUTPUT_LIMIT','MODEL_CONTEXT_LIMIT','MODEL_CANCELLED','EVIDENCE_SOURCE_CHANGED','MODEL_PROVIDER_REJECTED','MODEL_VISION_PROTOCOL'])assert.equal(mayFailover({code}),false);
 for(const flag of ['hasVisibleOutput','unknownSideEffect','partialContent'])assert.equal(mayFailover({code:'MODEL_HTTP_TRANSIENT',[flag]:true}),false);
 assert.equal(mayFailover({code:'MODEL_PROVIDER_ERROR',providerCategory:'unknown'}),false);
 assert.equal(mayFailover({code:'MODEL_NETWORK',networkCode:'CERT_HAS_EXPIRED'}),false);
 assert.equal(mayFailover({code:'MODEL_NETWORK',networkCode:'ERR_NETWORK_IO_SUSPENDED'}),true);
});
test('text requests retry finitely then stay on the selected backup with actual credentials, diagnostics and reply history',async()=>{
 const {storage,loaded,records}=fixture(),calls=[];
 const result=await createChat(storage,async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body.model);assert.equal(options.headers.Authorization,'Bearer key-'+body.model);
  if(body.model==='p')return new Response('upstream',{status:503});
  return reply('原任务继续');
 },{retryDelay:0}).complete(input);
 assert.deepEqual(calls,['p','p','p','pb']);assert.deepEqual(loaded,['p','pb']);assert.equal(result.content,'原任务继续');
 assert.deepEqual(records.map(r=>r.modelId),calls);assert.ok(records.every(r=>r.selectedModelId==='auto'&&r.routingLane==='primary'));
 assert.equal(result.replyDetails.modelRoutes.length,1);assert.equal(result.replyDetails.modelRoutes[0].from,'p');assert.equal(result.replyDetails.modelRoutes[0].to,'pb');
});
test('no primary/backup ping-pong across reads, and total failure stays bounded',async()=>{
 const {storage}=fixture(),router=await createModelRouter(storage,'auto'),calls=[];
 const invoke=actual=>{calls.push(actual.id);if(actual.id==='p')throw Object.assign(Error('down'),{code:'MODEL_HTTP_TRANSIENT'});return actual.id;};
 for(let i=0;i<8;i++)assert.equal((await router.run('primary',invoke)).result,'pb');
 assert.equal(calls.filter(id=>id==='p').length,1);
 await assert.rejects(router.run('primary',()=>{throw Object.assign(Error('down'),{code:'MODEL_HTTP_TRANSIENT'});}));
 let after=0;await assert.rejects(router.run('primary',()=>{after++;}));assert.equal(after,0);
});
test('manual selection and disabled Auto failover never call another configured model',async()=>{
 for(const selected of ['p','auto']){
  const {storage}=fixture({...autoModel,failover:false}),calls=[];
  await assert.rejects(createChat(storage,async(_url,options)=>{calls.push(JSON.parse(options.body).model);return new Response('down',{status:503});},{retryDelay:0}).complete({...input,modelId:selected}));
  assert.deepEqual(calls,['p','p','p']);
 }
});
test('401 and explicit quota rejection do not send the conversation to a backup',async()=>{
 for(const response of [()=>new Response('secret',{status:401}),()=>Response.json({error:{code:'insufficient_quota'}},{status:429})]){
  const {storage}=fixture(),calls=[];
  await assert.rejects(createChat(storage,async(_u,o)=>{calls.push(JSON.parse(o.body).model);return response();},{retryDelay:0}).complete(input));assert.deepEqual(calls,['p']);
 }
});
test('rate limiting retries then switches, and exhausted backup retries stop',async()=>{
 const {storage}=fixture(),calls=[];
 await assert.rejects(createChat(storage,async(_u,o)=>{calls.push(JSON.parse(o.body).model);return new Response('',{status:429});},{retryDelay:0}).complete(input));
 assert.deepEqual(calls,['p','p','p','pb','pb','pb']);
});
test('visible streaming output and explicit stop never restart on a backup',async()=>{
 const {storage}=fixture(),calls=[],content=[];
 const chat=createChat(storage,async(_u,o)=>{calls.push(JSON.parse(o.body).model);let sent=false;return new Response(new ReadableStream({pull(c){if(!sent){sent=true;c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'已显示的正文'}}]})+'\n\n'));}else c.error(Object.assign(Error('reset'),{code:'ECONNRESET'}));}}),{headers:{'content-type':'text/event-stream'}});},{retryDelay:0});
 await assert.rejects(chat.complete({...input,onText:text=>content.push(text)}));assert.deepEqual(calls,['p']);assert.ok(content.some(t=>t.includes('已显示')));
 const {storage:other}=fixture();let entered;const ready=new Promise(r=>entered=r),stopped=[];
 const hanging=createChat(other,async(_u,o)=>{stopped.push(JSON.parse(o.body).model);entered();return new Promise((_r,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));},{retryDelay:0});
 const result=hanging.complete(input);await ready;hanging.cancel(input.id);await assert.rejects(result,/已停止/);assert.deepEqual(stopped,['p']);
});
test('paired images reach only the vision lane; cached observations retain identity and uncertainties',async()=>{
 const {storage}=fixture(),router=await createModelRouter(storage,'auto'),prepare=createVisualRouter(router);let calls=0;
 const state={phase:'task',goal:'对照设计稿',steps:[{id:'s',title:'检查按钮',status:'running'}],acceptanceCriteria:[{id:'v',text:'位置一致',type:'visual'}]};
 const messages=[image,{role:'user',content:JSON.stringify(state)}],original=structuredClone(messages);
 const request=async(sent,actual)=>{calls++;assert.equal(actual.id,'v');assert.equal(sent[1].content.filter(p=>p.type==='image_url').length,2);assert.doesNotMatch(JSON.stringify(sent),/apiKey|tools/);return {content:JSON.stringify(visualResult)};};
 const first=await prepare(messages,request);const second=await prepare([image,{role:'user',content:JSON.stringify({...state,pendingVisualReview:{status:'paired_delivered'}})}],request);
 assert.equal(calls,1);assert.deepEqual(messages,original);assert.deepEqual(first.reviews,second.reviews);assert.equal(first.reviews[0].modelId,'v');assert.equal(first.reviews[0].inputHash.length,64);
 assert.ok(first.messages.every(m=>typeof m.content==='string'));assert.match(first.messages[0].content,/8像素/);assert.match(first.messages[0].content,/截图无法证明点击行为/);assert.match(first.messages[0].content,/event-1/);
 const changed=structuredClone(messages);changed[0].content.at(-1).image_url.url+='changed';await prepare(changed,request);assert.equal(calls,2);
});
test('vision fallback never downgrades to text and invalid observations get one correction without changing provider',async()=>{
 const {storage}=fixture(),router=await createModelRouter(storage,'auto'),prepare=createVisualRouter(router),calls=[];
 await prepare([image],async(_sent,actual)=>{calls.push(actual.id);if(actual.id==='v')throw Object.assign(Error('unsupported'),{code:'MODEL_IMAGE_UNSUPPORTED'});return {content:JSON.stringify(visualResult)};});assert.deepEqual(calls,['v','vb']);
 const next=await createModelRouter(fixture().storage,'auto'),invalid=createVisualRouter(next),bad=[];
 const failed=await invalid([image],async(_m,a)=>{bad.push(a.id);return {content:'{"action":"finish"}'};});assert.deepEqual(bad,['v','v']);assert.equal(failed.reviews.length,0);assert.equal(failed.failures[0].code,'MODEL_VISION_PROTOCOL');assert.match(failed.messages[0].content,/不是验收证据/);
 const cached=await invalid([image],()=>assert.fail('same failed pixels must not consume a new recovery budget'));assert.deepEqual(cached.failures,failed.failures);
 const missing=fixture({primaryModelId:'p',failover:true});await assert.rejects(createVisualRouter(await createModelRouter(missing.storage,'auto'))([image],()=>assert.fail()),{code:'MODEL_VISION_UNAVAILABLE'});
 const unsupported=fixture({primaryModelId:'p',visionModelId:'v',failover:true});await assert.rejects(createVisualRouter(await createModelRouter(unsupported.storage,'auto'))([image],()=>{throw Object.assign(Error('bad'),{code:'MODEL_IMAGE_UNSUPPORTED'});}),{code:'MODEL_VISION_UNAVAILABLE'});
});
test('backup request budgets use the actual smaller context and output limit',async()=>{
 const {storage,state}=fixture();state.models.find(m=>m.id==='pb').contextWindow=4096;state.models.find(m=>m.id==='pb').maxOutputTokens=512;
 const router=await createModelRouter(storage,'auto');assert.equal(router.model.contextWindow,4096);assert.equal(router.model.maxOutputTokens,512);
 let reserve;
 const result=await createChat(storage,async(_u,o)=>{const body=JSON.parse(o.body);if(body.model==='p')return new Response('',{status:503});reserve=body.max_tokens;return reply('正常');},{retryDelay:0}).complete(input);
 assert.equal(result.content,'正常');assert.ok(reserve<=512);
});
test('Auto identity changes when the allowed vision endpoint or fallback policy changes, without including credentials',async()=>{
 const first=fixture(),second=fixture({...autoModel,failover:false});second.state.models.find(m=>m.id==='v').baseUrl='https://another.example/v1';
 const a=await createModelRouter(first.storage,'auto'),b=await createModelRouter(second.storage,'auto');
 assert.notEqual(a.model.autoRouting.configFingerprint,b.model.autoRouting.configFingerprint);
 const identity=require('../apps/desktop/runtime-provenance.cjs').forModel;
 assert.notEqual(identity(a.model).modelConfigFingerprint,identity(b.model).modelConfigFingerprint);
 assert.doesNotMatch(JSON.stringify(a.model.autoRouting),/key-p|apiKey/);
});
test('storage persists Auto independently of model credentials and preserves it across unrelated settings writes',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-auto-storage-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const storage=require('../apps/desktop/storage.cjs').createStorage(directory,{});
 await storage.saveWorkspace({tasks:[],projects:[],models,autoModel,defaultModelId:'auto'});
 let state=await storage.readWorkspace();assert.deepEqual(state.autoModel,autoModel);assert.equal(state.defaultModelId,'auto');assert.equal((await storage.modelCredentials('auto')).id,'p');
 await storage.saveWorkspace({...state,projects:[{id:'project',name:'示例'}]});state=await storage.readWorkspace();assert.deepEqual(state.autoModel,autoModel);
 await assert.rejects(storage.saveWorkspace({...state,models:models.filter(m=>m.id!=='v')}),/已移除/);assert.deepEqual((await storage.readWorkspace()).autoModel,autoModel);
});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
test('Auto failover cannot reset repeated-read budgets or replay an unknown side effect on continuation',async t=>{
 const {runAgent}=require('../apps/desktop/agent/runner.cjs'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{execute}=require('../apps/desktop/agent/tools.cjs');
 for(const kind of ['reads','unknown']){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-auto-budget-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const task={id:kind,request:'生成并核验说明'},router=await createModelRouter(fixture().storage,'auto'),calls=[];let tools=0;
  const ask=async messages=>(await router.run('primary',actual=>{
   calls.push(actual.id);if(actual.id==='p'&&tools)throw Object.assign(Error('down'),{code:'MODEL_HTTP_TRANSIENT'});
   const state=JSON.parse(messages.at(-1).content);
   return {content:JSON.stringify(state.phase==='route'?{action:'route',kind:'task'}:!state.steps.length?{action:'plan',goal:task.request,decisions:[],requirements:[{id:'r',text:'说明内容已核验',type:'content'}],steps:[{id:'s',title:'生成说明',status:'running'}]}:kind==='reads'?{action:'list_files',path:'.'}:{action:'run_command',command:'isolated fake operation',purpose:'核验说明'})};
  })).result;
  const options={base,task,model:router.model,ask,signal:new AbortController().signal,maxSteps:30,executeTool:async(...args)=>{tools++;return kind==='reads'?execute(...args):{exitCode:null,timedOut:true,output:'unknown effect'};}};
  const result=await runAgent(options);assert.equal(result.agentRun.status,'blocked');assert.ok(calls.includes('pb'));assert.ok(calls.length<=12);assert.equal(calls.filter(id=>id==='p').length,4);
  let w=await createWorkspace(base,task);const executionId=w.run.executionId;
  if(kind==='reads'){assert.equal(tools,2);assert.ok(w.run.events.some(e=>e.type==='loop_recovery'));}
  else{assert.equal(tools,1);assert.ok(w.run.actionJournal.some(e=>e.status==='unknown'));await runAgent({...options,continuationReason:'user'});w=await createWorkspace(base,task);assert.equal(w.run.executionId,executionId);assert.equal(tools,1);assert.ok(w.run.actionJournal.some(e=>e.status==='unknown'));}
 }
});
test('read-only image chat routes attachments without creating agent task state or leaking pixels to text',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-auto-image-chat-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const {storage,state}=fixture(),sourceId=require('node:crypto').randomUUID();storage.agentDirectory=base;storage.isTemporary=()=>true;
 await fs.mkdir(path.join(base,'imports'));await fs.writeFile(path.join(base,'imports',sourceId),png);
 const messages=[{role:'user',content:'图片里有什么？',materials:[{sourceId,name:'shot.png',text:null,size:png.length}]}],task={id:'temporary',temporary:true,request:messages[0].content,materials:messages[0].materials,messages};state.tasks=[task];
 const calls=[];const result=await createChat(storage,async(_u,o)=>{const body=JSON.parse(o.body);calls.push(body.model);if(body.model==='v'){assert.ok(JSON.stringify(body).includes('data:image/png'));assert.equal(body.tools,undefined);return reply(JSON.stringify(visualResult));}assert.doesNotMatch(JSON.stringify(body),/data:image|image_url/);assert.match(JSON.stringify(body),/按钮位置偏低/);return reply('根据视觉观察，按钮位置偏低。');}).complete({...input,taskId:task.id,messages});
 assert.deepEqual(calls,['v','p']);assert.equal(result.replyDetails.visualReviews[0].modelId,'v');assert.deepEqual(await fs.readdir(base),['imports']);assert.equal((await fs.readFile(path.join(base,'imports',sourceId))).equals(png),true);
});
test('real executor preserves task, write, visual receipt and unmet criteria across both lane failovers and explicit continuation',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-auto-agent-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const {storage,state,records}=fixture();storage.agentDirectory=base;storage.imageObserver={prepare:async()=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64')}}})};
 const task={id:'task',request:'保留说明，比较图片，未验收不能标完成',materials:[],messages:[{id:'u',role:'user',content:'保留说明，比较图片，未验收不能标完成'}]};state.tasks=[task];
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');let w=await createWorkspace(base,task);await fs.writeFile(path.join(w.files,'shot.png'),png);await fs.writeFile(path.join(w.files,'ref.png'),png);
 let wrote=false,viewed=false,resumed=false;const ids=new Set(),calls=[];
 const chat=createChat(storage,async(_u,o)=>{
  const body=JSON.parse(o.body);calls.push(body.model);
  if(body.model==='v')return new Response('',{status:503});
  if(body.model==='vb'){assert.equal(body.tools,undefined);assert.equal(body.messages[1].content.filter(p=>p.type==='image_url').length,2);return reply(JSON.stringify(visualResult));}
  assert.ok(body.messages.every(m=>typeof m.content==='string'));
  const snapshot=JSON.parse(body.messages.at(-1).content);
  if(snapshot.phase==='route')return action({action:'route',kind:'task'});
  if(!snapshot.steps.length)return action({action:'plan',goal:task.request,decisions:[],requirements:[{id:'visual',text:'图片差异已修复并核验',type:'visual'}],steps:[{id:'s',title:'保存说明并对照图片',status:'running'}]});
  if(!wrote){wrote=true;return action({action:'write_file',path:'draft.txt',content:'成果保留，尚未验收'});}
  if(!viewed){viewed=true;return action({action:'view_image',path:'shot.png',reference:'ref.png'});}
  if(body.model==='p'&&!resumed)return new Response('',{status:503});
  if(!resumed)assert.match(JSON.stringify(body),/编辑按钮比原稿低8像素/);
  return action({action:'pause',text:'已保留原任务、说明与真实图片观察，视觉差异仍须修复。'});
 },{retryDelay:0});
 const result=await chat.complete({...input,taskId:task.id,messages:task.messages,executionOrigin:'user',onRun:r=>ids.add(r.executionId)});
 assert.equal(result.agentRun.status,'paused');assert.equal(result.agentRun.acceptanceCriteria[0].status,'pending');assert.equal(ids.size,1);assert.ok(calls.includes('pb'));assert.ok(calls.includes('vb'));assert.equal(calls.filter(id=>id==='v').length,3);
 w=await createWorkspace(base,task);const executionId=w.run.executionId;assert.equal(w.run.events.filter(e=>e.type==='write_file').length,1);assert.equal(w.run.visualObservations[0].delivered,true);assert.equal(w.run.visualObservations[0].modelReviews[0].modelId,'vb');assert.equal(w.run.events.filter(e=>e.type==='model_route').length,2);
 assert.ok(records.some(r=>r.modelId==='vb'&&r.routingLane==='vision'));assert.equal(await fs.readFile(path.join(w.files,'draft.txt'),'utf8'),'成果保留，尚未验收');
 resumed=true;task.messages.push({id:'u2',role:'user',content:'继续原任务，保留已有成果与观察'});
 await chat.complete({...input,id:'resume',taskId:task.id,messages:task.messages,executionOrigin:'user'});w=await createWorkspace(base,task);
 assert.equal(w.run.executionId,executionId);assert.equal(w.run.events.filter(e=>e.type==='write_file').length,1);const criteria=require('../apps/desktop/agent/acceptance.cjs').criteria(w.run);assert.equal(criteria[0].id,'visual');assert.notEqual(criteria[0].check?.status,'passed');
});

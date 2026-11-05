// Exercise storage -> chat -> named tool transport -> runner -> live activity.
// The provider is local and scripted; no credentials or external service is used.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const JSZip=require('../apps/desktop/node_modules/jszip');
const {createStorage}=require('../apps/desktop/storage.cjs');
const {createChat}=require('../apps/desktop/chat.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {builtins}=require('../apps/desktop/extensions.cjs');
const wire=({action,...arguments})=>Response.json({choices:[{message:{tool_calls:[{id:'fixture-call',type:'function',function:{name:action,arguments:JSON.stringify(arguments)}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:20,completion_tokens:5}});
const bodyOf=options=>JSON.parse(options.body);
const stateOf=body=>JSON.parse(body.messages.at(-1).content);
const systemOf=body=>body.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
async function fixture(t,request){
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ailo-auto-skill-chat-')));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 let storage=createStorage(directory,{});
 const manager=storage.skillPackages,zip=new JSZip();
 zip.file('SKILL.md','---\nname: team-outline\ndescription: 为团队需求讨论组织提纲\n---\nCHAT_IMPORTED_SKILL_BODY: 参考 references/outline.txt 组织回答。');
 zip.file('references/outline.txt','团队讨论提纲资源');
 const installed=await manager.importSkill({name:'team-outline.zip',buffer:await zip.generateAsync({type:'nodebuffer'})});
 const state=await storage.readWorkspace();await storage.saveWorkspace({...state,extensions:[...state.extensions,installed]});
 const task=await storage.patchTask('task',{title:'技能自动加载回归',request,materials:[],messages:[{id:'u',role:'user',content:request}]});
 // Reopen the workspace so the test proves persisted extensions reach chat,
 // rather than handing availableSkills directly to the runner.
 storage=createStorage(directory,{});storage.agentDirectory=path.join(directory,'agent');storage.skillPackages=manager;
 storage.modelCredentials=async()=>({id:'fixture',name:'离线模型',model:'fixture',baseUrl:'https://fixture.invalid/v1',contextWindow:131072});
 return {directory,storage,installed,task};
}
const inputOf=f=>({id:'request',taskId:f.task.id,modelId:'fixture',messages:f.task.messages,executionOrigin:'user'});

test('persistent chat discovers saved builtin and installed skills and publishes automatic loading before its reply',async t=>{
 const f=await fixture(t,'请把团队需求讨论整理成验收清单和提纲'),builtin=builtins.find(e=>e.id==='skill-requirements'),activities=[];let calls=0;
 const chat=createChat(f.storage,async(_url,options)=>{
  const body=bodyOf(options),state=stateOf(body),system=systemOf(body);calls++;
  assert.ok(body.tools.every(tool=>tool.function.name!=='ailo_action'));
  if(calls===1){
   assert.equal(state.phase,'route');assert.ok(state.skillCatalog.some(e=>e.id===builtin.id));assert.ok(state.skillCatalog.some(e=>e.id===f.installed.id));
   assert.ok(!system.includes(builtin.instructions));assert.doesNotMatch(system,/CHAT_IMPORTED_SKILL_BODY/);
   assert.ok(!activities.some(a=>a.loadedExtensions.some(e=>e.id===f.installed.id)));
   return wire({action:'route',kind:'chat',skillIds:[builtin.id,f.installed.id]});
  }
  assert.equal(calls,2);assert.equal(state.phase,'chat');assert.ok(system.includes(builtin.instructions));assert.match(system,/CHAT_IMPORTED_SKILL_BODY/);
  assert.deepEqual(state.loadedSkills.map(e=>[e.id,e.source]),[[builtin.id,'auto'],[f.installed.id,'auto']]);
  const live=chat.sessions()[0];assert.deepEqual(live.activity.loadedExtensions.map(e=>[e.id,e.source]),[[builtin.id,'auto'],[f.installed.id,'auto']]);
  assert.ok(activities.some(a=>a.events.some(e=>e.type==='skill_loaded')),'技能加载事件应在最终回复前到达界面');
  return wire({action:'reply',text:'验收清单与团队讨论提纲已整理。'});
 },{retryDelay:0});
 const result=await chat.complete({...inputOf(f),onActivity:a=>activities.push(structuredClone(a))});
 assert.equal(calls,2);assert.equal(result.content,'验收清单与团队讨论提纲已整理。');
 assert.deepEqual(result.replyDetails.loadedExtensions.map(e=>[e.id,e.source]),[[builtin.id,'auto'],[f.installed.id,'auto']]);
 assert.ok(result.replyDetails.loadedExtensions.every(e=>e.reason));assert.equal(chat.sessions().length,0);
 const w=await createWorkspace(f.storage.agentDirectory,f.task);
 assert.equal(await fs.readFile(path.join(w.files,'.runtime/ailo-skills',f.installed.package.id,'references/outline.txt'),'utf8'),'团队讨论提纲资源');
 assert.deepEqual(w.run.loadedExtensions.map(e=>e.source),['auto','auto']);
 await f.storage.patchTask(f.task.id,{},[{id:'answer',role:'assistant',content:result.content,replyDetails:result.replyDetails}]);
 const restored=(await createStorage(f.directory,{}).readWorkspace()).tasks.find(e=>e.id===f.task.id).messages.find(e=>e.id==='answer');
 assert.deepEqual(restored.replyDetails.loadedExtensions,result.replyDetails.loadedExtensions);
});

test('a failed automatic package preparation never reports loaded status in live activity or the final reply',async t=>{
 const f=await fixture(t,'请提供团队需求讨论的提纲'),activities=[];let calls=0;
 await fs.writeFile(path.join(f.directory,'skill-packages',f.installed.package.id,'files/references/outline.txt'),'资源已损坏');
 const chat=createChat(f.storage,async(_url,options)=>{
  const body=bodyOf(options),state=stateOf(body);calls++;
  if(calls===1){assert.ok(state.skillCatalog.some(e=>e.id===f.installed.id));return wire({action:'route',kind:'chat',skillIds:[f.installed.id]});}
  assert.equal(calls,2);assert.deepEqual(state.loadedSkills,[]);assert.ok(!state.skillCatalog.some(e=>e.id===f.installed.id));assert.doesNotMatch(systemOf(body),/CHAT_IMPORTED_SKILL_BODY/);
  assert.deepEqual(chat.sessions()[0].activity.loadedExtensions,[]);
  return wire({action:'reply',text:'附加提纲技能的资源损坏，未加载；可先按已有需求整理提纲。'});
 },{retryDelay:0});
 const result=await chat.complete({...inputOf(f),onActivity:a=>activities.push(structuredClone(a))});
 assert.equal(calls,2);assert.deepEqual(result.replyDetails.loadedExtensions,[]);assert.deepEqual(result.agentRun.loadedExtensions,[]);
 assert.ok(activities.every(a=>a.loadedExtensions.every(e=>e.id!==f.installed.id)));
 assert.ok(result.replyDetails.events.some(e=>e.type==='extension_prepare_failed'));assert.ok(!result.replyDetails.events.some(e=>e.type==='skill_loaded'));
});

test('persistent chat with a populated skill library still answers an unrelated greeting in one model request',async t=>{
 const f=await fixture(t,'你好'),activities=[];let calls=0;
 const chat=createChat(f.storage,async(_url,options)=>{
  calls++;const body=bodyOf(options),state=stateOf(body);assert.equal(state.phase,'route');assert.ok(state.skillCatalog.length>0);assert.deepEqual(state.loadedSkills,[]);
  assert.doesNotMatch(systemOf(body),/CHAT_IMPORTED_SKILL_BODY/);assert.ok(!systemOf(body).includes(builtins.find(e=>e.id==='skill-requirements').instructions));
  return wire({action:'reply',text:'你好！'});
 },{retryDelay:0});
 const result=await chat.complete({...inputOf(f),onActivity:a=>activities.push(structuredClone(a))});
 assert.equal(calls,1);assert.equal(result.content,'你好！');assert.equal(result.agentRun.performance.modelRequests,1);assert.equal(result.replyDetails.usage.requestCount,1);
 assert.deepEqual(result.replyDetails.loadedExtensions,[]);assert.ok(activities.every(a=>!a.loadedExtensions.length));
 const w=await createWorkspace(f.storage.agentDirectory,f.task);await assert.rejects(fs.access(path.join(w.files,'.runtime/ailo-skills',f.installed.package.id)),{code:'ENOENT'});
});

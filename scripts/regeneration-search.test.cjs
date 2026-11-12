const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createStorage}=require('../apps/desktop/storage.cjs'),{createExperience}=require('../apps/desktop/experience.cjs'),{createChat}=require('../apps/desktop/chat.cjs'),{runAgent}=require('../apps/desktop/agent/runner.cjs');
const {allowedActions}=require('../apps/desktop/agent/protocol.cjs');
async function fixture(t,searchEnabled=true,id='news'){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-regenerate-search-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const request='搜索今日AI热点并总结';const task={id,searchEnabled,request,materials:[],created:'2026-11-09',messages:[{id:'u',role:'user',content:request},{id:'a',role:'assistant',content:'原回答'}]};await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[task],projects:[],models:[]}));const storage=createStorage(dir,{});storage.agentDirectory=path.join(dir,'agent');storage.modelCredentials=async()=>({baseUrl:'https://example.org/v1',name:'fixture',model:'fixture',contextWindow:131072});const experience=createExperience({storage});return {dir,task,storage,experience};}
function toolResponse(name,args){return new Response(JSON.stringify({choices:[{message:{role:'assistant',tool_calls:[{id:'fixture-call',type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]}),{headers:{'content-type':'application/json'}});}
for(const id of ['news','my-ailo-assistant'])test(id+': regenerate button retains enabled search and reaches real tool pipeline, while original response stays archived',async t=>{
 const f=await fixture(t,true,id);const task=await f.experience.action({id:f.task.id,action:'regenerate',messageId:'a'});let calls=0,searches=0;
 f.storage.webSearch={execute:async a=>{searches++;assert.equal(a.query,'AI 2026-11-09');return {query:a.query,sources:[{title:'当天资料',url:'https://example.org/today',date:'2026-11-09',content:'当天真实搜索返回'}]};}};
 const chat=createChat(f.storage,async(_url,options)=>{
  calls++;const body=JSON.parse(options.body),state=JSON.parse(body.messages.at(-1).content),names=body.tools.map(t=>t.function.name);
  assert.equal(state.regeneration.readOnly,true);assert.equal(state.phase,'chat');assert.ok(names.includes('web_search'));assert.ok(!names.includes('write_file'));assert.ok(!names.includes('run_command'));
  if(calls===1)return toolResponse('web_search',{query:'AI 2026-11-09'});
  assert.equal(state.searchContext.results[0].sources[0].url,'https://example.org/today');
  return toolResponse('reply',{text:'今日热点依据当天真实搜索返回，来源：https://example.org/today'});
 });
 const r=await chat.complete({id:'regenerated',taskId:task.id,modelId:'m',searchEnabled:task.searchEnabled,messages:task.messages.map(m=>({role:m.role,content:m.content}))});
 assert.equal(searches,1);assert.equal(calls,2);assert.match(r.content,/当天真实搜索返回/);assert.equal(task.conversationSections[0].messages.at(-1).content,'原回答');assert.equal(r.agentRun.currentIntent,'chat');
});
test('disabled search is absent from regeneration tools and cannot be called by an unsupported model action',async t=>{
 const f=await fixture(t,false);const task=await f.experience.action({id:f.task.id,action:'regenerate',messageId:'a'});let calls=0,searches=0;
 f.storage.webSearch={execute:async()=>{searches++;throw Error('must not run');}};
 const chat=createChat(f.storage,async(_url,options)=>{calls++;const body=JSON.parse(options.body),state=JSON.parse(body.messages.at(-1).content);assert.equal(state.webSearchEnabled,false);assert.ok(!body.tools.some(t=>t.function.name==='web_search'));return toolResponse('reply',{text:'当前未开启联网搜索，无法获取当天热点。'});});
 const r=await chat.complete({id:'closed',taskId:task.id,modelId:'m',searchEnabled:false,messages:task.messages});assert.equal(searches,0);assert.equal(calls,1);assert.match(r.content,/未开启/);
});
test('regeneration rejects model-proposed writes and route changes before tools execute, then permits fresh search and reply',async t=>{
 const f=await fixture(t);const task=await f.experience.action({id:f.task.id,action:'regenerate',messageId:'a'});let n=0,searches=0;
 const actions=[{action:'write_file',path:'must-not-exist.txt',content:'side effect'},{action:'route',kind:'task'},{action:'web_search',query:'AI热点'},{action:'reply',text:'已经依据本轮搜索核对。'}];
 const r=await runAgent({base:f.storage.agentDirectory,task,model:{contextWindow:131072},signal:new AbortController().signal,webSearch:{execute:async()=>{searches++;return {query:'AI热点',sources:[]};}},ask:async()=>({content:JSON.stringify(actions[n++])})});
 assert.equal(searches,1);assert.match(r.content,/本轮搜索/);
 const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(f.storage.agentDirectory,task);await assert.rejects(fs.stat(path.join(w.files,'must-not-exist.txt')),/ENOENT/);assert.equal(w.run.events.filter(e=>e.type==='write_file').length,0);assert.equal(w.run.artifacts.length,0);
 const names=allowedActions({phase:'chat',regeneration:{readOnly:true},webSearchEnabled:true,subagentAvailable:true,mcpConnections:[{id:'x'}]});for(const name of ['feishu','mcp','memory','assistant','subagent','run_command','browser','artifact','verify','finish','write_file'])assert.ok(!names.includes(name),name);
});

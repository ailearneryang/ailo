const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createStorage}=require('../apps/desktop/storage.cjs');
const {createChat}=require('../apps/desktop/chat.cjs');
test('model task summaries update titles during execution and survive stale task writes',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-title-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const storage=createStorage(directory,{});const task=await storage.patchTask('t',{title:'请解析附件里的文件',request:'请解析附件里的文件，说明天气 UI 的设计',materials:[{name:'天气UI.sketch',text:'设计图层'}],messages:[{id:'u',role:'user',content:'请解析附件里的文件，说明天气 UI 的设计'}]});
 const titles=[];
 const chat=createChat({agentDirectory:path.join(directory,'agent'),readWorkspace:()=>storage.readWorkspace(),setGeneratedTitle:(...args)=>storage.setGeneratedTitle(...args),modelCredentials:async()=>({baseUrl:'https://example.com/v1',model:'test',contextWindow:32768})},async(_,options)=>{
  const request=JSON.parse(options.body),state=JSON.parse(request.messages.at(-1).content);
  const action=state.phase==='route'?{action:'route',kind:'chat',conversationTitle:'解析天气 UI Sketch 设计稿'}:{action:'reply',text:'设计稿包含天气界面。',conversationTitle:'解析天气 UI Sketch 设计稿'};
  return Response.json({choices:[{message:{tool_calls:[{id:'a',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]}}]});
 });
 await chat.complete({id:'run',taskId:task.id,modelId:'test',messages:task.messages,onRun:run=>{if(run.conversationTitle)titles.push(run.conversationTitle);}});
 assert.ok(titles.includes('解析天气 UI Sketch 设计稿'));
 await storage.patchTask(task.id,task);
 assert.equal((await storage.readWorkspace()).tasks[0].title,'解析天气 UI Sketch 设计稿');
 assert.equal(await storage.setGeneratedTitle(task.id,'x'.repeat(41)),null);
 await storage.patchTask('scheduled',{request:'每日复盘',title:'定时 · 每日复盘',materials:[],scheduledTaskId:'s'});
 assert.equal(await storage.setGeneratedTitle('scheduled','总结今日工作'),null);
 assert.equal((await storage.readWorkspace()).tasks.find(t=>t.id==='scheduled').title,'定时 · 每日复盘');
});

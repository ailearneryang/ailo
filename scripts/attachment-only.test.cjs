const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createStorage}=require('../apps/desktop/storage.cjs');
const {createChat}=require('../apps/desktop/chat.cjs');
test('attachment-only messages persist and reach the agent without invented user text',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-attachment-only-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const {hasMessageContent}=await import('../apps/desktop/attachments.mjs');
 const material={name:'需求.txt',size:12,text:'附件独有正文'};
 assert.equal(hasMessageContent('   ',[]),false);assert.equal(hasMessageContent('',[material]),true);
 assert.equal(hasMessageContent('',[{name:'lost.bin',text:null}]),false);
 const storage=createStorage(directory,{});
 const task=await storage.patchTask('t',{request:'',title:material.name,materials:[material],messages:[{id:'u',role:'user',content:'',materials:[material]}]});
 assert.equal((await storage.readWorkspace()).tasks[0].messages[0].content,'');
 const chat=createChat({agentDirectory:path.join(directory,'agent'),readWorkspace:()=>storage.readWorkspace(),modelCredentials:async()=>({baseUrl:'https://example.com/v1',model:'test',contextWindow:32768})},async(_,options)=>{
  const request=JSON.parse(options.body),state=JSON.parse(request.messages.at(-1).content);
  assert.equal(state.conversation[0].content,'');assert.equal(state.materials[0].name,material.name);
  const action=state.phase==='route'?{action:'route',kind:'chat'}:{action:'reply',text:'已收到文件，请问希望如何处理？'};
  return Response.json({choices:[{message:{tool_calls:[{id:'a',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]}}]});
 });
 assert.match((await chat.complete({id:'run',taskId:task.id,modelId:'test',messages:task.messages})).content,/已收到文件/);
 await assert.rejects(chat.complete({id:'empty',modelId:'test',messages:[{role:'user',content:'',materials:[]}]}),/无效/);
});

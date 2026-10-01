const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStorage } = require('../apps/desktop/storage.cjs');
const { createChat } = require('../apps/desktop/chat.cjs');
const { builtins, selectedExtensions } = require('../apps/desktop/extensions.cjs');
test('migrates old workspaces, saves custom extensions, disabled state and project defaults', async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(),'ailo-extensions-'));
 try {
  await fs.writeFile(path.join(dir,'workspace.json'), JSON.stringify({tasks:[],projects:[],models:[]}));
  const storage = createStorage(dir, {});
  const initial = await storage.readWorkspace();
  assert.equal(initial.extensions.length,6);
  const custom = {id:'custom',kind:'skill',name:'自定义',description:'说明',instructions:'CUSTOM_WORKFLOW',enabled:true};
  await storage.saveWorkspace({...initial,extensions:[...initial.extensions,custom],projects:[{id:'p',name:'项目',extensionIds:['custom']}]});
  const reloaded = await createStorage(dir,{}).readWorkspace();
  assert.equal(reloaded.extensions.at(-1).instructions,'CUSTOM_WORKFLOW');
  assert.deepEqual(reloaded.projects[0].extensionIds,['custom']);
  await assert.rejects(storage.saveWorkspace({...reloaded,extensions:[custom,custom]}),/配置无效/);
  await storage.saveWorkspace({...reloaded,extensions:reloaded.extensions.map(e=>({...e,enabled:false}))});
  assert.equal((await storage.readWorkspace()).extensions.at(-1).enabled,false);
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('only explicitly selected enabled extensions reach the model', async () => {
 let payload;
 const chat = createChat({readWorkspace:async()=>({extensions:builtins}),modelCredentials:async()=>({baseUrl:'https://example.com/v1',model:'test'})},async(url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}));});
 const input = {id:'r',modelId:'m',messages:[{role:'user',content:'hi'}]};
 await chat.complete(input); assert.equal(payload.messages.length,2);
 await chat.complete({...input,extensionIds:['expert-product','skill-requirements']});
 assert.equal(payload.messages.length,4);
 assert.match(payload.messages[1].content,/产品经理/);
 assert.match(payload.messages[2].content,/验收标准/);
 await assert.rejects(chat.complete({...input,extensionIds:['missing']}),/不存在/);
 assert.throws(()=>selectedExtensions(builtins,['expert-product','expert-editor']),/1 位专家/);
 assert.throws(()=>selectedExtensions(builtins.map(e=>({...e,enabled:false})),['skill-summary']),/停用/);
});
test('output limit is persisted independently from context capacity and validated',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-output-config-'));
 try{
  const storage=createStorage(dir,{}),state=await storage.readWorkspace();
  const model={id:'m',name:'测试',model:'test',baseUrl:'https://example.com/v1',contextWindow:100000,maxOutputTokens:32768};
  await storage.saveWorkspace({...state,models:[model]});assert.equal((await storage.modelCredentials('m')).maxOutputTokens,32768);
  assert.equal((await createStorage(dir,{}).readWorkspace()).models[0].maxOutputTokens,32768);
  for(const value of [0,255,3.5,100000,2000001])await assert.rejects(storage.saveWorkspace({...state,models:[{...model,maxOutputTokens:value}]}),/最大输出额度/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

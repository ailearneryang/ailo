const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { randomUUID } = require('node:crypto');
const { createChat } = require('../apps/desktop/chat.cjs');
const { imageContent } = require('../apps/desktop/materials.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
test('regenerated delegated conversation inherits legacy originals; an old image cannot block a newly added image',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-branch-images-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const {workspacePath}=require('../apps/desktop/agent/workspace-path.cjs');
 const {withMaterialOrigins}=require('../apps/desktop/material-originals.cjs');
 const {imageMessages}=require('../apps/desktop/chat-image-input.cjs');
 const sourceId=randomUUID(),newId=randomUUID(),material={name:'image.png',sourceId,size:png.length,text:null};
 const parent={id:'my-assistant'},child={id:'delegated',parentAssistantId:parent.id};
 const branch={id:'regenerated',responseOnly:true,resourceOrigins:[{id:child.id}],branchOf:{id:child.id},messages:[{role:'user',content:'',materials:[material]},{role:'assistant',content:'已收到'},{role:'user',content:'',materials:[{...material,sourceId:newId}]}]};
 const original=path.join(workspacePath(base,parent),'originals',sourceId);await fs.mkdir(path.dirname(original),{recursive:true});await fs.writeFile(original,png);
 await fs.mkdir(path.join(base,'imports'));await fs.writeFile(path.join(base,'imports',newId),png);
 await assert.rejects(imageMessages(base,branch,branch.messages),/image.png.*原文件缺失/);
 const prepared=withMaterialOrigins(branch,[parent,child,branch]);
 const images=await imageMessages(base,prepared,branch.messages);assert.equal(images.length,2);
 assert.ok(images.every(m=>m.content[1].image_url.url===`data:image/png;base64,${png.toString('base64')}`));
 await assert.rejects(fs.stat(workspacePath(base,branch)),{code:'ENOENT'},'read-only replies must not create workspaces');
 assert.deepEqual(await fs.readFile(original),png);
 let calls=0;const storage={agentDirectory:base,readWorkspace:async()=>({tasks:[parent,child,branch]}),modelCredentials:async()=>({baseUrl:'https://example.com/v1',model:'vision',contextWindow:65536})};
 const chat=createChat(storage,async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.messages.filter(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')).length,2);return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'reply-images',type:'function',function:{name:'reply',arguments:JSON.stringify({text:'两张图片均已收到'})}}]}}]}),{headers:{'content-type':'application/json'}});});
 const result=await chat.complete({id:'regenerate-images',taskId:branch.id,modelId:'vision',messages:branch.messages});assert.equal(result.content,'两张图片均已收到');assert.equal(calls,1);
});
test('import ownership is preserved while related branches copy original files through recorded lineage',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-shared-original-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{workspacePath}=require('../apps/desktop/agent/workspace-path.cjs');
 const sourceId=randomUUID(),material={name:'image.png',sourceId,size:png.length,text:null};
 await fs.mkdir(path.join(base,'imports'));await fs.writeFile(path.join(base,'imports',sourceId),png);
 const first={id:'original',messages:[{role:'user',content:'看图',materials:[material]}]};await createWorkspace(base,first);
 await assert.rejects(fs.stat(path.join(base,'imports',sourceId)),{code:'ENOENT'});
 const branch={id:'new-branch',resourceOrigins:[{id:first.id}],messages:first.messages};
 const restored=await createWorkspace(base,branch);assert.equal((await restored.images([material])).length,1);
 assert.deepEqual(await fs.readFile(path.join(workspacePath(base,branch),'originals',sourceId)),png);
 assert.deepEqual(await fs.readFile(path.join(workspacePath(base,first),'originals',sourceId)),png);
});
test('image recovery stays within recorded lineage and still rejects truly missing or linked files',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-image-boundary-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const {workspacePath}=require('../apps/desktop/agent/workspace-path.cjs'),{findMaterialOriginal,materialOrigins}=require('../apps/desktop/material-originals.cjs');
 const sourceId=randomUUID(),unrelated={id:'unrelated'},task={id:'current'};const original=path.join(workspacePath(base,unrelated),'originals',sourceId);await fs.mkdir(path.dirname(original),{recursive:true});await fs.writeFile(original,png);
 assert.equal(await findMaterialOriginal(base,task,sourceId),null);
 await assert.rejects(findMaterialOriginal(base,task,'../'+sourceId),/来源标识无效/);
 await fs.mkdir(path.join(base,'imports'));await fs.symlink(original,path.join(base,'imports',sourceId));
 await assert.rejects(findMaterialOriginal(base,task,sourceId),/符号链接/);
 assert.equal(materialOrigins({id:'cycle',resourceOrigins:[{id:'cycle'}]}).length,1);
});
test('a delegated workspace catalogs older parent documents even when its current message attaches nothing',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-parent-documents-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{workspacePath}=require('../apps/desktop/agent/workspace-path.cjs');
 const parent={id:'my-ailo-assistant'},sourceId=randomUUID(),document={name:'earlier.md',sourceId,text:'前段摘要'};
 const original=path.join(workspacePath(base,parent),'originals',sourceId);await fs.mkdir(path.dirname(original),{recursive:true});await fs.writeFile(original,'前段摘要\n完整历史文档的后半段');
 const child={id:'delegated-doc',parentAssistantId:parent.id,materials:[document],messages:[{role:'user',content:'根据之前文档总结',materials:[]}]};
 const workspace=await createWorkspace(base,child);assert.equal(workspace.catalog.length,1);assert.equal(workspace.catalog[0].name,document.name);
 const read=await workspace.source(workspace.catalog[0].id);assert.match(read.text,/完整历史文档的后半段/);
 assert.deepEqual(await fs.readFile(original),await fs.readFile(path.join(workspacePath(base,child),'originals',sourceId)));
});
test('image attachments reach model requests and survive retry after source migration', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ailo-image-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.mkdir(path.join(base, 'imports'));
  const sourceId = randomUUID();
  await fs.writeFile(path.join(base, 'imports', sourceId), png);
  const task = { id: 'image-task', request: '', materials: [], messages: [{ role: 'user', content: '', materials: [{ name: '截图.png', size: png.length, text: null, sourceId }] }] };
  const storage = { agentDirectory: base, readWorkspace: async () => ({ tasks: [task] }), modelCredentials: async () => ({ baseUrl: 'https://example.com/v1', model: 'vision', contextWindow: 32768 }) };
  let calls = 0;
  const chat = createChat(storage, async (_, options) => {
    const request = JSON.parse(options.body);
    const state = JSON.parse(request.messages.at(-1).content);
    const images = request.messages.filter(message => Array.isArray(message.content));
    assert.equal(images.length, state.phase==='route'?0:1);
    if(state.phase!=='route'){
      const image = images[0].content.find(part => part.type === 'image_url');
      assert.equal(image.image_url.url, `data:image/png;base64,${png.toString('base64')}`);
    }
    const action = state.phase === 'route' ? { action: 'route', kind: 'chat' } : { action: 'reply', text: '已收到图片' };
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'a', type: 'function', function: { name: 'ailo_action', arguments: JSON.stringify(action) } }] } }] }));
  });
  for (const id of ['first', 'retry']) assert.equal((await chat.complete({ id, taskId: task.id, modelId: 'vision', messages: task.messages })).content, '已收到图片');
  assert.equal(calls, 4);
});
test('attachment availability, image validation and token estimates', async t => {
  const { canSendMaterial } = await import('../apps/desktop/attachments.mjs');
  assert.ok(canSendMaterial({ name: 'a.png', text: null, sourceId: randomUUID() }));
  assert.ok(canSendMaterial({ name: 'a.txt', text: 'text' }));
  assert.ok(canSendMaterial({ name: 'a.pdf', text: null, sourceId: randomUUID() }));
  assert.ok(!canSendMaterial({ name: 'a.png', text: null }));
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ailo-image-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const filename = path.join(base, 'fake.png');
  await fs.writeFile(filename, 'not an image');
  await assert.rejects(imageContent(filename), /有效的/);
  const { countMessages, requestContextUsage } = await import('../apps/desktop/context.mjs');
  const messages = [{ role: 'user', content: [{ type: 'text', text: '图片' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'x'.repeat(100000) } }] }];
  assert.ok(countMessages(messages) > 2048 && countMessages(messages) < 2100);
  assert.equal(requestContextUsage(messages, {}, {}, 1024).rows.find(row => row.label === '图片输入（估算）').tokens, 2048);
});
test('attachment-only requests respect disabled image input and retain endpoint rejection across later decisions', async t => {
 for(const disabled of [true,false]){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-image-fallback-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
  await fs.mkdir(path.join(base,'imports'));const sourceId=randomUUID();await fs.writeFile(path.join(base,'imports',sourceId),png);
  const task={id:'image-task',request:'检查图片',messages:[{role:'user',content:'检查图片',materials:[{name:'design.png',sourceId,size:png.length,text:null}]}]};
  const storage={agentDirectory:base,readWorkspace:async()=>({tasks:[task]}),modelCredentials:async()=>({baseUrl:'https://example.com/v1',model:'vision',contextWindow:65536,imageInput:disabled?'disabled':'auto'})};
  let rejected=false,calls=0;
  const chat=createChat(storage,async(_,options)=>{
   calls++;assert.ok(calls<6);
   const request=JSON.parse(options.body),state=JSON.parse(request.messages.at(-1).content);
   const hasImage=request.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));
   if(hasImage){assert.equal(disabled,false);assert.equal(rejected,false);rejected=true;return new Response(JSON.stringify({error:{message:'image input unsupported'}}),{status:400});}
   if(state.phase!=='route'&&!disabled)assert.equal(rejected,true);
   const action=state.phase==='route'?{action:'route',kind:'task'}:!state.steps.length?{action:'plan',goal:'核对图片',decisions:[],acceptance:['图片内容已核对'],steps:[{id:'review',title:'核对图片',status:'running'}]}:{action:'pause',text:'当前图像尚未核验，保留任务'};
   return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'a',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]}}]}));
  });
  const result=await chat.complete({id:'run',taskId:task.id,modelId:'vision',messages:task.messages});
  assert.equal(result.agentRun.status,'paused');assert.equal(calls,disabled?3:4);assert.equal(rejected,!disabled);
 }
});

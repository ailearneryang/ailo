const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createStorage}=require('../apps/desktop/storage.cjs');
const load=()=>import('../apps/desktop/workspace-load.mjs');
for(const request of ['', '   '])test('attachment-only persisted workspace loads without losing model configuration: '+JSON.stringify(request),async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-workspace-load-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const storage=createStorage(directory,{});
 await storage.patchTask('attachment',{request,materials:[{name:'design.png',path:'/fixture/design.png'}],messages:[{id:'u',role:'user',content:request}]});
 await storage.mutateWorkspace(state=>{state.models=[{id:'custom',name:'公司模型',model:'company-model',baseUrl:'https://example.com/v1'}];state.defaultModelId='custom';});
 const before=await fs.readFile(path.join(directory,'workspace.json'),'utf8');
 const state=await storage.readWorkspace();const {validateLoadedWorkspace}=await load();
 assert.doesNotThrow(()=>validateLoadedWorkspace(state));
 assert.equal(state.defaultModelId,'custom');assert.equal(state.models[0].model,'company-model');assert.equal(state.tasks[0].request,request);
 assert.equal(await fs.readFile(path.join(directory,'workspace.json'),'utf8'),before);
});
test('load validation retains ordinary records and rejects malformed records',async()=>{
 const {validateLoadedWorkspace}=await load();
 for(const tasks of [[],[{id:'text',request:'hello',materials:[]}]])assert.doesNotThrow(()=>validateLoadedWorkspace({tasks}));
 for(const state of [null,{}, {tasks:[null]},...[
  {id:'x',request:42,materials:[]},{id:'x',request:'',materials:[]},{id:'x',request:'text',materials:null},{id:'',request:'text',materials:[]}
 ].map(task=>({tasks:[task]}))])assert.throws(()=>validateLoadedWorkspace(state),/保存的数据格式不正确/);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createStorage}=require('../apps/desktop/storage.cjs');
test('project metadata persists and deletion is atomic, guarded, and leaves local files intact',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-project-management-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const folder=path.join(dir,'user-project');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'keep.txt'),'preserve');
 const state={projects:[{id:'p',name:'项目',localPath:folder,source:'local'},{id:'other',name:'其他项目'}],tasks:[{id:'t',title:'工作',request:'工作',materials:[],projectId:'p'},{id:'u',title:'其他工作',request:'其他',materials:[],projectId:'other'}],models:[],extensions:[]};
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify(state));
 const storage=createStorage(dir,{});await storage.saveWorkspace({...state,projects:state.projects.map(p=>p.id==='p'?{...p,name:'修改后的项目',description:'培训背景',pinned:true}:p)},true);
 let saved=await storage.readWorkspace();assert.equal(saved.projects[0].description,'培训背景');assert.equal(saved.projects[0].pinned,true);assert.equal(saved.projects[0].localPath,folder);
 await assert.rejects(storage.removeProject('p',()=>false),/正在执行或排队/);assert.equal((await storage.readWorkspace()).tasks.length,2);
 await storage.removeProject('p');saved=await storage.readWorkspace();assert.deepEqual(saved.projects.map(p=>p.id),['other']);assert.deepEqual(saved.tasks.map(t=>t.id),['u']);assert.equal(await fs.readFile(path.join(folder,'keep.txt'),'utf8'),'preserve');
 await assert.rejects(storage.patchTask('t',{request:'旧任务',materials:[],projectId:'p'}),/任务数据无效/);
});

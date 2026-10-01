const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createStorage}=require('../apps/desktop/storage.cjs');
const {createWorkspace,resolveFile}=require('../apps/desktop/agent/workspace.cjs');
const {workspaceFiles}=require('../apps/desktop/agent/workspace-path.cjs');
async function setup(t){const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ailo-local-project-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const folder=path.join(dir,'existing');await fs.mkdir(folder);const data=path.join(dir,'data');return {dir,folder,base:path.join(data,'agent'),storage:createStorage(data,{})};}
test('local project reuses selected folder, preserves existing files and deduplicates',async t=>{
 const {folder,base,storage}=await setup(t);await fs.writeFile(path.join(folder,'existing.txt'),'original');
 const p=await storage.addLocalProject(folder);assert.equal((await storage.addLocalProject(folder)).id,p.id);
 const w=await createWorkspace(base,{id:'task',projectId:p.id,messages:[]});assert.equal(w.files,folder);
 assert.equal(await fs.readFile(await resolveFile(w.files,'existing.txt'),'utf8'),'original');
 await fs.writeFile(await resolveFile(w.files,'output.txt',true),'new');assert.equal(await fs.readFile(path.join(folder,'output.txt'),'utf8'),'new');
 assert.deepEqual((await fs.readdir(folder)).sort(),['existing.txt','output.txt']);
 assert.equal((await storage.readWorkspace()).projects.length,1);
});
test('renderer cannot change local roots or register arbitrary paths',async t=>{
 const {folder,base,storage,dir}=await setup(t);const p=await storage.addLocalProject(folder);
 const state=await storage.readWorkspace();state.projects[0].localPath=dir;state.projects.push({id:'fake',name:'fake',localPath:dir});await storage.saveWorkspace(state);
 const saved=await storage.readWorkspace();assert.equal(saved.projects[0].localPath,folder);assert.equal(saved.projects[1].localPath,undefined);
 assert.equal(await workspaceFiles(base,{id:'a',projectId:p.id,localPath:dir}),folder);
 assert.notEqual(await workspaceFiles(base,{id:'b',projectId:'fake'}),dir);
});
test('missing local roots fail without recreating directories; unassigned sessions stay isolated',async t=>{
 const {folder,base,storage}=await setup(t);const p=await storage.addLocalProject(folder);await fs.rmdir(folder);
 await assert.rejects(createWorkspace(base,{id:'a',projectId:p.id,messages:[]}));await assert.rejects(fs.access(folder));
 const a=await createWorkspace(base,{id:'a',messages:[]}),b=await createWorkspace(base,{id:'b',messages:[]});assert.notEqual(a.files,b.files);
});

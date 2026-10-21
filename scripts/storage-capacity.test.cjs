const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createStorage}=require('../apps/desktop/storage.cjs');

test('history beyond the former workspace limit survives creation, replies, edits, settings and restart',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-storage-capacity-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const storage=createStorage(directory,{});
  const content='历史'.repeat(1_050_000);
  // Seed an existing workspace, as written by internal execution updates.
  await fs.writeFile(path.join(directory,'workspace.json'),JSON.stringify({tasks:[{
    id:'history',request:'历史问题',materials:[],messages:[{id:'h',role:'assistant',content}],
  }],projects:[],models:[]}));
  await storage.patchTask('new',{request:'新问题',materials:[]},[{id:'u',role:'user',content:'新问题'}]);
  await storage.patchTask('new',{},[{id:'a',role:'assistant',content:'新回答'}]);
  await storage.editLastMessage('new','u','修改后的问题');
  await storage.mutateWorkspace(state=>{state.tasks.find(t=>t.id==='new').lastError='可重试';});
  await storage.saveWorkspace(await storage.readWorkspace(),true);
  await storage.saveWorkspace(await storage.readWorkspace());
  const restored=await createStorage(directory,{}).readWorkspace();
  assert.equal(restored.tasks.find(t=>t.id==='history').messages[0].content,content);
  const task=restored.tasks.find(t=>t.id==='new');
  assert.equal(task.request,'修改后的问题');
  assert.equal(task.lastError,'可重试');
  const backup=JSON.parse(await fs.readFile(path.join(directory,'message-edits',task.messages[0].id+'.json'),'utf8'));
  assert.equal(backup.messages[1].content,'新回答');
  await assert.rejects(storage.patchTask('invalid',{request:'缺少附件数组'}),/任务数据无效/);
});

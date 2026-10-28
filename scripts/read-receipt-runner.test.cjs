const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {runAgent}=require('../apps/desktop/agent/runner.cjs'),{execute}=require('../apps/desktop/agent/tools.cjs'),{createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
test('runner repeat guards retain exact archive references after recent results are evicted and the execution reloads',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-read-runner-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'durable-read',request:'读取源文件并保留分页'},model={contextWindow:1048576},signal=new AbortController().signal,w=await createWorkspace(base,task),text='原始文本'.repeat(500);
 await fs.writeFile(path.join(w.files,'source.txt'),text);let n=0,reads=0;
 await runAgent({base,task,model,signal,executeTool:async(...args)=>{reads++;return execute(...args);},ask:async()=>({content:JSON.stringify(++n===1?{action:'route',kind:'chat'}:n<4?{action:'read_file',path:'source.txt',offset:0,limit:100}:{action:'pause',text:'保存当前分页'})})});
 assert.equal(reads,2);const saved=await createWorkspace(base,task);assert.equal(saved.run.readReceipts.entries.length,1);const receipt=saved.run.readReceipts.entries[0];assert.equal(receipt.next,100);assert.equal(receipt.total,text.length);
 saved.run.observations=[];await saved.save();let second=0;
 await runAgent({base,task,model,signal,executeTool:async()=>assert.fail('the repeated read must not execute'),ask:async messages=>{
  const snapshot=JSON.parse(messages.at(-1).content);second++;
  if(second===1)return {content:'{"action":"route","kind":"chat"}'};
  if(second===2)return {content:'{"action":"batch_read","items":[{"action":"read_file","path":"source.txt","offset":0,"limit":100}]}'};
  const parent=snapshot.toolResults.findLast(row=>row.result?.results),result=parent.result.results[0].result;
  assert.equal(result.notExecuted,true);assert.equal(result.sourceObservationId,receipt.sourceObservationId);assert.equal(result.next,100);
  const current=await createWorkspace(base,task),record=await current.observationRecord(result.sourceObservationId,{archiveOnly:true});assert.equal(record.response.result.text,text.slice(0,100));assert.equal(current.run.readAttempts[0][1],2);
  return {content:'{"action":"pause","text":"按引用继续下一页"}'};
 }});
 assert.equal(second,3);assert.equal(reads,2);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createPersonalMemory}=require('../apps/desktop/personal-memory.cjs');
const {allowedActions,actionTools}=require('../apps/desktop/agent/protocol.cjs');
test('memory is an actual agent tool; saved facts are visible next decision and across sessions',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-memory-agent-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const task={id:'chat',memoryOwner:'local',title:'记住偏好',request:'请记住：周报先讲风险，再讲进展',materials:[],messages:[{id:'u1',role:'user',content:'请记住：周报先讲风险，再讲进展',createdAt:new Date().toISOString()}]},store=createPersonalMemory({directory:dir,account:async()=>null,workspace:async()=>({tasks:[task],projects:[]})});let calls=0;
 const memory=await store.scope({task,owner:'local'});
 const result=await runAgent({base:path.join(dir,'agent'),task,memory,model:{id:'m'},signal:new AbortController().signal,ask:async messages=>{const state=JSON.parse(messages.at(-1).content);calls++;if(state.phase==='route')return {content:JSON.stringify({action:'route',kind:'chat'})};if(calls===2){assert.ok(allowedActions(state).includes('memory'));assert.ok(actionTools(state).some(t=>t.function.name==='memory'));return {content:JSON.stringify({action:'memory',operation:'save',data:{topic:'周报偏好',content:'周报先讲风险，再讲进展',type:'preference',scope:'personal',quote:'周报先讲风险，再讲进展'}})};}assert.equal(state.personalMemory.entries[0].content,'周报先讲风险，再讲进展');return {content:JSON.stringify({action:'reply',text:'已记住周报偏好。'})};}});
 assert.equal(result.content,'已记住周报偏好。');assert.equal(result.agentRun.memoryUsed.entries.length,1);assert.equal(result.agentRun.memoryUsed.inputId,'u1');assert.equal(result.agentRun.memoryUsed.entries[0].source.quote,undefined);
 const next={...task,id:'next',messages:[{id:'u2',role:'user',content:'帮我写周报'}]};const scoped=await store.scope({task:next,owner:'local'});assert.equal((await scoped.context('周报')).entries.length,1);
 next.memoryEnabled=false;assert.equal((await scoped.context('周报')).entries.length,0);
});
test('ordinary providers do not receive unavailable memory tools',()=>{assert.equal(allowedActions({phase:'chat'}).includes('memory'),false);assert.ok(allowedActions({phase:'chat',memoryAvailable:true}).includes('memory'));});

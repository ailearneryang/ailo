const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {runAgent,publicRun}=require('../apps/desktop/agent/runner.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {beginRound}=require('../apps/desktop/agent/execution-rounds.cjs');
const steps=[{id:'build',title:'开发',status:'done'}];
function completed(){return {executionId:'old',inputKey:'u1',mode:'task',status:'completed',goal:'开发应用',steps:structuredClone(steps),decisions:['Kotlin'],acceptance:['测试通过'],artifacts:[],events:[],revision:2,observations:[],workingMemory:'已实现天气应用，尚未运行模拟器'};}
test('new follow-up archives once, retry resumes, and chat preserves previous delivery across restart',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-rounds-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'t',projectId:'p',request:'开发应用',messages:[{id:'u1',role:'user',content:'开发应用'},{id:'a1',role:'assistant',content:'已交付'},{id:'u2',role:'user',content:'解释一下结构'}]};
 const w=await createWorkspace(base,task);Object.assign(w.run,completed());await w.save();
 const execute=async(kind,action)=>runAgent({base,task,model:{contextWindow:32768},signal:new AbortController().signal,ask:async messages=>{const s=JSON.parse(messages.at(-1).content);if(s.phase==='route')return {content:JSON.stringify({action:'route',kind})};assert.equal(s.currentRequest,task.messages.at(-1).content);assert.equal(s.previousExecutions[0].goal,'开发应用');return {content:JSON.stringify(action)};}});
 let result=await execute('chat',{action:'reply',text:'这是 Kotlin 工程'});
 assert.equal(result.agentRun.history.length,1);assert.equal(result.agentRun.history[0].afterMessageId,'a1');assert.equal(result.agentRun.history[0].steps[0].status,'done');assert.equal(result.agentRun.mode,'chat');assert.equal(result.agentRun.steps.length,0);
 task.messages.push({id:'a2',role:'assistant',content:result.content},{id:'u3',role:'user',content:'在模拟器启动'});
 result=await execute('task',{action:'pause',text:'准备检查模拟器'});
 assert.equal(result.agentRun.history.length,1);const id=result.agentRun.executionId;
 result=await execute('task',{action:'blocked',text:'缺少模拟器'});assert.equal(result.agentRun.executionId,id);assert.equal(result.agentRun.history.length,1);
 const reloaded=await createWorkspace(base,task);assert.equal(reloaded.run.history[0].executionId,'old');assert.match(reloaded.run.workingMemory,/天气应用/);
});
test('legacy completed run archives on new input, but paused work keeps its plan',()=>{
 const task={messages:[{id:'a',role:'assistant',content:'交付'},{id:'new',role:'user',content:'启动'}]};
 const run=completed();delete run.inputKey;beginRound(run,task,publicRun);assert.equal(run.history.length,1);assert.equal(run.history[0].afterMessageId,'a');assert.deepEqual(run.steps,[]);
 const paused={...completed(),status:'paused'};beginRound(paused,task,publicRun);assert.equal(paused.history.length,0);assert.equal(paused.steps.length,1);
});
test('finish cannot silently convert blocked steps to done despite valid files and command evidence',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-finish-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'t',projectId:'p',request:'构建',messages:[{id:'u',role:'user',content:'构建'}]};let n=0;
 const result=await runAgent({base,task,model:{contextWindow:32768},signal:new AbortController().signal,executeTool:async()=>({exitCode:0,output:'checks passed'}),ask:async messages=>{
 const s=JSON.parse(messages.at(-1).content);let action;
 if(n++===0)action={action:'route',kind:'task'};
 else if(n===2)action={action:'plan',goal:'构建',decisions:[],acceptance:['APK 构建成功'],steps:[{id:'apk',title:'Gradle 构建',status:'blocked'}]};
 else if(n===3){const w=await createWorkspace(base,task);await fs.writeFile(path.join(w.files,'README.md'),'尚未构建 APK');action={action:'artifact',path:'README.md',label:'说明'};}
 else if(n===4)action={action:'run_command',command:'true',purpose:'检查说明文件'};
 else if(n===5)action={action:'finish',text:'完成',evidence:[s.recentEvents.find(e=>e.type==='run_command').id]};
 else {assert.match(s.toolResults.at(-1).error,/尚未全部验收/);action={action:'blocked',text:'APK 构建受阻'};}
 return {content:JSON.stringify(action)};
 }});assert.equal(result.agentRun.status,'blocked');assert.equal(result.agentRun.steps[0].status,'blocked');
});

test('ordinary chat preserves paused task anchor and actual blocked status',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-chat-anchor-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'t',projectId:'p',request:'开发应用',messages:[{id:'u1',role:'user',content:'开发应用'},{id:'a1',role:'assistant',content:'受阻'},{id:'u2',role:'user',content:'为什么没有发现错误？'}]};
 const w=await createWorkspace(base,task);Object.assign(w.run,completed(),{status:'blocked',progressInputId:'u1'});await w.save();
 const result=await runAgent({base,task,model:{contextWindow:32768},signal:new AbortController().signal,ask:async messages=>({content:JSON.stringify(JSON.parse(messages.at(-1).content).phase==='route'?{action:'route',kind:'chat'}:{action:'reply',text:'解释原因'})})});
 assert.equal(result.agentRun.progressInputId,'u1');assert.equal(result.agentRun.status,'blocked');assert.equal(result.agentRun.steps.length,1);
 const saved=await createWorkspace(base,task);assert.equal(saved.run.progressInputId,'u1');
});

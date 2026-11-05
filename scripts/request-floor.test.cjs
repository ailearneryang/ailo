// Request-count brake. These scenarios use the most cooperative model possible
// so the counts measure the runtime's own ceremony, not model quality. Lowering
// a bound is an improvement; raising one needs an explicit incident.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const requirements=require('../apps/desktop/agent/requirements.cjs');
const FLOOR={chatTurn:1,singleFileDelivery:3,standaloneCeremony:6};
const reply=action=>({content:JSON.stringify(action)});
async function setup(t,request){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-floor-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'t',projectId:'p',request,messages:[{role:'user',content:request}]};
 const w=await createWorkspace(base,task);return {base,task,w};
}
test('a plain greeting costs one model request and no separate route call',async t=>{
 const {base,task}=await setup(t,'你好');
 const phases=[];
 const result=await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);phases.push(s.phase);
  return reply({action:'reply',text:'你好，我是 Ailo。'});
 }});
 assert.deepEqual(phases,['route']);
 assert.equal(result.content,'你好，我是 Ailo。');
 assert.equal(result.agentRun.currentIntent,'chat');
 assert.equal(result.agentRun.performance.modelRequests,FLOOR.chatTurn);
 assert.equal(result.agentRun.performance.processModelRequests,0,'直接回答不增加流程请求');
 const saved=await createWorkspace(base,task);
 assert.ok(saved.run.events.some(e=>e.type==='intent'&&e.detail.kind==='chat'&&e.detail.basis==='direct_reply'));
});
test('a direct reply cannot be used to skip delivery work',async t=>{
 const {base,task}=await setup(t,'写一个 lesson.md');
 let n=0;
 const result=await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,ask:async()=>{
  n++;
  if(n===1)return reply({action:'route',kind:'task'});
  if(n===2)return reply({action:'reply',text:'# lesson\n这是内容'});
  return reply({action:'pause',text:'停止'});
 }});
 assert.equal(result.agentRun.status,'paused');
 await assert.rejects(fs.stat(path.join((await createWorkspace(base,task)).files,'lesson.md')));
});
test('single-file delivery with standalone artifact/verify/finish actions stays within the ceremony bound',async t=>{
 const {base,task,w}=await setup(t,'写一个 lesson.md，内容是一段关于注意力机制的简短介绍');
 const sequence=[];let n=0;
 const result=await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);n++;
  const criteria=s.acceptanceCriteria||[];
  let action;
  if(n===1)action={action:'route',kind:'task'};
  else if(n===2)action={action:'plan',goal:'生成 lesson.md',decisions:['使用 Markdown'],requirements:[{id:'r1',text:'lesson.md 存在且包含注意力机制介绍',type:'content'}],steps:[{id:'write',title:'写入 lesson.md',status:'running'},{id:'check',title:'核对内容',status:'pending'}]};
  else if(n===3)action={action:'write_file',path:'lesson.md',content:'# 注意力机制\n\n注意力机制让模型按相关性加权输入。\n',progress:{steps:[{id:'write',status:'done'},{id:'check',status:'running'}],memory:'已写入 lesson.md，包含注意力机制一句话介绍，下一步核对并登记成果。'}};
  else if(!s.artifacts?.length)action={action:'artifact',path:'lesson.md',label:'课程文档'};
  else if(criteria.some(c=>c.check?.status!=='passed'))action={action:'verify',checks:criteria.map(c=>({criterionId:c.id,kind:'text_contains',path:'lesson.md',contains:['注意力机制'],reason:'lesson.md 存在且文本包含注意力机制介绍，覆盖该要求'}))};
  else action={action:'finish',text:'已生成 lesson.md',outcome:'complete',review:{summary:'已生成并核对 lesson.md',issues:[],unverified:[]},progress:{steps:[{id:'check',status:'done'}]}};
  if(n>FLOOR.standaloneCeremony+4)action={action:'pause',text:'超出预算'};
  sequence.push(action.action);return reply(action);
 }});
 assert.equal(result.agentRun.status,'completed',sequence.join('>'));
 assert.equal(await fs.readFile(path.join(w.files,'lesson.md'),'utf8'),'# 注意力机制\n\n注意力机制让模型按相关性加权输入。\n');
 assert.ok(sequence.length<=FLOOR.standaloneCeremony,`单文件交付需要 ${sequence.length} 次请求：${sequence.join('>')}`);
 assert.equal(result.agentRun.performance.modelRequests,sequence.length);
 const saved=await createWorkspace(base,task);
 assert.ok(!saved.run.events.some(e=>['tool_error','protocol_error','loop_recovery'].includes(e.type)),saved.run.events.map(e=>e.type).join('|'));
});
test('single-file delivery with attached artifact and checks completes within the request floor',async t=>{
 const {base,task,w}=await setup(t,'写一个 lesson.md，内容是一段关于注意力机制的简短介绍');
 const sequence=[];let n=0;
 const result=await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);n++;
  let action;
  if(n===1)action={action:'route',kind:'task'};
  else if(n===2){
   assert.ok(s.toolResults.length===0);
   action={action:'plan',goal:'生成 lesson.md',decisions:['使用 Markdown'],requirements:[{id:'r1',text:'lesson.md 存在且包含注意力机制介绍',type:'content'}],steps:[{id:'write',title:'写入并核对 lesson.md',status:'running'}]};
  } else if(n===3){
   assert.deepEqual(s.acceptanceCriteria.map(c=>c.id),['r1']);
   action={action:'write_file',path:'lesson.md',content:'# 注意力机制\n\n注意力机制让模型按相关性加权输入。\n',artifact:{label:'课程文档'},checks:[{criterionId:'r1',kind:'text_contains',path:'lesson.md',contains:['注意力机制'],reason:'lesson.md 存在且文本包含注意力机制介绍，覆盖该要求'}],progress:{steps:[{id:'write',status:'done'}],memory:'已写入 lesson.md 并附带登记与核验，等待运行时按证据收尾。'}};
  } else action={action:'pause',text:'超出预算'};
  sequence.push(action.action);return reply(action);
 }});
 assert.deepEqual(sequence,['route','plan','write_file']);
 assert.equal(result.agentRun.status,'completed',JSON.stringify(result.agentRun.delivery));
 assert.equal(result.agentRun.performance.modelRequests,FLOOR.singleFileDelivery);
 assert.ok(result.agentRun.performance.processModelRequests/result.agentRun.performance.modelRequests<=2/3,'单文件精简路径流程请求占比不得超过 route + plan 的 2/3');
 assert.equal(await fs.readFile(path.join(w.files,'lesson.md'),'utf8'),'# 注意力机制\n\n注意力机制让模型按相关性加权输入。\n');
 const saved=await createWorkspace(base,task);
 assert.deepEqual(saved.run.artifacts.map(a=>[a.path,a.label]),[['lesson.md','课程文档']]);
 assert.equal(saved.run.acceptanceResults?.r1?.status??saved.run.requirements.find(r=>r.id==='r1')?.check?.status,'passed');
 const types=saved.run.events.map(e=>e.type);
 assert.ok(types.includes('acceptance_verified')&&types.at(-1)==='finish',types.join('|'));
 assert.equal(saved.run.events.at(-1).detail.origin,'runtime_evidence');
 assert.ok(!types.some(t=>['tool_error','protocol_error','loop_recovery'].includes(t)),types.join('|'));
});
test('a failed attached check keeps the write, records the failure and does not complete',async t=>{
 const {base,task,w}=await setup(t,'写一个 lesson.md');
 let n=0,seen;
 const result=await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,ask:async messages=>{
  n++;
  if(n===1)return reply({action:'route',kind:'task'});
  if(n===2)return reply({action:'plan',goal:'生成 lesson.md',decisions:[],requirements:[{id:'r1',text:'lesson.md 包含注意力机制介绍',type:'content'}],steps:[{id:'write',title:'写入',status:'running'}]});
  if(n===3)return reply({action:'write_file',path:'lesson.md',content:'# 空白\n',artifact:{label:'课程文档'},checks:[{criterionId:'r1',kind:'text_contains',path:'lesson.md',contains:['注意力机制'],reason:'核对文本是否包含注意力机制介绍'}],progress:{steps:[{id:'write',status:'done'}],memory:'已写入 lesson.md，附带核验结果待运行时确认。'}});
  seen=JSON.parse(messages.at(-1).content);
  return reply({action:'pause',text:'停止'});
 }});
 assert.equal(n,4);
 assert.equal(seen.executionState?.blocker?.code,'ACCEPTANCE_FAILED');
 assert.equal(seen.executionState?.blocker?.action,'verify');
 assert.equal(result.agentRun.status,'paused');
 assert.equal(await fs.readFile(path.join(w.files,'lesson.md'),'utf8'),'# 空白\n');
 const saved=await createWorkspace(base,task);
 assert.equal(saved.run.artifacts.length,1);
 assert.equal(saved.run.performance.validationFailures,1);
 assert.ok(saved.run.events.some(e=>e.type==='tool_error'&&e.detail.action==='verify'&&e.detail.attachedTo==='write_file'));
 assert.ok(saved.run.events.some(e=>e.type==='write_file'));
});
test('an invalid attachment rejects the write before any side effect',async t=>{
 const {base,task,w}=await setup(t,'写一个 lesson.md');
 let n=0;
 await runAgent({base,task,model:{contextWindow:65536},signal:new AbortController().signal,ask:async()=>{
  n++;
  if(n===1)return reply({action:'route',kind:'task'});
  if(n===2)return reply({action:'plan',goal:'生成 lesson.md',decisions:[],requirements:[{id:'r1',text:'lesson.md 包含注意力机制介绍',type:'content'}],steps:[{id:'write',title:'写入',status:'running'}]});
  if(n===3)return reply({action:'write_file',path:'lesson.md',content:'# x\n',checks:[{criterionId:'nope',kind:'text_contains',path:'lesson.md',contains:['x'],reason:'错误的要求 ID 不能通过'}]});
  if(n===4)return reply({action:'write_file',path:'lesson.md',content:'# x\n',artifact:{label:''}});
  return reply({action:'pause',text:'停止'});
 }});
 await assert.rejects(fs.stat(path.join(w.files,'lesson.md')));
 const saved=await createWorkspace(base,task);
 assert.equal(saved.run.artifacts.length,0);
});
test('a requirement without an id is rejected instead of producing an unverifiable criterion',()=>{
 const run={inputKey:'k',steps:[],events:[]};
 assert.throws(()=>requirements.update(run,{action:'plan',requirements:[{text:'文件存在',type:'content'}]}),/唯一稳定 ID/);
 assert.throws(()=>requirements.update(run,{action:'plan',requirements:[{id:'undefined',text:'文件存在',type:'content'},{id:undefined,text:'另一条',type:'content'}]}),/唯一稳定 ID/);
 assert.equal(requirements.update(run,{action:'plan',requirements:[{id:'r1',text:'文件存在',type:'content'}]}).requirements[0].id,'r1');
});

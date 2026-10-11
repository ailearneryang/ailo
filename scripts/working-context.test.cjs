const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const {decodeAction}=require('../apps/desktop/agent/protocol.cjs');
test('requested limits determine actual file, archive and execution pages',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-page-limits-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const w=await createWorkspace(base,{id:'limits',projectId:'p',request:'读取指定范围'}),signal=new AbortController().signal;
 await fs.writeFile(path.join(w.files,'source.py'),'0123456789'.repeat(1500));
 const read=async action=>execute(w,decodeAction({content:JSON.stringify(action)}),signal);
 const a=await read({action:'read_file',path:'source.py',offset:'0',limit:'100'}),b=await read({action:'read_file',path:'source.py',offset:100,limit:3000});
 assert.equal(a.text.length,100);assert.equal(a.next,100);assert.equal(b.text.length,3000);assert.equal(b.next,3100);
 const id=await w.archiveObservation({action:'read_file',path:'source.py'},{result:{text:'archive'.repeat(1500)}});
 const page=await read({action:'read_execution',id,offset:'0',limit:'100'});assert.equal(page.text.length,100);assert.equal(page.next,100);
 await w.event('plan',{goal:'分页记录'.repeat(500)});
 const log=await read({action:'read_execution',offset:0,limit:100});assert.equal(log.text.length,100);assert.equal(log.next,100);
 await assert.rejects(execute(w,{action:'read_file',path:'source.py',limit:0},signal),/读取长度/);await assert.rejects(w.observation(id,0,12001),/读取长度/);
});
test('effective read identity ignores irrelevant fields and correction survives checkpoint',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-read-recovery-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'recovery',projectId:'p',request:'按范围分析'},w=await createWorkspace(base,task);await fs.writeFile(path.join(w.files,'a.py'),'a'.repeat(15000));
 const actions=[{action:'route',kind:'chat'},{action:'read_file',path:'a.py',id:'ignored-a',offset:0,limit:3000},{action:'read_file',path:'./a.py',id:'ignored-b',offset:'0',limit:'3000'},{action:'read_file',path:'a.py',offset:0,limit:3000},{action:'checkpoint',text:'已读取相同源码开头两次，应使用归档原文并继续下一范围，不再从头重读。'},{action:'read_file',path:'a.py',offset:3000,limit:3000},{action:'pause',text:'正常继续分页'}];
 let n=0,reads=0,sourceId;
 const result=await runAgent({base,task,model:{contextWindow:1048576},signal:new AbortController().signal,executeTool:async(...args)=>{reads++;return execute(...args);},ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(n===4){assert.equal(s.toolResults.at(-1).notExecuted,true);assert.equal(s.readRecovery.next,3000);sourceId=s.readRecovery.sourceObservationId;assert.notEqual(sourceId,s.toolResults.at(-1).observationId);}
  if(n===5){assert.equal(s.toolResults.length,0);assert.equal(s.readRecovery.next,3000);assert.equal(s.readRecovery.sourceObservationId,sourceId);}
  return {content:JSON.stringify(actions[n++])};
 }});
 assert.equal(result.content,'正常继续分页');assert.equal(reads,3);assert.ok(!result.agentRun.events.some(e=>e.type==='no_progress'));
 const saved=await createWorkspace(base,task);assert.match((await saved.observation(sourceId)).text,/"text":"aaa/);
});
test('a command changing file content permits reread, while identical bytes remain guarded',async t=>{
 for(const change of [true,false]) {
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-read-version-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const task={id:'version',projectId:'p',request:'修改后检查文件'},w=await createWorkspace(base,task),file=path.join(w.files,'a.py');await fs.writeFile(file,'before');
  const read={action:'read_file',path:'a.py',offset:0};
  const plan={action:'plan',goal:'修改并验证',decisions:['保留内容证据'],acceptance:['正确读取'],steps:[{id:'check',title:'修改并验证',status:'running'}]};
  const actions=[{action:'route',kind:'task'},plan,read,read,{action:'run_command',command:'modify fixture',purpose:'修改源码'},read,read,{action:'pause',text:'修改后继续'}];let n=0;
  const result=await runAgent({base,task,model:{contextWindow:1048576},signal:new AbortController().signal,executeTool:async(...args)=>{
   if(args[1].action==='run_command'){await fs.writeFile(file,change?'after!':'before');return {exitCode:0,output:'verified fixture command'};}return execute(...args);
  },ask:async()=>({content:JSON.stringify(actions[n++])})});
  if(change){assert.equal(result.content,'修改后继续');assert.ok(!result.agentRun.events.some(e=>e.type==='repeat_warning'||e.type==='no_progress'));}
  else {assert.match(result.content,/read_file.*a.py.*位置 0/);assert.equal(result.agentRun.events.at(-1).type,'no_progress');}
 }
});
test('missing file failures never claim successful repeated reads',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-failed-read-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'missing',projectId:'p',request:'读取文件'};let n=0;
 await assert.rejects(runAgent({base,task,model:{contextWindow:1048576},signal:new AbortController().signal,ask:async()=>({content:JSON.stringify(n++?{action:'read_file',path:'missing.txt'}:{action:'route',kind:'chat'})})}),/相同动作多次失败/);
 const w=await createWorkspace(base,task);assert.equal(w.run.events.filter(e=>e.type==='tool_error').length,3);assert.ok(!w.run.events.some(e=>e.type==='repeat_warning'));
});
test('external record rereads receive correction before pausing and history honors its limit',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-record-repeat-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'records',projectId:'p',request:'回查记录',messages:[{role:'user',content:'回查记录'.repeat(100)}]},w=await createWorkspace(base,task),id=await w.archiveObservation({action:'run_command'},{result:{output:'archived output'.repeat(100)}});
 let n=0;
 const actions=[{action:'route',kind:'chat'},{action:'read_history',offset:0,limit:'100'},{action:'read_execution',id,offset:0,limit:100},{action:'checkpoint',text:'保存已有结论和来源，继续核对记录的后续内容，不能重放已执行工具。'},{action:'read_execution',id,offset:'0',limit:'100'},{action:'read_execution',id,offset:0,limit:100},{action:'read_execution',id,offset:0,limit:100}];
 const result=await runAgent({base,task,model:{contextWindow:1048576},signal:new AbortController().signal,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(n===2){assert.equal(s.toolResults.at(-1).result.text.length,100);assert.equal(s.toolResults.at(-1).result.next,100);}
  if(n===6){assert.equal(s.toolResults.at(-1).notExecuted,true);assert.equal(s.readRecovery.next,100);assert.equal(s.readRecovery.action,'read_execution');}
  return {content:JSON.stringify(actions[n++])};
 }});
 assert.match(result.content,/read_execution/);assert.equal(result.agentRun.events.filter(e=>e.type==='read_execution').length,2);assert.equal(result.agentRun.events.filter(e=>e.type==='repeat_warning').length,1);
});
test('string offsets page files and external records without gaps and persist visible read coverage',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-string-pages-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'pages',projectId:'p',request:'分析文件'},model={contextWindow:1048576};
 let w=await createWorkspace(base,task);
 const text='file-contents:'+'abcdef'.repeat(2100);await fs.writeFile(path.join(w.files,'render.py'),text);
 const id=await w.archiveObservation({action:'run_command',command:'test'},{result:{output:'original-output:'+'uvwxyz'.repeat(1400)}});
 const raw=(await w.observation(id)).text;
 // A short final tool page must still explicitly report EOF.
 assert.equal((await execute(w,{action:'read_file',path:'render.py',offset:text.length-5},new AbortController().signal)).next,null);
 const collected={file:'',archive:''};let stage='route',offset=0;
 await runAgent({base,task,model,signal:new AbortController().signal,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(stage==='route'){stage='file';return {content:'{"action":"route","kind":"chat"}'};}
  if(s.toolResults.length&&['file','archive'].includes(stage)) {
   const page=s.toolResults.at(-1).result;
   assert.equal(page.offset,offset);collected[stage]+=page.text;
   if(page.next===null){stage=stage==='file'?'archive':'summary';offset=0;}else {assert.equal(page.next,offset+page.text.length);offset=page.next;}
  }
  if(stage==='file')return {content:JSON.stringify({action:'read_file',path:'render.py',offset:String(offset)})};
  if(stage==='archive')return {toolCalls:[{function:{name:'read_execution',arguments:JSON.stringify({id,offset:String(offset)})}}]};
  if(stage==='summary'){stage='done';return {content:JSON.stringify({action:'checkpoint',text:'已连续分页读取完整源码和归档记录，保留文件哈希及读取范围，下一步分析并验证。'})};}
  assert.equal(s.toolResults.length,0);assert.equal(s.readCoverage.at(-1).next,null);return {content:'{"action":"pause","text":"保存进度"}'};
 },executeTool:execute});
 assert.equal(collected.file,text);assert.equal(collected.archive,raw);
 w=await createWorkspace(base,task);assert.ok(w.run.readCoverage.length>=3);
 const reads=w.run.readCoverage.filter(r=>r.path==='render.py');assert.equal(reads[0].offset,0);assert.equal(reads.at(-1).end,text.length);assert.equal(reads.at(-1).next,null);assert.match(reads[0].sha256,/^[a-f0-9]{64}$/);
 assert.ok(!w.run.events.some(e=>['tool_error','protocol_error','repeat_warning'].includes(e.type)));
});
test('repeat correction groups numeric and string offsets and returns only the same file coverage',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-repeat-pages-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'repeat',projectId:'p',request:'分析源码'},w=await createWorkspace(base,task);
 for(const file of ['a.py','b.py'])await fs.writeFile(path.join(w.files,file),file.repeat(1800));
 let n=0,reads=0;
 const actions=[{action:'route',kind:'chat'},{action:'read_file',path:'a.py',offset:0},{action:'read_file',path:'b.py',offset:0},{action:'read_file',path:'a.py',offset:'0'},{action:'read_file',path:'a.py',offset:0}];
 await runAgent({base,task,model:{contextWindow:1048576},signal:new AbortController().signal,executeTool:async(...args)=>{reads++;return execute(...args);},ask:async messages=>{
  if(n<actions.length)return {content:JSON.stringify(actions[n++])};
  const warning=JSON.parse(messages.at(-1).content).toolResults.at(-1);assert.equal(warning.notExecuted,true);assert.ok(warning.coverage.length>0);assert.ok(warning.coverage.every(r=>r.path==='a.py'));assert.equal(warning.coverage[0].next,3000);
  return {content:'{"action":"pause","text":"按 next 继续"}'};
 }});
 assert.equal(reads,3);assert.equal((await createWorkspace(base,task)).run.events.filter(e=>e.type==='repeat_warning').length,1);
});
test('legacy history is externalized, paginated and recoverable through checkpoint and restart without replay',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-working-memory-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'working',projectId:'p',request:'保留中文约束，不重复写文件',messages:[{id:'u',role:'user',content:'保留中文约束，不重复写文件'}]},model={id:'m',contextWindow:1048576,maxOutputTokens:131072};
 let w=await createWorkspace(base,task);
 w.run.status='paused';w.run.workingMemory='之前已完成写入，必须保留中文约束。';w.run.readCoverage=Array.from({length:40},(_,i)=>({id:'material',offset:i*100,end:(i+1)*100,next:(i+1)*100}));
 w.run.observations=Array.from({length:20},(_,i)=>({action:{action:'write_file',path:`part${i}.txt`},response:{eventId:'event-'+i,result:{text:`payload-${i}:`+'数据'.repeat(12000)}}}));await w.save();
 const totals=[];let n=0,oldId,readonlyCalls=0;
 const summary='已保存中文约束、完成的写入和二十条执行凭据，原文已归档，下一步按需回查并继续验收。';
 await runAgent({base,task,model,signal:new AbortController().signal,executeTool:async(...args)=>{readonlyCalls++;assert.equal(args[1].action,'read_execution');return execute(...args);},ask:async(messages,budget)=>{
  const s=JSON.parse(messages.at(-1).content);totals.push(Buffer.byteLength(JSON.stringify(messages)));
  assert.equal(messages.length,2);assert.ok(s.toolResults.length<=3);assert.equal(s.currentRequest,task.request);assert.ok(s.readCoverage.length<=24);assert.equal(s.readCoverageTotal,40);
  if(n++===0){assert.equal(budget,4096);assert.ok(!JSON.stringify(messages).includes('payload-0:'));return {content:JSON.stringify({action:'route',kind:'task'})};}
  if(n===2){assert.equal(s.requiredAction,'checkpoint');return {content:JSON.stringify({action:'read_execution',id:'observations',offset:0})};}
  if(n===3){oldId=JSON.parse(s.toolResults.at(-1).result.text.split('\n')[0]).id;return {content:JSON.stringify({action:'read_execution',id:oldId,offset:0})};}
  if(n===4){assert.match(s.toolResults.at(-1).result.text,/payload-0:/);assert.equal(budget,8192);return {content:JSON.stringify({action:'checkpoint',text:summary})};}
  assert.equal(s.workingMemory,summary);assert.equal(s.toolResults.length,0);return {content:JSON.stringify({action:'pause',text:'等待继续'})};
 }});
 assert.equal(readonlyCalls,2);assert.ok(Math.max(...totals)<100000);w=await createWorkspace(base,task);assert.equal(w.run.workingMemory,summary);assert.equal(w.run.readCoverage.length,40);
 let offset=0,raw='';do{const page=await w.observation(oldId,offset);raw+=page.text;offset=page.next;}while(offset!==null);
 assert.equal(JSON.parse(raw).response.result.text,'payload-0:'+'数据'.repeat(12000));
 const other=await createWorkspace(base,{...task,id:'other'});await assert.rejects(other.observation(oldId),{code:'ENOENT'});await assert.rejects(w.observation('../escape'),/ID 无效/);
 let stage=0;await runAgent({base,task,model,signal:new AbortController().signal,ask:async messages=>{const s=JSON.parse(messages.at(-1).content);assert.equal(s.workingMemory,summary);return {content:JSON.stringify(stage++?{action:'pause',text:'保留进度'}:{action:'route',kind:'task'})};},executeTool:()=>assert.fail('no writes on resume')});
});

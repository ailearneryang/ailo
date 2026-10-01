const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createWorkspace,resolveFile}=require('../apps/desktop/agent/workspace.cjs');
const {runCommand}=require('../apps/desktop/agent/tools.cjs');
const model={contextWindow:32768};
const task={id:'t',projectId:'p',messages:[{role:'user',content:'制作交付文件',materials:[{name:'requirements.md',text:'必须包含晴天'}]}]};
const plan={action:'plan',goal:'制作交付文件',decisions:['包含晴天'],acceptance:['文件存在且包含晴天'],steps:[{id:'make',title:'制作与验证',status:'pending'}]};
async function setup(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-agent-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return base;}
function options(base,ask,rest={}){let first=true;return {base,task,model,signal:new AbortController().signal,ask:async (...args)=>{if(first){first=false;return {content:JSON.stringify({action:'route',kind:rest.intent||'task'})};}return ask(...args);}, ...rest};}
test('ordinary conversation needs no plan and runs no tools',async t=>{
 const base=await setup(t);const result=await runAgent(options(base,async()=>({content:JSON.stringify({action:'reply',text:'你好'})}),{intent:'chat',executeTool:()=>assert.fail('no tools')}));
 assert.equal(result.content,'你好');assert.equal(result.agentRun.mode,'chat');
});
test('full task writes actual file, registers artifact, checks evidence, and persists completion',async t=>{
 const base=await setup(t);let call=0;
 const result=await runAgent(options(base,async messages=>{
  const snapshot=JSON.parse(messages.at(-1).content);
  const actions=[plan,{action:'write_file',path:'weather.txt',content:'晴天'},{action:'run_command',command:'test -f weather.txt',purpose:'文件检查'},{action:'artifact',path:'weather.txt',label:'天气说明'},{...plan,steps:plan.steps.map(s=>({...s,status:'done'}))}];
  if(call===4)assert.equal(snapshot.recentEvents.find(e=>e.type==='run_command').detail.result.exitCode,0,JSON.stringify(snapshot.recentEvents));
  const action=actions[call++]||{action:'finish',text:'已生成天气说明并检查文件',evidence:[snapshot.recentEvents.find(e=>e.type==='run_command').id]};
  return {content:JSON.stringify(action)};
 }),);
 assert.equal(result.agentRun.status,'completed');
 const workspace=await createWorkspace(base,task);assert.equal(await fs.readFile(path.join(workspace.files,'weather.txt'),'utf8'),'晴天');assert.equal(workspace.run.status,'completed');
});
test('project paths and material IDs cannot cross project boundaries or symlinks',async t=>{
 const base=await setup(t);const a=await createWorkspace(base,task);const b=await createWorkspace(base,{...task,id:'b',projectId:'other',messages:[]});
 await assert.rejects(b.material(a.catalog[0].id),/不属于/);
 await assert.rejects(resolveFile(a.files,'../secret'),/相对路径/);
 await fs.symlink(b.files,path.join(a.files,'escape'));await assert.rejects(resolveFile(a.files,'escape/private.txt',true),/符号链接/);
});
test('clarification resumes with confirmed answers and saved plan',async t=>{
 const base=await setup(t);let i=0;
 await runAgent(options(base,async()=>({content:JSON.stringify(i++?{action:'clarify',text:'请选择交付形式',clarification:{title:'交付',questions:[{id:'format',kind:'choice',title:'格式',options:[{id:'txt',label:'文本'},{id:'md',label:'Markdown'}]}],defaults:[]}}:plan)})));
 const result=await runAgent(options(base,async messages=>{const s=JSON.parse(messages.at(-1).content);assert.equal(s.goal,plan.goal);assert.equal(s.conversation.at(-1).content,'文本');return {content:JSON.stringify({action:'pause',text:'已记录文本格式'})};},{task:{...task,messages:[...task.messages,{role:'user',content:'文本'}]}}));
 assert.equal(result.agentRun.status,'paused');
});
test('cannot finish with nonexistent evidence, no artifact, or writes before a plan',async t=>{
 const base=await setup(t);let calls=0;
 const result=await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  const actions=[{action:'write_file',path:'bad.txt',content:'bad'},plan,{action:'finish',text:'完成',evidence:['fake']},{action:'blocked',text:'缺少验证成果'}];
  if(calls===1)assert.match(s.toolResults.at(-1).error,/计划/);
  if(calls===3)assert.match(s.toolResults.at(-1).error,/实际成果/);
  return {content:JSON.stringify(actions[calls++])};
 }));assert.equal(result.agentRun.status,'blocked');const w=await createWorkspace(base,task);await assert.rejects(fs.access(path.join(w.files,'bad.txt')));
});
test('stop preserves file and recoverable state without replaying writes',async t=>{
 const base=await setup(t);const controller=new AbortController();let call=0;
 await assert.rejects(runAgent(options(base,async()=>({content:JSON.stringify(call++?{action:'write_file',path:'saved.txt',content:'saved'}:plan)}),{signal:controller.signal,onRun:r=>{if(r.events.some(e=>e.type==='write_file'))controller.abort();}})),/停止/);
 const w=await createWorkspace(base,task);assert.equal(w.run.status,'paused');assert.equal(await fs.readFile(path.join(w.files,'saved.txt'),'utf8'),'saved');
});
test('large attachments are indexed instead of injected into every model call',async t=>{
 const base=await setup(t);const longTask={...task,messages:[{role:'user',content:'看看需求',materials:[{name:'large.md',text:'unique-marker'+ 'x'.repeat(200000)}]}]};
 await runAgent(options(base,async messages=>{assert.ok(messages.at(-1).content.length<5000);assert.ok(!messages.at(-1).content.includes('unique-marker'));return {content:JSON.stringify({action:'reply',text:'收到'})};},{task:longTask,intent:'chat'}));
});
test('sandbox command cannot read or write another project and receives no parent secrets',async t=>{
 const base=await setup(t);const a=await createWorkspace(base,task);const b=await createWorkspace(base,{...task,projectId:'other'});
 await fs.writeFile(path.join(b.files,'private.txt'),'isolated');process.env.AILO_TEST_SECRET='parent-secret';
 const result=await runCommand(a.files,`cat '${b.files}/private.txt'; echo "$AILO_TEST_SECRET"; touch '${b.files}/unexpected.txt'`,new AbortController().signal);
 delete process.env.AILO_TEST_SECRET;
 assert.notEqual(result.exitCode,0);assert.ok(!result.output.includes('isolated'));assert.ok(!result.output.includes('parent-secret'));await assert.rejects(fs.access(path.join(b.files,'unexpected.txt')));
});
test('task route cannot fall back to dumping code into chat',async t=>{
 const base=await setup(t);let calls=0;
 const result=await runAgent(options(base,async messages=>{
  if(calls++===0)return {content:JSON.stringify({action:'reply',text:'```kotlin\nclass Weather\n```'})};
  assert.match(JSON.parse(messages.at(-1).content).toolResults.at(-1).error,/不能用聊天正文/);
  return {content:JSON.stringify({action:'blocked',text:'执行环境缺少必要依赖'})};
 }));assert.equal(result.agentRun.status,'blocked');assert.ok(!result.content.includes('kotlin'));
});
test('chat during an existing task cannot write project files',async t=>{
 const base=await setup(t);let first=0;
 await runAgent(options(base,async()=>({content:JSON.stringify(first++?{action:'pause',text:'已暂停'}:plan)})));
 let calls=0;
 await runAgent(options(base,async messages=>{
  if(calls++===0)return {content:JSON.stringify({action:'write_file',path:'unexpected.txt',content:'bad'})};
  assert.match(JSON.parse(messages.at(-1).content).toolResults.at(-1).error,/计划/);return {content:JSON.stringify({action:'reply',text:'这是方案解释'})};
 },{intent:'chat'}));
 const w=await createWorkspace(base,task);await assert.rejects(fs.access(path.join(w.files,'unexpected.txt')));
});
test('new source imports are owned by one project and expose full original text in bounded pages',async t=>{
 const base=await setup(t),sourceId=require('node:crypto').randomUUID();await fs.mkdir(path.join(base,'imports'));
 await fs.writeFile(path.join(base,'imports',sourceId),'head\n'+'x'.repeat(12000)+'TAIL');
 const sourceTask={...task,messages:[{role:'user',content:'读取材料',materials:[{sourceId,name:'full.md',text:'head',summary:'已截断'}]}]};
 const a=await createWorkspace(base,sourceTask);const result=await a.source(a.catalog[0].id,undefined,12000);assert.ok(result.text.endsWith('TAIL'));
 const b=await createWorkspace(base,{...sourceTask,projectId:'b'});await assert.rejects(b.source(b.catalog[0].id),/没有保存原文件/);
});
test('sandbox rejects missing environment without inventing success and stops long commands',async t=>{
 const base=await setup(t);const w=await createWorkspace(base,task);
 const result=await runCommand(w.files,'/bin/sleep 10',new AbortController().signal,30);assert.equal(result.timedOut,true);assert.notEqual(result.exitCode,0);
});
test('project listing accepts root aliases and canonical relative directory paths',async t=>{
 const base=await setup(t);const w=await createWorkspace(base,task);
 const {execute,listFiles}=require('../apps/desktop/agent/tools.cjs');
 await fs.mkdir(path.join(w.files,'src'));await fs.writeFile(path.join(w.files,'src','main.txt'),'ok');
 const expected=await listFiles(w.files);
 for(const p of ['', '.', './', '././'])assert.deepEqual(await listFiles(w.files,p),expected);
 assert.deepEqual(await execute(w,{action:'list_files'},new AbortController().signal),expected);
 for(const p of ['src','./src','src/','./src//./'])assert.deepEqual(await listFiles(w.files,p),[{name:'src/main.txt',directory:false}]);
 assert.equal(await resolveFile(w.files,'./src//./main.txt'),path.join(w.files,'src','main.txt'));
 for(const p of ['/','/tmp','../','src/../src','./../','C:/tmp','src\\main.txt',null,1])await assert.rejects(listFiles(w.files,p),/相对路径/);
 await assert.rejects(resolveFile(w.files,'.'),/文件路径/);
});
test('root inspection before planning proceeds without repeated path failures',async t=>{
 const base=await setup(t);let step=0;
 const actions=[{action:'list_files',path:'.'},{action:'list_files',path:'./'},plan,{action:'pause',text:'目录检查完成，等待继续'}];
 const result=await runAgent(options(base,async messages=>{
  const snapshot=JSON.parse(messages.at(-1).content);
  assert.ok(!snapshot.recentEvents.some(e=>e.type==='tool_error'));
  return {content:JSON.stringify(actions[step++])};
 }));assert.equal(result.agentRun.status,'paused');assert.equal(step,4);
});
test('legacy attachment records merge with originals, aliases survive restart and raw revisions remain distinct',async t=>{
 const base=await setup(t);const old=await createWorkspace(base,task);const oldId=old.catalog[0].id;
 const make=async raw=>{const sourceId=require('node:crypto').randomUUID();await fs.mkdir(path.join(base,'imports'),{recursive:true});await fs.writeFile(path.join(base,'imports',sourceId),raw);return {...task.messages[0].materials[0],sourceId};};
 const first=await make('original version one');const updated={...task,messages:[{...task.messages[0],materials:[first]}]};
 let w=await createWorkspace(base,updated);assert.equal(w.catalog.length,1);assert.equal((await w.source(oldId)).text,'original version one');
 const duplicate=await make('original version one');w=await createWorkspace(base,{...updated,messages:[{...task.messages[0],materials:[duplicate]}]});assert.equal(w.catalog.length,1);assert.equal(w.catalog[0].id,oldId);
 const alias=w.catalog[0].aliases[0];assert.equal((await w.material(alias)).name,'requirements.md');
 w=await createWorkspace(base,updated);assert.equal(w.catalog.length,1);
 const changed=await make('original version TWO');w=await createWorkspace(base,{...updated,messages:[{...task.messages[0],materials:[changed]}]});assert.equal(w.catalog.length,2);
 await assert.rejects(w.source('fake'),/ID 无效/);
});
test('material observations and read coverage survive pause, checkpoint and resume',async t=>{
 const base=await setup(t);let n=0;
 await runAgent(options(base,async messages=>{const s=JSON.parse(messages.at(-1).content);return {content:JSON.stringify(n++?{action:'pause',text:'暂停'}:{action:'read_material',id:s.materials[0].id})};}));
 let resumed=0;
 const memory='需求：必须包含晴天。来源：requirements.md 全文。缺口：无。下一步：制定计划生成天气说明文件。';
 await runAgent(options(base,async messages=>{const s=JSON.parse(messages.at(-1).content);if(resumed++===0){assert.equal(s.readCoverage.length,1);assert.match(s.toolResults[0].result.text,/晴天/);return {content:JSON.stringify({action:'checkpoint',text:memory})};}assert.equal(s.workingMemory,memory);assert.equal(s.readCoverage[0].next,null);assert.equal(s.toolResults.length,0);return {content:JSON.stringify({action:'pause',text:'暂停'})};}));
 const w=await createWorkspace(base,task);assert.equal(w.run.workingMemory,memory);assert.equal(w.run.observations.length,0);
});
test('repeated reads mixed with successes pause instead of looping indefinitely',async t=>{
 const base=await setup(t);let n=0;
 const result=await runAgent(options(base,async messages=>{const s=JSON.parse(messages.at(-1).content);const action=n++%2?{action:'list_files',path:'.'}:{action:'read_material',id:s.materials[0].id};return {content:JSON.stringify(action)};}));
 assert.equal(result.agentRun.status,'paused');assert.match(result.content,/反复/);assert.ok(n<=6);assert.equal(result.agentRun.events.at(-1).type,'no_progress');
});
test('duplicate route is recoverable but cannot switch chat into task permissions',async t=>{
 const base=await setup(t);let n=0;
 const result=await runAgent(options(base,async()=>({content:JSON.stringify([{action:'route',kind:'chat'},{action:'route',kind:'task'},{action:'reply',text:'你好'}][n++])}),{intent:'chat'}));
 assert.equal(result.content,'你好');assert.ok(result.agentRun.events.some(e=>e.type==='tool_error'&&/权限/.test(e.detail.message)));
});
test('large JSON can be inspected and selected without serially paging the entire file',async t=>{
 const base=await setup(t),sourceId=require('node:crypto').randomUUID();await fs.mkdir(path.join(base,'imports'));
 await fs.writeFile(path.join(base,'imports',sourceId),JSON.stringify({pages:[{name:'天气',components:['temperature','forecast']},{name:'其他',content:'x'.repeat(100000)}]}));
 const w=await createWorkspace(base,{...task,messages:[{role:'user',content:'设计',materials:[{name:'design.json',text:'preview',sourceId}]}]});
 const id=w.catalog[0].id,outline=await w.inspect(id);assert.equal(outline.kind,'json_outline');assert.ok(JSON.stringify(outline).length<4000);
 const page=await w.inspect(id,undefined,'/pages/0');assert.match(page.text,/forecast/);assert.equal(page.next,null);
 await assert.rejects(w.inspect(id,undefined,'/__proto__'),/不存在/);
});
test('checkpoint is required before old observations are removed and planning follows initial reads',async t=>{
 const base=await setup(t);let reads=0,checkpoint=false,planned=false;
 const longTask={...task,messages:[{role:'user',content:'开发',materials:[{name:'requirements.md',text:'x'.repeat(12000)}]}]};
 await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);let action;
  if(s.requiredAction==='checkpoint'){assert.equal(reads,6);assert.ok(messages.some(m=>m.role==='assistant'));checkpoint=true;action={action:'checkpoint',text:'需求来源 requirements.md，目前已读前八个片段，尚未读完；下一步建立开发与验证计划。'};}
  else if(s.requiredAction==='plan_or_clarify'){assert.ok(checkpoint);planned=true;action=plan;}
  else if(planned)action={action:'pause',text:'计划已保存'};
  else action={action:'read_material',id:s.materials[0].id,offset:reads++*1000,limit:1000};
  return {content:JSON.stringify(action)};
 },{task:longTask}));assert.ok(planned);
});
test('large non-ASCII tool pages fit context and next points to the observed boundary',async t=>{
 const base=await setup(t);let n=0;
 const sourceTask={...task,messages:[{role:'user',content:'阅读',materials:[{name:'large.md',text:'需求'.repeat(20000)}]}]};
 await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(n++===0)return {content:JSON.stringify({action:'read_material',id:s.materials[0].id,limit:12000})};
  const result=s.toolResults.at(-1).result;
  assert.equal(result.truncated,true);assert.equal(result.next,result.text.length);assert.equal(s.readCoverage[0].end,result.next);assert.ok(result.text.length<4000);
  return {content:JSON.stringify({action:'pause',text:'保存进度'})};
 },{task:sourceTask}));
 const w=await createWorkspace(base,sourceTask);const raw=await w.execution();assert.match(raw.text,/read_material/);
});
test('output truncation retries with bounded budgets without executing partial actions',async t=>{
 const base=await setup(t);let n=0;const budgets=[];
 const result=await runAgent(options(base,async(messages,budget)=>{
  budgets.push(budget);const s=JSON.parse(messages.at(-1).content);
  if(n++<2){if(n===2)assert.match(s.recovery,/截断/);throw Object.assign(Error('length'),{code:'MODEL_OUTPUT_LIMIT',partialContent:'{"action":"write_file"',diagnostics:{finishReason:'length',toolArgumentChars:40}});}
  return {content:JSON.stringify({action:'pause',text:'已恢复'})};
 },{model:{contextWindow:100000,maxOutputTokens:20000},executeTool:()=>assert.fail('partial action cannot execute')}));
 assert.deepEqual(budgets,[8192,16384,20000]);assert.equal(result.agentRun.status,'paused');
 const w=await createWorkspace(base,task);assert.equal(w.run.events.filter(e=>e.type==='output_limit').length,2);
});
test('output truncation retries stop at configured cap and after two retries',async t=>{
 const base=await setup(t);const budgets=[];
 await assert.rejects(runAgent(options(base,async(messages,budget)=>{budgets.push(budget);throw Object.assign(Error('length'),{code:'MODEL_OUTPUT_LIMIT'});},{model:{contextWindow:32768,maxOutputTokens:4096}})),/重试 2 次/);
 assert.deepEqual(budgets,[4096,4096,4096]);
});
test('non-length provider failures are not replayed by output recovery',async t=>{
 const base=await setup(t);let calls=0;
 await assert.rejects(runAgent(options(base,async()=>{calls++;throw Error('HTTP 401');})),/401/);assert.equal(calls,1);
});

test('progress review survives restart and checkpoint, gates tools and publishes updated steps',async t=>{
 const base=await setup(t);let n=0;
 await runAgent(options(base,async()=>({content:JSON.stringify(n++===0?plan:n<=6?{action:'write_file',path:`part${n}.txt`,content:'work'}:{action:'pause',text:'暂停'})})));
 let w=await createWorkspace(base,task);assert.equal(w.run.actionsSincePlan,5);
 let stage=0,executed=0;const updates=[];
 await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  assert.equal(s.status,'running');
  let action;
  if(stage===0){assert.equal(s.requiredAction,undefined);action={action:'read_file',path:'part2.txt'};}
  else if(stage===1){assert.equal(s.requiredAction,'plan_update');action={action:'write_file',path:'must-not-exist.txt',content:'bad'};}
  else if(stage===2){assert.equal(s.requiredAction,'plan_update');action={...plan,steps:[{...plan.steps[0],status:'running'}]};}
  else {assert.equal(s.requiredAction,undefined);assert.equal(s.steps[0].status,'running');action={action:'pause',text:'核对完成'};}
  stage++;return {content:JSON.stringify(action)};
 },{onRun:r=>updates.push(r),executeTool:async()=>{executed++;return {text:'work'};}}));
 assert.equal(executed,1);assert.ok(updates.some(r=>r.status==='running'&&r.steps[0].status==='running'));
 w=await createWorkspace(base,task);assert.equal(w.run.actionsSincePlan,0);
 await assert.rejects(fs.stat(path.join(w.files,'must-not-exist.txt')),/ENOENT/);
 // Checkpoint compression must not reset progress cadence.
 w.run.actionsSincePlan=6;w.run.observations=Array.from({length:6},()=>({action:{action:'read_material'},response:{text:'reference'}}));await w.save();
 let turn=0;
 await runAgent(options(base,async messages=>{const s=JSON.parse(messages.at(-1).content);if(turn++===0){assert.equal(s.requiredAction,'checkpoint');return {content:JSON.stringify({action:'checkpoint',text:'已读取需求材料，已保存工程文件，下一步核对执行计划并继续实现剩余功能。'})};}assert.equal(s.requiredAction,'plan_update');return {content:JSON.stringify({action:'pause',text:'保留核对要求'})};}));
 assert.equal((await createWorkspace(base,task)).run.actionsSincePlan,6);
});

test('legacy runs recover progress cadence from events without changing completed steps',async t=>{
 const base=await setup(t);const w=await createWorkspace(base,task);
 w.run.steps=[{id:'one',title:'已验证部分',status:'done'},{id:'two',title:'剩余工作',status:'pending'}];w.run.mode='task';w.run.status='failed';
 w.run.events=[{type:'plan',detail:{},at:new Date().toISOString()},...Array.from({length:7},()=>({type:'write_file',detail:{},at:new Date().toISOString()}))];await w.save();
 await runAgent(options(base,async messages=>{const s=JSON.parse(messages.at(-1).content);assert.equal(s.status,'running');assert.equal(s.requiredAction,'plan_update');assert.deepEqual(s.steps,w.run.steps);return {content:JSON.stringify({action:'pause',text:'保留原状态等待核对'})};}));
});

test('overlong step title gets actionable feedback and corrected plan resumes without losing prior state',async t=>{
 const base=await setup(t);const w=await createWorkspace(base,task);
 w.run.mode='task';w.run.steps=plan.steps;w.run.goal=plan.goal;w.run.status='paused';w.run.actionsSincePlan=6;await w.save();
 const proposed={...plan,steps:Array.from({length:5},(_,i)=>({id:`s${i+1}`,title:i===4?'x'.repeat(229):`步骤 ${i+1}`,status:i===4?'running':'done'}))};
 let turn=0;
 await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);let action;
  if(turn===0)action=proposed;
  else if(turn===1){
   assert.match(s.toolResults.at(-1).error,/steps\[4\].*title.*229.*200/);
   assert.deepEqual(s.steps,plan.steps); // No partial mutation on rejection.
   assert.equal(s.requiredAction,'plan_update');
   action={...proposed,steps:proposed.steps.map(step=>step.id==='s5'?{...step,title:'实现天气 app UI，完成剩余页面和资源'}:step)};
  }else{assert.equal(s.steps[4].status,'running');assert.equal(s.steps[0].status,'done');assert.equal(s.requiredAction,undefined);action={action:'pause',text:'计划已恢复'};}
  turn++;return {content:JSON.stringify(action)};
 }));
 assert.equal(turn,3);
});

test('plan contract exposes limits and identifies duplicate ids, invalid status and empty titles',()=>{
 const {validatePlan,fields}=require('../apps/desktop/agent/plan.cjs');
 assert.equal(fields.steps.items.properties.title.maxLength,200);
 assert.equal(fields.steps.maxItems,12);
 assert.throws(()=>validatePlan({...plan,steps:[{id:'same',title:' ',status:'completed'},{id:'same',title:'valid',status:'pending'}]}),error=>{
  assert.match(error.message,/steps\[0\].*title/);assert.match(error.message,/status/);assert.match(error.message,/steps\[1\].*id 重复/);return true;
 });
 assert.doesNotThrow(()=>validatePlan({...plan,steps:[{id:'s1',title:'x'.repeat(200),status:'running'}]}));
});

test('steering arriving during decision discards stale write and re-routes with new instruction',async t=>{
 const base=await setup(t);let queue=[],turn=0;const seen=[];
 const result=await runAgent({base,task:structuredClone(task),model,signal:new AbortController().signal,
 getSteering:async()=>queue.splice(0),
 ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);seen.push(s);let action;
  if(turn===0)action={action:'route',kind:'task'};
  else if(turn===1)action=plan;
  else if(turn===2){queue.push({id:'steer1',role:'user',content:'改为生成 rainy.txt，保留原任务'});action={action:'write_file',path:'stale.txt',content:'旧决策'};}
  else if(turn===3){assert.equal(s.phase,'route');assert.match(s.conversation.at(-1).content,/rainy/);action={action:'route',kind:'task'};}
  else if(turn===4)action={action:'write_file',path:'rainy.txt',content:'new'};
  else action={action:'pause',text:'已按补充调整'};
  turn++;return {content:JSON.stringify(action)};
 }});
 const w=await createWorkspace(base,task);await assert.rejects(fs.stat(path.join(w.files,'stale.txt')),/ENOENT/);assert.equal(await fs.readFile(path.join(w.files,'rainy.txt'),'utf8'),'new');assert.ok(result.agentRun.events.some(e=>e.type==='steering'));
});

test('oversized arguments recover with smaller actions, fixed budget and bounded retries',async t=>{
 const base=await setup(t);let calls=0;const budgets=[];
 await runAgent(options(base,async(messages,budget)=>{
  budgets.push(budget);
  if(calls++<2)throw Object.assign(Error('large'),{code:'MODEL_TOOL_ARGUMENT_LIMIT',diagnostics:{toolArgumentChars:250001}});
  assert.match(JSON.parse(messages.at(-1).content).recovery,/250000/);
  return {content:JSON.stringify({action:'pause',text:'已拆分下一步'})};
 },{model:{contextWindow:100000,maxOutputTokens:32000},executeTool:()=>assert.fail('partial action must not execute')}));
 assert.deepEqual(budgets,[8192,8192,8192]);
 const failBase=await setup(t);let retries=0;
 await assert.rejects(runAgent(options(failBase,async()=>{retries++;throw Object.assign(Error('large'),{code:'MODEL_TOOL_ARGUMENT_LIMIT'});})),/重试 2 次/);
 assert.equal(retries,3);
});

test('batch boundaries continue same execution without re-routing or replaying writes',async t=>{
 const base=await setup(t);let n=0;const actions=[plan,{action:'write_file',path:'a.txt',content:'a'},{action:'write_file',path:'b.txt',content:'b'},{action:'pause',text:'检查完成'}];
 const result=await runAgent(options(base,async()=>({content:JSON.stringify(actions[n++])}),{batchSize:3,maxSteps:9}));
 assert.equal(result.content,'检查完成');
 const w=await createWorkspace(base,task);
 assert.equal(w.run.events.filter(e=>e.type==='intent').length,1);
 assert.equal(w.run.events.filter(e=>e.type==='batch_continue').length,1);
 assert.equal(w.run.events.filter(e=>e.type==='write_file').length,2);
});
test('total decision budget pauses explicitly and saves files',async t=>{
 const base=await setup(t);let n=0;
 const result=await runAgent(options(base,async()=>({content:JSON.stringify(n++===0?plan:{action:'write_file',path:`part${n}.txt`,content:'ok'})}),{batchSize:2,maxSteps:5}));
 assert.match(result.content,/决策轮数预算（5 轮）/);assert.match(result.content,/任务尚未完成/);
 const w=await createWorkspace(base,task);assert.equal(w.run.events.filter(e=>e.type==='batch_continue').length,2);assert.equal(w.run.events.at(-1).type,'execution_budget');
 assert.equal((await fs.readdir(w.files)).length,3);
});
test('cancellation during batch save never requests the next action',async t=>{
 const base=await setup(t),controller=new AbortController();let n=0;
 await assert.rejects(runAgent(options(base,async()=>{n++;return {content:JSON.stringify(plan)};},{batchSize:2,signal:controller.signal,onRun:r=>{if(r.events.at(-1)?.type==='batch_continue')controller.abort();}})),/已停止/);
 assert.equal(n,1);
});
test('elapsed budget is checked again before executing a generated action',async t=>{
 const base=await setup(t);let clock=0;
 const result=await runAgent(options(base,async()=>{clock=101;return {content:JSON.stringify(plan)};},{now:()=>clock,maxDurationMs:100}));
 assert.match(result.content,/时长预算/);assert.equal(result.agentRun.steps.length,0);
});
test('bookkeeping-only batch pauses rather than endlessly continuing',async t=>{
 const base=await setup(t);let n=0;
 const result=await runAgent(options(base,async()=>({content:JSON.stringify(n++===0?plan:{action:'checkpoint',text:'保存已有结论，当前没有新的材料或者执行结果，下一步需要继续判断。'})}),{batchSize:2,maxSteps:10}));
 assert.match(result.content,/未发现新的有效进展/);
});
test('repeated action guard remains effective across batch boundaries',async t=>{
 const base=await setup(t);let n=0;
 const result=await runAgent(options(base,async()=>({content:JSON.stringify(n++===0?plan:{action:'read_file',path:'a.txt'})}),{batchSize:2,maxSteps:12,executeTool:async()=>({text:'same'})}));
 assert.match(result.content,/相同动作反复执行/);
});

test('thinking truncation learns budget across actions and manual continuation',async t=>{
 const base=await setup(t);let n=0;const budgets=[];
 await runAgent(options(base,async(messages,budget)=>{
  budgets.push(budget);
  if(n++===0)throw Object.assign(Error('length'),{code:'MODEL_OUTPUT_LIMIT',diagnostics:{contentChars:0,toolCalls:0,reasoningChars:30000}});
  if(n===2){assert.match(JSON.parse(messages.at(-1).content).recovery,/思考阶段/);return {content:JSON.stringify(plan)};}
  return {content:JSON.stringify({action:'pause',text:'已保存'})};
 },{model:{id:'m',contextWindow:100000,maxOutputTokens:65536}}));
 assert.deepEqual(budgets,[8192,16384,16384]);
 const w=await createWorkspace(base,task);assert.equal(w.run.outputBudget.preferred,16384);
 assert.match(w.run.events.find(e=>e.type==='output_limit').detail.message,/思考.*16384/);
 await runAgent(options(base,async(messages,budget)=>{assert.equal(budget,16384);return {content:JSON.stringify({action:'pause',text:'保持进度'})};},{model:{id:'m',contextWindow:100000,maxOutputTokens:65536}}));
});

test('repeated material range warns before pausing and includes precise location',async t=>{
 const base=await setup(t);let calls=0;
 const result=await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);calls++;
  if(calls===4){assert.equal(s.toolResults.at(-1).notExecuted,true);assert.match(s.toolResults.at(-1).instruction,/query/);}
  return {content:JSON.stringify({action:'inspect_source',id:s.materials[0].id,entry:'icons.json',pointer:'/icons',offset:30000})};
 },{executeTool:async()=>({text:'svg',offset:30000,next:40000,total:90000})}));
 assert.equal(calls,4);
 const events=result.agentRun.events;assert.equal(events.filter(e=>e.type==='inspect_source').length,2);
 assert.ok(events.some(e=>e.type==='repeat_warning'));
 const last=events.at(-1);assert.equal(last.type,'no_progress');assert.equal(last.detail.offset,30000);assert.equal(last.detail.pointer,'/icons');assert.match(last.detail.message,/icons.json/);
});
test('material reread after changed file content is permitted and retains read evidence',async t=>{
 const base=await setup(t);let i=0;
 const result=await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content),read={action:'read_material',id:s.materials[0].id};
  const actions=[plan,read,read,{action:'write_file',path:'icon.xml',content:'new resource'},read,{action:'pause',text:'正常推进'}];
  return {content:JSON.stringify(actions[i++])};
 }));
 assert.equal(result.content,'正常推进');assert.ok(!result.agentRun.events.some(e=>e.type==='repeat_warning'||e.type==='no_progress'));
});
test('large JSON keyword search locates nested string content with bounded paginated matches',async t=>{
 const base=await setup(t);await fs.mkdir(path.join(base,'imports'),{recursive:true});
 const sourceId=require('node:crypto').randomUUID();await fs.writeFile(path.join(base,'imports',sourceId),JSON.stringify({content:[{text:('x'.repeat(5000)+'sun_cloud').repeat(10)}]}));
 const w=await createWorkspace(base,{...task,messages:[{role:'user',content:'查图标',materials:[{name:'icons.json',text:'preview',sourceId}]}]});
 const id=w.catalog[0].id;
 const hits=await w.inspect(id,undefined,'/content/0/text',0,'sun_cloud');
 assert.equal(hits.kind,'json_search');assert.equal(hits.hits.length,8);assert.ok(hits.next>0);
 const rest=await w.inspect(id,undefined,'/content/0/text',hits.next,'sun_cloud');assert.equal(rest.hits.length,2);assert.equal(rest.next,null);
 const page=await w.inspect(id,undefined,'/content/0/text',hits.hits[0].offset);assert.match(page.text,/sun_cloud/);
 await assert.rejects(w.inspect(id,undefined,'/content/0/text',0,''),/检索词/);
 await assert.rejects(w.inspect('foreign',undefined,undefined,0,'sun_cloud'),/不属于/);
});
test('rewriting identical file content does not reset repeat-read detection',async t=>{
 const base=await setup(t),w=await createWorkspace(base,task);await fs.writeFile(path.join(w.files,'same.txt'),'same');let i=0;
 const result=await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content),read={action:'read_material',id:s.materials[0].id};
  return {content:JSON.stringify([plan,read,read,{action:'write_file',path:'same.txt',content:'same'},read,read][i++])};
 }));
 assert.equal(result.agentRun.events.at(-1).type,'no_progress');assert.ok(result.agentRun.events.some(e=>e.type==='repeat_warning'));
});
test('Feishu conversation executes tool and replies with actual result without local delivery artifacts',async t=>{
 const base=await setup(t);let n=0,called=0;
 const result=await runAgent(options(base,async messages=>{
  if(n++===0)return {content:JSON.stringify({action:'feishu',operation:'api',method:'GET',path:'/open-apis/calendar/v4/calendars',purpose:'查看日历'})};
  assert.match(JSON.parse(messages.at(-1).content).toolResults.at(-1).result.output,/calendar/);
  return {content:JSON.stringify({action:'reply',text:'已查询日历'})};
 },{intent:'chat',feishuCli:{execute:async()=>{called++;return {output:'{"calendar":"工作"}',exitCode:0};}}}));
 assert.equal(called,1);assert.equal(result.content,'已查询日历');
});
test('unassigned conversations can chat and keep files and materials isolated',async t=>{
 const base=await setup(t);const aTask={...task,id:'loose-a',projectId:''};const bTask={...task,id:'loose-b',projectId:'',messages:[]};
 const a=await createWorkspace(base,aTask),b=await createWorkspace(base,bTask),p=await createWorkspace(base,{...task,projectId:'loose-a'});
 assert.notEqual(a.files,b.files);assert.notEqual(a.files,p.files);await fs.writeFile(path.join(a.files,'private.txt'),'a');await assert.rejects(fs.readFile(path.join(b.files,'private.txt')),/ENOENT/);await assert.rejects(b.material(a.catalog[0].id),/不属于/);
 const result=await runAgent(options(base,async()=>({content:JSON.stringify({action:'reply',text:'你好'})}),{task:aTask,intent:'chat'}));assert.equal(result.content,'你好');
});

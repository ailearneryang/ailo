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
test('large-capacity models externalize accumulated tools and preserve summaries with an independent budget',async t=>{
 const base=await setup(t),largeModel={id:'large',contextWindow:1048576,maxOutputTokens:131072};
 await runAgent(options(base,async()=>({content:JSON.stringify({action:'pause',text:'保存进度'})}),{model:largeModel}));
 const w=await createWorkspace(base,task);
 w.run.observations=Array.from({length:12},(_,i)=>({action:{action:'read_file',path:`part-${i}.txt`},response:{text:`retained-observation-${i}`}}));
 const policy=require('../apps/desktop/agent/output-budget.cjs').createOutputBudget(largeModel,131072);policy.limited(8192);policy.limited(16384);policy.limited(32768);w.run.outputBudget=policy.snapshot();await w.save();
 let calls=0;const memory='已完整保留十二次文件读取的结论和来源，下一步根据当前用户要求继续推进并验证。';
 await runAgent(options(base,async(messages,budget)=>{
  const s=JSON.parse(messages.at(-1).content);
  if(calls++===0){assert.equal(s.requiredAction,'checkpoint');assert.ok(!JSON.stringify(messages).includes('retained-observation-0'));assert.match((await w.observation(s.externalMemory.recent[0].id)).text,/retained-observation-0/);assert.ok(JSON.stringify(messages).includes('retained-observation-11'));assert.equal(budget,8192);return {content:JSON.stringify({action:'checkpoint',text:memory})};}
  assert.equal(s.workingMemory,memory);assert.equal(s.toolResults.length,0);assert.ok(!JSON.stringify(messages).includes('retained-observation-0'));return {content:JSON.stringify({action:'pause',text:'摘要已保存'})};
 },{model:largeModel,executeTool:()=>assert.fail('no tool should be replayed')}));
 assert.equal((await createWorkspace(base,task)).run.workingMemory,memory);
});
function options(base,ask,rest={}){let first=true;return {base,task,model,signal:new AbortController().signal,ask:async (...args)=>{if(first){first=false;return {content:JSON.stringify({action:'route',kind:rest.intent||'task'})};}return ask(...args);}, ...rest};}
test('ordinary conversation needs no plan and runs no tools',async t=>{
 const base=await setup(t);const result=await runAgent(options(base,async()=>({content:JSON.stringify({action:'reply',text:'你好'})}),{intent:'chat',executeTool:()=>assert.fail('no tools')}));
 assert.equal(result.content,'你好');assert.equal(result.agentRun.mode,'chat');
});
test('full task writes actual file, registers artifact, checks evidence, and persists completion',async t=>{
 const base=await setup(t);let call=0;
 const result=await runAgent(options(base,async messages=>{
  const snapshot=JSON.parse(messages.at(-1).content);
  if(snapshot.requiredAction==='checkpoint')return {content:JSON.stringify({action:'checkpoint',text:'已保存当前文件、登记成果和检查证据；下一步依据现有证据核验正文并完成交付，不重复写入或执行旧命令。'})};
  const actions=[plan,{action:'write_file',path:'weather.txt',content:'晴天'},{action:'run_command',command:'test -f weather.txt',purpose:'文件检查'},{action:'artifact',path:'weather.txt',label:'天气说明'},{...plan,steps:plan.steps.map(s=>({...s,status:'done'}))}];
  if(call===4)assert.equal(snapshot.recentEvents.find(e=>e.type==='run_command').detail.result.exitCode,0,JSON.stringify(snapshot.recentEvents));
  const action=actions[call++]||(!snapshot.acceptanceCriteria.every(c=>c.check?.status==='passed')?{action:'verify',checks:snapshot.acceptanceCriteria.map(c=>({criterionId:c.id,kind:'text_contains',path:'weather.txt',contains:['晴天'],reason:'文件存在且包含晴天'}))}:{action:'finish',review:{summary:'已对照要求检查当前成果',issues:[],unverified:[]},text:'已生成天气说明并检查文件',evidence:[snapshot.recentEvents.find(e=>e.type==='run_command').id]});
  return {content:JSON.stringify(action)};
 },{executeTool:checkWeatherFile}));
 assert.equal(result.agentRun.status,'completed',JSON.stringify(result));
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
  const actions=[{action:'write_file',path:'bad.txt',content:'bad'},plan,{action:'finish',review:{summary:'已对照要求检查当前成果',issues:[],unverified:[]},text:'完成',evidence:['fake']},{action:'blocked',text:'缺少验证成果'}];
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
test('repeated reads mixed with successes recover internally without replaying tools',async t=>{
 const base=await setup(t);let n=0;
 const result=await runAgent(options(base,async messages=>{const s=JSON.parse(messages.at(-1).content);const action=n++%2?{action:'list_files',path:'.'}:{action:'read_material',id:s.materials[0].id};return {content:JSON.stringify(action)};},{maxSteps:10}));
 assert.equal(result.agentRun.status,'paused');assert.match(result.content,/决策轮数预算/);assert.equal(n,9);assert.ok(result.agentRun.events.some(e=>e.type==='loop_recovery'));assert.ok(!result.agentRun.events.some(e=>e.type==='no_progress'));
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
  if(s.requiredAction==='checkpoint'){assert.ok(reads>0&&reads<=8);assert.ok(!messages.some(m=>m.role==='assistant'));assert.ok(s.externalMemory.recent.every(r=>r.id));checkpoint=true;action={action:'checkpoint',text:'需求来源 requirements.md，目前已读前八个片段，尚未读完；下一步建立开发与验证计划。'};}
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
test('persistent output truncation stops after staged recovery within configured cap',async t=>{
 const base=await setup(t);const budgets=[];
 const result=await runAgent(options(base,async(messages,budget)=>{budgets.push(budget);throw Object.assign(Error('length'),{code:'MODEL_OUTPUT_LIMIT'});},{model:{contextWindow:32768,maxOutputTokens:4096}}));
 assert.equal(result.agentRun.status,'blocked');assert.match(result.content,/单步直出恢复/);
 assert.deepEqual(budgets,[4096,4096,4096,4096]);
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
  if(s.requiredAction==='checkpoint')return {content:JSON.stringify({action:'checkpoint',text:'保留已写入文件和当前步骤状态，接下来继续核对计划，不重放已有文件写入。'})};
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
test('bookkeeping-only batches refocus internally while retaining the overall execution budget',async t=>{
 const base=await setup(t);let n=0;
 const result=await runAgent(options(base,async()=>({content:JSON.stringify(n++===0?plan:{action:'checkpoint',text:'保存已有结论，当前没有新的材料或者执行结果，下一步需要继续判断。'})}),{batchSize:2,maxSteps:10}));
 assert.match(result.content,/决策轮数预算/);assert.ok(result.agentRun.events.some(e=>e.type==='loop_recovery'));
});
test('repeated action guard remains effective across batch boundaries',async t=>{
 const base=await setup(t);let n=0;
 const result=await runAgent(options(base,async()=>({content:JSON.stringify(n++===0?plan:{action:'read_file',path:'a.txt'})}),{batchSize:2,maxSteps:12,executeTool:async()=>({text:'same'})}));
 assert.match(result.content,/决策轮数预算/);assert.ok(result.agentRun.events.some(e=>e.type==='loop_recovery'));
});

test('thinking truncation does not inflate budget across actions or manual continuation',async t=>{
 const base=await setup(t);let n=0;const budgets=[];
 await runAgent(options(base,async(messages,budget)=>{
  budgets.push(budget);
  if(n++===0)throw Object.assign(Error('length'),{code:'MODEL_OUTPUT_LIMIT',diagnostics:{contentChars:0,toolCalls:0,reasoningChars:30000}});
  if(n===2){assert.match(JSON.parse(messages.at(-1).content).recovery,/思考阶段/);return {content:JSON.stringify(plan)};}
  return {content:JSON.stringify({action:'pause',text:'已保存'})};
 },{model:{id:'m',contextWindow:100000,maxOutputTokens:65536}}));
 assert.deepEqual(budgets,[8192,8192,8192]);
 const w=await createWorkspace(base,task);assert.equal(w.run.outputBudget.stages.action.preferred,8192);
 assert.equal(w.run.events.find(e=>e.type==='output_limit').detail.nextBudget,8192);
 await runAgent(options(base,async(messages,budget)=>{assert.equal(budget,8192);return {content:JSON.stringify({action:'pause',text:'保持进度'})};},{model:{id:'m',contextWindow:100000,maxOutputTokens:65536}}));
});

test('repeated material range warns then recovers internally with precise location',async t=>{
 const base=await setup(t);let calls=0;
 const result=await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);calls++;
  if(calls===4){assert.equal(s.toolResults.at(-1).notExecuted,true);assert.match(s.toolResults.at(-1).instruction,/query/);}
  return {content:JSON.stringify({action:'inspect_source',id:s.materials[0].id,entry:'icons.json',pointer:'/icons',offset:30000})};
 },{maxSteps:6,executeTool:async()=>({text:'svg',offset:30000,next:40000,total:90000})}));
 assert.equal(calls,5);
 const events=result.agentRun.events;assert.equal(events.filter(e=>e.type==='inspect_source').length,2);
 assert.ok(events.some(e=>e.type==='repeat_warning'));
 const last=events.filter(e=>e.type==='loop_recovery').at(-1);assert.ok(last);assert.equal(last.detail.offset,30000);assert.equal(last.detail.pointer,'/icons');assert.ok(last.detail.message);
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
  return {content:JSON.stringify([plan,read,read,{action:'write_file',path:'same.txt',content:'same'},read,read][i++]||read)};
 },{maxSteps:9}));
 assert.ok(result.agentRun.events.some(e=>e.type==='loop_recovery'));assert.ok(result.agentRun.events.some(e=>e.type==='repeat_warning'));
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


// These tests exercise evidence/repair state transitions, independently of the
// host's ability to launch a nested sandbox. Real command isolation has its own tests.
async function checkWeatherFile(workspace,action,signal,options){
 if(action.action!=='run_command')return require('../apps/desktop/agent/tools.cjs').execute(workspace,action,signal,options);
 assert.equal(action.command,'test -f weather.txt');
 const bytes=await fs.readFile(path.join(workspace.files,'weather.txt'));
 return {exitCode:0,output:'',sources:[{path:'weather.txt',sha256:require('../apps/desktop/agent/evidence.cjs').hash(bytes)}]};
}
test('resumed completed plan can inspect results and finishes with archived evidence',async t=>{
 const base=await setup(t);let n=0;
 await runAgent(options(base,async()=>({content:JSON.stringify([plan,{action:'write_file',path:'weather.txt',content:'晴天'},{action:'run_command',command:'test -f weather.txt',purpose:'验证文件'},{action:'artifact',path:'weather.txt',label:'天气说明'},{...plan,steps:plan.steps.map(s=>({...s,status:'done'}))},{action:'pause',text:'暂停后继续收尾'}][n++])}),{executeTool:checkWeatherFile}));
 const w=await createWorkspace(base,task);
 const evidence=w.run.events.find(e=>e.type==='run_command').id;
 for(let i=0;i<10;i++)await w.event('note',{message:'历史记录'});
 let calls=0;
 const result=await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(s.requiredAction==='checkpoint')return {content:JSON.stringify({action:'checkpoint',text:'已保存历史验证证据，成果文件未变化；下一步复用该证据核验内容并完成交付，不重跑旧命令。'})};
  assert.equal(s.requiredAction,'finish_review');
  assert.ok(s.completionEvidence.some(e=>e.id===evidence));
  assert.ok(!s.recentEvents.some(e=>e.id===evidence));
  if(calls++===0)return {content:JSON.stringify({action:'list_files',path:'.'})};
  if(!s.acceptanceCriteria.every(c=>c.check?.status==='passed'))assert.ok(Array.isArray(s.toolResults.at(-1).result));
  return {content:JSON.stringify(!s.acceptanceCriteria.every(c=>c.check?.status==='passed')?{action:'verify',checks:s.acceptanceCriteria.map(c=>({criterionId:c.id,kind:'text_contains',path:'weather.txt',contains:['晴天'],reason:'核验晴天文件'}))}:{action:'finish',review:{summary:'已对照要求检查当前成果',issues:[],unverified:[]},text:'已核验并交付',evidence:[evidence]})};
 },{executeTool:checkWeatherFile}));
 assert.equal(result.agentRun.status,'completed');
});
test('completed steps without actual artifacts and evidence cannot bypass finish validation',async t=>{
 const base=await setup(t);let calls=0;
 const result=await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(calls++===0)return {content:JSON.stringify({...plan,steps:plan.steps.map(step=>({...step,status:'done'}))})};
  assert.equal(s.requiredAction,'finish_review');
  if(calls===2)return {content:JSON.stringify({action:'finish',review:{summary:'已对照要求检查当前成果',issues:[],unverified:[]},text:'完成',evidence:['fake']})};
  assert.match(s.toolResults.at(-1).error,/实际成果/);
  return {content:JSON.stringify({action:'blocked',text:'缺少实际成果与验收证据'})};
 }));
 assert.equal(result.agentRun.status,'blocked');
});
test('complete short progress files survive checkpoint and resume without another read',async t=>{
 const base=await setup(t),w=await createWorkspace(base,task);await fs.writeFile(path.join(w.files,'progress.json'),'{"next":"KV Cache"}');let calls=0;
 await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(calls++===0)return {content:JSON.stringify({action:'read_file',path:'progress.json'})};
  assert.equal(s.knownFileContents[0].text,'{"next":"KV Cache"}');
  if(calls===2)return {content:JSON.stringify({action:'checkpoint',text:'已完整读取课程进度，下一课 KV Cache，直接根据此进度推进。'})};
  assert.equal(s.toolResults.length,0);return {content:JSON.stringify({action:'pause',text:'保存进度'})};
 }));
 await runAgent(options(base,async messages=>{
  assert.equal(JSON.parse(messages.at(-1).content).knownFileContents[0].text,'{"next":"KV Cache"}');
  return {content:JSON.stringify({action:'pause',text:'无需重读'})};
 }));
 await fs.writeFile(path.join(w.files,'progress.json'),'{"next":"Quantization"}');
 await runAgent(options(base,async messages=>{
  assert.deepEqual(JSON.parse(messages.at(-1).content).knownFileContents,[]);
  return {content:JSON.stringify({action:'pause',text:'文件已更新，需要读取新版'})};
 }));
});
test('repeat correction restores actual cached content and model can advance instead of pausing',async t=>{
 const base=await setup(t),w=await createWorkspace(base,task);await fs.writeFile(path.join(w.files,'progress.json'),'{"next":"KV Cache"}');let calls=0,reads=0;
 const execute=require('../apps/desktop/agent/tools.cjs').execute;
 const result=await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(calls++<3)return {content:JSON.stringify({action:'read_file',path:'progress.json'})};
  assert.equal(s.toolResults.at(-1).notExecuted,true);assert.match(s.toolResults.at(-1).result.text,/KV Cache/);
  return {content:JSON.stringify({action:'reply',text:'下一课 KV Cache，已使用缓存进度'})};
 },{intent:'chat',executeTool:async(...args)=>{if(args[1].action==='read_file')reads++;return execute(...args);}}));
 assert.equal(reads,2);assert.equal(result.agentRun.status,'idle');assert.match(result.content,/KV Cache/);
});
test('large static context does not force checkpoint after every single read',async t=>{
 const base=await setup(t),w=await createWorkspace(base,task);await fs.writeFile(path.join(w.files,'progress.json'),'short');let calls=0;
 await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(calls++===0)return {content:JSON.stringify({action:'read_file',path:'progress.json'})};
  assert.notEqual(s.requiredAction,'checkpoint');
  return {content:JSON.stringify({action:'reply',text:'利用现有文件继续'})};
 },{intent:'chat',model:{contextWindow:100000},projectContext:'背景信息'.repeat(7000)}));
});

test('changed artifact errors identify every file and successful repairs reset finish failure counters',async t=>{
 const base=await setup(t);let call=0,repairs=0;const repairQueue=[];let checkedGate=false;let savedError,lastEvidence;
 const w=await createWorkspace(base,task);
 const initial=[plan,{action:'write_file',path:'weather.txt',content:'晴天'},{action:'write_file',path:'extra.txt',content:'extra'},{action:'run_command',command:'test -f weather.txt',purpose:'检查成果'},{action:'artifact',path:'weather.txt',label:'天气'},{action:'artifact',path:'extra.txt',label:'附录'},{...plan,steps:plan.steps.map(s=>({...s,status:'done'}))}];
 const result=await runAgent(options(base,async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  lastEvidence=s.completionEvidence?.at(-1)?.id||lastEvidence;
  if(call<initial.length)return {content:JSON.stringify(initial[call++])};
  if(s.requiredAction==='checkpoint'){savedError=s.toolResults.at(-1)?.error||savedError;return {content:JSON.stringify({action:'checkpoint',text:'已制作天气和附录，外部修改导致旧登记失效；正在逐个重新登记最终内容，之后核验并完成。'+call+'-'+repairs})};}
  if(!checkedGate&&s.pendingArtifactUpdates?.length&&repairs===1){assert.deepEqual(s.pendingArtifactUpdates,['weather.txt','extra.txt']);checkedGate=true;}
  if(repairQueue.length)return {content:JSON.stringify(repairQueue.shift())};
  const error=s.toolResults.at(-1)?.error||savedError;savedError=undefined;
  if(error){
   assert.match(error,/weather\.txt/);assert.match(error,/extra\.txt/);assert.match(error,/不要直接重复 finish/);
   repairs++;
   assert.deepEqual(s.pendingArtifactUpdates,['weather.txt','extra.txt']);
   if(repairs===1){repairQueue.push({action:'artifact',path:'weather.txt',label:'天气'},{action:'artifact',path:'extra.txt',label:'附录'});return {content:JSON.stringify({action:'verify',checks:s.acceptanceCriteria.map(c=>({criterionId:c.id,kind:'file_exists',path:'weather.txt',reason:'不能跳过登记'}))})};}
   repairQueue.push({action:'artifact',path:'extra.txt',label:'附录'},{action:'run_command',command:'test -f weather.txt',purpose:'重新检查最终成果'});
   return {content:JSON.stringify({action:'artifact',path:'weather.txt',label:'天气'})};
  }
  if(repairs<3){
   await fs.writeFile(path.join(w.files,'weather.txt'),'晴天 '+repairs);
   await fs.writeFile(path.join(w.files,'extra.txt'),'extra '+repairs);
  }else if(!s.acceptanceCriteria.every(c=>c.check?.status==='passed'))return {content:JSON.stringify({action:'verify',checks:s.acceptanceCriteria.map(c=>({criterionId:c.id,kind:'text_contains',path:'weather.txt',contains:['晴天'],reason:'最终文件包含晴天'}))})};
  return {content:JSON.stringify({action:'finish',review:{summary:'已对照要求检查当前成果',issues:[],unverified:[]},text:'完成',evidence:[lastEvidence]})};
 },{executeTool:checkWeatherFile}));
 assert.equal(checkedGate,true);assert.equal(result.agentRun.status,'completed',JSON.stringify(result));assert.equal(repairs,3);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {commandOutput}=require('../apps/desktop/agent/command-output.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const at='2026-10-24T00:00:00Z';
test('log snapshots are bounded, preserve failure budgets and ignore late output and observer errors',async()=>{
 const run={inFlight:{actionId:'a'},decisionRecovery:{noActionFailures:3},events:[]};let publishes=0;
 const stream=commandOutput(run,'a',()=>{publishes++;throw Error('observer failed');});
 stream.update('x'.repeat(25000));assert.equal(run.inFlight.output.length,24000);assert.equal(run.inFlight.outputTruncated,true);
 assert.equal(run.decisionRecovery.noActionFailures,3);assert.deepEqual(run.events,[]);
 stream.close();stream.update('late');assert.equal(publishes,1);
 const next=commandOutput(run,'a',async()=>{throw Error('async observer failed');});next.update('short',{truncated:true});
 await new Promise(r=>setImmediate(r));assert.equal(run.inFlight.output,'short');assert.equal(run.inFlight.outputTruncated,true);
 run.inFlight={actionId:'b'};next.update('old command');assert.equal(run.inFlight.output,undefined);
});
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-log-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return {base,task:{id:'log',request:'检查下载',materials:[],messages:[{id:'u',role:'user',content:'检查下载'}]}};}
const plan={action:'plan',goal:'检查下载',steps:[{id:'s',title:'检查模型文件',status:'running'}],decisions:[],acceptance:['检查文件清单']};
test('running command emits actual output before completion then retains final command, tail and exit code',async t=>{
 const {base,task}=await fixture(t);let n=0,finished=false,late,seen=false;
 const actions=[{action:'route',kind:'task'},plan,{action:'run_command',command:'check-download',purpose:'检查下载进度'},{action:'pause',text:'等待继续核对'}];
 const result=await runAgent({base,task,model:{contextWindow:32768},signal:new AbortController().signal,
  ask:async()=>({content:JSON.stringify(actions[n++])}),
  onRun:run=>{if(run.inFlight?.output){assert.equal(finished,false);assert.equal(run.inFlight.command,'check-download');seen=true;}},
  executeTool:async(_w,_a,_s,options)=>{assert.equal(typeof options.onOutput,'function');late=options.onOutput;options.onOutput('download 99%');await new Promise(r=>setImmediate(r));finished=true;return {exitCode:7,output:'missing model file',truncated:false};}
 });
 assert.equal(seen,true);assert.equal(result.agentRun.inFlight,undefined);
 const event=result.agentRun.events.find(e=>e.type==='run_command');assert.equal(event.detail.command,'check-download');assert.equal(event.detail.exitCode,7);assert.equal(event.detail.output,'missing model file');assert.ok(event.detail.durationMs>=0);
 late('stale');assert.equal(result.agentRun.inFlight,undefined);
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');const w=await createWorkspace(base,task);const stored=w.run.events.find(e=>e.type==='run_command');assert.equal(stored.detail.command,event.detail.command);assert.equal(stored.detail.result.output,event.detail.output);
});
test('cancelled commands preserve their partial output and unknown journal state without replay',async t=>{
 const {base,task}=await fixture(t),controller=new AbortController();let n=0,calls=0;
 const actions=[{action:'route',kind:'task'},plan,{action:'run_command',command:'download-model',purpose:'下载模型'}];
 await assert.rejects(runAgent({base,task,model:{contextWindow:32768},signal:controller.signal,ask:async()=>({content:JSON.stringify(actions[n++])}),executeTool:async(_w,_a,_s,options)=>{calls++;options.onOutput('download 42%');controller.abort();throw Error('已停止执行');}}),/已停止/);
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),w=await createWorkspace(base,task);
 const log=w.run.events.find(e=>e.type==='command_interrupted');assert.equal(log.detail.result.output,'download 42%');assert.equal(log.detail.command,'download-model');assert.equal(w.run.actionJournal.at(-1).status,'unknown');assert.equal(w.run.inFlight,undefined);assert.equal(calls,1);
 assert.throws(require('../apps/desktop/agent/action-journal.cjs').begin.bind(null,w.run,actions[2]),/禁止自动重放/);
});
let ui;
async function components(){
 if(ui)return ui;
 const Module=require('node:module'),app=path.resolve(__dirname,'../apps/desktop'),deps=Module.createRequire(path.join(app,'package.json'));
 const {build}=await import(require('node:url').pathToFileURL(deps.resolve('rolldown')).href),input=path.join(app,'src/task-activity.tsx');
 async function compile(name){const entry=path.join(app,'src',name+'.tsx'),bundle=await build({input:entry,platform:'node',plugins:[{name:'style-free-render',load(id){if(id.endsWith('/pet.tsx'))return {code:'export function Pet(){return null}',moduleType:'js'};if(id.endsWith('.css'))return {code:'',moduleType:'js'};}}],external:['react','react/jsx-runtime'],write:false,output:{format:'cjs'}});const compiled=new Module(input,module);compiled.paths=Module._nodeModulePaths(path.dirname(input));compiled._compile(bundle.output.find(o=>o.type==='chunk').code,input);return compiled.exports;}
 ui={React:deps('react'),render:deps('react-dom/server').renderToStaticMarkup,...await compile('task-activity'),...await compile('task-progress')};return ui;
}
test('activity headline uses current work and never substitutes bookkeeping or completed command output',async()=>{
 const {React,render,TaskActivity}=await components();
 const run={status:'running',mode:'task',currentIntent:'task',steps:[],events:[{id:'cmd',type:'run_command',at,detail:{output:'POLL_DL10_DONE',exitCode:0}},{id:'book',type:'attached_progress',at,detail:{}}]};
 const task={id:'t',messages:[],agentRun:run};
 const html=render(React.createElement(TaskActivity,{task,status:'执行中',session:{id:'s',phase:'running',startedAt:at,run,status:'执行中',content:''}}));
 const summary=html.match(/<summary class="task-activity-current">([\s\S]*?)<\/summary>/)[1];
 assert.match(summary,/运行项目命令 · 分析结果中/);assert.doesNotMatch(summary,/task-activity-subtitle/);assert.doesNotMatch(summary,/POLL_DL10_DONE|更新进度与记忆|更新任务状态/);
 const live={...run,inFlight:{actionId:'a',action:'run_command',purpose:'检查模型文件完整性',command:'verify-model',at,output:'checking'}};
 const liveHtml=render(React.createElement(TaskActivity,{task,status:'执行中',session:{id:'s',phase:'running',startedAt:at,run:live,status:'执行中',content:''}}));
 assert.match(liveHtml,/检查模型文件完整性/);assert.match(liveHtml,/实时输出/);assert.match(liveHtml,/verify-model/);assert.doesNotMatch(liveHtml,/<details class="task-activity-details[^"]*"[^>]* open/);
});
test('timeline separates internal records and preserves failures, timeouts, raw commands and legacy output',async()=>{
 const {React,render,ExecutionEvents,executionEventState}=await components();
 const events=[{id:'meta',type:'attached_progress',at,detail:{}},{id:'ok',type:'run_command',at,detail:{command:'echo <tag>',output:'<script>no</script>',exitCode:0}},{id:'bad',type:'run_command',at,detail:{exitCode:1,output:'error'}},{id:'timeout',type:'run_command',at,detail:{exitCode:0,timedOut:true,output:'partial',outputTruncated:true}}];
 const html=render(React.createElement(ExecutionEvents,{events}));assert.match(html,/<details class="execution-internal"><summary>查看运行详情<\/summary>/);assert.match(html,/更新进度与记忆/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/实际命令/);assert.match(html,/24,000/);
 assert.equal(executionEventState(events[1]),'done');assert.equal(executionEventState(events[2]),'failed');assert.equal(executionEventState(events[3]),'unknown');
 assert.match(html,/命令成功不代表任务已完成或验收通过/);
 const paused=render(React.createElement(ExecutionEvents,{events:[],inFlight:{action:'run_command',at,command:'download',output:'42%'},live:false}));assert.match(paused,/结果待确认/);assert.doesNotMatch(paused,/实时输出|execution-event-running/);
});
test('folded activity exposes authorization and recovery context instead of overriding it with a generic session label',async()=>{
 const {React,render,TaskActivity}=await components();
 for(const state of ['waiting_permission','running']){
  const run={status:state,mode:'task',currentIntent:'task',goal:'部署本地模型',steps:[{id:'move',title:'移动模型到部署目录',status:'running'}],executionState:state==='waiting_permission'?{blocker:{message:'目标目录目前只有只读权限'}}:undefined,events:[{id:'retry',type:'no_action_recovery',at,detail:{}},{id:'book',type:'attached_progress',at,detail:{}}]};
  const html=render(React.createElement(TaskActivity,{task:{id:'t',messages:[],agentRun:run},status:'执行中',session:{id:'s',phase:'running',startedAt:at,run,status:'执行中',content:''}}));
  const summary=html.match(/<summary class="task-activity-current">([\s\S]*?)<\/summary>/)[1];
  assert.match(summary,state==='waiting_permission'?/等待授权/:/自动重试中/);
  assert.match(summary,state==='waiting_permission'?/目标目录目前只有只读权限/:/移动模型到部署目录/);
  assert.doesNotMatch(summary,/正在准备下一步操作|更新任务状态/);
 }
});
test('recovery-only activity is grouped separately from tool results with originals collapsed',async()=>{
 const {React,render,TaskActivity,ExecutionEvents}=await components();
 const events=[{id:'limit',type:'output_limit',at,detail:{message:'未产出动作，将精简请求并适配输出预算与决策时间后继续'}},{id:'retry',type:'no_action_recovery',at,detail:{message:'自动恢复：精简决策上下文、缩小单次动作，保留已授权工具并适配输出预算。'}},{id:'meta',type:'intent',at,detail:{}}];
 const run={mode:'task',status:'running',currentIntent:'task',goal:'检查页面效果',steps:[{id:'verify',title:'逐区对照并提交verify证据',status:'running'}],events};
 const html=render(React.createElement(TaskActivity,{task:{id:'t',messages:[],agentRun:run},status:'执行中',session:{id:'s',phase:'running',startedAt:at,run,status:'执行中',content:''}}));
 const summary=html.match(/<summary class="task-activity-current">([\s\S]*?)<\/summary>/)[1];
 assert.match(summary,/核对各区域效果 · 自动重试中/);assert.doesNotMatch(summary,/task-activity-subtitle/);assert.doesNotMatch(summary,/verify|输出预算|决策上下文/);
 const timeline=render(React.createElement(ExecutionEvents,{events}));
 assert.doesNotMatch(timeline,/execution-event-done|execution-event-running|· 已执行/);
 assert.equal((timeline.match(/class="execution-recovery"/g)||[]).length,1);
 assert.match(timeline,/2 条记录/);
 assert.match(timeline,/输出预算与决策时间/);assert.match(timeline,/精简决策上下文/);
 assert.doesNotMatch(timeline,/<details class="execution-recovery"[^>]* open/);
 assert.doesNotMatch(timeline,/<details class="execution-internal"[^>]* open/);
});
test('only the live tool action animates in both collapsed header and timeline; paused, waiting, historical and finished actions stay still',async()=>{
 const {React,render,TaskActivity,ExecutionEvents}=await components();
 const flight={actionId:'live',action:'android_device',purpose:'安装当前 APK',at};
 const base={status:'running',mode:'task',currentIntent:'task',steps:[],inFlight:flight,events:[{id:'old',type:'android_device',at,detail:{operation:'start'}}]};
 function activity(run,session=true){return render(React.createElement(TaskActivity,{task:{id:'t',messages:[],agentRun:run},status:'执行中',...(session?{session:{id:'s',phase:'running',startedAt:at,run,status:'执行中',content:''}}:{})}));}
 const live=activity(base),summary=live.match(/<summary class="task-activity-current">([\s\S]*?)<\/summary>/)[1];
 assert.match(summary,/class="activity-spinner" aria-hidden="true"/);assert.match(summary,/安装当前 APK/);assert.equal((live.match(/class="activity-spinner"/g)||[]).length,2);
 for(const status of ['paused','waiting_permission','waiting_user','blocked','failed'])assert.doesNotMatch(activity({...base,status}),/class="activity-spinner"/);
 assert.doesNotMatch(activity(base,false),/class="activity-spinner"/);
 assert.doesNotMatch(activity({...base,inFlight:undefined}),/class="activity-spinner"/);
 const finished=render(React.createElement(ExecutionEvents,{events:[{id:'done',type:'run_command',at,detail:{command:'verify',exitCode:0}}]}));assert.doesNotMatch(finished,/activity-spinner/);
});
test('live device snapshots identify the actual install operation before its result arrives',async t=>{
 const {base,task}=await fixture(t);let n=0,seen=false;
 const actions=[{action:'route',kind:'task'},plan,{action:'android_device',operation:'install',path:'app.apk'},{action:'pause',text:'已保留检查结果'}];
 await runAgent({base,task,model:{contextWindow:32768},signal:new AbortController().signal,ask:async()=>({content:JSON.stringify(actions[n++])}),onRun:run=>{if(run.inFlight?.action==='android_device'){assert.equal(run.inFlight.operation,'install');seen=true;}},executeTool:async()=>({installed:true})});
 assert.equal(seen,true);
 const {React,render,TaskActivity}=await components(),run={status:'running',mode:'task',currentIntent:'task',steps:[],events:[],inFlight:{actionId:'install',action:'android_device',operation:'install',path:'app.apk',at}};
 const html=render(React.createElement(TaskActivity,{task:{id:'t',agentRun:run},status:'执行中',session:{id:'s',phase:'running',startedAt:at,run,status:'执行中',content:''}}));
 const summary=html.match(/<summary class="task-activity-current">([\s\S]*?)<\/summary>/)[1];assert.match(summary,/安装当前 APK · 执行中/);assert.match(summary,/activity-spinner/);
});
test('suspended-network task progress offers a direct retry while unknown effects still require result checking',async()=>{
 const {React,render,TaskProgress}=await components();
 const run={status:'blocked',mode:'task',currentIntent:'task',steps:[],decisions:[],acceptance:[],artifacts:[],events:[],waitingError:{code:'MODEL_NETWORK',networkCode:'ERR_NETWORK_IO_SUSPENDED'},taskContinuation:{taskOpen:true,state:'waiting_service',question:'旧的补充诊断提示',gap:'net::ERR_NETWORK_IO_SUSPENDED',retained:{requirements:5,artifacts:[],unknownActions:0}}};
 const view=r=>render(React.createElement(TaskProgress,{task:{id:'network',messages:[],agentRun:r},busy:false,onContinue:()=>{},onOpenArtifacts:()=>{}}));
 const html=view(run);assert.match(html,/重试当前步骤/);assert.match(html,/等待网络恢复/);assert.doesNotMatch(html,/补充信息后继续|旧的补充诊断提示/);assert.match(html,/此状态不计成功交付/);
 const unknown=view({...run,taskContinuation:{...run.taskContinuation,state:'waiting_result_check',question:'先核对未知结果，不能直接重放',retained:{...run.taskContinuation.retained,unknownActions:1}}});
 assert.match(unknown,/补充信息后继续/);assert.match(unknown,/不能直接重放/);assert.doesNotMatch(unknown,/重试当前步骤/);
});

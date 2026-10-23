const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const memory=require('../apps/desktop/agent/source-memory.cjs');
const hash=text=>createHash('sha256').update(text).digest('hex');
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-source-memory-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return base;}
const layout='<FrameLayout>\n'+'<!-- 天气布局 "quoted" \\ -->\n'.repeat(310)+'<View android:id="@+id/oldId"/>\n</FrameLayout>';

test('overlapping source pages merge exactly and preserve genuine gaps',()=>{
 const run={},sha256=hash(layout),base={path:'layout.xml',sha256,total:layout.length};
 memory.remember(run,{...base,offset:0,text:layout.slice(0,3000)},'first');
 memory.remember(run,{...base,offset:4770,text:layout.slice(4770)},'last');
 let c=memory.context(run);assert.equal(c.files[0].complete,false);assert.deepEqual(c.files[0].missingRanges,[{offset:3000,end:4770}]);
 assert.equal(memory.covered(c,{...base,offset:2900,end:5000}),false);
 memory.remember(run,{...base,offset:2600,text:layout.slice(2600,6000)},'middle');
 c=memory.context(run);assert.equal(c.files[0].complete,true);assert.equal(c.files[0].ranges[0].text,layout);assert.equal(c.files[0].ranges[0].end,layout.length);
 const bounded=memory.context(run,100);assert.equal(bounded.files[0].complete,false);assert.deepEqual(bounded.files[0].missingRanges,[{offset:100,end:layout.length}]);
 const changed=layout.replace('oldId','newId');memory.remember(run,{...base,sha256:hash(changed),offset:0,text:changed},'changed');
 assert.equal(memory.context(run).files[0].ranges[0].text,changed);
});

test('result view skips progress wrappers and keeps its own exact pagination',async t=>{
 const base=await fixture(t),w=await createWorkspace(base,{id:'views',request:'读取源文件'});
 const id=await w.archiveObservation({action:'read_file',path:'layout.xml',progress:{memory:'PROGRESS_WRAPPER'.repeat(400)}},{result:{path:'layout.xml',sha256:hash(layout),offset:3000,total:3000+layout.length,text:layout}});
 const record=await w.observation(id,0,400);assert.match(record.text,/PROGRESS_WRAPPER/);
 const result=await w.observation(id,11,400,'result');assert.equal(result.text,layout.slice(11,411));assert.equal(result.next,411);assert.equal(result.source.offset,3011);assert.equal(result.source.sha256,hash(layout));
 assert.ok(!result.text.includes('PROGRESS_WRAPPER'));assert.equal(result.total,layout.length);
 await assert.rejects(w.observation(id,0,100,'unknown'),/视图/);await assert.rejects(w.observationRecord('../outside'),/无效/);
});

test('realistic activity and layout both fit repair context; oversized layouts expose tail and gaps',async t=>{
 const base=await fixture(t),w=await createWorkspace(base,{id:'repair',request:'修复布局'});
 const main='app/src/main/java/MainActivity.kt',xml='app/src/main/res/layout/activity_main.xml';
 await fs.mkdir(path.dirname(path.join(w.files,main)),{recursive:true});await fs.mkdir(path.dirname(path.join(w.files,xml)),{recursive:true});
 await fs.writeFile(path.join(w.files,main),'setContentView(R.layout.activity_main)\n'+' '.repeat(6990));
 await fs.writeFile(path.join(w.files,xml),layout);
 const build={id:'failed-build',detail:{revision:0,result:{exitCode:1,output:'e: '+pathToFileURL(path.join(w.files,main)).href+':1:1 Unresolved reference: oldId'}}};
 let context=await require('../apps/desktop/agent/repair-context.cjs').collect(w,build),file=context.files.find(f=>f.path===xml);
 assert.equal(file.complete,true);assert.equal(file.excerpts[0].text,layout);
 const large=layout.repeat(5);await fs.writeFile(path.join(w.files,xml),large);
 context=await require('../apps/desktop/agent/repair-context.cjs').collect(w,build);file=context.files.find(f=>f.path===xml);
 assert.equal(file.complete,false);assert.ok(file.missingRanges.length);assert.equal(file.excerpts.at(-1).end,large.length);
 assert.ok(context.files.reduce((n,f)=>n+f.excerpts.reduce((m,e)=>m+e.text.length,0),0)<=24000);
 for(const e of file.excerpts)assert.equal(e.text,large.slice(e.offset,e.end));
});

test('legacy source pages survive restart and stale archives cannot replace current text',async t=>{
 const base=await fixture(t),task={id:'legacy',request:'继续修改'},w=await createWorkspace(base,task);
 await fs.writeFile(path.join(w.files,'layout.xml'),layout);
 for(const [offset,end] of [[0,4000],[3000,7000],[4770,layout.length]]){
  const id=await w.archiveObservation({action:'read_file',path:'layout.xml'},{result:{path:'layout.xml',sha256:hash(layout),offset,text:layout.slice(offset,end),total:layout.length}});
  w.run.observationIndex||=[];w.run.observationIndex.push({id,action:'read_file',path:'layout.xml'});
 }
 await w.save();const restarted=await createWorkspace(base,task);await memory.hydrate(restarted);
 assert.equal(memory.context(restarted.run).files[0].ranges[0].text,layout);
 const current=layout+'current';await fs.writeFile(path.join(w.files,'layout.xml'),current);
 memory.remember(restarted.run,{path:'layout.xml',sha256:hash(current),offset:0,text:current,total:current.length},'new');
 await memory.hydrate(restarted);assert.equal(memory.context(restarted.run).files[0].sha256,hash(current));
});

for(const batched of [false,true])test('recovery reuses long source across tools then edits and builds without a pagination loop'+(batched?' (batch)':''),async t=>{
 const base=await fixture(t),task={id:'complete',request:'修复布局并生成构建报告'},w=await createWorkspace(base,task),relative='activity_main.xml';
 await fs.writeFile(path.join(w.files,relative),layout);const sha256=hash(layout);let archiveId;
 for(const [offset,end] of [[0,4000],[3000,7000],[4770,layout.length]]){
  const id=await w.archiveObservation({action:'read_file',path:relative,progress:{memory:'准备修改布局'.repeat(200)}},{result:{path:relative,sha256,offset,total:layout.length,text:layout.slice(offset,end)}});
  w.run.observationIndex||=[];w.run.observationIndex.push({id,action:'read_file',path:relative});archiveId=id;
 }
 w.run.checkpointObservationCount=w.run.observationIndex.length;await w.save();
 let n=0,reads=0,builds=0;const reply=a=>({content:JSON.stringify(a)});
 const result=await runAgent({base,task,model:{id:'company',contextWindow:1000000,maxOutputTokens:65536},signal:new AbortController().signal,
 executeTool:async(workspace,a,signal,options)=>{
  if(a.action==='read_file'||a.action==='read_execution')reads++;
  if(a.action==='build_android'){builds++;assert.ok((await fs.readFile(path.join(w.files,relative),'utf8')).includes('@+id/newId'));await fs.writeFile(path.join(w.files,'report.txt'),'BUILD SUCCESSFUL');return {exitCode:0,output:'BUILD SUCCESSFUL'};}
  return execute(workspace,a,signal,options);
 },ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(s.requiredAction==='checkpoint')return reply({action:'checkpoint',text:'已保留当前布局精确原文及来源，修复后构建并生成报告，不重复分页读取。'});
  n++;
  if(n===1)return reply({action:'route',kind:'task'});
  if(n===2)return reply({action:'plan',goal:task.request,decisions:[],acceptance:['报告包含 BUILD SUCCESSFUL'],steps:[{id:'fix',title:'修复并构建',status:'running'}]});
  if(n===3)throw Object.assign(Error('timeout'),{code:'MODEL_NO_ACTION_TIMEOUT'});
  if(n>=4&&n<=8){const f=s.sourceContext.files.find(f=>f.path===relative);assert.equal(f.complete,true);assert.equal(f.ranges[0].text,layout);}
  if(n===4)return reply(batched?{action:'batch_read',items:[{action:'read_file',path:relative,offset:0,limit:3000},{action:'read_file',path:relative,offset:5000,limit:3000}]}:{action:'read_file',path:relative,offset:0,limit:4000});
  if(n===5)return reply({action:'read_execution',id:archiveId,offset:754,limit:4000});
  if(n===6){assert.equal(s.readRecovery.kind,'source_reuse');return reply({action:'read_file',path:relative,offset:4770,limit:3000});}
  if(n===7)return reply({action:'read_file',path:relative,offset:6000,limit:4000});
  if(n===8)return reply({action:'edit_file',path:relative,version:sha256,edits:[{oldText:'@+id/oldId',newText:'@+id/newId'}]});
  if(n===9)return reply({action:'build_android',tasks:[':app:assembleDebug']});
  if(n===10)return reply({action:'artifact',path:'report.txt',label:'报告'});
  if(n===11)return reply({action:'verify',checks:[{criterionId:s.acceptanceCriteria[0].id,kind:'text_contains',path:'report.txt',contains:['BUILD SUCCESSFUL'],reason:'核验构建报告'}],progress:{steps:[{id:'fix',status:'done'}]}});
  return reply({action:'finish',text:'完成',review:{summary:'已修复并构建',issues:[],unverified:[]}});
 }});
 assert.equal(result.agentRun.status,'completed');assert.equal(n,12);assert.equal(reads,1);assert.equal(builds,1);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');
const receipts=require('../apps/desktop/agent/read-receipts.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const {runSegments}=require('../apps/desktop/agent/execution-segments.cjs');
const workingContext=require('../apps/desktop/agent/working-context.cjs');
const hash=text=>createHash('sha256').update(text).digest('hex');
const stable=value=>value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const key=target=>JSON.stringify(stable(target));
const fileKey=(version,extra={})=>key({action:'read_file',path:'source.txt',version,offset:0,limit:100,...extra});
async function fixture(t,name){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-receipts-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:name,projectId:'p',request:'保留读取凭据并继续验证'};return {base,task,workspace:await createWorkspace(base,task)};}
async function archive(workspace,action,response){const id=await workspace.archiveObservation(action,response);workspace.run.observationIndex||=[];workspace.run.observationIndex.push(workingContext.receipt({action,response,observationId:id}));return id;}

test('durable receipts contain bounded metadata and restore without changing execution budgets',()=>{
 const version=hash('source'),run={executionId:randomUUID(),readAttempts:[[fileKey(version),2]],loopRecovery:{attempts:2},failureEpisodes:{failures:4},progressEvidence:['proof']};
 const prior=JSON.stringify(run),id=randomUUID();
 assert.equal(receipts.remember(run,fileKey(version),{sourceObservationId:id,sha256:version,path:'source.txt',offset:0,limit:100,next:100,total:1000,text:'do not persist source',command:'do not persist command'}),true);
 const restored=receipts.restore(JSON.parse(JSON.stringify(run))),value=restored.get(fileKey(version));
 assert.deepEqual(value,{sourceObservationId:id,next:100,total:1000,path:'source.txt',sha256:version,offset:0,limit:100});
 const {readReceipts,...unchanged}=run;assert.equal(JSON.stringify(unchanged),prior);assert.ok(!JSON.stringify(readReceipts).includes('do not persist'));
 const noNext=fileKey(version,{offset:100});assert.equal(receipts.remember(run,noNext,{sourceObservationId:randomUUID(),sha256:version}),true);assert.equal(Object.hasOwn(receipts.restore(run).get(noNext),'next'),false);
});

test('receipt keys separate file versions, ranges, record views and directory revisions',()=>{
 const version=hash('old'),run={executionId:randomUUID()},id=randomUUID(),target=fileKey(version);
 for(const metadata of [{sha256:hash('new')},{sha256:version,path:'other.txt'},{sha256:version,offset:1},{sha256:version,limit:200},{sha256:version,next:101,total:100}])assert.equal(receipts.remember(run,target,{sourceObservationId:id,...metadata}),false);
 assert.equal(receipts.remember(run,target,{sourceObservationId:id,sha256:version,next:null,total:100}),true);
 assert.equal(receipts.restore(run).has(fileKey(hash('new'))),false);assert.equal(receipts.restore(run).has(fileKey(version,{limit:200})),false);
 const viewKey=view=>key({action:'read_execution',id:randomUUID(),view,offset:0,limit:100});
 const recordKey=viewKey('result');assert.equal(receipts.remember(run,recordKey,{sourceObservationId:id,next:100}),true);assert.equal(receipts.restore(run).has(recordKey),true);
 assert.equal(receipts.remember(run,viewKey('unsafe'),{sourceObservationId:id}),false);
 for(const location of [undefined,'','.', 'src']){const directory=key({action:'list_files',...(location===undefined?{}:{path:location}),offset:0,revision:3});assert.equal(receipts.remember(run,directory,{sourceObservationId:id}),true);assert.equal(receipts.restore(run).has(directory),true);assert.equal(receipts.restore(run).has(key({action:'list_files',...(location===undefined?{}:{path:location}),offset:0,revision:4})),false);}
 for(const location of ['../escape','/tmp/absolute','a/../b'])assert.equal(receipts.remember(run,key({action:'list_files',path:location,revision:0}),{sourceObservationId:id}),false);
 for(const revision of [undefined,-1,'3'])assert.equal(receipts.remember(run,key({action:'list_files',revision}),{sourceObservationId:id}),false);
 assert.equal(receipts.remember(run,key({action:'write_file',path:'source.txt'}),{sourceObservationId:id}),false);
 assert.equal(receipts.remember(run,key({action:'read_file',path:'source.txt',version,offset:0,limit:100,command:'unsafe'}),{sourceObservationId:id,sha256:version}),false);
 assert.equal(receipts.restore({...run,executionId:randomUUID()}).size,0);
});

test('receipt LRU and malformed persisted entries remain bounded',()=>{
 const run={executionId:randomUUID()},version=hash('bounded'),id=randomUUID();
 for(let offset=0;offset<receipts.MAX_RECEIPTS+10;offset++)assert.equal(receipts.remember(run,fileKey(version,{offset}),{sourceObservationId:id,sha256:version}),true);
 assert.equal(run.readReceipts.entries.length,receipts.MAX_RECEIPTS);assert.equal(receipts.restore(run).has(fileKey(version,{offset:0})),false);assert.equal(receipts.restore(run).has(fileKey(version,{offset:10})),true);
 run.readReceipts.entries.push(null,{key:'not json',sourceObservationId:id},{key:fileKey(version),sourceObservationId:'not-an-id',sha256:version});assert.ok(receipts.restore(run).size<=receipts.MAX_RECEIPTS);
});

test('actual workspace persistence carries usable references across segments without replay or new progress',async t=>{
 const {base,task,workspace}=await fixture(t,'segments'),content='0123456789'.repeat(150),version=hash(content),identity=fileKey(version),signal=new AbortController().signal;
 await fs.writeFile(path.join(workspace.files,'source.txt'),content);workspace.run.executionId=randomUUID();workspace.run.loopRecovery={attempts:2};workspace.run.progressEvidence=['original-proof'];workspace.run.failureEpisodes={count:3};await workspace.save();
 let toolCalls=0,segments=0,sourceId;
 const result=await runSegments(async options=>{
  segments++;const current=await createWorkspace(base,task);
  if(options.segmentIndex===0){
   for(let n=0;n<2;n++){toolCalls++;const action={action:'read_file',path:'source.txt',offset:0,limit:100},page=await execute(current,action,signal);sourceId=await archive(current,action,{result:page});assert.equal(receipts.remember(current.run,identity,{...page,sourceObservationId:sourceId}),true);}
   current.run.readAttempts=[[identity,2]];
   // A real segment can evict all recent observations while retaining its index.
   current.run.observations=[];await current.save();
   return {agentRun:{mode:'task',status:'paused'},continuation:{safe:true}};
  }
  assert.equal(options.continuationReason,'segment');assert.equal(current.run.observations.length,0);assert.equal(current.run.readAttempts[0][1],2);
  const before=JSON.stringify({loop:current.run.loopRecovery,proof:current.run.progressEvidence,failures:current.run.failureEpisodes}),previous=receipts.restore(current.run).get(identity);
  assert.equal(previous.sourceObservationId,sourceId);assert.equal(previous.next,100);assert.equal(previous.total,content.length);
  const saved=await current.observationRecord(previous.sourceObservationId);assert.equal(saved.action.action,'read_file');assert.equal(saved.response.result.text,content.slice(0,100));assert.equal(saved.response.result.sha256,version);
  assert.equal(JSON.stringify({loop:current.run.loopRecovery,proof:current.run.progressEvidence,failures:current.run.failureEpisodes}),before);
  await fs.writeFile(path.join(current.files,'source.txt'),'changed');assert.equal(receipts.restore(current.run).has(fileKey(hash('changed'))),false);
  return {agentRun:{mode:'task',status:'completed'},content:'references retained'};
 },{signal,policy:{segmentSteps:1,segmentDurationMs:1000,maxSegments:2,maxTotalDurationMs:5000}});
 assert.equal(result.agentRun.status,'completed');assert.equal(segments,2);assert.equal(toolCalls,2);
});

test('0.1.66 migration reads only matching archived file results and never crosses SHA, range or execution',async t=>{
 const {base,task,workspace}=await fixture(t,'legacy'),content='abcdefghij'.repeat(200),version=hash(content),signal=new AbortController().signal;
 workspace.run.executionId=randomUUID();await fs.writeFile(path.join(workspace.files,'source.txt'),content);
 const action={action:'read_file',path:'source.txt',offset:0,limit:100},page=await execute(workspace,action,signal),validId=await archive(workspace,action,{result:page});
 await archive(workspace,{action:'write_file',path:'source.txt'},{result:{changed:true}});
 await archive(workspace,action,{error:'failed read'});
 const identity=fileKey(version),changed=fileKey(hash('changed')),differentLimit=fileKey(version,{limit:200}),differentOffset=fileKey(version,{offset:100});
 workspace.run.readAttempts=[[identity,2],[changed,2],[differentLimit,2],[differentOffset,2]];workspace.run.observations=[];await workspace.save();
 const current=await createWorkspace(base,task),original=current.observationRecord.bind(current),lookedUp=[];current.observationRecord=async(id,options)=>{lookedUp.push(id);assert.deepEqual(options,{archiveOnly:true});return original(id,options);};
 const before=JSON.stringify(current.run.readAttempts),result=await receipts.hydrate(current);
 assert.deepEqual(result,{restored:1,checkedArchives:2,unresolved:3});assert.equal(lookedUp.includes(validId),true);assert.equal(lookedUp.length,2);assert.equal(JSON.stringify(current.run.readAttempts),before);
 const restored=receipts.restore(current.run);assert.equal(restored.get(identity).sourceObservationId,validId);assert.equal(restored.get(identity).next,100);assert.equal(restored.has(changed),false);assert.equal(restored.has(differentLimit),false);assert.equal(restored.has(differentOffset),false);
 await current.save();assert.equal(receipts.restore((await createWorkspace(base,task)).run).get(identity).sourceObservationId,validId);
 const other={...current,run:{...current.run,executionId:randomUUID(),readReceipts:undefined}};assert.equal((await receipts.hydrate(other)).restored,0);
});

test('legacy migration never infers EOF or next from partial metadata and obeys archive budget',async t=>{
 const {workspace}=await fixture(t,'unknown'),version=hash('old'),identity=fileKey(version);workspace.run.executionId=randomUUID();
 const valid=await archive(workspace,{action:'read_file',path:'source.txt',limit:100},{result:{text:'partial',sha256:version}});
 await archive(workspace,{action:'read_file',path:'source.txt',limit:100},{result:{text:'failed placeholder',sha256:version,notExecuted:true}});
 workspace.run.readAttempts=[[identity,2]];assert.deepEqual(await receipts.hydrate(workspace,{maxArchives:1}),{restored:0,checkedArchives:1,unresolved:1});
 assert.deepEqual(await receipts.hydrate(workspace),{restored:1,checkedArchives:2,unresolved:0});
 const restored=receipts.restore(workspace.run).get(identity);assert.equal(restored.sourceObservationId,valid);assert.equal(Object.hasOwn(restored,'next'),false);assert.equal(Object.hasOwn(restored,'total'),false);
 let reads=0;workspace.observationRecord=async()=>{reads++;throw Object.assign(Error('missing'),{code:'EXECUTION_RECORD_NOT_FOUND'});};delete workspace.run.readReceipts;
 assert.deepEqual(await receipts.hydrate(workspace),{restored:0,checkedArchives:2,unresolved:1});assert.equal(reads,2);assert.equal(receipts.restore(workspace.run).size,0);
 for(const maxArchives of [0,-1,1025,1.5])await assert.rejects(receipts.hydrate(workspace,{maxArchives}),/迁移预算/);
});

test('a missing actual archive stays unresolved even when execution-log fallback could supply a result',async t=>{
 const {task,workspace}=await fixture(t,'missing-archive'),version=hash('past source'),identity=fileKey(version);workspace.run.executionId=randomUUID();
 const action={action:'read_file',path:'source.txt',offset:0,limit:100},result={path:'source.txt',sha256:version,text:'past source',offset:0,next:null,total:11};
 await workspace.event('read_file',{path:'source.txt',offset:0,limit:100,result});const event=workspace.run.events.at(-1),id=await archive(workspace,action,{eventId:event.id,result});
 workspace.run.readAttempts=[[identity,2]];
 await fs.unlink(path.join(workspace.project,'runs',hash(task.id)+'.json.observations',id+'.json'));
 // Legacy/manual recall remains available, but migration cannot trigger it.
 assert.equal((await workspace.observationRecord(id)).response.result.sha256,version);
 await assert.rejects(workspace.observationRecord(id,{archiveOnly:true}),{code:'EXECUTION_RECORD_NOT_FOUND'});
 assert.deepEqual(await receipts.hydrate(workspace),{restored:0,checkedArchives:1,unresolved:1});assert.equal(receipts.restore(workspace.run).size,0);
});

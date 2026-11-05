const test=require('node:test'),assert=require('node:assert/strict');
const {createReplyMetrics,summarizeRequests}=require('../apps/desktop/request-metrics.cjs');
const {trialEfficiency}=require('./agent-eval-efficiency.cjs');
test('reply timing counts preparation and queueing, not status, reasoning or tool arguments',()=>{
 let clock=100;const m=createReplyMetrics({now:()=>clock});
 clock=250;m.text('');m.text('   ');assert.equal(m.capture().firstReplyMs,null);
 clock=500;m.text('正文');clock=900;m.text('正文继续');
 assert.equal(m.capture().firstReplyMs,400);assert.equal(m.capture().firstStreamTextMs,400);
 assert.equal(m.capture().firstReplySource,'stream');assert.equal(m.capture().coverageComplete,false);
});
test('final-only delivery is timed separately from streamed text; duplicate request IDs do not inflate ratios',()=>{
 let clock=0;const m=createReplyMetrics({now:()=>clock});
 m.record({id:'1',metricsVersion:1,action:'route',durationMs:10,outcome:'completed'});
 m.record({id:'1',metricsVersion:1,action:'route',durationMs:10,outcome:'completed'});
 m.record({id:'2',metricsVersion:1,action:'write_file',durationMs:30,outcome:'completed',content:'SECRET'});
 clock=100;m.text('成果','final');const p=m.capture();
 assert.equal(p.firstReplyMs,100);assert.equal(p.firstStreamTextMs,null);assert.equal(p.firstReplySource,'final');
 assert.equal(p.modelRequests,2);assert.equal(p.processRequestRatio,.5);assert.equal(p.processTimeRatio,.25);
 assert.ok(!JSON.stringify(p).includes('SECRET'));
});
test('legacy, incomplete and zero-duration records cannot fabricate complete metrics',()=>{
 assert.equal(summarizeRequests([{action:'route',durationMs:10}]).processRequestRatio,null);
 assert.equal(summarizeRequests([{metricsVersion:1,action:'route',durationMs:10}],{expectedRequests:2}).processRequestRatio,null);
 assert.equal(summarizeRequests([{metricsVersion:1,action:'route',durationMs:NaN}]).processTimeRatio,null);
 assert.equal(summarizeRequests([{metricsVersion:1,action:'route',durationMs:0}]).processTimeRatio,null);
 const p=summarizeRequests([{metricsVersion:1,action:'request_tools',durationMs:2},{metricsVersion:1,durationMs:3,protocolErrorReason:'invalid_json',outcome:'completed'},{metricsVersion:1,durationMs:5,outcome:'failed'}]);
 assert.equal(p.processRequestRatio,1/3);assert.equal(p.protocolErrorRequests,1);assert.equal(p.failedModelRequests,1);
});
test('evaluation reports missing TTFT as unknown and keeps first turn separate from later/resumed turns',()=>{
 const records=[{metricsVersion:1,action:'route',durationMs:10}];
 assert.equal(trialEfficiency({result:{replyDetails:{performance:{firstReplyMs:1}}}},records).firstReplyMs,null);
 const p=trialEfficiency({actualModelRequests:1,responseTimings:[{firstReplyMs:80,firstStreamTextMs:null},{firstReplyMs:3,firstStreamTextMs:3}]},records);
 assert.equal(p.firstReplyMs,80);assert.equal(p.firstStreamTextMs,null);assert.equal(p.segmentOnly,true);
 assert.equal(trialEfficiency({actualModelRequests:2},records).processRequestRatio,null);
});
test('report includes new efficiency fields without retroactively inventing baseline timings',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-efficiency-report-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const fixture=require('./agent-eval-cases.cjs').cases[0];
 for(const version of ['baseline','candidate']){
  const dir=path.join(root,version,fixture.id+'-1');await fs.mkdir(dir,{recursive:true});
  const candidate=version==='candidate';
  await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({elapsedMs:50,actualModelRequests:2,result:{agentRun:{status:'paused'}},...(candidate?{responseTimings:[{firstReplyMs:40,firstStreamTextMs:30}]}:{})}));
  await fs.writeFile(path.join(dir,'requests.json'),JSON.stringify([{action:'route',durationMs:10,...(candidate?{metricsVersion:1}:{})},{action:'reply',durationMs:20,...(candidate?{metricsVersion:1}:{})}]));
 }
 const report=await require('./agent-eval-report.cjs').summarize(root,{print:false});
 assert.equal(report.versions.baseline.medianFirstReplyMs,null);assert.equal(report.versions.baseline.medianProcessRequestRatio,null);
 assert.equal(report.versions.candidate.medianFirstReplyMs,40);assert.equal(report.versions.candidate.medianProcessRequestRatio,.5);
 assert.equal(report.versions.candidate.verifiedSuccess,0);
 assert.match(await fs.readFile(path.join(root,'report.md'),'utf8'),/不包含界面绘制/);
});

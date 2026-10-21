const {test}=require('node:test'),assert=require('node:assert/strict');
const {record,idFor}=require('../apps/desktop/agent/browser-diagnostics.cjs');
const requirements=[{id:'visual',type:'visual'}];
const observe=(path,items,extra={})=>({id:Math.random().toString(),type:'browser',at:new Date().toISOString(),detail:{result:{path,scope:{kind:'viewport',path,rect:{x:0,y:0,width:1280,height:900}},errors:[],dom:{imageHealth:{items,total:items.length,truncated:false,...extra}}}}});
const apply=(w,e)=>record(w,e,requirements);
const item=(src,status)=>({src,status});
test('35 legacy failures close on successful reinspection and reopen on an actual regression',()=>{
 const path='gallery.html',w={run:{issues:Array.from({length:35},(_,i)=>{const description='资源加载失败：'+i+'.png';return {id:idFor(path,description),description,status:'open',scope:{kind:'viewport',path},requirementIds:['visual']};})}};
 const good=observe(path,Array.from({length:47},(_,i)=>item(i+'.png','loaded')));apply(w,good);
 assert.equal(w.run.browserDiagnostics.failed,0);assert.equal(w.run.browserDiagnostics.loaded,47);
 assert.equal(w.run.issues.length,35);assert.ok(w.run.issues.every(i=>i.status==='resolved'&&i.evidenceId===good.id));
 const bad=observe(path,[item('3.png','failed')]);apply(w,bad);
 const issue=w.run.issues.find(i=>i.description.endsWith('：3.png'));
 assert.equal(issue.status,'open');assert.equal(issue.evidenceId,undefined);
 assert.equal(w.run.issues.filter(i=>i.status==='open').length,1);
});
test('pending, absent in truncated scans, other pages and empty inventories cannot clear a failure',()=>{
 const w={run:{issues:[]}};apply(w,observe('a.html',[item('x.png','failed')]));
 for(const e of [observe('a.html',[item('x.png','pending')]),observe('b.html',[item('x.png','loaded')]),observe('a.html',[item('y.png','loaded')],{truncated:true}),observe('a.html',[])]){apply(w,e);assert.equal(w.run.issues[0].status,'open');}
 apply(w,observe('a.html',[item('x.png','loaded')],{truncated:true,total:3000}));assert.equal(w.run.issues[0].status,'open');
 apply(w,observe('a.html',[item('x.png','loaded')]));assert.equal(w.run.issues[0].status,'resolved');
});
test('renamed resources resolve only when the replacement inventory is completely loaded',()=>{
 const w={run:{issues:[]}};apply(w,observe('a.html',[item('中文.png','failed')]));
 apply(w,observe('a.html',[item('01.png','pending')]));assert.equal(w.run.issues[0].status,'open');
 apply(w,observe('a.html',[item('01.png','loaded')]));assert.equal(w.run.issues[0].status,'resolved');
});
test('legacy missing lists still open errors but absence alone does not prove recovery',()=>{
 const w={run:{issues:[]}},e=observe('a.html',[]);delete e.detail.result.dom.imageHealth;
 e.detail.result.dom.missingImages=['x.png'];apply(w,e);
 e.detail.result.dom.missingImages=[];apply(w,e);assert.equal(w.run.issues[0].status,'open');
});
test('resource recovery does not close manual issues or runtime errors',()=>{
 const w={run:{issues:[{id:'manual',status:'open',description:'资源加载失败：x.png',scope:{path:'a.html'}}]}};
 const bad=observe('a.html',[item('x.png','failed')]);bad.detail.result.errors=['script error'];apply(w,bad);
 apply(w,observe('a.html',[item('x.png','loaded')]));
 assert.equal(w.run.issues.find(i=>i.id==='manual').status,'open');
 assert.equal(w.run.issues.find(i=>i.description==='页面运行错误：script error').status,'open');
});
test('agent receives resolved issues and current diagnostics after a fresh browser recheck',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-diagnostic-recheck-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 let calls=0,observations=0;
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task:{id:'recheck',request:'检查页面图片'},model:{contextWindow:65536},signal:new AbortController().signal,
  executeTool:async()=>observe('gallery.html',[item('x.png',observations++?'loaded':'failed')]).detail.result,
  ask:async messages=>{
   const state=JSON.parse(messages.at(-1).content);calls++;
   if(calls===1)return {content:JSON.stringify({action:'route',kind:'task'})};
   if(calls===2)return {content:JSON.stringify({action:'plan',goal:'检查页面图片',decisions:[],acceptance:['图片正确加载'],steps:[{id:'check',title:'复检页面',status:'running'}]})};
   if(calls<=4)return {content:JSON.stringify({action:'browser',operation:'open',path:'gallery.html',purpose:'复检图片加载'})};
   assert.equal(state.issues.length,1,JSON.stringify(state.failureMemory));assert.equal(state.issues[0].status,'resolved');
   assert.equal(state.browserDiagnostics.failed,0);assert.equal(state.browserDiagnostics.loaded,1);
   return {content:JSON.stringify({action:'pause',text:'最新复检确认图片已加载，无须再次修改路径。'})};
  }});
 assert.equal(result.content,'最新复检确认图片已加载，无须再次修改路径。');assert.equal(observations,2);
});

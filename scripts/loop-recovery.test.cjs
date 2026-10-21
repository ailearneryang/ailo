const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const hash=text=>createHash('sha256').update(text).digest('hex');
async function base(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-loop-recovery-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
const plan={action:'plan',goal:'生成总览网页',decisions:[],requirements:[{id:'page',text:'网页包含天气标题',type:'content'}],steps:[{id:'make',title:'生成并检查网页',status:'running'}]};
const html='<h1>天气效果图总览</h1>',file='render-output/效果图总览.html';
test('repeated browser opens reuse existing evidence and complete without a user continuation',async t=>{
 const directory=await base(t);let calls=0,browsers=0,recoverySeen=false;
 const result=await runAgent({base:directory,task:{id:'t',request:plan.goal},model:{contextWindow:65536,imageInput:'disabled'},signal:new AbortController().signal,
 executeTool:async(w,a,signal,options)=>{
  if(a.action!=='browser')return execute(w,a,signal,options);
  browsers++;await fs.mkdir(path.join(w.files,'.ailo-observations'),{recursive:true});
  const screenshot='.ailo-observations/'+browsers+'.png';await fs.writeFile(path.join(w.files,screenshot),'fake screenshot');
  return {path:file,screenshot,sha256:hash('fake screenshot'),sources:[{path:file,sha256:hash(html)}],scope:{kind:'viewport',path:file,rect:{x:0,y:0,width:1280,height:900}},dom:{missingImages:[],layoutHealth:{scope:'document',textNodes:1,clippedTextNodes:0}},errors:[]};
 },ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(s.requiredAction==='checkpoint')return {content:JSON.stringify({action:'checkpoint',text:'总览网页已生成并登记，浏览器结果与截图已保存在归档；下一步复用当前结果完成内容核验并交付，不重复打开页面。'})};
  calls++;
  if(calls===1)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(calls===2)return {content:JSON.stringify(plan)};
  if(calls===3)return {content:JSON.stringify({action:'write_file',path:file,content:html})};
  if(calls===4)return {content:JSON.stringify({action:'artifact',path:file,label:'效果图总览'})};
  if(calls<=7)return {content:JSON.stringify({action:'browser',operation:'open',path:file,purpose:'再次检查'})};
  if(calls===8){
   assert.equal(s.loopRecovery.blockedAction.action,'browser');assert.equal(s.loopRecovery.location.path,file);
   assert.ok(s.loopRecovery.previousObservation.sourceObservationId);assert.ok(s.loopRecovery.evidence.some(e=>e.action==='browser'));
   assert.equal(s.decisionRecovery.stage,'refocus');recoverySeen=true;
   // A model trying to stop for this internal problem is corrected too.
   return {content:JSON.stringify({action:'pause',text:'请用户点击继续'})};
  }
  if(calls===9){assert.ok(s.loopRecovery);return {content:JSON.stringify({action:'verify',checks:[{criterionId:'page',kind:'text_contains',path:file,contains:['天气'],reason:'核对标题'}],progress:{steps:[{id:'make',status:'done'}]}})};}
  return {content:JSON.stringify({action:'finish',text:'总览网页已交付',review:{summary:'已检查内容与网页结构',issues:[],unverified:[]}})};
 }});
 assert.ok(recoverySeen);assert.equal(result.agentRun.status,'completed',JSON.stringify(result.agentRun.events));assert.equal(browsers,2);assert.equal(calls,10);
 assert.ok(!result.agentRun.events.some(e=>e.type==='no_progress'||e.type==='execution_budget'));
});
test('a batch without substantive progress refocuses internally and then produces a result',async t=>{
 const directory=await base(t);let stage=0,recovered=false;
 const result=await runAgent({base:directory,task:{id:'t',request:'生成天气说明'},model:{contextWindow:65536},signal:new AbortController().signal,batchSize:2,maxSteps:20,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(stage++===0)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(stage===2)return {content:JSON.stringify({...plan,goal:'生成天气说明'})};
  if(!s.loopRecovery&&!recovered)return {content:JSON.stringify({action:'checkpoint',text:'已保存天气说明的需求与计划，下一步生成文件并检查其内容，不重复读取。'})};
  if(!recovered){assert.equal(s.loopRecovery.kind,'no_progress');recovered=true;return {content:JSON.stringify({action:'write_file',path:'weather.txt',content:'天气说明'})};}
  if(!s.artifacts.length)return {content:JSON.stringify({action:'artifact',path:'weather.txt',label:'天气说明'})};
  if(!s.acceptanceCriteria[0].check)return {content:JSON.stringify({action:'verify',checks:[{criterionId:'page',kind:'text_contains',path:'weather.txt',contains:['天气'],reason:'核对天气标题'}],progress:{steps:[{id:'make',status:'done'}]}})};
  return {content:JSON.stringify({action:'finish',text:'天气说明已交付',review:{summary:'内容已核对',issues:[],unverified:[]}})};
 }});
 assert.ok(recovered);assert.equal(result.agentRun.status,'completed');assert.ok(result.agentRun.events.some(e=>e.type==='loop_recovery'));
});
test('a model that never changes its decision cannot replay the repeated tool indefinitely',async t=>{
 const directory=await base(t);let calls=0,executed=0;
 const result=await runAgent({base:directory,task:{id:'t',request:'查看材料',materials:[{name:'data.txt',text:'天气'}]},model:{contextWindow:65536},signal:new AbortController().signal,maxSteps:10,batchSize:4,executeTool:async()=>{executed++;return {text:'天气',offset:0,next:null,total:2};},ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  return {content:JSON.stringify(calls++?{action:'read_material',id:s.materials[0].id}:{action:'route',kind:'chat'})};
 }});
 assert.equal(executed,2);assert.match(result.content,/决策轮数预算/);assert.ok(result.agentRun.events.some(e=>e.type==='loop_recovery'));
 assert.ok(!result.agentRun.events.some(e=>e.type==='no_progress'));
});
test('internal loop recovery still stops for a real permission request',async t=>{
 const directory=await base(t);let calls=0,permissionCalls=0;
 const result=await runAgent({base:directory,task:{id:'t',request:'读取材料并保存',materials:[{name:'input.txt',text:'天气'}]},model:{contextWindow:65536},signal:new AbortController().signal,maxSteps:15,
 executeTool:async(w,a,signal,options)=>{
  if(a.action==='write_file'){permissionCalls++;throw Object.assign(Error('需要用户授权目标目录'),{code:'PERMISSION_REQUIRED'});}
  return execute(w,a,signal,options);
 },ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);
  if(s.requiredAction==='checkpoint')return {content:JSON.stringify({action:'checkpoint',text:'已读取天气材料并保留来源记录，下一步根据已有内容保存目标文件，若缺少权限则请求真实授权。'})};
  calls++;
  if(calls===1)return {content:JSON.stringify({action:'route',kind:'task'})};
  if(calls===2)return {content:JSON.stringify(plan)};
  if(s.loopRecovery)return {content:JSON.stringify({action:'write_file',path:'protected.txt',content:'天气'})};
  return {content:JSON.stringify({action:'read_material',id:s.materials[0].id})};
 }});
 assert.equal(permissionCalls,1);assert.equal(result.agentRun.status,'waiting_permission');assert.match(result.content,/授权目标目录/);
});
test('explicit cancellation during loop recovery never requests another model decision',async t=>{
 const directory=await base(t),controller=new AbortController();let calls=0;
 await assert.rejects(runAgent({base:directory,task:{id:'t',request:'查看材料',materials:[{name:'input.txt',text:'天气'}]},model:{contextWindow:65536},signal:controller.signal,
  onRun:run=>{if(run.events.at(-1)?.type==='loop_recovery')controller.abort();},ask:async messages=>{
   const s=JSON.parse(messages.at(-1).content);calls++;
   return {content:JSON.stringify(calls===1?{action:'route',kind:'chat'}:{action:'read_material',id:s.materials[0].id})};
  }}),/已停止/);
 assert.equal(calls,5);
});

// Run with: apps/desktop/node_modules/.bin/electron scripts/observation-electron-smoke.cjs
const {app,protocol,BrowserWindow,session,nativeImage}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const profile=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'ailo-electron-profile-'));app.setPath('userData',profile);
console.log('Electron',process.versions.electron);
protocol.registerSchemesAsPrivileged([{scheme:'ailo-project',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 let base,browser;
 try{
  base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-browser-smoke-'));
  const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
  const w=await createWorkspace(base,{id:'smoke',projectId:'p',request:'检查网页'});w.run.executionId='smoke';
  await fs.writeFile(path.join(w.files,'index.html'),`<!doctype html><title>Observe</title><h1 id="status">Ready</h1><input id="name"><button id="go" onclick="document.querySelector('#status').textContent=document.querySelector('#name').value">Apply</button><div style="position:absolute;left:-10000px">offscreen</div><div style="position:absolute;left:9000px">far-right</div><div style="position:absolute;top:9000px">far-bottom</div><div style="overflow:hidden;width:20px;height:10px"><p>clipped-content</p></div><p style="display:none">hidden-only</p>`);
  const baseline=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});await baseline.loadURL('data:text/html,<h1>Baseline</h1>');assert.equal(await baseline.webContents.executeJavaScript('document.body.innerText'),'Baseline');baseline.destroy();console.log('PASS: renderer baseline');
  browser=require('../apps/desktop/agent/browser-observer.cjs').createBrowserObserver({BrowserWindow,session});
  const signal=new AbortController().signal;
  const opened=await browser.execute(w,{operation:'open',path:'index.html',width:800,height:600},signal);
  assert.equal(opened.dom.viewport.width,800);assert.ok(opened.dom.offscreen>0);assert.equal(opened.errors.length,0);
  await browser.execute(w,{operation:'fill',selector:'#name',text:'Updated'},signal);
  const clicked=await browser.execute(w,{operation:'click',selector:'#go'},signal);assert.match(clicked.dom.text,/Updated/);
  const images=require('../apps/desktop/agent/image-observer.cjs').createImageObserver(nativeImage);
  const image=await images.prepare(await fs.readFile(path.join(w.files,clicked.screenshot)),{crop:{x:0,y:0,width:400,height:300}});assert.equal(image.size.width,400);assert.match(image.image.image_url.url,/^data:image\/png;base64,/);
  assert.match(clicked.dom.fullText,/hidden-only/);assert.ok(!clicked.dom.visibleText.includes('hidden-only'));assert.ok(!clicked.dom.visibleText.includes('far-bottom'));assert.ok(clicked.dom.overflow.right>0&&clicked.dom.overflow.bottom>0);assert.ok(clicked.dom.clipped.length>0);
  await fs.writeFile(path.join(w.files,'clipped.html'),'<div style="position:relative;width:800px;height:600px;overflow:hidden">'+Array.from({length:47},(_,i)=>`<div style="position:absolute;left:${i<45?-1000:20}px;top:${i}px">weather ${i}</div>`).join('')+'</div>');
  const broken=await browser.execute(w,{operation:'open',path:'clipped.html',width:800,height:600},signal);
  assert.equal(broken.dom.layoutHealth.textNodes,47);assert.equal(broken.dom.layoutHealth.clippedTextNodes,45);
  assert.throws(()=>require('../apps/desktop/agent/html-delivery.cjs').assertLayout(broken.dom),/大量内容被容器裁剪/);
  await browser.execute(w,{operation:'open',path:'index.html',width:800,height:600},signal);
  await browser.execute(w,{operation:'fill',selector:'#name',text:'Updated'},signal);
  await browser.execute(w,{operation:'click',selector:'#go'},signal);
  const element=await browser.execute(w,{operation:'inspect',selector:'#status'},signal);assert.equal(element.scope.kind,'element');assert.equal(element.scope.selector,'#status');assert.equal(element.dom.target.text,'Updated');
  const region=await browser.execute(w,{operation:'inspect',crop:{x:0,y:0,width:200,height:100}},signal);assert.equal(region.scope.kind,'region');assert.equal(nativeImage.createFromBuffer(await fs.readFile(path.join(w.files,region.screenshot))).getSize().width,region.pixelSize.width);assert.equal(region.scope.rect.width,200);
  const visual=require('../apps/desktop/agent/visual-observation.cjs');
  w.run.visualObservations=[{path:region.screenshot,sha256:region.sha256,sources:region.sources,scope:region.scope,pixelSize:region.pixelSize,revision:w.run.revision}];
  const firstCrop={x:20,y:20,width:40,height:40},firstView=await visual.imageObservation(w,{path:region.screenshot,crop:firstCrop},images);
  w.run.visualObservations.push({path:firstView.path,sha256:firstView.sha256,sources:firstView.sources,scope:firstView.scope,pixelSize:firstView.pixelSize,transform:{crop:firstCrop}});
  const nextView=await visual.imageObservation(w,{path:region.screenshot,crop:{x:100,y:40,width:60,height:30}},images);
  const scale=region.scope.rect.width/region.pixelSize.width;assert.equal(nextView.scope.rect.x,100*scale);assert.equal(nextView.scope.rect.width,60*scale);
  await assert.rejects(browser.execute(w,{operation:'inspect',selector:'main-does-not-exist'},signal),/未找到/);
  await browser.execute(w,{operation:'open',path:'index.html',width:800,height:600},signal);
  w.run.revision++;await browser.execute(w,{operation:'inspect'},signal); // unrelated revisions do not stale actual dependencies
  await fs.appendFile(path.join(w.files,'index.html'),'<!-- changed dependency -->');await assert.rejects(browser.execute(w,{operation:'inspect'},signal),/依赖文件已变化/);
  await browser.execute(w,{operation:'open',path:'index.html'},signal);
  const controller=new AbortController();controller.abort();await assert.rejects(browser.execute(w,{operation:'inspect'},controller.signal),/已停止/);
  await layoutClippingCases(base,browser);
  await repairLoop(base,browser,images);
  console.log('PASS: real browser render, screenshot, crop, fill/click, geometry observation, targeted capture, visible/full text, dependency guard and cancellation');
 }catch(error){console.error(error);process.exitCode=1;}finally{browser?.dispose();if(base)await fs.rm(base,{recursive:true,force:true});app.exit(process.exitCode||0);}
});

async function repairLoop(base,browser,images){
 const {runAgent}=require('../apps/desktop/agent/runner.cjs');
 const task={id:'repair-loop',projectId:'repair',request:'生成布局正确的本地页面并验证'};
 const wrong='<!doctype html><h1 style="position:absolute;left:-10000px">Report</h1>';
 const fixed='<!doctype html><h1>Report</h1>';
 const plan={action:'plan',goal:task.request,decisions:[],acceptance:['标题应出现在页面内'],acceptanceTypes:['visual'],steps:[{id:'make',title:'生成并检查页面',status:'running'}]};
 let sawBad=false,sawFixed=false;const decisions=[];
 const result=await runAgent({base,task,browser,images,onStatus:message=>assert.equal(typeof message,'string'),model:{contextWindow:65536},signal:new AbortController().signal,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);let action;
  const observation=[...s.toolResults].reverse().find(o=>o.action==='browser'&&o.result?.dom);
  if(s.phase==='route')action={action:'route',kind:'task'};
  else if(!s.steps.length)action=plan;
  else if(s.artifacts.length&&s.steps.every(step=>step.status==='done')&&s.acceptanceCriteria.every(c=>c.check?.status==='passed'))action={action:'finish',text:'已修正并复查页面',review:{summary:'初次渲染发现标题越界，修正后重新渲染并核对标题可见',issues:[],unverified:[]},...(s.requiredAction==='checkpoint'?{progress:{memory:'已发现标题越界并修正，重新渲染观察确认标题可见；成果已登记，各条验收已绑定实际图像证据，现在复用检查完成交付。'}}:{})};
  else if(s.requiredAction==='checkpoint')action={action:'checkpoint',text:'已发现标题越界并修正；继续以当前版本浏览器观察、登记成果和验收，不重放旧操作。'};
  else if(s.requiredAction==='plan_update')action=plan;
  else if(!s.revision)action={action:'write_file',path:'index.html',content:wrong};
  else if(!observation||observation.result.revision!==s.revision)action={action:'browser',operation:'open',path:'index.html'};
  else if(observation.result.dom.offscreen>0){sawBad=true;assert.ok(messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));action={action:'write_file',path:'index.html',content:fixed};}
  else if(!s.artifacts.length){sawFixed=true;action={action:'artifact',path:'index.html',label:'页面'};}
  else if(s.steps.some(step=>step.status!=='done'))action={...plan,steps:plan.steps.map(step=>({...step,status:'done'}))};
  else if(s.acceptanceCriteria.some(c=>c.check?.status!=='passed'))action={action:'verify',checks:s.acceptanceCriteria.map(c=>({criterionId:c.id,kind:'visual',evidenceId:observation.eventId,reason:'当前版本实际渲染后标题可见，无负坐标越界'}))};
  else action={action:'finish',text:'已修正并复查页面',evidence:[observation.eventId],review:{summary:'初次渲染发现标题越界，修正后重新渲染并核对标题可见',issues:[],unverified:[]}};
  decisions.push({action:action.action,operation:action.operation,required:s.requiredAction,error:s.toolResults.at(-1)?.error,criteria:s.acceptanceCriteria.map(c=>({id:c.id,status:c.check?.status}))});
  return {content:JSON.stringify(action)};
 }});
 assert.equal(result.agentRun.status,'completed',JSON.stringify({result,decisions}));assert.ok(sawBad&&sawFixed);
 console.log('PASS: deterministic agent loop: render -> observe defect -> repair -> re-render -> visual acceptance -> reviewed delivery (no live model benchmark)');
}

async function layoutClippingCases(base,browser){
 const task={id:'layout-clipping',projectId:'layout',request:'验证可滚动页面与裁剪页面'};
 const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(base,task);
 const rows=Array.from({length:50},(_,i)=>`<p>Row ${i}</p>`).join('');
 const check=async html=>{
  await fs.writeFile(path.join(w.files,'index.html'),'<!doctype html>'+html);
  return browser.execute(w,{operation:'open',path:'index.html',width:800,height:600},new AbortController().signal);
 };
 let r=await check(`<h1 id="title">List</h1><div style="height:140px;overflow:hidden"><div style="height:120px;overflow:auto">${rows}</div></div>`);
 assert.equal(r.dom.layoutHealth.clippedTextNodes,0);assert.ok(r.dom.layoutHealth.scrollableTextNodes>30);
 require('../apps/desktop/agent/html-delivery.cjs').assertLayout(r.dom);
 r=await check(`<h1>Long document</h1>${rows}`);assert.equal(r.dom.layoutHealth.clippedTextNodes,0);
 r=await check(`<h1 id="title">Report</h1><div style="position:relative;height:200px;overflow:hidden"><div style="position:absolute;left:-10000px">${rows}</div></div>`);
 assert.ok(r.dom.layoutHealth.clippedTextNodes>=50);assert.throws(()=>require('../apps/desktop/agent/html-delivery.cjs').assertLayout(r.dom),/大量内容/);
 const detail=await browser.execute(w,{operation:'inspect',selector:'#title'},new AbortController().signal);
 assert.equal(detail.scope.kind,'element');assert.ok(detail.dom.layoutHealth.clippedTextNodes>=50);
 console.log('PASS: scrollable/nested containers and long documents remain valid; title crops cannot hide whole-document clipping');
 browser.close(w);
}

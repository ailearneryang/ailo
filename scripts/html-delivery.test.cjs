const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {assertHtmlDelivery,assertLayout,rememberFailure}=require('../apps/desktop/agent/html-delivery.cjs');
const {hash}=require('../apps/desktop/agent/evidence.cjs');
test('rejects the weather clipping pattern but permits long documents',()=>{
 assert.throws(()=>assertLayout({layoutHealth:{textNodes:47,clippedTextNodes:45}}),/大量内容被容器裁剪/);
 assert.doesNotThrow(()=>assertLayout({layoutHealth:{textNodes:100,clippedTextNodes:0},overflow:{bottom:90}}));
});
test('HTML delivery requires fresh browser evidence and a delivered screenshot',async t=>{
 const files=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-html-delivery-'));t.after(()=>fs.rm(files,{recursive:true,force:true}));
 await fs.writeFile(path.join(files,'index.html'),'<h1>天气</h1>');await fs.writeFile(path.join(files,'shot.png'),'screenshot');
 const sources=[{path:'index.html',sha256:hash(Buffer.from('<h1>天气</h1>'))}];
 const run={revision:1,artifacts:[{path:'index.html',sha256:sources[0].sha256}],events:[],visualObservations:[]},workspace={files,run};
 await assert.rejects(assertHtmlDelivery(workspace),/先 browser/);
 run.events.push({id:'b',type:'browser',detail:{revision:1,result:{path:'index.html',screenshot:'shot.png',sources,scope:{kind:'viewport',path:'index.html'},dom:{layoutHealth:{scope:'document',textNodes:47,clippedTextNodes:0}},errors:[]}}});
 await assert.rejects(assertHtmlDelivery(workspace),/尚未传给模型/);
 run.visualObservations.push({eventId:'b',delivered:true,path:'shot.png',sha256:hash(Buffer.from('screenshot')),sources});
 run.events[0].detail.result.dom.layoutHealth.clippedTextNodes=45;
 await assert.rejects(assertHtmlDelivery(workspace),/大量内容被容器裁剪/);
 run.events[0].detail.result.dom.layoutHealth.clippedTextNodes=0;
 await assertHtmlDelivery(workspace);
 await fs.writeFile(path.join(files,'index.html'),'changed');
 await assert.rejects(assertHtmlDelivery(workspace),/文件已变化/);
});
async function fixture(t){
 const files=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-html-scope-'));t.after(()=>fs.rm(files,{recursive:true,force:true}));
 await fs.writeFile(path.join(files,'index.html'),'<h1>Title</h1>');await fs.writeFile(path.join(files,'shot.png'),'pixels');
 const sources=[{path:'index.html',sha256:hash(Buffer.from('<h1>Title</h1>'))}];
 const run={revision:1,goal:'交付页面',acceptance:['页面完整可见'],steps:[{id:'make',title:'生成并检查',status:'done'}],artifacts:[{path:'index.html',sha256:sources[0].sha256}],events:[],visualObservations:[]};
 const add=(id,kind='viewport',health={textNodes:20,clippedTextNodes:0})=>{
  run.events.push({id,type:'browser',detail:{revision:1,result:{path:'index.html',screenshot:'shot.png',sources,scope:{kind,path:'index.html',...(kind==='element'?{selector:'#title'}:{})},dom:{layoutHealth:{scope:'document',...health}},errors:[]}}});
  run.visualObservations.push({eventId:id,delivered:true,path:'shot.png',sha256:hash(Buffer.from('pixels')),sources});
 };
 return {files,run,add};
}
test('title-only evidence cannot grant page delivery; page observation can be reused for later crops',async t=>{
 const w=await fixture(t);w.add('title','element');await assert.rejects(assertHtmlDelivery(w),/局部截图不能替代/);
 w.add('page');w.add('detail','region');await assertHtmlDelivery(w);
});
test('a new broken UI state cannot fall back to an older healthy screenshot',async t=>{
 const w=await fixture(t);w.add('old');w.add('broken','viewport',{textNodes:47,clippedTextNodes:45});
 await assert.rejects(assertHtmlDelivery(w),/大量内容被容器裁剪/);
});
test('delivery failure persists a repair target and only a new valid page observation resolves it',async t=>{
 const w=await fixture(t);w.add('bad','viewport',{textNodes:47,clippedTextNodes:45});
 let error;try{await assertHtmlDelivery(w);}catch(e){error=e;}rememberFailure(w,error);
 assert.equal(w.run.issues[0].status,'open');assert.equal(w.run.steps[0].status,'running');assert.match(w.run.executionState.nextAction,/修复/);
 // An empty model update does not remove the runtime issue.
 w.run.issues=await require('../apps/desktop/agent/issues.cjs').update(w,[]);assert.equal(w.run.issues[0].status,'open');
 await assert.rejects(assertHtmlDelivery(w),/裁剪/);assert.equal(w.run.issues[0].status,'open');
 w.add('fixed');await assertHtmlDelivery(w);assert.equal(w.run.issues[0].status,'resolved');assert.equal(w.run.issues[0].evidenceId,'fixed');assert.equal(w.run.executionState.gaps.length,0);
});
test('changes to HTML dependencies invalidate the page check; unrelated files do not',async t=>{
 const w=await fixture(t);await fs.writeFile(path.join(w.files,'style.css'),'body{}');
 w.add('page');w.run.events[0].detail.result.sources.push({path:'style.css',sha256:hash(Buffer.from('body{}'))});
 await assertHtmlDelivery(w);await fs.writeFile(path.join(w.files,'notes.txt'),'unrelated');await assertHtmlDelivery(w);
 await fs.writeFile(path.join(w.files,'style.css'),'body{color:red}');await assert.rejects(assertHtmlDelivery(w),/依赖文件已变化/);
});

test('agent repairs a blocked HTML delivery and rechecks before completion',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-html-repair-loop-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const {runAgent}=require('../apps/desktop/agent/runner.cjs');let n=0,sawRepair=false;
 const plan={action:'plan',goal:'交付完整页面',decisions:[],acceptance:['页面含 Title'],steps:[{id:'make',title:'制作并检查',status:'running'}]};
 const actions=[{action:'route',kind:'task'},plan,{action:'write_file',path:'index.html',content:'<h1>Title bad</h1>'},{action:'artifact',path:'index.html',label:'页面'},{action:'browser',operation:'open',path:'index.html'},'verify','finish',{action:'write_file',path:'index.html',content:'<h1>Title fixed</h1>'},{action:'artifact',path:'index.html',label:'页面'},{action:'browser',operation:'open',path:'index.html'},'verify','finish'];
 const browser={close(){},async execute(w){const bytes=await fs.readFile(path.join(w.files,'index.html'));await fs.writeFile(path.join(w.files,'shot.png'),'pixels');return {path:'index.html',screenshot:'shot.png',sha256:hash(Buffer.from('pixels')),sources:[{path:'index.html',sha256:hash(bytes)}],scope:{kind:'viewport',path:'index.html'},dom:{layoutHealth:{scope:'document',textNodes:47,clippedTextNodes:bytes.includes('fixed')?0:45}},errors:[]};}};
 const result=await runAgent({base,task:{id:'repair',request:plan.goal},browser,images:{prepare:async()=>({image:{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}})},model:{contextWindow:100000},signal:new AbortController().signal,ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);let action=actions[n++];assert.ok(action,'unexpected extra decision: '+JSON.stringify(s.toolResults));
  if(n===8){sawRepair=true;assert.equal(s.issues[0].status,'open');assert.equal(s.steps[0].status,'running');assert.match(s.executionState.nextAction,/修复/);}
  if(action==='verify')action={action:'verify',checks:s.acceptanceCriteria.map(c=>({criterionId:c.id,kind:'text_contains',path:'index.html',contains:['Title'],reason:'检查正文'})),progress:{steps:[{id:'make',status:'done'}]}};
  if(action==='finish')action={action:'finish',text:'页面已检查并交付',review:{summary:'修复后重新观察',issues:[],unverified:[]}};
  if(s.requiredAction==='checkpoint')action={...action,progress:{...action.progress,memory:'已根据页面检查保留裁剪问题和修复目标，修复后重新观察并绑定新版本证据，不能重复提交未经检查的交付。'}};
  return {content:JSON.stringify(action)};
 }});
 assert.ok(sawRepair);assert.equal(result.agentRun.status,'completed');assert.equal(result.agentRun.issues[0].status,'resolved');
});

test('current page errors cannot be hidden by a previous healthy observation',async t=>{
 const w=await fixture(t);w.add('healthy');w.add('error');w.run.events.at(-1).detail.result.errors=['Uncaught error'];
 await assert.rejects(assertHtmlDelivery(w),/运行错误/);
});

test('model cannot close or rewrite a runtime defect while current metrics still fail',async t=>{
 const w=await fixture(t),issues=require('../apps/desktop/agent/issues.cjs');
 w.add('bad','viewport',{textNodes:990,clippedTextNodes:949});
 require('../apps/desktop/agent/html-delivery.cjs').recordObservation(w,w.run.events.at(-1));
 const issue=w.run.issues[0];
 w.add('still-bad','viewport',{textNodes:990,clippedTextNodes:909});
 const update={id:issue.id,status:'resolved',description:issue.description,requirementIds:issue.requirementIds,reason:'overflow visible 后看起来正常',evidenceId:'still-bad'};
 await assert.rejects(issues.update(w,[update]),/909\/990/);
 await assert.rejects(issues.update(w,[{...update,description:'已修复',requirementIds:[],scope:{kind:'element',path:'other.html',selector:'h1'}}]),/909\/990/);
 await assert.rejects(issues.update(w,[{...update,status:'limitation'}]),/不能直接改为限制/);
 assert.equal(w.run.issues[0].status,'open');
 w.add('fixed');
 await assert.rejects(issues.update(w,[{...update,evidenceId:'still-bad'}]),/当前通过页面检查/);
 const normalized=await issues.update(w,[{...update,evidenceId:'fixed',description:'已经没问题了',requirementIds:[],scope:{kind:'element',path:'other.html',selector:'h1'}}]);
 assert.equal(normalized[0].description,w.run.issues[0].description);
 assert.deepEqual(normalized[0].scope,w.run.issues[0].scope);
 assert.deepEqual(normalized[0].requirementIds,w.run.issues[0].requirementIds);
 assert.equal(normalized[0].history.at(-1).submittedDescription,'已经没问题了');
 const minimal=await issues.update(w,[{id:issue.id,status:'resolved',evidenceId:'fixed',reason:'重新检查页面通过'}]);
 assert.equal(minimal[0].description,issue.description);
 assert.equal(minimal[0].status,'resolved');
 await assert.rejects(issues.update(w,[{id:issue.id,status:'resolved',reason:'仅提供文字说明'}]),/当前通过页面检查/);
 await assert.rejects(issues.update(w,[{id:'new_issue',status:'open'}]),/说明及有效 requirementIds/);
 w.run.issues=await issues.update(w,[{...update,evidenceId:'fixed'}]);
 assert.equal(w.run.issues[0].status,'resolved');
 await issues.assertDeliverable(w,'complete',{issues:[]},'交付');
 // Regression in the same file/state must reopen the delivery gate even if the
 // model retains an earlier resolved ledger entry.
 w.add('regression','viewport',{textNodes:990,clippedTextNodes:909});
 await assert.rejects(issues.assertDeliverable(w,'complete',{issues:[]},'交付'),/909\/990/);
});

test('broken screenshots cannot satisfy visual verification through browser or view_image aliases',async t=>{
 const w=await fixture(t),proof=require('../apps/desktop/agent/evidence.cjs');
 w.add('bad','viewport',{textNodes:990,clippedTextNodes:909});
 await assert.rejects(proof.event(w,'bad'),/909\/990/);
 const page=w.run.events[0].detail.result;
 w.run.events.push({id:'alias',type:'view_image',detail:{result:{path:page.screenshot,sources:page.sources}}});
 w.run.visualObservations.push({eventId:'alias',delivered:true,path:'shot.png',sha256:hash(Buffer.from('pixels')),sources:page.sources});
 await assert.rejects(proof.event(w,'alias'),/909\/990/);
});
test('removing source checks or altering source data cannot close a machine-detected source defect',async t=>{
 const w=await fixture(t),api=require('../apps/desktop/agent/html-delivery.cjs');
 const source={path:'source.json',sha256:hash(Buffer.from('source'))};await fs.writeFile(path.join(w.files,source.path),'source');
 w.add('bad-source');let result=w.run.events.at(-1).detail.result;
 result.sources=[...result.sources,source];result.sourceAudit={status:'checked',sources:[source],issues:['原稿图片未渲染']};
 api.recordObservation(w,w.run.events.at(-1));assert.equal(w.run.issues[0].status,'open');
 w.add('no-source');
 await assert.rejects(assertHtmlDelivery(w),/原稿依赖|原稿缺陷/);
 await fs.writeFile(path.join(w.files,source.path),'altered');
 w.add('altered-source');result=w.run.events.at(-1).detail.result;
 const changed={path:source.path,sha256:hash(Buffer.from('altered'))};result.sources=[...result.sources,changed];result.sourceAudit={status:'checked',sources:[changed],issues:[]};
 await assert.rejects(assertHtmlDelivery(w),/不能修改或删除原稿/);
 await fs.writeFile(path.join(w.files,source.path),'source');w.add('fixed-source');result=w.run.events.at(-1).detail.result;
 result.sources=[...result.sources,source];result.sourceAudit={status:'checked',sources:[source],issues:[]};
 await assertHtmlDelivery(w);assert.equal(w.run.issues[0].status,'resolved');
});
test('text-only HTML delivery checks structure without claiming a model viewed the screenshot',async t=>{
 const w=await fixture(t);w.add('page');w.run.visualObservations[0].delivered=false;
 await assert.rejects(assertHtmlDelivery(w),/尚未传给模型/);
 w.run.observationCapabilities={images:false};
 await assertHtmlDelivery(w);
 assert.equal(w.run.visualObservations[0].delivered,false);
 w.run.events[0].detail.result.dom.missingImages=['missing.png'];
 await assert.rejects(assertHtmlDelivery(w),/图片加载失败/);
});

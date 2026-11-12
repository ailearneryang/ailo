const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{runAgent}=require('../apps/desktop/agent/runner.cjs'),{execute}=require('../apps/desktop/agent/tools.cjs');
const search=require('../apps/desktop/agent/search-context.cjs');
const response=a=>({content:JSON.stringify(a)});
const result=query=>({provider:'fixture',query,searchedAt:'2026-11-09T02:30:41Z',sources:Array.from({length:5},(_,i)=>({title:`当日AI技术 ${query}-${i}`,url:`https://example.org/news/${query}/${i}`,date:'2026-11-09',content:`真实当天资料 ${query}-${i} `+'资料'.repeat(1700)}))});
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-search-context-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'news',request:'搜索AI热点并交付今日总结文件',messages:[{id:'u1',role:'user',content:'搜索AI热点并交付今日总结文件'}]};const w=await createWorkspace(base,task);return {base,task,w};}
async function archive(w,action,result){const id=await w.archiveObservation(action,{action:action.action,result});(w.run.observationIndex||=[]).push({id,action:action.action});return id;}
test('three large real search receipts survive old-file reads, restart and recovery compaction without new searches',async t=>{
 const f=await fixture(t);f.w.run.executionId='original';const ids=[];
 for(let i=0;i<3;i++)ids.push(await archive(f.w,{action:'web_search',query:String(i)},result(String(i))));
 for(let i=0;i<18;i++)await archive(f.w,{action:'read_file',path:'old.md'},{text:'旧文件',path:'old.md'});
 await f.w.save();const restored=await createWorkspace(f.base,f.task),context=await search.createContext(restored)();
 assert.deepEqual(context.results.map(r=>r.observationId),ids);assert.equal(context.results.flatMap(r=>r.sources).length,15);
 for(const row of context.results){assert.equal(row.complete,false);assert.equal(row.read.view,'result');assert.match(row.sources[4].url,/\/4$/);assert.equal(row.sources[4].date,'2026-11-09');}
 const compact=require('../apps/desktop/agent/decision-recovery.cjs').compact({searchContext:context,decisionRecovery:{stage:'direct_action'}},x=>x);assert.deepEqual(compact.searchContext,context);
 const sources=await require('../apps/desktop/agent/result-sources.cjs').findings(restored);assert.equal(sources.filter(s=>s.action==='web_search').length,3);assert.ok(sources.some(s=>s.text.includes('https://example.org/news/2/')));
 restored.run.executionId='another';assert.equal(await search.createContext(restored)(),undefined);
});
test('failed searches and previous-input sources do not become current evidence, empty results stay explicit',async t=>{
 const {w}=await fixture(t);w.run.executionId='same';const prior=await archive(w,{action:'web_search'},result('old'));
 const failed=await w.archiveObservation({action:'web_search'},{error:'search limit'});w.run.observationIndex.push({id:failed,action:'web_search'});
 const empty=await archive(w,{action:'web_search'},{query:'empty',sources:[]});w.run.inputTurn={followup:true,observationIds:[prior]};
 const context=await search.createContext(w)();assert.deepEqual(context.results.map(r=>r.observationId),[empty]);assert.deepEqual(context.results[0].sources,[]);
 assert.equal(w.run.acceptanceResults?.news,undefined);
});
test('paginated search archive retains original navigation through nested reads and exact independent offsets',async t=>{
 const {w}=await fixture(t),raw=result('original'),id=await archive(w,{action:'web_search'},raw),full=JSON.stringify(raw);
 const first=await w.observation(id,3000,4000,'result');assert.equal(first.text,full.slice(3000,7000));
 const pageId=await archive(w,{action:'read_execution',id,view:'result',offset:3000,limit:4000},first);
 const page=await w.observation(pageId,1200,1000,'result');assert.equal(page.text,full.slice(4200,5200));assert.deepEqual(page.original,{id,view:'result',offset:4200,total:full.length});
 const nestedId=await archive(w,{action:'read_execution',id:pageId,view:'result',offset:1200,limit:1000},page);
 const nested=await w.observation(nestedId,100,300,'result');assert.equal(nested.original.offset,4300);
 assert.equal((await w.observation(nested.original.id,nested.original.offset,300,'result')).text,nested.text);
});
test('incident: three searches, repeated archive pages and old files still deliver current sourced news under unchanged verification',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.w.files,'old.md'),'昨天的历史文件');let n=0,searches=0,writeCalls=0,lastContext,reads=0,wrote=false;
 const plan={action:'plan',goal:'交付今日AI热点文件',decisions:[],requirements:[{id:'news',text:'今日热点文件包含当天搜索资料及来源链接',type:'content'}],steps:[{id:'write',title:'搜索并交付',status:'running',requirementIds:['news']}]};
 const actions=[{action:'route',kind:'task'},plan,...[0,1,2].map(i=>({action:'web_search',query:String(i)}))];
 const r=await runAgent({base:f.base,task:f.task,model:{contextWindow:131072},signal:new AbortController().signal,webSearch:{execute:async a=>{searches++;return result(a.query);}},executeTool:async(...args)=>{if(args[1].action==='write_file')writeCalls++;return execute(...args);},ask:async messages=>{
  const s=JSON.parse(messages.at(-1).content);if(s.requiredAction==='checkpoint')return response({action:'checkpoint',text:'已经获得三次当日搜索的真实资料与链接，保留原验收要求，下一步使用搜索导航写入今日热点并核验来源。'});if(n<actions.length)return response(actions[n++]);
  lastContext=s.searchContext;assert.equal(lastContext.results.length,3);
  const id=lastContext.results[0].observationId;
  if(reads++<3)return response({action:'batch_read',items:[{action:'read_execution',id,view:'result',offset:0,limit:3000},{action:'read_file',path:'old.md',limit:100}]});
  if(!wrote){wrote=true;return response({action:'write_file',path:'today.md',content:'# 今日AI热点\n'+lastContext.results.map(r=>r.sources.map(x=>`${x.title} ${x.date} ${x.url} ${x.content}`).join('\n')).join('\n'),artifact:{label:'今日热点'},checks:[{criterionId:'news',kind:'text_contains',path:'today.md',contains:['2026-11-09','https://example.org/news/2/4'],reason:'文件包含当天实际搜索的资料和来源链接'}],progress:{steps:[{id:'write',status:'done'}]}});}
  return response({action:'finish',text:'已交付今日热点。',review:{summary:'当天资料及来源已经写入并核对',issues:[],unverified:[]}});
 }});
 assert.equal(searches,3);assert.equal(writeCalls,1,JSON.stringify({content:r.content,events:r.agentRun.events}));assert.equal(r.agentRun.status,'completed');assert.ok(r.agentRun.acceptanceCriteria.every(c=>c.status==='passed'));
 const saved=await createWorkspace(f.base,f.task);assert.equal(saved.run.artifacts.length,1);assert.match(await fs.readFile(path.join(saved.files,'today.md'),'utf8'),/https:\/\/example.org\/news\/2\/4/);
 assert.ok(saved.run.observationIndex.some(o=>o.action==='batch_read'));
});

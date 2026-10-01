const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createWebSearch}=require('../apps/desktop/web-search.cjs');const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
async function setup(t,fetchImpl,now){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-search-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,api:createWebSearch({directory,safeStorage,fetchImpl,now})};}
const response=()=>Response.json({references:[{title:'天气',url:'https://example.com/weather',content:'实时资料',date:'2026-09-29'},{url:'javascript:alert(1)'},{url:'https://example.com/weather'}]});
test('Baidu uses fixed endpoint, credentials stay out of results, successful test required',async t=>{
 let calls=0;const {api}=await setup(t,async(url,options)=>{calls++;assert.equal(url,'https://qianfan.baidubce.com/v2/ai_search/web_search');assert.equal(options.headers['X-Appbuilder-Authorization'],'Bearer secret-key');assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).search_source,'baidu_search_v2');return response();});
 assert.equal((await api.status()).configured,false);assert.equal((await api.save({provider:'baidu',key:'secret-key',limit:100})).connected,false);assert.equal((await api.test()).connected,true);
 const result=await api.execute({query:'北京天气'});assert.equal(result.sources.length,1);assert.ok(!JSON.stringify(result).includes('secret-key'));assert.equal(calls,2);assert.equal((await api.status()).used,2);
});
test('atomic local quota across concurrent searches and restart, no request after limit',async t=>{
 let calls=0;const {api,directory}=await setup(t,async()=>{calls++;return response();});await api.save({provider:'baidu',key:'secret-key',limit:1});
 const results=await Promise.allSettled([api.execute({query:'a'}),api.execute({query:'b'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1);
 const restored=createWebSearch({directory,safeStorage,fetchImpl:()=>assert.fail('must not call')});await assert.rejects(restored.execute({query:'a'}),/上限/);
});
test('Tavily uses basic search without answer generation and resets monthly',async t=>{
 let date=new Date('2026-09-29T01:00:00Z');const {api}=await setup(t,async(url,opts)=>{assert.equal(url,'https://api.tavily.com/search');assert.equal(opts.headers.Authorization,'Bearer secret-key');const body=JSON.parse(opts.body);assert.equal(body.search_depth,'basic');assert.equal(body.auto_parameters,false);assert.equal(body.include_answer,false);return Response.json({results:[]});},()=>date);
 await api.save({provider:'tavily',key:'secret-key',limit:1});await api.execute({query:'a'});await assert.rejects(api.execute({query:'b'}),/上限/);date=new Date('2026-10-01T01:00:00Z');await api.execute({query:'b'});
});
test('provider failures are actionable and never echo secrets, disconnect removes access',async t=>{
 const {api}=await setup(t,async()=>new Response('secret-key',{status:401}));await api.save({provider:'baidu',key:'secret-key',limit:100});await assert.rejects(api.test(),e=>e.code==='SEARCH_UNAVAILABLE'&&!e.message.includes('secret-key'));assert.equal((await api.status()).connected,false);await api.disconnect();await assert.rejects(api.execute({query:'a'}),/配置/);
});
test('agent searches in ordinary chat, appends real sources, no project or plan required',async t=>{
 const {api,directory}=await setup(t,async()=>response());await api.save({provider:'baidu',key:'secret-key',limit:100});let i=0;const actions=[{action:'route',kind:'chat'},{action:'web_search',query:'天气'},{action:'reply',text:'已查到资料。'}];
 const result=await runAgent({base:directory,task:{id:'chat',messages:[{role:'user',content:'查天气'}]},model:{contextWindow:32768},webSearch:api,signal:new AbortController().signal,ask:async()=>({content:JSON.stringify(actions[i++])})});assert.match(result.content,/https:\/\/example.com\/weather/);assert.equal(result.agentRun.mode,'chat');assert.equal(result.agentRun.artifacts.length,0);
});
test('disabled search stops once without retries',async t=>{
 const {directory}=await setup(t,()=>assert.fail('not enabled'));let i=0;const result=await runAgent({base:directory,task:{id:'disabled',messages:[{role:'user',content:'查天气'}]},model:{contextWindow:32768},signal:new AbortController().signal,ask:async()=>({content:JSON.stringify(i++?{action:'web_search',query:'天气'}:{action:'route',kind:'chat'})})});assert.equal(i,2);assert.match(result.content,/未开启/);
});
test('switching providers preserves each provider quota',async t=>{
 const {api}=await setup(t,async url=>url.includes('tavily')?Response.json({results:[]}):response());
 await api.save({provider:'baidu',key:'secret-key',limit:1});await api.execute({query:'a'});
 await api.save({provider:'tavily',key:'secret-key',limit:1});await api.execute({query:'a'});
 await api.save({provider:'baidu',key:'secret-key',limit:1});await assert.rejects(api.execute({query:'a'}),/上限/);
 await assert.rejects(api.save({provider:'constructor',key:'secret-key',limit:1}),/请选择/);
});
test('abort and oversized responses terminate without leaking raw provider content',async t=>{
 const {api}=await setup(t,async()=>new Response('x'.repeat(1000001)));await api.save({provider:'baidu',key:'secret-key',limit:100});await assert.rejects(api.execute({query:'a'}),/过大/);
 const controller=new AbortController();controller.abort();await assert.rejects(api.execute({query:'a'},controller.signal));assert.equal((await api.status()).used,1);
});

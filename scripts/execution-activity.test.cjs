const {test}=require('node:test'),assert=require('node:assert/strict');
const {createExecutionActivity}=require('../apps/desktop/execution-activity.cjs');
const at='2026-11-03T00:00:00Z',event=(id,type='read_file',detail={})=>({id:String(id),type,at,detail});
test('live snapshots accumulate real operations beyond the latest runtime window without duplicates or old-turn leakage',()=>{
 const trace=createExecutionActivity(at);const first={events:[{...event('old'),at:'2026-11-02T23:59:59Z'},event(1)],loadedExtensions:[{id:'s',kind:'skill',name:'jira'}],executionRecovery:{repair:{stagnant:9}}},copy=structuredClone(first);trace.capture(first);
 const result=trace.capture({events:[event(1),...Array.from({length:14},(_,i)=>event(i+2))]});assert.equal(result.events.length,15);assert.equal(result.eventCount,15);assert.equal(result.events[0].id,'1');assert.equal(result.loadedExtensions[0].name,'jira');assert.deepEqual(first,copy);assert.equal(trace.capture({events:[]}).events.length,15);
});
test('presentation trace bounds command output, updates existing results and declares truncation without touching source evidence',()=>{
 const trace=createExecutionActivity(at,{limit:2}),source=event(1,'run_command',{output:'x'.repeat(10000),exitCode:0,command:'command'});trace.capture({events:[source,event(2)]});const updated=trace.capture({events:[source,event(2),event(3)]});assert.equal(updated.eventCount,3);assert.equal(updated.eventsTruncated,true);assert.equal(updated.events.length,2);assert.equal(source.detail.output.length,10000);
 const retained=createExecutionActivity(at).capture({events:[source]});assert.equal(retained.events[0].detail.output.length,4000);assert.equal(retained.events[0].detail.outputTruncated,true);assert.equal(retained.events[0].detail.exitCode,0);
 const changed=trace.capture({events:[event(3,'run_command',{exitCode:7})]});assert.equal(changed.events.at(-1).detail.exitCode,7);assert.equal(changed.eventCount,3);
});
test('chat completion retains loaded skills and early tool events after more than twelve live operations',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-process-trace-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const storage=require('../apps/desktop/storage.cjs').createStorage(directory,{});storage.agentDirectory=path.join(directory,'agent');storage.modelCredentials=async()=>({id:'m',name:'test',model:'test',baseUrl:'https://fixture.test/v1',contextWindow:131072});
 const task=await storage.patchTask('trace',{request:'生成文件并保留过程',title:'过程回归',materials:[],messages:[{id:'u',role:'user',content:'生成文件并保留过程'}]});let calls=0;
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:'生成文件',decisions:[],requirements:[{id:'files',text:'文件包含原内容',type:'content'}],steps:[{id:'write',title:'写入并核对文件',status:'running'}]},...Array.from({length:15},(_,i)=>({action:'write_file',path:'file'+i+'.txt',content:'原内容 '+i,progress:{steps:[{id:'write',status:'running'}]}})),{action:'pause',text:'离线测试停止点，原要求仍待核验'}];
 const chat=require('../apps/desktop/chat.cjs').createChat(storage,async()=>Response.json({choices:[{message:{tool_calls:[{id:'tool',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(actions[Math.min(calls++,actions.length-1)])}}]},finish_reason:'tool_calls'}]}));
 const liveSnapshots=[];const result=await chat.complete({id:'request',taskId:task.id,modelId:'m',messages:task.messages,extensionIds:['skill-summary'],onActivity:a=>liveSnapshots.push(structuredClone(a))});assert.ok(liveSnapshots.some(a=>a.inFlight?.action==='write_file'));assert.ok(liveSnapshots.some(a=>a.events.some(e=>e.detail.path==='file0.txt')));assert.ok(liveSnapshots.some(a=>a.loadedExtensions.some(e=>e.id==='skill-summary')));assert.equal(result.replyDetails.status,'paused');assert.equal(result.replyDetails.loadedExtensions[0].id,'skill-summary');assert.ok(result.replyDetails.events.some(e=>e.type==='write_file'&&e.detail.path==='file0.txt'));assert.ok(result.replyDetails.events.some(e=>e.type==='write_file'&&e.detail.path==='file14.txt'),JSON.stringify(result.replyDetails.events.map(e=>({type:e.type,path:e.detail.path,message:e.detail.message}))));assert.ok(result.replyDetails.events.length>12);assert.equal(chat.sessions().length,0);
});
test('reasoning status and selected skills stream before any agent run and survive reconnect and completion',async()=>{
 const modelCredentials=async()=>({id:'m',name:'fixture',model:'fixture',baseUrl:'https://fixture.test/v1'});let stream,done=false;const snapshots=[];
 const chat=require('../apps/desktop/chat.cjs').createChat({modelCredentials,readWorkspace:async()=>({extensions:[{id:'jira',name:'jira',kind:'skill',enabled:true,instructions:'查询前检查可用工具'}]})},async()=>new Response(new ReadableStream({start(c){stream=c;}}),{headers:{'content-type':'text/event-stream'}}));
 const resultPromise=chat.complete({id:'live',modelId:'m',extensionIds:['jira'],messages:[{role:'user',content:'查工具'}],onActivity:a=>snapshots.push(structuredClone(a))}).then(r=>{done=true;return r;});
 for(let i=0;!stream&&i<100;i++)await new Promise(r=>setTimeout(r,5));assert.ok(stream);
 assert.equal(done,false);assert.equal(chat.sessions()[0].run,undefined);assert.equal(chat.sessions()[0].activity.loadedExtensions[0].name,'jira');
 stream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'PRIVATE_INTERNAL_REASONING'}}]})+'\n\n'));
 for(let i=0;!snapshots.some(s=>s.statuses.some(e=>e.message.includes('模型正在思考')))&&i<100;i++)await new Promise(r=>setTimeout(r,5));
 assert.ok(snapshots.some(s=>s.statuses.some(e=>e.message.includes('模型正在思考'))));assert.equal(done,false);assert.ok(!JSON.stringify(chat.sessions()).includes('PRIVATE_INTERNAL_REASONING'));
 stream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'检查完毕'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));stream.close();const result=await resultPromise;
 assert.equal(result.replyDetails.loadedExtensions[0].name,'jira');assert.ok(result.replyDetails.statuses.some(e=>e.message.includes('模型正在思考')));assert.equal(chat.sessions().length,0);
});
test('thinking heartbeat updates coalesce and retained phase history is bounded independently of evidence',()=>{const trace=createExecutionActivity(at);trace.status('模型正在思考 · 已等待 1 秒');trace.status('模型正在思考 · 已等待 2 秒');assert.equal(trace.capture().statuses.length,1);assert.match(trace.capture().statuses[0].message,/2 秒/);for(let i=0;i<55;i++)trace.status('步骤 '+String.fromCharCode(65+i));assert.equal(trace.capture().statuses.length,40);assert.equal(trace.capture().eventCount,0);});
test('live usage publishes only reported provider tokens and isolates activity-observer failure from completion',async()=>{
 const {createChat}=require('../apps/desktop/chat.cjs'),snapshots=[];
 const chat=createChat({modelCredentials:async()=>({id:'m',name:'Company',model:'mock',baseUrl:'https://example.invalid/v1'})},async()=>Response.json({choices:[{message:{content:'结果'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20}}));
 const result=await chat.complete({id:'r',modelId:'m',messages:[{role:'user',content:'你好'}],onActivity:a=>{snapshots.push(structuredClone(a));if(a.usage?.requestCount)throw Error('display observer failed');}});
 assert.equal(result.content,'结果');assert.equal(result.replyDetails.usage.totalTokens,120);
 assert.ok(snapshots.some(a=>a.usage?.totalTokens===120));assert.equal(chat.sessions().length,0);
});
test('search receipts retain real queries and bounded safe source metadata without changing evidence',()=>{
 const {searchReceipt}=require('../apps/desktop/execution-activity.cjs');
 const e=event('search','web_search',{query:'北京 就业 统计',result:{sources:[{title:'统计公报',url:'https://stats.example.cn/report?private=123',content:'not-for-trace'},{title:'unsafe',url:'file:///private'},{title:'credential',url:'https://user:secret@example.com/'}]}}),original=structuredClone(e);
 const publicDetail=searchReceipt(e);assert.equal(publicDetail.query,'北京 就业 统计');assert.equal(publicDetail.sourceCount,3);assert.deepEqual(publicDetail.sources,[{title:'统计公报',domain:'stats.example.cn'}]);
 const snapshot=createExecutionActivity(at).capture({events:[{...e,detail:publicDetail}]});assert.deepEqual(snapshot.events[0].detail,publicDetail);assert.deepEqual(e,original);assert.doesNotMatch(JSON.stringify(snapshot),/private=|secret|not-for-trace/);
 assert.equal(searchReceipt(event('empty','web_search',{query:'无匹配',result:{sources:[]}})).sourceCount,0);
 assert.equal(searchReceipt(event('pending','web_search',{query:'等待'})).sourceCount,undefined);
});
test('three real search actions publish query before receipt and preserve source counts through completion',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-search-feedback-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const queries=['北京就业统计','北京产业就业','北京青年就业'],snapshots=[];let n=0;
 const actions=[{action:'route',kind:'chat'},...queries.map(query=>({action:'web_search',query})),{action:'reply',text:'本地模拟查询完成，结果仅用于回归。'}];
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task:{id:'search',messages:[{role:'user',content:'检索北京就业统计与产业情况'}]},model:{contextWindow:32768},signal:new AbortController().signal,ask:async()=>({content:JSON.stringify(actions[n++])}),onRun:r=>snapshots.push(structuredClone(r)),webSearch:{execute:async action=>({query:action.query,sources:action.query===queries[2]?[]:[{title:'隔离测试资料',url:'https://fixture.invalid/report'}]})}});
 assert.equal(n,5);assert.match(result.content,/模拟查询完成/);
 for(const query of queries)assert.ok(snapshots.some(s=>s.inFlight?.query===query),query);
 const trace=createExecutionActivity('2020-01-01T00:00:00Z');for(const s of snapshots)trace.capture(s);
 const events=trace.capture(result.agentRun).events.filter(e=>e.type==='web_search');assert.deepEqual(events.map(e=>e.detail.query),queries);assert.deepEqual(events.map(e=>e.detail.sourceCount),[1,1,0]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextUsage, prepareContext, countMessages, serializeMessage, validCheckpoint } from '../apps/desktop/context.mjs';
import { createChat } from '../apps/desktop/chat.cjs';
import { createStorage } from '../apps/desktop/storage.cjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const model = {id:'m', name:'test', model:'test', baseUrl:'https://example.com/v1', contextWindow:4096};
const history = [...Array.from({length:8}, (_,i) => ({role:i % 2 ? 'assistant' : 'user',content:`message-${i}:` + '重要事实'.repeat(130)})),{role:'user',content:'最新要求：保持蓝色'}];
const response = (text, usage) => new Response(JSON.stringify({choices:[{message:{content:text}}],usage}));
test('short context is unchanged, estimates reconcile and drafts include attachments', async () => {
 const messages = [serializeMessage({role:'user',content:'hello',materials:[{name:'a',text:'中文材料'}]})];
 const info=contextUsage(messages,[],model);
 assert.equal(info.used,info.rows.reduce((n,r)=>n+r.tokens,0));
 assert.ok(info.rows.find(r=>r.label==='附件材料').tokens>0);
 const result=await prepareContext(messages,[],model,undefined,()=>assert.fail('no summary expected'));
 assert.equal(result.messages.at(-1).content,messages[0].content);
 assert.equal(countMessages(result.messages),info.used);
});
test('compacts bounded chunks, preserves latest message and validates checkpoint against history', async()=>{
 const original=structuredClone(history);let calls=0;
 const result=await prepareContext(history,[],model,undefined,async(messages,budget)=>{
  calls++;assert.ok(countMessages(messages)+budget<model.contextWindow);
  return '目标与约束：保持蓝色；历史数字待核对。';
 });
 assert.ok(calls>1);assert.ok(result.compacted);assert.deepEqual(history,original);
 assert.equal(result.messages.at(-1).content,history.at(-1).content);
 assert.ok(countMessages(result.messages)+result.reserve<=model.contextWindow);
 assert.ok(validCheckpoint(history,result.checkpoint));
 assert.equal(validCheckpoint([{...history[0],content:'changed'},...history.slice(1)],result.checkpoint),undefined);
 const next=await prepareContext(history,[],model,result.checkpoint,()=>assert.fail('reuse summary'));
 assert.equal(next.compacted,false);
});
test('oversized newest request and oversized extensions fail before any API call',async()=>{
 await assert.rejects(prepareContext([{role:'user',content:'中'.repeat(4000)}],[],model,undefined,()=>assert.fail()),/当前消息/);
 await assert.rejects(prepareContext(history,[{kind:'skill',name:'large',instructions:'中'.repeat(4000)}],model,undefined,()=>assert.fail()),/当前消息/);
});
test('failed or ineffective summary never deletes history',async()=>{
 const original=structuredClone(history);
 await assert.rejects(prepareContext(history,[],model,undefined,async()=>{throw Error('offline');}),/offline/);
 await assert.rejects(prepareContext(history,[],model,undefined,async()=> '中'.repeat(3000)),/摘要未达到/);
 assert.deepEqual(history,original);
});
test('checkpoint survives failed final reply and storage restart; provider token usage is distinct',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ailo-context-'));
 try {
  let storage=createStorage(dir,{});
  await storage.saveWorkspace({projects:[],models:[model],defaultModelId:'m',tasks:[{id:'t',request:'old',materials:[],messages:history}]});
  let finalCalls=0;
  const chat=createChat(storage,async(url,options)=>{
   const payload=JSON.parse(options.body);
   if(payload.messages[0].content.startsWith('请整理历史')) return response('保留目标与约束。');
   finalCalls++;return new Response('private provider detail',{status:503});
  });
  await assert.rejects(chat.complete({id:'r',taskId:'t',modelId:'m',messages:history}),/503/);
  storage=createStorage(dir,{});
  const state=await storage.readWorkspace(); const checkpoint=state.tasks[0].contextCheckpoint;
  assert.ok(checkpoint);assert.deepEqual(state.tasks[0].messages,history);assert.equal(state.models[0].contextWindow,4096);
  const retry=createChat(storage,async(url,options)=>{
   assert.ok(!JSON.parse(options.body).messages[0].content.startsWith('请整理历史'));
   return response('完成',{prompt_tokens:123});
  });
  const result=await retry.complete({id:'retry',taskId:'t',modelId:'m',messages:history,contextCheckpoint:checkpoint});
  assert.equal(result.promptTokens,123);assert.equal(finalCalls,1);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('cancellation during compaction aborts without checkpoint writes',async()=>{
 let signalStarted; const started=new Promise(r=>signalStarted=r);let saved=false;
 const chat=createChat({modelCredentials:async()=>model,saveContextCheckpoint:async()=>{saved=true;}},async(url,{signal})=>{
  signalStarted();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('abort')),{once:true}));
 });
 const promise=chat.complete({id:'cancel',taskId:'t',modelId:'m',messages:history});await started;chat.cancel('cancel');
 await assert.rejects(promise,/已停止/);assert.equal(saved,false);
});

test('provider length finish retries with more output room and smaller original chunks, without losing evidence', async()=>{
 const requests=[], successfulChunks=[], statuses=[];let stored;
 const chat=createChat({modelCredentials:async()=>model,saveContextCheckpoint:async(id,cp)=>{stored=cp;}},async(url,options)=>{
  const payload=JSON.parse(options.body);
  assert.ok(countMessages(payload.messages)+payload.max_tokens<=model.contextWindow);
  if(!payload.messages[0].content.startsWith('请整理历史')) return response('完成');
  requests.push(payload);
  if(requests.length===1) return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'不能采纳的残缺摘要'}}]}));
  assert.ok(!JSON.stringify(payload.messages).includes('不能采纳的残缺摘要'));
  successfulChunks.push(payload.messages[1].content.split('新增历史：\n')[1]);
  return response('完整摘要：保持蓝色。');
 });
 const result=await chat.complete({id:'length-retry',taskId:'t',modelId:'m',messages:history,onStatus:s=>statuses.push(s)});
 assert.equal(result.content,'完成');assert.ok(stored);
 assert.ok(requests[1].max_tokens>requests[0].max_tokens);
 assert.ok(requests[1].messages[1].content.length<requests[0].messages[1].content.length);
 assert.ok(statuses.some(s=>s.includes('重试（2/3）')));
 assert.equal(successfulChunks.join(''),history.slice(0,stored.covered).map(m=>`[${m.role}]\n${m.content}`).join('\n\n'));
});
test('completed but oversized summaries retry automatically and never replace original evidence',async()=>{
 let attempts=0;
 const prepared=await prepareContext(history,[],model,undefined,async(messages,budget,meta)=>{
  attempts++;
  assert.ok(!messages[1].content.includes('无效摘要'));
  return attempts===1?'无效摘要'.repeat(300):'简短有效摘要';
 });
 assert.ok(prepared.compacted);assert.ok(attempts>1);
 assert.equal(prepared.checkpoint.summary,'简短有效摘要');
});
test('three length failures stop automatically, preserve original history, and never persist a partial summary',async()=>{
 let calls=0,saved=false;const original=structuredClone(history);
 const chat=createChat({modelCredentials:async()=>model,saveContextCheckpoint:async()=>{saved=true;}},async()=>{
  calls++;return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:''}}]}));
 });
 await assert.rejects(chat.complete({id:'exhausted',taskId:'t',modelId:'m',messages:history}),/连续 3 次/);
 assert.equal(calls,3);assert.equal(saved,false);assert.deepEqual(history,original);
});
test('provider failures are not retried as length failures',async()=>{
 let calls=0;
 const chat=createChat({modelCredentials:async()=>model},async()=>{calls++;return new Response('private',{status:401});});
 await assert.rejects(chat.complete({id:'auth',modelId:'m',messages:history}),/API Key/);
 assert.equal(calls,1);
});
test('cancelling an automatic retry prevents another request and checkpoint writes',async()=>{
 let calls=0,saved=false;
 const chat=createChat({modelCredentials:async()=>model,saveContextCheckpoint:async()=>{saved=true;}},async()=>{
  calls++;return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'partial'}}]}));
 });
 await assert.rejects(chat.complete({id:'cancel-retry',taskId:'t',modelId:'m',messages:history,onStatus:s=>{if(s.includes('重试'))chat.cancel('cancel-retry');}}),/已停止/);
 assert.equal(calls,1);assert.equal(saved,false);
});

test('runtime context estimate includes summaries, tool results and actual tool schema',async()=>{
 const {requestContextUsage,countMessages,tokens}=await import('../apps/desktop/context.mjs');
 const model={id:'m',name:'测试',contextWindow:100000};
 const format={tools:[{type:'function',function:{name:'ailo_action',parameters:{type:'object'}}}]};
 const snapshot={phase:'task',goal:'开发',workingMemory:'已确认需求'.repeat(1000),toolResults:[{result:{text:'工具输出'.repeat(1500)}}],materials:[{id:'m1',name:'需求'}],readCoverage:[{offset:0,end:6000}],conversation:[{role:'user',content:'开发'}]};
 const messages=[{role:'system',content:'系统指令'},{role:'assistant',content:'{"action":"read_material"}'},{role:'user',content:'旧工具结果'},{role:'user',content:JSON.stringify(snapshot)}];
 const stats=requestContextUsage(messages,format,model,16000);
 assert.equal(stats.used,stats.rows.reduce((n,r)=>n+r.tokens,0));
 assert.equal(stats.used,countMessages(messages)+tokens(JSON.stringify(format))+128);
 assert.ok(stats.rows.find(r=>r.label==='需求摘要').tokens>1000);
 assert.ok(stats.rows.find(r=>r.label==='工具调用与结果').tokens>1000);
 assert.equal(stats.reserve,16000);assert.equal(stats.window,100000);assert.equal(stats.status,'sending');
 const small=requestContextUsage([{role:'system',content:'系统指令'},{role:'user',content:JSON.stringify({...snapshot,workingMemory:'',toolResults:[]})}],format,model,16000);
 assert.ok(stats.used>small.used+10000);
});

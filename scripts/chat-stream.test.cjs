const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createChat}=require('../apps/desktop/chat.cjs');
const storage={modelCredentials:async()=>({baseUrl:'https://example.com/v1',model:'test',name:'Test'})};
const input={id:'r',modelId:'m',messages:[{role:'user',content:'hi'}]};
const event=(delta,finish_reason=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason}]})}\r\n\r\n`;
function stream(parts,delay=0,close=true){
 let timer,index=0;
 return new Response(new ReadableStream({
  start(controller){
   function push(){
    if(index<parts.length){controller.enqueue(typeof parts[index]==='string'?new TextEncoder().encode(parts[index++]):parts[index++]);timer=setTimeout(push,delay);}
    else if(close)controller.close();
   }push();
  },cancel(){clearTimeout(timer);}
 }),{headers:{'content-type':'text/event-stream; charset=utf-8'}});
}
test('fragmented UTF-8 and CRLF SSE streams progressively, ignores reasoning, retains usage',async()=>{
 const source=event({reasoning_content:'private reasoning'})+event({content:'你好'})+event({content:'世界'},'stop')+'data: {"choices":[],"usage":{"prompt_tokens":42}}\r\n\r\ndata: [DONE]\r\n\r\n';
 const bytes=new TextEncoder().encode(source),parts=[];
 for(let i=0;i<bytes.length;i+=7)parts.push(bytes.slice(i,i+7));
 const texts=[],statuses=[];
 const chat=createChat(storage,async(url,options)=>{assert.equal(JSON.parse(options.body).stream,true);return stream(parts);});
 const result=await chat.complete({...input,onText:t=>texts.push(t),onStatus:s=>statuses.push(s)});
 assert.deepEqual(texts,['你好','你好世界']);assert.equal(result.content,'你好世界');assert.equal(result.promptTokens,42);
 assert.ok(statuses.some(s=>s.includes('思考')));assert.ok(!JSON.stringify(texts).includes('private'));
});
test('active stream may outlive initial timeout while making progress',async()=>{
 const chat=createChat(storage,async()=>stream([event({content:'a'}),event({reasoning_content:'hidden'}),event({content:'b'}),event({},'stop'),'data: [DONE]\n\n'],35),{first:65,idle:90,total:600});
 assert.equal((await chat.complete(input)).content,'ab');
});
test('no first content and stalled stream report different timeout phases',async()=>{
 await assert.rejects(createChat(storage,async()=>stream([': heartbeat\n\n'],0,false),{first:20,idle:20,total:200}).complete(input),/未收到模型内容/);
 const texts=[];
 await assert.rejects(createChat(storage,async()=>stream([event({content:'partial'})],0,false),{first:100,idle:20,total:200}).complete({...input,onText:t=>texts.push(t)}),/内容已停止更新/);
 assert.deepEqual(texts,['partial']);
});
test('heartbeats cannot keep a stalled stream alive; total limit bounds active generation',async()=>{
 await assert.rejects(createChat(storage,async()=>stream(Array(15).fill(': ping\n\n'),5),{first:25,idle:25,total:200}).complete(input),/未收到模型内容/);
 await assert.rejects(createChat(storage,async()=>stream(Array(15).fill(event({content:'a'})),10),{first:80,idle:80,total:50}).complete(input),/最长等待时间/);
});
test('truncated, malformed and provider error events are not accepted as complete replies',async()=>{
 await assert.rejects(createChat(storage,async()=>stream([event({content:'partial'})])).complete(input),/意外中断/);
 await assert.rejects(createChat(storage,async()=>stream(['data: {bad}\n\n'])).complete(input),/JSON/);
 await assert.rejects(createChat(storage,async()=>stream(['data: {"error":{"message":"secret"}}\n\n'])).complete(input),e=>!e.message.includes('secret')&&/返回错误/.test(e.message));
 await assert.rejects(createChat(storage,async()=>stream([event({content:'partial'},'length'),'data: [DONE]\n\n'])).complete(input),e=>e.code==='MODEL_OUTPUT_LIMIT');
});
test('cancel aborts active stream immediately and preserves received progress',async()=>{
 const texts=[];const chat=createChat(storage,async()=>stream([event({content:'partial'})],0,false));
 await assert.rejects(chat.complete({...input,onText:t=>{texts.push(t);chat.cancel('r');}}),/已停止/);
 assert.deepEqual(texts,['partial']);
});
test('length-limited reply continues from received text and joins progress',async()=>{
 let calls=0;const texts=[];
 const chat=createChat(storage,async(url,options)=>{
  const body=JSON.parse(options.body);calls++;
  if(calls===1){assert.equal(body.max_tokens,8192);return stream([event({content:'开头'},'length'),'data: [DONE]\n\n']);}
  assert.equal(body.max_tokens,16384);assert.equal(body.messages.at(-2).content,'开头');assert.equal(body.messages.at(-2).role,'assistant');
  return stream([event({content:'结尾'},'stop'),'data: [DONE]\n\n']);
 });
 assert.equal((await chat.complete({...input,onText:t=>texts.push(t)})).content,'开头结尾');
 assert.deepEqual(texts,['开头','开头结尾']);assert.equal(calls,2);
});
test('length limit without visible output retries original request with larger budget',async()=>{
 let calls=0;
 const chat=createChat(storage,async(url,options)=>{
  calls++;const body=JSON.parse(options.body);
  if(calls===1)return stream([event({},'length'),'data: [DONE]\n\n']);
  assert.equal(body.messages.at(-1).content,'hi');assert.equal(body.max_tokens,16384);
  return stream([event({content:'完成'},'stop'),'data: [DONE]\n\n']);
 });
 assert.equal((await chat.complete(input)).content,'完成');assert.equal(calls,2);
});
test('continuations are bounded and preserve accumulated partial progress',async()=>{
 let calls=0;const texts=[];
 const chat=createChat(storage,async()=>{calls++;return stream([event({content:'片段'},'length'),'data: [DONE]\n\n']);});
 await assert.rejects(chat.complete({...input,onText:t=>texts.push(t)}),/已自动续写或调整额度 2 次/);
 assert.equal(calls,3);assert.equal(texts.at(-1),'片段片段片段');
});
test('continuous reasoning cannot reset the visible-text deadline; pending request is released',async()=>{
 let calls=0;const statuses=[];
 const chat=createChat(storage,async()=>++calls===1
  ?stream(Array(100).fill(event({reasoning_content:'private reasoning'})),5)
  :stream([event({content:'recovered'},'stop'),'data: [DONE]\n\n']),
 {first:100,idle:100,text:35,total:1000});
 await assert.rejects(chat.complete({...input,onStatus:s=>statuses.push(s)}),/未生成正文/);
 assert.ok(statuses.some(s=>s.includes('字思考数据')));
 assert.ok(!statuses.join('').includes('private reasoning'));
 assert.equal((await chat.complete(input)).content,'recovered');
});
test('visible text clears reasoning deadline while normal streaming continues',async()=>{
 const chat=createChat(storage,async()=>stream([
  event({reasoning_content:'hidden'}),event({content:'a'}),event({content:'b'}),event({},'stop'),'data: [DONE]\n\n'
 ],20),{first:100,idle:100,text:55,total:500});
 assert.equal((await chat.complete(input)).content,'ab');
});
test('empty-output retries share the visible-text deadline',async()=>{
 let calls=0;
 const chat=createChat(storage,async()=>{
  calls++;
  return calls===1?stream([event({reasoning_content:'hidden'}),event({},'length'),'data: [DONE]\n\n'],10)
   :stream(Array(100).fill(event({reasoning_content:'hidden'})),5);
 },{first:100,idle:100,text:55,total:1000});
 await assert.rejects(chat.complete(input),/未生成正文/);
 assert.equal(calls,2);
});

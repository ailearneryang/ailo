const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createChat}=require('../apps/desktop/chat.cjs');
const {replyText,decodePartialString}=require('../apps/desktop/agent/reply-stream.cjs');

test('partial JSON string decoding stops at closing quote or incomplete escape',()=>{
 assert.deepEqual(decodePartialString('你好\\n世界"}'),{text:'你好\n世界',closed:true});
 assert.deepEqual(decodePartialString('a\\'),{text:'a',closed:false});
 assert.deepEqual(decodePartialString('a\\u00'),{text:'a',closed:false});
 assert.deepEqual(decodePartialString('a\\u4e2d\\"b'),{text:'a中"b',closed:false});
 assert.deepEqual(decodePartialString('\\ud83d\\ude00!'),{text:'😀!',closed:false});
});
test('reply preview only exposes reply text from streaming arguments',()=>{
 assert.equal(replyText('reply','{"te'),'');
 assert.equal(replyText('reply','{"text":"第一'),'第一');
 assert.equal(replyText('functions.reply','{"text":"第一句\\n第二","conversationTitle":"x"}'),'第一句\n第二');
 assert.equal(replyText('ailo_action','{"action":"rep'),'');
 assert.equal(replyText('ailo_action','{"action":"reply","text":"你好'),'你好');
 assert.equal(replyText('ailo_action','{"action":"read_file","path":"text"}'),undefined);
 assert.equal(replyText('ailo_action','{"action":"write_file","path":"a.md","content":"{\\"text\\":\\"secret"'),undefined);
 assert.equal(replyText('ailo_action','{"text":"before action"'),undefined);
 assert.equal(replyText('write_file','{"path":"a","content":"{\\"text\\":\\"x\\"}"}'),undefined);
 assert.equal(replyText('ailo_action',''),undefined);
});
function sse(deltas){
 const frames=deltas.map(delta=>'data: '+JSON.stringify({choices:[{index:0,delta}]})+'\n\n');
 frames.push('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\n','data: [DONE]\n\n');
 const encoder=new TextEncoder();
 const body=new ReadableStream({async pull(controller){if(!frames.length){controller.close();return;}controller.enqueue(encoder.encode(frames.shift()));await new Promise(r=>setTimeout(r,2));}});
 return new Response(body,{headers:{'content-type':'text/event-stream'}});
}
const args=(name,pieces)=>pieces.map((text,i)=>({tool_calls:[{index:0,...(i===0?{id:'c',type:'function',function:{name,arguments:text}}:{function:{arguments:text}})}]}));
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-reply-stream-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'task',projectId:'project',request:'你好',materials:[],messages:[{role:'user',content:'你好'}]};return {agentDirectory:base,modelCredentials:async()=>({baseUrl:'https://example.com/v1',name:'mock',model:'mock'}),readWorkspace:async()=>({tasks:[task]})};}
test('a greeting is answered in one streamed request without a separate route call',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async(url,options)=>{
  calls++;const body=JSON.parse(options.body),state=JSON.parse(body.messages.at(-1).content);
  assert.equal(state.phase,'route');assert.deepEqual(body.tools.map(t=>t.function.name),['route','reply']);assert.equal(body.tool_choice,'required');
  return sse(args('reply',['{','"text":"你好，','我是 Ailo。\\n','有什么可以帮你？"}']));
 });
 const shown=[];
 const result=await chat.complete({id:'r',modelId:'m',taskId:'task',messages:[{role:'user',content:'你好'}],onText:text=>shown.push(text)});
 assert.equal(calls,1);
 assert.equal(result.content,'你好，我是 Ailo。\n有什么可以帮你？');
 assert.deepEqual(shown,['你好，','你好，我是 Ailo。\n','你好，我是 Ailo。\n有什么可以帮你？']);
 assert.equal(result.agentRun.currentIntent,'chat');
 assert.equal(result.replyDetails.performance.modelRequests,1);
 assert.equal(result.replyDetails.performance.processRequestRatio,0);
 assert.equal(result.replyDetails.performance.firstReplySource,'stream');
 assert.ok(result.replyDetails.performance.firstStreamTextMs>=0);
});
test('task phase tool arguments never stream into the chat text',async t=>{
 const storage=await fixture(t);let calls=0;
 const chat=createChat(storage,async(url,options)=>{
  calls++;
  if(calls===1)return sse(args('ailo_action',['{"action":"route","kind":"task"}']));
  if(calls===2)return sse(args('ailo_action',['{"action":"plan","goal":"写文件","decisions":[],"acceptance":["文件存在"],"steps":[{"id":"write","title":"写入","status":"running"}]}']));
  if(calls===3)return sse(args('ailo_action',['{"action":"write_file","path":"a.md",','"content":"{\\"text\\":\\"not a reply\\"}"}']));
  return sse(args('ailo_action',['{"action":"pause","text":"稍后继续"}']));
 });
 const shown=[];
 const result=await chat.complete({id:'r',modelId:'m',taskId:'task',messages:[{role:'user',content:'写一个文件'}],onText:text=>shown.push(text)});
 assert.deepEqual(shown,[]);
 assert.equal(result.agentRun.status,'paused');
});

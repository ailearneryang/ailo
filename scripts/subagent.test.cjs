const {test}=require('node:test');
const assert=require('node:assert/strict');
const runtime=require('../apps/desktop/agent/subagent-runtime.cjs');
const protocol=require('../apps/desktop/agent/protocol.cjs');
const {createExecutionActivity}=require('../apps/desktop/execution-activity.cjs');
const {createSubagentRequest}=require('../apps/desktop/subagent-request.cjs');
const journal=require('../apps/desktop/agent/action-journal.cjs');

test('subagent contract permits only bounded independent read-only roles',()=>{
 const agents=runtime.validate([{name:'代码探索',type:'explore',prompt:'找出相关文件'}]);
 assert.deepEqual(agents.map(agent=>agent.id),['agent-1']);
 assert.throws(()=>runtime.validate(Array.from({length:4},(_,i)=>({name:String(i),type:'research',prompt:'调查'}))),/1–3/);
 assert.throws(()=>runtime.validate([{name:'x',type:'general-purpose',prompt:'修改文件'}]),/类型/);
 for(const action of ['write_file','run_command','assistant','mcp','request_network'])assert.throws(()=>runtime.decode(JSON.stringify({action,path:'a'})),/只允许读取/);
 assert.equal(protocol.allowedActions({phase:'task',subagentAvailable:true}).includes('subagent'),true);
 assert.equal(protocol.allowedActions({phase:'chat',subagentAvailable:true}).includes('subagent'),false);
 assert.equal(protocol.allowedActions({phase:'task',subagentAvailable:false}).includes('subagent'),false);
 const entry=journal.begin({actionJournal:[],steps:[],revision:0},{action:'subagent',agents});
 assert.equal(entry.readOnly,true);
});

test('two subagents run concurrently with separate model contexts and return receipts to the parent',async()=>{
 const controller=new AbortController(),seen=new Map(),updates=[],readStarted=[];
 let active=0,maximum=0;
 const result=await runtime.run({agents:[{name:'甲',type:'explore',prompt:'查文件甲'},{name:'乙',type:'research',prompt:'查文件乙'}],signal:controller.signal,
  ask:async(messages,{agent,turn})=>{
   if(turn===0){active++;maximum=Math.max(active,maximum);await new Promise(resolve=>setTimeout(resolve,10));active--;return {content:JSON.stringify({action:'read_file',path:agent.name+'.txt'})};}
   seen.set(agent.name,messages.map(message=>message.content).join('\n'));
   return {content:JSON.stringify({action:'finish',summary:agent.name+' 的结论'})};
  },read:async action=>{readStarted.push(action.path);return {text:action.path+' 的内容'};},onUpdate:async update=>updates.push(update)
 });
 assert.equal(maximum,2);
 assert.deepEqual(new Set(readStarted),new Set(['甲.txt','乙.txt']));
 assert.deepEqual(result.map(item=>item.status),['completed','completed']);
 assert.equal(result[0].observations[0].path,'甲.txt');
 assert.equal(seen.get('甲').includes('乙.txt'),false);
 assert.equal(seen.get('乙').includes('甲.txt'),false);
 assert.ok(updates.some(item=>item.name==='甲'&&item.state==='completed'));
});

test('invalid child action fails locally without executing a tool or satisfying acceptance',async()=>{
 let reads=0;
 const [result]=await runtime.run({agents:[{name:'越权',type:'plan',prompt:'做方案'}],signal:new AbortController().signal,
  ask:async()=>({content:JSON.stringify({action:'write_file',path:'result.md',content:'假的成果'})}),read:async()=>{reads++;},onUpdate:async()=>{}});
 assert.equal(reads,0);assert.equal(result.status,'failed');assert.equal(result.summary,undefined);
});

test('subagent activity identity survives the live and final presentation trace',()=>{
 const startedAt=new Date(Date.now()-1000).toISOString();
 const activity=createExecutionActivity(startedAt),event={id:'subagent-event-1',type:'subagent_status',at:new Date().toISOString(),detail:{agentId:'agent-1',name:'资料探索',agentType:'explore',state:'reading',message:'正在读取资料',action:'read_file'}};
 const snapshot=activity.capture({events:[event]});
 assert.equal(snapshot.events[0].detail.agentId,'agent-1');
 assert.equal(snapshot.events[0].detail.state,'reading');
 assert.equal(snapshot.events[0].detail.action,'read_file');
});

test('subagent requests use the selected model, record its reported usage and retry only an unsupported usage parameter',async()=>{
 const requests=[],usage=[],records=[];
 const fetchImpl=async(_url,init)=>{
  const body=JSON.parse(init.body);requests.push(body);
  if(requests.length===1)return new Response(JSON.stringify({error:{message:'stream_options include_usage unsupported'}}),{status:400});
  return new Response(JSON.stringify({choices:[{index:0,message:{content:'{"action":"finish","summary":"已分析"}'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10}}),{status:200,headers:{'content-type':'application/json'}});
 };
 const request=createSubagentRequest({fetchImpl,model:{id:'model-1',name:'当前模型',model:'company-model',baseUrl:'https://models.example.com/v1/chat/completions',maxOutputTokens:4096},signal:new AbortController().signal,onUsage:(...args)=>usage.push(args),recordRequest:row=>records.push(row)});
 const result=await request([{role:'system',content:'只读'},{role:'user',content:'调查'}],{agent:{id:'agent-1'},turn:0});
 assert.equal(result.content.includes('已分析'),true);
 assert.equal(requests.length,2);assert.equal(requests[0].model,'company-model');
 assert.ok(requests[0].stream_options);assert.equal(requests[1].stream_options,undefined);
 assert.equal(usage[0][1].inputTokens,20);assert.equal(records[0].subagentId,'agent-1');
});

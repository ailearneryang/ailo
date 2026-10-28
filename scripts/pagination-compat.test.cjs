const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {decodeAction,parameterHint}=require('../apps/desktop/agent/protocol.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const response=action=>({content:JSON.stringify(action),finishReason:'stop'});
const decode=(action,options={boundReadPages:true})=>decodeAction(response(action),options);
const named=(name,args)=>({function:{name,arguments:JSON.stringify(args)}});
const model={id:'company',baseUrl:'https://company.example/v1',model:'company-model',contextWindow:131072,maxOutputTokens:8192};
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-page-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const task={id:'page-task',request:'读取完整材料后回答',materials:[],messages:[{id:'u1',role:'user',content:'读取完整材料后回答'}]},w=await createWorkspace(base,task);
 const content=Array.from({length:2500},(_,i)=>`第${i}行内容\n`).join('');await fs.writeFile(path.join(w.files,'source.txt'),content);
 return {base,task,w,content,model,signal:new AbortController().signal};
}
test('runtime page adaptation bounds optional read lengths, preserving objects and offsets across response channels',()=>{
 for(const action of ['read_file','read_material','read_history','read_execution']){
  const notices=[],original={action,path:'source.txt',id:'saved',view:'result',offset:'27',limit:'50000',progress:{memory:'保留原任务与材料来源，继续按实际读取结果和下一页位置完成核对。'}};
  const result=decode(original,{boundReadPages:true,onNormalization:n=>notices.push(n)});
  assert.deepEqual(result,{...original,offset:27,limit:12000});assert.equal(original.limit,'50000');
  assert.equal(notices.length,1);assert.equal(notices[0].receivedValue,'50000');assert.equal(notices[0].normalizedValue,12000);
  assert.equal(decode({...original,limit:null}).limit,undefined);
  assert.equal(decodeAction({toolCalls:[named(action,{...original,action:undefined})]},{boundReadPages:true}).limit,12000);
 }
 assert.equal(decodeAction({toolCalls:[named('ailo_action',{action:'read_file',path:'source.txt',limit:50000})]},{boundReadPages:true}).limit,12000);
 assert.equal(decode({action:'read_file',path:'source.txt',limit:50000},{boundReadPages:true,readPageMax:50000}).limit,12000);
 for(const limit of [12001,null])assert.throws(()=>decode({action:'read_file',path:'source.txt',limit},{}),e=>e.reason==='invalid_parameter');
});
test('ambiguous lengths and offsets stay invalid; connector data and side effects are never rewritten',()=>{
 for(const limit of [0,-1,1.5,false,true,[],{},'1e4','all','-1',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>decode({action:'read_file',path:'source.txt',limit}),e=>e.reason==='invalid_parameter'&&e.diagnostics.field==='limit');
 for(const offset of [null,-1,1.5,false,'all'])assert.throws(()=>decode({action:'read_file',path:'source.txt',offset,limit:50000}),e=>e.diagnostics.field==='offset');
 for(const action of [{action:'mcp',params:{limit:null,offset:-1}},{action:'write_file',path:'x',content:'limit=50000'},{action:'run_command',command:'echo 50000',limit:50000}])assert.deepEqual(decode(action),action);
 assert.throws(()=>decodeAction({toolCalls:[named('read_file',{path:'source.txt',limit:50000}),named('write_file',{path:'x',content:'bad'})]},{boundReadPages:true}),e=>e.reason==='multiple_tools');
 assert.throws(()=>decode({action:'read_file',path:'source.txt',limit:'private-user-material'}),e=>!JSON.stringify(e.diagnostics).includes('private-user-material')&&e.diagnostics.receivedType==='string');
 assert.throws(()=>decode({action:'read_file',path:'source.txt',limit:0}),e=>e.diagnostics.receivedValue===0&&/read_file.limit.*收到 0.*3000/.test(parameterHint(e.diagnostics)));
});
test('explicit and implicit local read batches bound each page before validation and reject the entire invalid batch',()=>{
 const items=[{action:'read_file',path:'source.txt',limit:50000,offset:3},{action:'read_material',id:'m',limit:null}];
 const explicit=decode({action:'batch_read',items});assert.equal(explicit.items[0].limit,4000);assert.equal(explicit.items[0].offset,3);assert.equal(explicit.items[1].limit,3000);
 const implicit=decodeAction({toolCalls:items.map(({action,...args})=>named(action,args))},{boundReadPages:true});assert.deepEqual(implicit,explicit);
 assert.throws(()=>decode({action:'batch_read',items:[items[0],{...items[1],limit:0}]}),e=>e.diagnostics.field==='items'&&e.diagnostics.itemDiagnostics.receivedValue===0&&/read_material.limit.*收到 0/.test(parameterHint(e.diagnostics)));
});
test('oversized pages continue using model-visible next until all content is actually read',async t=>{
 const f=await fixture(t),seen=[],executed=[],observed=new Set();let calls=0,nextOffset=0,complete=false;
 const result=await runAgent({...f,executeTool:async(w,a,s,o)=>{executed.push(a);return execute(w,a,s,o);},ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);assert.ok(++calls<30);
  if(state.phase==='route')return response({action:'route',kind:'chat'});
  const observation=state.toolResults.at(-1),page=observation?.result;
  if(page?.text!==undefined&&!observed.has(observation.observationId)){
   observed.add(observation.observationId);assert.equal(page.offset,seen.join('').length);seen.push(page.text);
   complete=page.next===null;nextOffset=page.next;assert.ok(complete||nextOffset===seen.join('').length);
  }
  if(state.requiredAction==='checkpoint')return response({action:'checkpoint',text:`已实际读取 ${seen.join('').length} 字符，下一位置 ${nextOffset}，继续读取剩余内容。`});
  if(complete)return response({action:'reply',text:'完整读取完成'});
  return response({action:'read_file',path:'source.txt',offset:nextOffset,limit:50000});
 }});
 assert.equal(result.content,'完整读取完成');assert.equal(seen.join(''),f.content);assert.ok(executed.length>2);assert.ok(executed.every(a=>a.limit===12000));
 assert.equal(result.agentRun.events.filter(e=>e.type==='protocol_error').length,0);assert.ok(result.agentRun.events.some(e=>e.type==='protocol_normalized'));
});
test('null optional page length uses real tool default without moving the requested position',async t=>{
 const f=await fixture(t),action=decode({action:'read_file',path:'source.txt',offset:17,limit:null});
 const page=await execute(f.w,action,f.signal);assert.equal(page.offset,17);assert.equal(page.text,f.content.slice(17,10017));assert.equal(page.next,10017);
});
test('a precise correction recovers the same read and invalid batch members execute nothing',async t=>{
 const f=await fixture(t);let bad=false,corrected=false,executed=0;
 const result=await runAgent({...f,executeTool:async(w,a,s,o)=>{executed++;assert.equal(a.limit,3000);return execute(w,a,s,o);},ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);
  if(state.phase==='route')return response({action:'route',kind:'chat'});
  if(!bad){bad=true;return response({action:'batch_read',items:[{action:'read_file',path:'source.txt',limit:50000},{action:'read_file',path:'source.txt',limit:0}]});}
  if(!corrected){corrected=true;assert.equal(executed,0);assert.match(state.protocolRecovery.instruction,/read_file.limit.*收到 0/);return response({action:'read_file',path:'source.txt',limit:3000});}
  assert.equal(state.toolResults.at(-1).result.text,f.content.slice(0,3000));return response({action:'reply',text:'已纠正，当前只读取了第一页'});
 }});assert.equal(executed,1);assert.match(result.content,/第一页/);
});
test('repeated bad limits stop after two corrections, preserve evidence, and allow explicit continuation',async t=>{
 const f=await fixture(t);let failures=0,executed=0;
 await fs.writeFile(path.join(f.w.files,'evidence.txt'),'原有证据');
 await assert.rejects(runAgent({...f,executeTool:async()=>{executed++;},ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);
  if(state.phase==='route')return response({action:'route',kind:'chat'});
  if(failures)assert.match(state.protocolRecovery.instruction,/read_file.limit.*收到 0/);
  failures++;return response({action:'read_file',path:'source.txt',limit:0});
 }}),e=>e.code==='AGENT_PROTOCOL'&&e.diagnostics.action==='read_file'&&e.diagnostics.receivedValue===0&&/read_file.limit.*收到 0/.test(e.message));
 assert.equal(failures,3);assert.equal(executed,0);assert.equal(await fs.readFile(path.join(f.w.files,'evidence.txt'),'utf8'),'原有证据');
 let read=false;
 const resumed=await runAgent({...f,ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);
  if(state.phase==='route')return response({action:'route',kind:'chat'});
  if(!read){read=true;return response({action:'read_file',path:'evidence.txt',limit:3000});}
  assert.equal(state.toolResults.at(-1).result.text,'原有证据');return response({action:'reply',text:'已保留原任务与证据'});
 }});
 assert.equal(resumed.content,'已保留原任务与证据');assert.equal((await createWorkspace(f.base,f.task)).run.taskId,f.task.id);
});
test('different oversized limits cannot evade repeated-read protection',async t=>{
 const f=await fixture(t);let n=0,executed=0;
 const result=await runAgent({...f,executeTool:async(w,a,s,o)=>{executed++;return execute(w,a,s,o);},ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);
  if(state.phase==='route')return response({action:'route',kind:'chat'});
  if(++n<=3)return response({action:'read_file',path:'source.txt',limit:50000+n*1000});
  assert.ok(state.toolResults.at(-1).notExecuted);return response({action:'reply',text:'使用已有读取结果'});
 }});
 assert.equal(executed,2);assert.ok(result.agentRun.events.some(e=>e.type==='repeat_warning'));
});

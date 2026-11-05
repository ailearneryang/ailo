const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),acceptance=require('../apps/desktop/agent/acceptance.cjs'),requirements=require('../apps/desktop/agent/requirements.cjs'),native=require('../apps/desktop/agent/native-operation.cjs'),proof=require('../apps/desktop/agent/evidence.cjs');
const file='journal.txt',request='读取 journal.txt 初始值7，用一次 write_file 将 journal.txt 写为字符串9，然后重新读取实际结果，输出 receipt.md 说明最终值及核对依据。未知结果必须先核对，不能重放写入。';
const criteria=[{id:'initial',text:'读取 journal.txt，确认初始值为7',type:'content',scope:{kind:'file',path:file}},{id:'effect',text:'用 write_file 将 journal.txt 写为字符串9',type:'behavior',scope:{kind:'file',path:file}},{id:'after',text:'写入后重新读取 journal.txt 核对实际结果',type:'content',scope:{kind:'file',path:file}},{id:'receipt',text:'receipt.md说明最终值及核对依据',type:'content',scope:{kind:'file',path:'receipt.md'}}];
const plan={action:'plan',goal:request,decisions:[],requirements:criteria,steps:[{id:'work',title:'读取、一次写入与核对',status:'running'}]},reply=action=>({content:JSON.stringify(action)});
async function temporary(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-native-operation-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return base;}
function operation(w,phase='before'){
 const reads=w.run.observationIndex.filter(r=>r.action==='read_file'&&r.path===file),entry=w.run.actionJournal.find(e=>e.action==='write_file'&&e.path===file);
 return {phase,path:file,beforeEvidenceId:reads[0].id,actionId:entry.id,afterEvidenceId:reads.at(-1).id,beforeText:'7',afterText:'9',sourceInputId:'input',sourceQuote:request};
}
function bound(w){return criteria.map((r,i)=>i<3?{...r,evidenceBinding:{kind:'operation',evidenceId:native.expectedId(operation(w,['before','effect','after'][i])),operation:operation(w,['before','effect','after'][i])}}:r);}
async function exercise(t,{complete=true,lostReceipt=true,resume=true,wrongKind=false}={}){
 const base=await temporary(t),task={id:'native',request,messages:[{id:'input',role:'user',content:request}]},model={id:'offline',contextWindow:131072},signal=new AbortController().signal;let w,writes=0;
 w=await createWorkspace(base,task);await fs.writeFile(path.join(w.files,file),'7');
 const runAgent=require('../apps/desktop/agent/runner.cjs').runAgent,actions=[plan,{action:'read_file',path:file},{action:'write_file',path:file,content:'9'},...(!lostReceipt?[{action:'pause',text:'先保存原生写入结果，随后核对后读'}]:[])];
 const executeTool=async(workspace,action,...rest)=>{const value=await require('../apps/desktop/agent/tools.cjs').execute(workspace,action,...rest);if(action.action==='write_file'&&action.path===file){writes++;if(lostReceipt)throw Object.assign(Error('controlled lost receipt after actual write'),{code:'ACTION_RESULT_UNKNOWN'});}return value;};
 const first=await runAgent({base,task,model,signal,requestOrigin:'user',executeTool,ask:async messages=>{const state=JSON.parse(messages.at(-1).content);return reply(state.phase==='route'?{action:'route',kind:'task'}:actions.shift());}});
 assert.equal(first.agentRun.status,lostReceipt?'blocked':'paused');w=await createWorkspace(base,task);const executionId=w.run.executionId,actionId=w.run.actionJournal.find(e=>e.action==='write_file').id;assert.equal(w.run.actionJournal.find(e=>e.id===actionId).status,lostReceipt?'unknown':'succeeded');
 if(!resume)return {base,task,w,first,actionId,executionId,writes};
 task.messages.push({id:'first-reply',role:'assistant',content:first.content},{id:'continue',role:'user',content:'继续任务'});let stage=0,calls=0,corrected=false;
 const second=await runAgent({base,task,model,signal,requestOrigin:'user',executeTool,maxSteps:25,onWorkspace:value=>{w=value;},ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);assert.ok(++calls<18);
  if(state.phase==='route')return reply({action:'route',kind:'task'});
  if(stage++===0)return reply({action:'read_file',path:file});
  if(stage===2&&wrongKind&&!corrected){corrected=true;stage--;return reply({action:'verify',checks:[{criterionId:'initial',kind:'observation',evidenceId:w.run.observationIndex.find(r=>r.action==='read_file'&&r.path===file).eventId,reason:'引用真实初始native读取核对原要求'}],progress:{steps:[{id:'work',status:'done'}],memory:'错误的kind不能改变步骤或将未经核验的过程标为完成。'}});}
  if(stage===2){if(wrongKind){assert.equal(state.protocolRecovery.issue,'native_operation_selection');assert.match(state.protocolRecovery.instruction,/nativeFileOperations/);assert.equal(state.steps[0].status,'running');assert.equal(w.run.revision,1);assert.equal(w.run.validationRepairs?.initial,undefined);assert.equal(w.run.performance.validationFailures||0,0);}return reply({...plan,requirements:bound(w)});}
  if(!complete)return reply({action:'pause',text:'已保存显式原生过程绑定，等待核验'});
  if(stage===3)return reply({action:'write_file',path:'receipt.md',content:'最终值9；依据初始读取7、原write_file已核对恢复和实际后读9。'});
  if(stage===4)return reply({action:'artifact',path:'receipt.md',label:'核对凭证'});
  if(stage===5)return reply({action:'verify',checks:[...criteria.slice(0,3).map(r=>({criterionId:r.id,kind:'operation',reason:'以原用户指令和native有序回执核对该过程阶段'})),{criterionId:'receipt',kind:'text_contains',path:'receipt.md',contains:['最终值9','初始读取7','实际后读9'],reason:'真实凭证包含最终结果和核对依据'}]});
  if(stage===6)return reply({...plan,requirements:bound(w),steps:[{...plan.steps[0],status:'done'}]});
  return reply({action:'finish',text:'初始读取、原一次写入及当前后读均已核对，最终值9。',review:{summary:'历史初始值与当前结果分开，使用原actionId和完整native回执核验',issues:[],unverified:[]}});
 }});
 assert.equal(w.run.executionId,executionId);assert.equal(writes,1);assert.equal(w.run.actionJournal.find(e=>e.id===actionId).status,'succeeded');assert.equal(w.run.actionJournal.find(e=>e.id===actionId).recovered===true,lostReceipt);return {base,task,w,second,actionId};
}
test('real runner finishes explicit native read/write/after requirements after lost receipt, without replaying the write',async t=>{
 const {w,second}=await exercise(t);assert.equal(second.agentRun.status,'completed');assert.equal(await fs.readFile(path.join(w.files,file),'utf8'),'9');assert.equal(w.run.acceptanceResults.initial.kind,'operation');assert.equal(w.run.acceptanceResults.initial.nativeOperation.operation.beforeText,'7');assert.equal(w.run.acceptanceResults.initial.sources[0].sha256,proof.hash('9'));assert.equal(w.run.acceptanceResults.effect.nativeOperation.status,'reconciled_effect');assert.equal(w.run.events.filter(e=>e.type==='action_recovered').length,1);assert.ok(w.run.requirements.slice(0,3).every((r,i)=>r.id===criteria[i].id&&r.type===criteria[i].type&&r.scope.path===file));
});
test('historical read7 is never a current-state7 pass and changes to the actual after file invalidate every operation proof',async t=>{
 const {w}=await exercise(t);await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'initial',kind:'text_contains',path:file,contains:['7'],reason:'错误地把初始值当当前值'}]}),/未匹配/);await fs.writeFile(path.join(w.files,file),'10');await assert.rejects(acceptance.assertAccepted(w),/当前文件|已变化|尚未核验/);await assert.rejects(proof.assertFresh(w,w.run.acceptanceResults.effect),/当前文件/);
});
test('native binding rejects invented source, arbitrary behavior, visual and changed original requirement scope/type',async t=>{
 const {w}=await exercise(t,{complete:false}),r=w.run.requirements[0],op=operation(w);
 for(const change of [{sourceQuote:'模型自己说已经读取7并写9'},{sourceInputId:'missing'},{phase:'after'}])assert.throws(()=>requirements.update(w.run,{requirements:[{...r,evidenceBinding:{kind:'operation',evidenceId:native.expectedId({...op,...change}),operation:{...op,...change}}},...w.run.requirements.slice(1)]}));
 for(const changed of [{...r,type:'visual'},{...r,text:'journal.txt 的搜索功能可用',type:'behavior'},{...r,scope:{kind:'viewport',path:file}},{...r,scope:{kind:'file',path:'elsewhere.txt'}}])assert.throws(()=>requirements.update(w.run,{requirements:[{...changed,evidenceBinding:r.evidenceBinding},...w.run.requirements.slice(1)]}),/原ID|验证类型|检查范围|文件过程|原要求/);
});
test('partial read, cross-execution archives and altered native receipt digests cannot be approved or retained',async t=>{
 const {base,task,w}=await exercise(t),record=w.run.acceptanceResults.initial,ids=record.nativeOperation.operation;
 const project=path.join(w.project,'runs',require('../apps/desktop/agent/workspace.cjs').key(task.id)+'.json.observations'),file=path.join(project,ids.beforeEvidenceId+'.json'),raw=await fs.readFile(file,'utf8'),receipt=JSON.parse(raw);
 for(const mutate of [x=>x.response.result.next=1,x=>x.response.result.sha256=proof.hash('wrong'),x=>x.executionId='different-execution',x=>x.response.result.offset=1]){
  const changed=JSON.parse(raw);mutate(changed);await fs.writeFile(file,JSON.stringify(changed));const loaded=await createWorkspace(base,task);await assert.rejects(proof.assertFresh(loaded,record),/真实完整|不一致|所属执行/);
 }
 await fs.writeFile(file,raw);await proof.assertFresh(w,record);receipt.action.purpose='altered archive metadata';await fs.writeFile(file,JSON.stringify(receipt));await assert.rejects(proof.assertFresh(w,record),/原始归档/);
});
test('unknown unreconciled results, repeated write attempts and reversed phases remain blocking',async t=>{
 const {w}=await exercise(t),record=w.run.acceptanceResults.effect,entry=w.run.actionJournal.find(e=>e.id===record.nativeOperation.operation.actionId),prior=structuredClone(entry);
 entry.status='unknown';await assert.rejects(proof.assertFresh(w,record),/仍未知/);Object.assign(entry,prior);
 w.run.actionJournal.push({...entry,id:require('node:crypto').randomUUID(),startedAt:new Date().toISOString()});await assert.rejects(proof.assertFresh(w,record),/额外write_file/);w.run.actionJournal.pop();
 const after=w.run.actionJournal.find(e=>e.id===w.run.events.find(e=>e.type==='read_file'&&e.detail.result?.text==='9').detail.actionId),index=w.run.actionJournal.indexOf(after);w.run.actionJournal.splice(index,1);w.run.actionJournal.unshift(after);await assert.rejects(proof.assertFresh(w,record),/顺序/);
});
test('candidate restoration requires a new after observation even when it restores the same final bytes',async t=>{
 const {w}=await exercise(t),record=w.run.acceptanceResults.effect;w.run.candidateRecovery={requiresReverification:true,transactionId:'restore',changedPaths:[file],requiredAfter:new Date().toISOString(),existingEventIds:w.run.events.map(e=>e.id)};await assert.rejects(proof.assertFresh(w,record),/候选恢复后/);
});

test('ordinary successful native writes use their exact success receipt and preserve the same strict process proof',async t=>{
 const {w,second}=await exercise(t,{lostReceipt:false});assert.equal(second.agentRun.status,'completed');assert.equal(w.run.acceptanceResults.effect.nativeOperation.status,'native_effect');assert.equal(w.run.events.filter(e=>e.type==='action_recovered').length,0);
});
test('phase values and original message hashes cannot be replaced with genuine but unrelated values or damaged material provenance',async t=>{
 const {w}=await exercise(t,{complete:false});
 for(const [phase,text]of [['before','读取 journal.txt，确认初始值为5；另外有7个事件'],['effect','用 write_file 将 journal.txt 写为字符串8，9次观察'],['after','写入后重新读取 journal.txt，核对实际结果为8']]){
  const r=criteria[['before','effect','after'].indexOf(phase)];assert.throws(()=>native.prepare(w.run,operation(w,phase),{...r,text}),/阶段值|阶段.*冲突|原要求/);
 }
 const source=w.run.inputCoverage.entries.find(e=>e.inputId==='input'),original=structuredClone(source);source.materialCount=1;source.sourceHash='damaged';assert.throws(()=>native.prepare(w.run,operation(w),criteria[0]),/带附件|哈希/);Object.assign(source,original);source.sourceHash='damaged';assert.throws(()=>native.prepare(w.run,operation(w),criteria[0]),/哈希/);
});
test('edits and commands cannot hide a changed-then-restored value inside a native single-write chain',async t=>{
 const {w}=await exercise(t),record=w.run.acceptanceResults.effect,writeIndex=w.run.actionJournal.findIndex(e=>e.id===record.nativeOperation.operation.actionId);
 for(const action of ['edit_file','edit_spreadsheet','run_command','build_android']){
  const hidden={id:require('node:crypto').randomUUID(),action,path:action.startsWith('edit')?'./'+file:undefined,status:'succeeded',readOnly:false,startedAt:new Date().toISOString(),fileChanges:[]};w.run.actionJournal.splice(writeIndex+1,0,hidden);await assert.rejects(proof.assertFresh(w,record),/隐藏中间改动|同路径编辑/);w.run.actionJournal.splice(writeIndex+1,1);
 }
 await proof.assertFresh(w,record);assert.equal(w.run.actionJournal.filter(e=>e.action==='write_file'&&e.path==='receipt.md').length,1);
});
test('an unrelated unknown result stays in its original journal and prevents task completion without erasing valid local proof',async t=>{
 const {base,task,w}=await exercise(t);w.run.actionJournal.push({id:require('node:crypto').randomUUID(),action:'feishu',status:'unknown',readOnly:false,fingerprint:'unrelated-remote-effect'});await w.save();await proof.assertFresh(w,w.run.acceptanceResults.effect);
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task,model:{id:'offline',contextWindow:131072},signal:new AbortController().signal,continuationReason:'segment',maxSteps:8,executeTool:()=>assert.fail('unknown side effect replayed'),ask:async()=>reply({action:'finish',text:'不能绕过未知操作完成',review:{summary:'已有文件通过但未知操作未核对',issues:[],unverified:[]}})});
 assert.equal(result.agentRun.status,'blocked');const saved=await createWorkspace(base,task);assert.equal(saved.run.actionJournal.at(-1).status,'unknown');assert.equal(saved.run.events.some(e=>e.type==='finish'&&e.detail.text==='不能绕过未知操作完成'),false);
});

test('source phase values cannot use numeric substrings, reverse the transition, or negate the actual operation',async t=>{
 const {w}=await exercise(t,{complete:false}),entry=w.run.inputCoverage.entries.find(e=>e.inputId==='input'),old=structuredClone(entry),op=operation(w);
 const messages=['读取 journal.txt 初始值17，用一次 write_file 将 journal.txt 写为字符串19，然后重新读取实际结果。','读取 journal.txt 初始值9，用一次 write_file 将 journal.txt 写为字符串7，然后重新读取实际结果。','读取 journal.txt 初始值7，不要用一次 write_file 将 journal.txt 写为字符串9，然后重新读取实际结果。','读取 journal.txt 初始值7a，用一次 write_file 将 journal.txt 写为字符串9b，然后重新读取实际结果。'];
 for(const text of messages){Object.assign(entry,{text,sourceHash:proof.hash(JSON.stringify([text,[]]))});assert.throws(()=>native.prepare(w.run,{...op,sourceQuote:text},criteria[0]),/阶段完整值|方向|否定/);}
 Object.assign(entry,old);assert.throws(()=>native.prepare(w.run,op,{...criteria[0],text:'不要读取 journal.txt 初始值7'}),/否定/);await native.verify(w,w.run.requirements[0],{kind:'operation',evidenceId:w.run.requirements[0].evidenceBinding.evidenceId});
});
test('source quotes cannot cut away a whole-message analysis prohibition or change a phase target path',async t=>{
 const {w}=await exercise(t,{complete:false}),entry=w.run.inputCoverage.entries.find(e=>e.inputId==='input'),old=structuredClone(entry),op=operation(w);
 const messages=[{text:'不要执行以下步骤，只分析风险：\n'+request,quote:request},{text:'读取 journal.txt 初始值7，用一次 write_file 将 other.txt 写为字符串9，然后重新读取实际结果。'},{text:'读取 other.txt 初始值7，用一次 write_file 将 journal.txt 写为字符串9，然后重新读取实际结果。'},{text:'读取 journal.txt 初始值7，用一次 write_file 将 journal.txt 写为字符串9，然后重新读取 other.txt 核对实际结果。'},{text:'读取 journalXtxt 初始值7，用一次 write_file 将 journalXtxt 写为字符串9，然后重新读取实际结果。'}];
 for(const item of messages){Object.assign(entry,{text:item.text,sourceHash:proof.hash(JSON.stringify([item.text,[]]))});assert.throws(()=>native.prepare(w.run,{...op,sourceQuote:item.quote||item.text},criteria[0]),/分析|禁止|路径|同一路径|完整值/);}
 Object.assign(entry,old);await native.verify(w,w.run.requirements[0],{kind:'operation',evidenceId:w.run.requirements[0].evidenceBinding.evidenceId});
});
test('a pure native receipt cannot consume additional search or visual obligations attached to the same original requirement',async t=>{
 const {w}=await exercise(t,{complete:false});for(const extra of ['，并确保搜索功能可用','，同时与原稿视觉一致',' and ensure the business API works'])assert.throws(()=>native.prepare(w.run,operation(w,'effect'),{...criteria[1],text:criteria[1].text+extra}),/纯native|额外业务/);
});

test('once must qualify the write_file clause itself rather than a separate read instruction',async t=>{
 const {w}=await exercise(t,{complete:false}),entry=w.run.inputCoverage.entries.find(e=>e.inputId==='input'),old=structuredClone(entry),op=operation(w);
 for(const text of ['读取 journal.txt 初始值7，读取一次以核对，用两次 write_file 将 journal.txt 写为字符串9，然后重新读取实际结果。','读取 journal.txt 初始值7，用一次 write_file 将 journal.txt 写为字符串9，再写入一次，然后重新读取实际结果。']){Object.assign(entry,{text,sourceHash:proof.hash(JSON.stringify([text,[]]))});assert.throws(()=>native.prepare(w.run,{...op,sourceQuote:text},criteria[0]),/一次|额外/);}
 Object.assign(entry,old);await native.verify(w,w.run.requirements[0],{kind:'operation',evidenceId:w.run.requirements[0].evidenceBinding.evidenceId});
});

test('source does not infer permission from demonstration preambles or revoked/analysis-only suffixes',async t=>{
 const {w}=await exercise(t,{complete:false}),entry=w.run.inputCoverage.entries.find(e=>e.inputId==='input'),old=structuredClone(entry),op=operation(w);
 for(const text of ['这只是演示流程，切勿照做。\n'+request,request+'以上只作示例，切勿照做。']){Object.assign(entry,{text,sourceHash:proof.hash(JSON.stringify([text,[]]))});assert.throws(()=>native.prepare(w.run,{...op,sourceQuote:request},criteria[0]),/正向|示例|后续语境|分析|禁止/);}
 const text='只在隔离试验目录操作：'+request;Object.assign(entry,{text,sourceHash:proof.hash(JSON.stringify([text,[]]))});assert.doesNotThrow(()=>native.prepare(w.run,{...op,sourceQuote:text},criteria[0]));Object.assign(entry,old);
});
test('real user continuation sends no model request while the local expected hash remains unmatched',async t=>{
 const {base,task,w,first,actionId}=await exercise(t,{resume:false});await fs.writeFile(path.join(w.files,file),'10');task.messages.push({id:'prior',role:'assistant',content:first.content},{id:'retry-unmatched',role:'user',content:'继续任务'});let calls=0;
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task,model:{id:'offline',contextWindow:131072},signal:new AbortController().signal,requestOrigin:'user',executeTool:()=>assert.fail('unknown write replayed'),ask:async()=>{calls++;assert.fail('unmatched unknown bypassed user resume gate');}});assert.equal(calls,0);assert.equal(result.agentRun.status,'blocked');const saved=await createWorkspace(base,task);assert.equal(saved.run.actionJournal.find(e=>e.id===actionId).status,'unknown');assert.equal(await fs.readFile(path.join(saved.files,file),'utf8'),'10');
});
test('a recovered local write does not reopen a real user continuation over an unrelated unknown remote action',async t=>{
 const {base,task,w,first,actionId}=await exercise(t,{resume:false}),remote={id:require('node:crypto').randomUUID(),action:'feishu',status:'unknown',readOnly:false,fingerprint:'unknown-remote'};w.run.actionJournal.push(remote);await w.save();task.messages.push({id:'prior',role:'assistant',content:first.content},{id:'retry-remote',role:'user',content:'继续任务'});let calls=0;
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task,model:{id:'offline',contextWindow:131072},signal:new AbortController().signal,requestOrigin:'user',executeTool:()=>assert.fail('remote or local side effect replayed'),ask:async()=>{calls++;assert.fail('unknown remote action bypassed gate');}});assert.equal(calls,0);assert.equal(result.agentRun.status,'blocked');const saved=await createWorkspace(base,task);assert.equal(saved.run.actionJournal.find(e=>e.id===actionId).recovered,true);assert.equal(saved.run.actionJournal.find(e=>e.id===remote.id).status,'unknown');assert.equal(await fs.readFile(path.join(saved.files,file),'utf8'),'9');
});

test('the original observation-kind misuse gets one protocol correction and finishes without a product defect or state pollution',async t=>{
 const {w,second}=await exercise(t,{wrongKind:true});assert.equal(second.agentRun.status,'completed');assert.equal(w.run.events.filter(e=>e.type==='protocol_error'&&e.detail.issue==='native_operation_selection').length,1);assert.equal(w.run.events.filter(e=>e.type==='validation_failed').length,0);assert.equal(w.run.performance.validationFailures||0,0);assert.equal(w.run.events.filter(e=>e.type==='tool_error').length,0);assert.equal(w.run.actionJournal.filter(e=>e.action==='write_file'&&e.path===file).length,1);
});
test('a wrong native receipt kind cannot revoke prior passes and missing explicit operation binding stays a request defect',async t=>{
 const {w}=await exercise(t),before=JSON.stringify(w.run.acceptanceResults),id=w.run.observationIndex.find(r=>r.action==='read_file'&&r.path===file).eventId;
 await assert.rejects(acceptance.verify(w,{checks:[{criterionId:'initial',kind:'observation',evidenceId:id,reason:'真实native回执不是browser运行观察'}]}),error=>error.code==='VERIFY_REQUEST_INVALID'&&error.diagnostics.issue==='native_operation_selection');assert.equal(JSON.stringify(w.run.acceptanceResults),before);assert.equal(w.run.validationRepairs?.initial,undefined);
 const protocol=require('../apps/desktop/agent/protocol.cjs');assert.throws(()=>protocol.decodeAction(reply({action:'verify',checks:[{criterionId:'initial',kind:'operation',reason:'缺少明确binding不应自动通过'}]}),{acceptanceCriteria:criteria,boundActionContract:true}),error=>error.code==='AGENT_PROTOCOL'&&error.diagnostics.issue==='native_binding_required');
});
test('freshness still checks all other dependencies after validating the immutable operation chain',async t=>{
 const {w}=await exercise(t),check=w.run.acceptanceResults.effect;await fs.writeFile(path.join(w.files,'support.txt'),'old');check.sources.push({path:'support.txt',sha256:proof.hash('old')});await proof.assertFresh(w,check);await fs.writeFile(path.join(w.files,'support.txt'),'new');await assert.rejects(proof.assertFresh(w,check),error=>error.code==='EVIDENCE_SOURCE_CHANGED');
});
test('a new actual full after-read advances a restored task without replaying the one original native write',async t=>{
 const {base,task,w:prior}=await exercise(t,{complete:false});prior.run.candidateRecovery={transactionId:'new-after-read',requiresReverification:true,executionId:prior.run.executionId,affectedRequirementIds:['initial','effect','after'],changedPaths:[file],requiredAfter:new Date().toISOString(),existingEventIds:prior.run.events.map(e=>e.id)};await prior.save();let w=prior,stage=0,calls=0;
 const result=await require('../apps/desktop/agent/runner.cjs').runAgent({base,task,model:{id:'offline',contextWindow:131072},signal:new AbortController().signal,requestOrigin:'user',maxSteps:12,onWorkspace:value=>{w=value;},ask:async messages=>{const state=JSON.parse(messages.at(-1).content);assert.ok(++calls<11);if(state.phase==='route')return reply({action:'route',kind:'task'});if(stage++===0)return reply({action:'read_file',path:file,limit:1});if(stage===2)return reply({...plan,requirements:bound(w)});if(stage===3)return reply({action:'verify',checks:criteria.slice(0,3).map(r=>({criterionId:r.id,kind:'operation',reason:'候选恢复后取得新的真实完整后读，再按原过程核验'}))});return reply({action:'pause',text:'原生过程三项已有新后读证明，继续保留原一次写入'});}});
 assert.equal(result.agentRun.status,'paused');assert.ok(['initial','effect','after'].every(id=>w.run.acceptanceResults[id]?.status==='passed'));assert.equal(w.run.candidateRecovery.requiresReverification,false);assert.equal(w.run.actionJournal.filter(e=>e.action==='write_file'&&e.path===file).length,1);
});

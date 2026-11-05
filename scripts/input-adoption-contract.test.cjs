const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const material=require('../apps/desktop/agent/material-input.cjs');
function roleFixture(request){return {currentRequest:request,requirements:[],materialInput:{inputId:'input',required:true,status:'inspected',request,materials:[{id:'current-html',name:'效果图总览.html',reads:[{kind:'text',text:'参考效果目录'}]}]}};}
const requirements=[{id:'background',text:'根据天气切换背景',type:'behavior'},{id:'visual',text:'按原设计核对视觉效果',type:'visual'}];
const reference={materialUse:[{id:'current-html',role:'reference',reason:'本次上传的效果参考目录',requirementIds:['background','visual']}]};
test('amendment step metadata accepts inherited IDs and rejects malformed step arrays as protocol errors',()=>{
 const protocol=require('../apps/desktop/agent/protocol.cjs'),base={action:'plan',mode:'amend',goal:'新增功能',decisions:[],requirements:[{id:'new',text:'新要求',type:'content'}],steps:[{id:'new_step',title:'新增步骤',status:'running'}],progress:{steps:[{id:'old_step',status:'waiting_sync'}]}};
 assert.equal(protocol.decodeAction({content:JSON.stringify(base)},{steps:[{id:'old_step',title:'旧步骤',status:'running'}],boundActionContract:true}).progress.steps[0].id,'old_step');
 for(const steps of [null,'bad',{}])assert.throws(()=>protocol.decodeAction({content:JSON.stringify({...base,steps,progress:undefined})},{steps:[{id:'old_step'}],boundActionContract:true}),e=>e.code==='AGENT_PROTOCOL'&&e.reason==='invalid_parameter');
 assert.equal(require('../apps/desktop/agent/quality-contract.cjs').context({requirementsManaged:true,requirements:[]}),undefined,'无已登记质量要求时不向普通聊天注入空质量政策上下文');
});
test('weather-dependent behavior followed by reference wording does not turn an HTML index into a replacement design',()=>{
 for(const text of ['希望天气的背景图片可以根据天气的情况变换不同的背景， 具体可以参考设计稿，参考效果图纵览','背景根据天气变化；参考设计稿','根据天气情况换背景，参考附件效果图总览','本次补充背景功能，具体参考设计稿'])assert.doesNotThrow(()=>material.checkPlan(roleFixture(text),reference,requirements),text);
});
test('direct adoption still requires design role and cannot be bypassed by a later reference clause',()=>{
 for(const text of ['请按照附件的设计稿更新天气应用','请用附件设计稿补充标题与云层背景','请采用这份新设计稿，其他内容可以参考旧稿','依据本次设计稿实现布局']){
  assert.throws(()=>material.checkPlan(roleFixture(text),reference,requirements),e=>e.code==='MATERIAL_INPUT_PENDING',text);
  assert.doesNotThrow(()=>material.checkPlan(roleFixture(text),{materialUse:[{...reference.materialUse[0],role:'design'}]},requirements));
 }
});
test('zero-execution adoption failure leads with the actual cause and retains historical files outside the reply',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-adoption-result-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),{hash}=require('../apps/desktop/agent/evidence.cjs'),w=await createWorkspace(base,{id:'result'});
 await fs.writeFile(path.join(w.files,'old.apk'),'old APK');Object.assign(w.run,{executionId:'e',inputKey:'new',mode:'task',goal:'保留原应用并处理新增要求',requirementsManaged:true,requirements:[{id:'original',text:'原始功能',type:'content'}],steps:[{id:'old',title:'原任务',status:'running'}],artifacts:[{path:'old.apk',label:'旧安装包',sha256:hash('old APK')}],inputTurn:{inputId:'new',followup:true,requiresPlan:true,eventIds:[],observationIds:[],artifacts:{'old.apk':hash('old APK')}},inputCoverage:{version:1,executionId:'e',entries:[{inputId:'new',status:'received',text:'新增背景要求',requirementIds:[]}]}});
 await w.event('tool_error',{action:'plan',message:'已有质量契约不可在执行中改变，尤其不能事后增加容差：original'});
 const result=await require('../apps/desktop/agent/result-settlement.cjs').settle(w,Object.assign(Error('采用窗口耗尽'),{code:'INPUT_ADOPTION_EXHAUSTED'}));
 assert.match(result.content,/^本次补充要求尚未执行/);assert.match(result.content,/Ailo 未能把你的补充要求正确接入原任务计划/);assert.match(w.run.delivery.failureDetail.message,/质量契约不可/);assert.doesNotMatch(result.content,/可查看的已有成果|APK|本轮已验证解决/);assert.notEqual(w.run.status,'completed');assert.equal(w.run.inputCoverage.entries[0].status,'received');assert.equal(await fs.readFile(path.join(w.files,'old.apk'),'utf8'),'old APK');assert.ok(w.run.delivery.availableArtifacts.some(a=>a.path==='old.apk'));
});

test('repository followup planning failure gives a plain result without APK or unsupported credential claims',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-repo-summary-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(base,{id:'clone-followup'});
 const requirement={id:'r1',text:'克隆示例仓库到当前工作区',type:'content'};
 Object.assign(w.run,{executionId:'e',inputKey:'followup',mode:'task',goal:requirement.text,currentRequest:'使用提供的克隆地址继续',requirementsManaged:true,requirements:[requirement],steps:[{id:'s1',title:'请求网络授权',status:'done'},{id:'s2',title:'克隆仓库',status:'blocked',requirementIds:['r1']},{id:'s3',title:'验证克隆结果',status:'pending',requirementIds:['r1']}],artifacts:[],inputTurn:{inputId:'followup',followup:true,requiresPlan:true,eventIds:[],observationIds:[],artifacts:{}},inputCoverage:{version:1,executionId:'e',entries:[{inputId:'followup',status:'received',text:'使用提供的克隆地址继续',requirementIds:[]}]}});
 const requirements=structuredClone(w.run.requirements),steps=structuredClone(w.run.steps);
 const message='增量计划无效：不能改变已有要求的检查范围：r1；新的检查对象应新增要求';
 await w.event('tool_error',{action:'plan',message});
 const result=await require('../apps/desktop/agent/result-settlement.cjs').settle(w,Object.assign(Error(message),{code:'INPUT_ADOPTION_EXHAUSTED'}));
 assert.match(result.content,/任务没有取得新的可交付结果/);assert.match(result.content,/Ailo 的执行流程问题/);assert.match(result.content,/本轮已停止，任务尚未完成/);
 assert.doesNotMatch(result.content,/APK|Android|requirements|inputId|r1|LDAP|密码|没有文件修改/);
 assert.equal(w.run.delivery.failureDetail.message,message);assert.equal(w.run.events.find(e=>e.type==='tool_error').detail.message,message);
 assert.deepEqual(w.run.requirements,requirements);assert.deepEqual(w.run.steps,steps);assert.equal(w.run.inputCoverage.entries[0].status,'received');assert.notEqual(w.run.status,'completed');assert.deepEqual(w.run.delivery.availableArtifacts,[]);
 assert.match(w.run.delivery.nextAction,/修复内部计划衔接问题/);assert.doesNotMatch(w.run.delivery.nextAction,/查看效果/);
});

async function stranded(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-stranded-adoption-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const sourceId=require('node:crypto').randomUUID();await fs.mkdir(path.join(base,'imports'));await fs.writeFile(path.join(base,'imports',sourceId),'<h1>效果参考</h1><p>晴天蓝天；雨天灰云。</p>');
 const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs'),coverage=require('../apps/desktop/agent/input-coverage.cjs'),quote='根据天气切换背景',text='希望根据天气切换背景，具体参考设计稿和效果图总览',original={id:'page',text:'保留基础说明',type:'content',scope:{kind:'file',path:'base.md'}},task={id:'stranded',request:'保留基础说明',messages:[{id:'original',role:'user',content:'保留基础说明'},{id:'reply',role:'assistant',content:'阶段成果'},{id:'pending',role:'user',content:text,materials:[{name:'效果图总览.html',sourceId,text:'<h1>效果参考</h1><p>晴天蓝天；雨天灰云。</p>'}]}]},w=await createWorkspace(base,task);
 await fs.writeFile(path.join(w.files,'base.md'),'基础说明');Object.assign(w.run,{executionId:'same',revision:0,inputKey:'original',acceptanceInputKey:'original',currentRequest:task.request,mode:'task',status:'partial',goal:task.request,requirementsManaged:true,requirements:[original],acceptance:[original.text],steps:[{id:'base',title:'基础说明',status:'done',requirementIds:['page']}],runtimeIdentity:{appVersion:'0.1.93'},observationIndex:[],artifacts:[{path:'base.md',label:'原说明',sha256:require('../apps/desktop/agent/evidence.cjs').hash('基础说明')}]});coverage.receive(w.run,task,[task.messages[0]]);
 require('../apps/desktop/agent/request-scope.cjs').suspendRecovery(w.run,task.messages.at(-1));w.run.inputKey='pending';w.run.currentRequest=text;require('../apps/desktop/agent/input-turn.cjs').begin(w.run);coverage.receive(w.run,task,[task.messages.at(-1)]);w.run.pendingTaskChange.adoptionDecisions=13;
 const error='已有质量契约不可在执行中改变，尤其不能事后增加容差：page',rejected={action:'plan',requirements:[{...original,quality:{level:'must',origin:'user',sourceQuote:quote}}],inputUse:[{inputId:'pending',disposition:'requirements',requirementIds:['page']}]};await w.event('tool_error',{action:'plan',message:error});const observationId=await w.archiveObservation(rejected,{error});w.run.observationIndex.push({id:observationId,action:'plan',error});
 let episode;for(let i=0;i<6;i++)episode=require('../apps/desktop/agent/failure-episodes.cjs').failure(w.run,rejected,Error(error));episode.recoveries=2;episode.exhaustedRevision=w.run.revision;await w.save();return {base,task,original,episodeId:episode.id};
}
test('the stranded 0.1.93 state adopts an HTML reference incrementally, changes real files and completes with fresh independent checks',async t=>{
 const f=await stranded(t),{runAgent}=require('../apps/desktop/agent/runner.cjs'),execute=require('../apps/desktop/agent/tools.cjs').execute;let calls=0,planRecorded=false;const seen=[];
 const result=await runAgent({...f,model:{contextWindow:131072},requestOrigin:'user',continuationReason:'user',signal:new AbortController().signal,maxSteps:20,executeTool:async(w,a,signal,options)=>{
  if(a.action!=='run_command')return execute(w,a,signal,options);
  const variants=JSON.parse(await fs.readFile(path.join(w.files,'backgrounds.json'),'utf8'));assert.equal(variants.sunny,'clear-sky.png');assert.equal(variants.rain,'rain-clouds.png');assert.notEqual(variants.sunny,variants.rain);return {exitCode:0,output:'Computed sunny/rain variants are distinct; isolated fixture, no device.'};
 },ask:async messages=>{const s=JSON.parse(messages.at(-1).content);calls++;seen.push({calls,phase:s.phase,errors:s.toolResults.map(r=>r.error).filter(Boolean)});let action;
  if(s.phase==='route')action={action:'route',kind:'task'};
  else if(!planRecorded){assert.equal(s.inputContractRepair.decisionsUsed,1);assert.equal(s.inputContractRepair.maxDecisions,3);assert.equal(s.materialInput.status,'inspected');planRecorded=true;action={action:'plan',mode:'amend',goal:'保留基础说明并新增天气背景映射',decisions:['采用本次效果参考，保留既有质量与证据'],requirements:[{id:'background',text:'晴天与雨天使用不同背景资源',type:'behavior',scope:{kind:'file',path:'backgrounds.json'}}],steps:[{id:'background',title:'实现并核对天气背景映射',status:'running',requirementIds:['background']}],inputUse:[{inputId:'pending',disposition:'requirements',requirementIds:['background']}],materialUse:[{id:s.materialInput.materials[0].id,role:'reference',reason:'实际读取的本次效果参考',requirementIds:['background']}]};}
  else if(calls===3)action={action:'write_file',path:'backgrounds.json',content:JSON.stringify({sunny:'clear-sky.png',rain:'rain-clouds.png'})};
  else if(calls===4)action={action:'artifact',path:'backgrounds.json',label:'天气背景映射'};
  else if(calls===5)action={action:'run_command',command:'isolated-variant-check',purpose:'计算验证晴雨背景映射不同',scope:{kind:'file',path:'backgrounds.json'}};
  else if(calls===6)action={action:'verify',checks:[{criterionId:'page',kind:'text_contains',path:'base.md',contains:['基础说明'],reason:'重新读取原要求实际内容'},{criterionId:'background',kind:'command',evidenceId:s.recentEvents.findLast(e=>e.type==='run_command').id,scope:{kind:'file',path:'backgrounds.json'},reason:'依据真实文件计算晴雨映射差异'}],progress:{steps:[{id:'background',status:'done'}]}};
  else action={action:'finish',text:'隔离回归的基础说明和晴雨背景映射已核验。',review:{summary:'保留旧要求并检查实际新增文件，不代表真实天气应用已通过',issues:[],unverified:[]}};
  assert.ok(calls<=8,JSON.stringify({calls,seen,criteria:s.acceptanceCriteria,steps:s.steps}));return {content:JSON.stringify(action)};
 }});
 const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(f.base,f.task);assert.equal(result.agentRun.status,'completed');assert.equal(w.run.inputCoverage.entries.find(e=>e.inputId==='pending').status,'verified');assert.equal(w.run.materialInput.status,'adopted');assert.equal(w.run.executionRecovery.inputContractRepair.status,'adopted');assert.equal(w.run.executionRecovery.inputContractRepair.originalAdoptionDecisions,13);assert.equal(w.run.executionRecovery.inputContractRepair.decisionsUsed,1);assert.equal(w.run.failureEpisodes.records.find(e=>e.id===f.episodeId).failures,6);assert.deepEqual(w.run.requirements.find(r=>r.id==='page'),f.original);assert.equal(await fs.readFile(path.join(w.files,'base.md'),'utf8'),'基础说明');
});
test('failed contract correction is consumed before model requests and cannot be renewed by clicking continue',async t=>{
 const f=await stranded(t),{runAgent}=require('../apps/desktop/agent/runner.cjs');let calls=0;
 const result=await runAgent({...f,model:{contextWindow:131072},requestOrigin:'user',continuationReason:'user',signal:new AbortController().signal,maxSteps:12,ask:async messages=>{const s=JSON.parse(messages.at(-1).content);calls++;const saved=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(f.base,f.task);if(s.phase==='route')return {content:JSON.stringify({action:'route',kind:'task'})};assert.equal(saved.run.executionRecovery.inputContractRepair.decisionsUsed,s.inputContractRepair.decisionsUsed);if(s.inputContractRepair.decisionsUsed===3)assert.equal(saved.run.executionRecovery.inputContractRepair.status,'exhausted');return {content:JSON.stringify({action:'plan',mode:'amend',goal:'错误计划',decisions:[],requirements:[{id:'bad_polish',text:'额外阴影',type:'visual',quality:{level:'must',origin:'agent_polish',polishOf:'page'}}],steps:[{id:'polish',title:'错误地新增强制润色',status:'running',requirementIds:['bad_polish']}]})};}});
 assert.equal(calls,4);assert.notEqual(result.agentRun.status,'completed');assert.match(result.content,/本次补充要求尚未执行/);
 let restartCalls=0;await runAgent({...f,model:{contextWindow:131072},requestOrigin:'user',continuationReason:'user',signal:new AbortController().signal,ask:async()=>{restartCalls++;throw Error('不得重新发起纠正');}});assert.equal(restartCalls,0);const w=await require('../apps/desktop/agent/workspace.cjs').createWorkspace(f.base,f.task);assert.equal(w.run.pendingTaskChange.adoptionDecisions,13);assert.equal(w.run.executionRecovery.inputContractRepair.decisionsUsed,3);assert.equal(w.run.executionRecovery.inputContractRepairGrants.length,1);
});

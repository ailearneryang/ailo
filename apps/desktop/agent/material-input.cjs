// Material receipt, source inspection and adoption are different milestones.
const {key}=require('./workspace.cjs');
const schema={type:'array',maxItems:10,items:{type:'object',additionalProperties:false,required:['id','role','reason','requirementIds'],properties:{id:{type:'string'},role:{type:'string',enum:['design','reference','data','irrelevant']},reason:{type:'string',minLength:1,maxLength:800},requirementIds:{type:'array',maxItems:12,items:{type:'string'}}}}};
function materialId(m){return key(JSON.stringify([m.name,m.sourceId||m.text]));}
function context(run){const s=run.materialInput;let budget=18000;return s&&{inputId:s.inputId,inputIds:s.inputIds||[s.inputId],requests:s.requests?.map(r=>({...r,request:r.request.slice(0,800)})),status:s.status,required:s.required,materials:s.materials.map(({id,name,inputIds,sourcePath,sourceHash,visual,reads,error})=>({id,name,inputIds,sourcePath,sourceHash,visual,reads:reads.map(r=>{const text=r.text?.slice(0,Math.min(3000,budget));budget-=text?.length||0;return {...r,text,...(r.text&&text.length<r.text.length?{next:(r.offset||0)+text.length}: {})};}),error})),uses:s.uses,instruction:'先处理本批每条输入的附件，不沿用旧材料默认替代。inputIds及requests保留各条来源；每份设计稿必须遵守其来源指令，不能只处理最后一条。reads是实际读取的有界摘录，next不为空必须按需求补读；目录、结构及计划均不代表理解或实现。plan.materialUse逐项提供{id,role:design/reference/data/irrelevant,reason,requirementIds}，关联真实要求ID；设计稿用design。新旧冲突依用户最新要求裁决，必要时才澄清。采用设计后，android-design.json.materialSources须包含当前设计材料的{path:sourcePath,sha256:sourceHash}，sourceRoots显式选择本次原稿的提取目录（导出包含dsl.nodes时提取原始design.json，支持其真实相对坐标与展开实例；不得生成占位原稿），不能混扫历史目录；核对目标画板、参考图和布局；旧缺陷不得批量撤销。新设计对应要求须重新核验，旧截图不能通过。'};}
async function prepare(workspace,task,record){
 const run=workspace.run,messages=task.messages||[],start=Number.isInteger(run.executionInputStart)?run.executionInputStart:0,inputKey=require('./execution-rounds.cjs').inputKey,previous=run.materialInput;
 const unadopted=previous&&previous.status!=='adopted'&&(!previous.executionId||previous.executionId===run.executionId)?previous:undefined,previousIds=unadopted?.inputIds|| (unadopted?[unadopted.inputId]:[]);
 const rows=Array.isArray(run.inputCoverage)?run.inputCoverage:run.inputCoverage?.entries,received=new Set((rows||[]).filter(r=>r.status==='received').map(r=>r.inputId));
 // Received IDs are the batch boundary even if executionInputStart points at
 // its final message. Catalog membership alone never makes a material current.
 let incoming=messages.filter(m=>m.role==='user'&&m.materials?.length&&received.has(inputKey(m)));
 if(!incoming.length&&!unadopted){const last=messages.slice(start).findLast(m=>m.role==='user'&&m.materials?.length);if(!last)return;if(last!==messages.findLast(m=>m.role==='user')&&!previous&&!messages.slice(0,messages.indexOf(last)).some(m=>m.role==='assistant'))return;incoming=[last];}
 const adoptedIds=previous?.status==='adopted'?previous.inputIds||[previous.inputId]:[];
 incoming=incoming.filter(m=>!adoptedIds.includes(inputKey(m)));
 const added=incoming.filter(m=>!previousIds.includes(inputKey(m)));
 if(unadopted&&!added.length&&unadopted.status!=='received')return;
 if(!unadopted&&!incoming.length)return;
 const inputIds=[...new Set([...previousIds,...incoming.map(inputKey)])],inputId=inputIds.at(-1),last=incoming.at(-1),required=!!unadopted?.required||inputIds.length>1||!!run.inputTurn?.followup||incoming.some(m=>messages.slice(0,messages.indexOf(m)).some(p=>p.role==='assistant'));
 // Keep initial single-attachment behavior; follow-ups and real multi-input
 // batches must explicitly read and adopt every source before further effects.
 if(!required&&!previous)return;
 const requests=(unadopted?.requests|| (unadopted?[{inputId:unadopted.inputId,request:unadopted.request||'',materialIds:unadopted.materials.map(m=>m.id)}]:[])).map(r=>({...r,materialIds:[...(r.materialIds||[])]}));
 for(const m of added){const id=inputKey(m);requests.push({inputId:id,request:String(m.content||''),materialIds:m.materials.map(f=>workspace.lookup(materialId(f))?.id||materialId(f))});}
 if(!requests.length&&last)requests.push({inputId:inputKey(last),request:String(last.content||''),materialIds:last.materials.map(f=>workspace.lookup(materialId(f))?.id||materialId(f))});
 const state={inputId,inputIds,executionId:run.executionId,status:'received',required,at:new Date().toISOString(),request:last?.content||unadopted?.request||'',requests,materials:(unadopted?.materials||[]).map(m=>({...m,inputIds:m.inputIds||[unadopted.inputId],reads:[...(m.reads||[])]}))};
 for(const message of incoming)for(const m of message.materials){const item=workspace.lookup(materialId(m)),id=item?.id||materialId(m),existing=state.materials.find(r=>r.id===id),sourceId=inputKey(message);if(existing){existing.inputIds=[...new Set([...existing.inputIds,sourceId])];continue;}state.materials.push({id,name:m.name,inputIds:[sourceId],sourcePath:item?.sourcePath,sourceHash:item?.sourceHash,visual:item?.visual,reads:[]});}
 if(state.materials.length>schema.maxItems)throw failure('本批附件超过10项，请合并材料后继续；已保留的输入与附件未被删除');
 run.materialInput=state;
 await workspace.event('material_input_received',{message:'已收到本批附件，正在读取各来源与关键内容',inputId,inputIds});
 for(const row of state.materials){
  if(row.reads.length||row.error)continue;
  const item=workspace.lookup(row.id);
  if(row.visual){row.reads.push({kind:'image_pending',notice:'图片须由图像观察核对，不能把收到图片当作已看图'});continue;}
  async function read(entry){
   const action=item?.sourceId?{action:'read_source',id:item.id,...(entry?{entry}:{}),offset:0}:{action:'read_material',id:row.id,offset:0,limit:6000};
   try{
    const result=action.action==='read_source'?await workspace.source(action.id,entry):await workspace.material(action.id,0,6000);
    const observationId=await record(action,{result});
    row.reads.push({...result,text:result.text?.slice(0,6000),next:result.text?.length>6000?6000:result.next,observationId});return result;
   }catch(error){if(error.code==='ERR_ASSERTION')throw error;row.error=String(error.message).slice(0,800);return null;}
  }
  const first=await read();
  if(first?.kind==='archive_manifest'){
   const entries=first.text.split('\n').filter(n=>n&&!n.endsWith('/')&&!/(^|\/)(?:__MACOSX|node_modules)\//.test(n));
   // Read the source contract before large SVG dumps; never rely on ZIP order.
   const priority=n=>/(^|\/)README\.md$/i.test(n)?0:/(^|\/)design\.json$/i.test(n)?1:/(^|\/)getDsl[^/]*\.json$/i.test(n)?2:99;
   for(const entry of entries.filter(n=>priority(n)<99).sort((a,b)=>priority(a)-priority(b)||a.localeCompare(b)).slice(0,3)){
    const result=await read(entry);
    if(priority(entry)===1&&result?.text&&/"dsl"\s*:/.test(result.text)){
     const action={action:'inspect_source',id:row.id,entry,pointer:'/dsl/nodes/0',offset:0};
     try{const selected=await workspace.inspect(row.id,entry,action.pointer,0);const observationId=await record(action,{result:selected});row.reads.push({...selected,text:selected.text?.slice(0,6000),next:selected.text?.length>6000?6000:selected.next,observationId});}catch(error){if(error.code==='ERR_ASSERTION')throw error;row.structureNotice=String(error.message).slice(0,500);}
    }
   }
  }
 }
 state.status='inspected';await workspace.save();
}
function pending(run){return !!run.materialInput?.required&&run.materialInput.status!=='adopted';}
function requiresDesign(text){
 // Match a direct instruction to use this design source. Do not join
 // "根据天气…参考设计稿" across intervening business words or clauses.
 return /(?:按照?|依据|根据|使用|采用|用|替换|补充)\s*(?:(?:本次|此次|这次|当前|最新|新|上传|提供|所附|随附|该|这份|这张|附件|中|里|的)\s*){0,6}(?:设计稿|原稿)/.test(String(text||''));
}
function checkPlan(run,action,requirements){
 const s=run.materialInput;if(!s||(!pending(run)&&action.materialUse===undefined))return;
 if(!Array.isArray(action.materialUse))throw failure('请在 plan.materialUse 逐项说明本批附件用途；只列 materialInput.materials 中的材料，不是整个历史材料目录');
 const expected=s.materials.map(m=>m.id),submitted=action.materialUse.map(u=>u?.id),missing=expected.filter(id=>!submitted.includes(id)),unexpected=submitted.filter(id=>!expected.includes(id));
 if(missing.length||unexpected.length||new Set(submitted).size!==submitted.length)throw failure('plan.materialUse 必须恰好覆盖本批附件：'+s.materials.map(m=>m.name+' (id='+m.id+')').join('、')+'。'+(missing.length?' 缺少本批ID：'+missing.join('、')+'。':'')+(unexpected.length?' 包含非本批ID：'+unexpected.slice(0,10).join('、')+'；请从本次 materialUse 移出历史材料映射，既有采用记录与要求仍保留。':'')+(new Set(submitted).size!==submitted.length?' 同一材料ID不能重复。':''));
 const seen=new Set(),ids=new Set(requirements.map(r=>r.id));
 for(const u of action.materialUse){
  const m=s.materials.find(m=>m.id===u?.id);
  if(!m||seen.has(u.id)||!['design','reference','data','irrelevant'].includes(u.role)||typeof u.reason!=='string'||!u.reason.trim()||u.reason.length>800||!Array.isArray(u.requirementIds)||u.requirementIds.some(id=>!ids.has(id))||u.role!=='irrelevant'&&!u.requirementIds.length)throw failure('附件映射无效：使用本次材料ID、具体用途理由与真实requirementIds');
  if(u.role!=='irrelevant'&&!m.reads?.some(r=>r.kind!=='archive_manifest'&&r.kind!=='image_pending')&&!run.readCoverage?.some(r=>r.id===m.id&&r.entry)&&!m.visual)throw failure('尚未取得附件正文；先读取实际条目，不能用压缩包目录证明采用附件：'+m.name);
  if(u.role==='design'&&requirements.some(r=>r.type==='visual')&&!u.requirementIds.some(id=>requirements.some(r=>r.id===id&&r.type==='visual')))throw failure('设计附件必须关联受影响的视觉要求，不能只关联文件存在');
  seen.add(u.id);
 }
 const cancelled=/(?:不用|不要使用|不再使用|忽略|撤回).*(?:附件|新稿|设计稿)/.test(run.currentRequest||'');
 const requests=s.requests||[{inputId:s.inputId,request:s.request||'',materialIds:s.materials.map(m=>m.id)}];
 for(const source of requests)if(!cancelled&&requiresDesign(source.request)&&!action.materialUse.some(u=>u.role==='design'&&(source.materialIds||s.materials.filter(m=>(m.inputIds||[s.inputId]).includes(source.inputId)).map(m=>m.id)).includes(u.id)))throw failure('本次明确要求采用附件设计稿，来源 '+source.inputId+' 的附件不能全部标为参考或不适用');
}
function commit(run,action){
 const s=run.materialInput;if(!s||!action.materialUse)return;
 const changed=JSON.stringify(s.uses)!==JSON.stringify(action.materialUse);
 if(!changed&&s.status==='adopted')return;
 if(action.materialUse.some(u=>u.role==='design')){s.previousDesignBaseline||=run.androidDesignSourceBaseline;delete run.androidDesignSourceBaseline;}
 s.uses=structuredClone(action.materialUse);s.status='adopted';s.adoptedAt=new Date().toISOString();
 // Keep old results for audit. Projection and delivery cannot use them again.
 s.affectedIds=[...new Set(s.uses.flatMap(u=>u.requirementIds))];
 s.priorProofs=Object.fromEntries(s.affectedIds.map(id=>[id,run.acceptanceResults?.[id]]).filter(([,v])=>v));
 for(const id of s.affectedIds)delete (run.acceptanceResults||{})[id];
}
function failure(text){return Object.assign(Error(text),{code:'MATERIAL_INPUT_PENDING'});}
function assertReady(run){if(pending(run))throw failure('本次附件尚未纳入要求与当前设计依据，请先读取关键内容并更新plan.materialUse；旧成果不能替代本次输入');}
function selectedDesign(run){const s=run.materialInput;return s?.uses?.filter(u=>u.role==='design').map(u=>s.materials.find(m=>m.id===u.id)).filter(Boolean)||[];}
async function assertDesign(workspace){
 assertReady(workspace.run);const selected=selectedDesign(workspace.run);if(!selected.length)return;
 const {resolveFile}=require('./workspace.cjs');
 const fs=require('node:fs/promises');let config;
 try{config=JSON.parse(await fs.readFile(await resolveFile(workspace.files,'android-design.json'),'utf8'));}catch{throw failure('当前附件设计尚未绑定：更新android-design.json.materialSources及screens，不能继续以旧稿交付');}
 if(!Array.isArray(config.sourceRoots)||!config.sourceRoots.length||config.sourceRoots.length>8||config.sourceRoots.some(p=>typeof p!=='string'||!p.trim()))throw failure('新设计须用android-design.json.sourceRoots显式选择原稿提取目录，不能默认混用历史Sketch');
 for(const dir of config.sourceRoots)if(!(await fs.stat(await resolveFile(workspace.files,dir))).isDirectory())throw failure('sourceRoots未指向有效的项目原稿目录');
 for(const m of selected){if(!m.sourcePath||!m.sourceHash||!config.materialSources?.some(s=>s.path===m.sourcePath&&s.sha256===m.sourceHash))throw failure('设计绑定未关联本次附件原文件：'+m.name);await require('./evidence.cjs').assertFresh(workspace,{sources:[{path:m.sourcePath,sha256:m.sourceHash}]});}
}
async function verifyProof(workspace,id,{evidenceId,sources,type}){
 assertReady(workspace.run);const s=workspace.run.materialInput;if(!s?.affectedIds?.includes(id))return sources;
 if(evidenceId){const e=await require('./evidence.cjs').lookup(workspace,evidenceId);if(!e?.at||e.at<s.at)throw failure('此证据早于本次附件，须按新设计重新核验');}
 if(type==='visual'&&selectedDesign(workspace.run).length&&workspace.run.artifacts?.some(a=>/\.apk$/i.test(a.path))){await assertDesign(workspace);for(const m of selectedDesign(workspace.run))if(!sources?.some(s=>s.path===m.sourcePath&&s.sha256===m.sourceHash))throw failure('图像未关联本次设计附件，请更新设计绑定并重新成对观察');}
 const dependencies=s.materials.filter(m=>s.uses.some(u=>u.id===m.id&&u.requirementIds.includes(id))).filter(m=>m.sourcePath&&m.sourceHash).map(m=>({path:m.sourcePath,sha256:m.sourceHash,inputIds:m.inputIds||[s.inputId]}));
 await require('./evidence.cjs').assertFresh(workspace,{sources:dependencies});
 const merged=(sources||[]).map(source=>({...source}));for(const dependency of dependencies){const source=merged.find(s=>s.path===dependency.path);if(source){if(source.sha256!==dependency.sha256)throw failure('验收来源的附件版本与本批采用版本不一致：'+dependency.path);source.inputIds=[...new Set([...(source.inputIds||[]),...dependency.inputIds])];}else merged.push(dependency);}return merged;
}
module.exports={schema,prepare,context,pending,checkPlan,commit,assertReady,assertDesign,verifyProof,selectedDesign};

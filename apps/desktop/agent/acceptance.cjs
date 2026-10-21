const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {resolveFile}=require('./workspace.cjs');
const criterionId=text=>'a_'+createHash('sha256').update(text).digest('hex').slice(0,16);
const appropriate=(type,kind)=>type==='visual'?kind==='visual':type==='behavior'?['command','observation'].includes(kind):type==='content'?kind!=='file_exists':true;
function criteria(run){return require('./requirements.cjs').current(run).map(({id,text,type,scope,scopes})=>{const check=run.acceptanceResults?.[id];return {id,text,type,scope,scopes,check:check&&(check.type||'content')===type&&(check.parts||[check]).every(p=>appropriate(type,p.kind))?check:undefined};});}
async function verify(workspace,action){
 let activeCheck;
 try{return await verifyBatch(workspace,action,check=>{activeCheck=check;});}
 catch(error){if(error.code==='VISUAL_REVIEW_UNAVAILABLE')throw error;await require('./validation-recovery.cjs').failed(workspace,activeCheck,error);throw error;}
}
async function verifyBatch(workspace,action,track){
 const run=workspace.run;
 if(!Array.isArray(action.checks)||!action.checks.length||action.checks.length>12)throw Error('verify.checks 必须包含 1–12 条验收检查');
 const results=[],seen=new Set(),proof=require('./evidence.cjs');
 for(const raw of action.checks){
  track(raw);
  const check={...raw,...(raw.evidenceId?{evidenceId:proof.resolveId(run,raw.evidenceId)}:{})};
  const key=JSON.stringify([check.criterionId,check.kind,check.path,check.evidenceId,check.scope,check.contains]);
  if(!check||!criteria(run).some(c=>c.id===check.criterionId)||seen.has(key))throw Error('验收项 id 无效或重复，请使用 acceptanceCriteria 中的 id');
  seen.add(key);
  if(typeof check.reason!=='string'||!check.reason.trim()||check.reason.length>800)throw Error('请说明检查如何覆盖这条验收要求');
  const type=criteria(run).find(c=>c.id===check.criterionId).type;
  if(type==='visual'&&run.observationCapabilities?.images===false)throw Object.assign(Error('当前没有模型图像观察能力，无法自动进行视觉验收。请继续生成与结构检查；交付时使用 outcome=limited，在 review.unverified 列出未核验视觉要求 ID，明确需要人工看图确认，不要反复截图或改用关键词冒充视觉检查。'),{code:'VISUAL_REVIEW_UNAVAILABLE'});
  if(type==='visual'&&check.kind!=='visual')throw Error('视觉要求必须绑定已传给模型的当前版本图像观察，文件或关键词检查不能替代');
  if(type==='behavior'&&!['command','observation'].includes(check.kind))throw Error('行为要求必须绑定运行检查证据');
  if(type!=='presence'&&check.kind==='file_exists')throw Error('文件存在只能核验 presence 要求，不能证明内容、行为或视觉质量');
  let sha256,evidence,observationPath,sources,observedScope,rendererState,fileSet;
  const requirement=criteria(run).find(c=>c.id===check.criterionId);
  if(check.kind==='command'){
   const event=await proof.lookup(workspace,check.evidenceId);
   if(!event||!['run_command','build_android'].includes(event.type))throw Error('验收命令证据无效，请使用 run_command/build_android 事件 ID');
   await proof.event(workspace,check.evidenceId);
   sources=event.detail.result.sources;fileSet=event.detail.result.fileSet;observedScope=event.detail.result.scope;evidence=event.id;
  }else if(['visual','observation'].includes(check.kind)){
   const referenced=await proof.lookup(workspace,check.evidenceId),event=referenced?.type==='browser'?referenced:undefined;
   const image=run.visualObservations?.find(o=>o.eventId===check.evidenceId&&o.delivered);
   if(check.kind==='visual'){
    if(!image)throw Error('视觉证据尚未传给模型或已过期；先 browser 或 view_image，再依据图像检查');
    await require('./visual-observation.cjs').assertSources(workspace,image);
    const data=await fs.readFile(await resolveFile(workspace.files,image.path));
    if(createHash('sha256').update(data).digest('hex')!==image.sha256)throw Error('观察图片已变化，请重新读取');
    sha256=image.sha256;observationPath=image.path;sources=image.sources;observedScope=image.scope;rendererState=image.rendererState;
   }else if(!event||!event.detail.result?.dom)throw Error('网页观察证据无效或已过期');
   await proof.event(workspace,check.evidenceId);
   observedScope ||= event?.detail.result.scope;rendererState ||= event?.detail.result.rendererState;
   if(event&&(event.detail.result.dom?.missingImages?.length||event.detail.result.errors?.length))throw Error('网页观察仍包含图片加载失败或运行错误，请修复后重新核验');
   sources ||= event?.detail.result.sources;
   await proof.assertFresh(workspace,{sources,revision:run.revision,rendererState});
   evidence=check.evidenceId;
  }else if(['file_exists','text_contains','json_valid'].includes(check.kind)){
   const file=await resolveFile(workspace.files,check.path),stat=await fs.stat(file);
   if(!stat.isFile()||stat.size===0||stat.size>2*1024*1024)throw Error('验收检查需要非空且不超过 2 MB 的文件');
   const data=await fs.readFile(file);sha256=createHash('sha256').update(data).digest('hex');sources=[{path:check.path,sha256}];observedScope={kind:'file',path:check.path};
   if(check.kind==='text_contains'){
    if(!Array.isArray(check.contains)||!check.contains.length||check.contains.length>24||check.contains.some(s=>typeof s!=='string'||!s||s.length>800))throw Error('contains 必须为 1–24 个非空检查文本');
    const source=data.toString('utf8'),missing=check.contains.filter(s=>!source.includes(s));
    if(missing.length){
     const normalize=text=>text.replace(/[\s\p{P}]/gu,'');
     const variants=missing.filter(text=>normalize(text)&&normalize(source).includes(normalize(text)));
     throw Object.assign(Error('验收未通过，未匹配到原文：'+missing.join('、')+'。文件：'+check.path+'。'+(variants.length?'存在忽略空白或标点后的近似文本：'+variants.join('、')+'；这不代表验收通过。':'')+'请读取实际内容核对关键词；按原要求修复成果或改用覆盖该要求的真实证据，不要为通过检查添加无关文字或降低验收要求。'),{code:'ACCEPTANCE_TEXT_MISSING'});
    }
   }
   if(check.kind==='json_valid')JSON.parse(data.toString('utf8'));
  }else throw Error('验收检查类型无效');
  if(check.scope)proof.scope(check.scope);
  if(check.scope&&!proof.covers(observedScope,check.scope))throw Error('证据对象或观察范围未覆盖验收要求；局部截图和文字存在不能证明完整布局');
  results.push({...check,type,sha256,sources,scope:observedScope,rendererState,fileSet,...(observationPath?{path:observationPath}:{}),basis:['visual','observation'].includes(check.kind)?'model_assessment':'machine_check',evidenceId:evidence,revision:run.revision,status:'passed'});
 }
 // Validate a requirement's complete scope against all its supplied evidence.
 // Multiple historical snapshots can establish a transition or cover pages.
 const updates={};
 for(const id of new Set(results.map(r=>r.criterionId))){
  track({criterionId:id});
  const parts=results.filter(r=>r.criterionId===id),requirement=criteria(run).find(c=>c.id===id);
  for(const range of [...(requirement.scope?[requirement.scope]:[]),...(requirement.scopes||[])])if(!parts.some(p=>proof.covers(p.scope,range)))throw Error('证据对象或观察范围未覆盖验收要求；请在同一次 verify 关联覆盖各范围的证据');
  updates[id]=parts.length===1?parts[0]:{...parts[0],parts,basis:parts.some(p=>p.basis==='model_assessment')?'model_assessment':'machine_check'};
 }
 // Publish only after the entire batch passes; never grant partial approval.
 run.acceptanceResults={...run.acceptanceResults,...updates};
 await workspace.event('acceptance_verified',{results});
 require('./validation-recovery.cjs').passed(run,results,run.events.at(-1).id);
 await workspace.save();return {results};
}
async function assertAccepted(workspace,{unverifiedVisualIds=[]}={}){
 for(const criterion of criteria(workspace.run)){
  if(unverifiedVisualIds.includes(criterion.id)){
   if(criterion.type!=='visual'||!require('./visual-limitation.cjs').unavailable(workspace.run))throw Error('只能在缺少图像能力时保留视觉要求为未核验');
   continue;
  }
  const check=criterion.check;
  if(!check||check.status!=='passed')throw Error('尚未核验验收项：'+criterion.text+'；请先 verify，每项绑定真实检查或当前版本的命令证据');
  const parts=check.parts||[check],proof=require('./evidence.cjs');
  for(const part of parts){
   await proof.assertFresh(workspace,part);
   if(part.evidenceId)await proof.event(workspace,part.evidenceId);
   if(part.sha256){const data=await fs.readFile(await resolveFile(workspace.files,part.path));if(createHash('sha256').update(data).digest('hex')!==part.sha256)throw Error('验收文件已变化，请重新 verify：'+part.path);}
  }
  for(const range of [...(criterion.scope?[criterion.scope]:[]),...(criterion.scopes||[])])if(!parts.some(part=>proof.covers(part.scope,range)))throw Error('验收范围未覆盖要求：'+criterion.id);
 }
}
module.exports={criteria,verify,assertAccepted,criterionId};

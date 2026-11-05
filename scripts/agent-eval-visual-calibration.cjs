// A calibration definition is not a labelled benchmark. Genuine image pairs
// and independently recorded human labels must be supplied before scoring.
const {hash}=require('./agent-eval-config.cjs');
const fs=require('node:fs/promises'),path=require('node:path');
const definitions=[
 ['actual-watermark','实际实现有明确水印，原要求禁止水印','defect'],
 ['clean-clouds','无水印且原要求的云层保留','no_defect'],
 ['dynamic-values','真实天气动态数值不同于原稿示例，结构与映射正确','no_defect'],
 ['offscreen-search','当前截图未显示搜索入口，尚无交互证据','uncertain'],
 ['repair-regression','水印消失但原要求的云层也消失','defect'],
 ['component-layout','真实同组件位置不符，画板和视口已对齐','defect'],
 ['reference-only-mark','原始素材有标识，但当前交付画面没有使用该素材','no_defect'],
 ['unreadable-detail','分辨率不足以确定图标或文字','uncertain'],
];
function template(){return {schemaVersion:1,kind:'visual_grader_calibration',status:'labels_missing',modelRequests:0,metrics:null,samples:definitions.map(([id,description,expectedClass])=>({id,description,expectedClass,images:null,humanLabel:null,prediction:null})),notice:'expectedClass描述拟覆盖的场景；不是对未提供图片的真实标注。模板不能用于宣称VLM准确率。'};}
function calculate(input){
 const expected=new Map(definitions.map(([id])=>[id,true])),samples=input?.samples;
 if(!Array.isArray(samples)||samples.length>256)throw Error('Calibration requires a bounded sample list');
 const ids=new Set(),models=new Set(),counts={truePositive:0,falsePositive:0,falseNegative:0,trueNegative:0,uncertainCorrect:0,uncertainIncorrect:0,falseBlock:0,falseClose:0};let labelled=0,measured=0;
 for(const s of samples){
  if(!s||!expected.has(s.id)||ids.has(s.id))throw Error('Calibration sample is unknown or duplicated');ids.add(s.id);
  const label=s.humanLabel,images=s.images;
  if(!label)continue;
  if(!label.reviewer||!Number.isFinite(Date.parse(label.at))||!['defect','no_defect','uncertain'].includes(label.class)||typeof label.blocking!=='boolean'||typeof label.shouldClose!=='boolean')throw Error('Calibration human label lacks provenance or decision');
  if(!Array.isArray(images)||images.length<1||images.length>2||images.some(i=>!i||typeof i.path!=='string'||!i.path||!/^[a-f0-9]{64}$/i.test(i.sha256||'')))throw Error('Calibration human label is not bound to real image fingerprints');
  if(label.imageFingerprint!==hash(images.map(({path,sha256})=>({path,sha256}))))throw Error('Calibration image/label binding changed');
  labelled++;const p=s.prediction;if(!p)continue;
  if(!['confirmed','none','uncertain'].includes(p.class)||typeof p.blocking!=='boolean'||typeof p.closed!=='boolean'||p.imageFingerprint!==label.imageFingerprint||!p.modelConfigurationFingerprint)throw Error('Calibration prediction lacks image/model provenance');
  models.add(p.modelConfigurationFingerprint);if(models.size>1)throw Error('Calibration cannot mix model configurations');
  measured++;const positive=p.class==='confirmed';
  if(label.class==='defect'){if(positive)counts.truePositive++;else counts.falseNegative++;}
  else if(label.class==='no_defect'){if(positive)counts.falsePositive++;else counts.trueNegative++;}
  else if(p.class==='uncertain')counts.uncertainCorrect++;else counts.uncertainIncorrect++;
  if(p.blocking&&!label.blocking)counts.falseBlock++;if(p.closed&&!label.shouldClose)counts.falseClose++;
 }
 const ratio=(a,b)=>b?a/b:null,complete=measured===definitions.length&&labelled===definitions.length&&samples.length===definitions.length;
 return {schemaVersion:1,kind:'visual_grader_calibration',status:!labelled?'labels_missing':!measured?'predictions_missing':complete?'measured':'incomplete',samples:definitions.length,labelled,measured,coverage:measured/definitions.length,counts,metrics:measured?{precision:ratio(counts.truePositive,counts.truePositive+counts.falsePositive),recall:ratio(counts.truePositive,counts.truePositive+counts.falseNegative),falseBlockRate:counts.falseBlock/measured,falseCloseRate:counts.falseClose/measured}:null,notice:'指标仅适用于提供的独立标注图像样本；小样本不代表真实任务总体准确率。缺失标注和预测不计通过。'};
}
function score(input){const result=calculate(input);return result.labelled?{...result,status:'image_evidence_unverified',metrics:null,notice:'仅核对标注结构；尚未读取并验证真实图像文件，不发布准确率。'}:result;}
async function evaluate(input,{root,predictionRoot}={}){
 if(input?.schemaVersion===2){await assertDataset(input,{root});for(const s of input.samples){if(s.humanLabel&&s.humanLabel.scopeFingerprint!==s.scopeFingerprint||s.prediction&&s.prediction.scopeFingerprint!==s.scopeFingerprint)throw Error('Calibration labels or predictions no longer match the original requirement scope');}}
 const preliminary=calculate(input);if(!preliminary.labelled)return preliminary;
 if(!root||!path.isAbsolute(root))throw Error('Calibration requires an explicit isolated image root');
 const checked=new Set();for(const s of input.samples)if(s.humanLabel)for(const image of s.images){
  const key=JSON.stringify([image.path,image.sha256]);if(checked.has(key))continue;
  const file=await require('../apps/desktop/agent/workspace.cjs').resolveFile(root,image.path),stat=await fs.stat(file);if(!stat.size||stat.size>20*1024*1024)throw Error('Calibration image is empty or exceeds 20MB');
  const bytes=await fs.readFile(file);if(hash(bytes)!==image.sha256)throw Error('Calibration image bytes changed after labelling');
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217,webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';if(!png&&!jpeg&&!webp)throw Error('Calibration image is not a supported raster image');checked.add(key);
 }
 const predictionEvidence=input?.schemaVersion===2&&input.samples.some(s=>s.prediction)?await assertPredictions(input,{directory:predictionRoot}):undefined;
 return {...preliminary,imageEvidence:{verified:true,files:checked.size},...(predictionEvidence?{predictionEvidence}:{}),modelConfigurationFingerprint:input.samples.find(s=>s.prediction)?.prediction.modelConfigurationFingerprint};
}
function immutable(input){return {schemaVersion:2,kind:'visual_grader_calibration',reference:input.reference,samples:input.samples.map(s=>({id:s.id,description:s.description,requirements:s.requirements,context:s.context,images:s.images,scopeFingerprint:s.scopeFingerprint}))};}
async function prepare(input,{root,output,reference}={}){
 if(!root||!output||!path.isAbsolute(root)||!path.isAbsolute(output))throw Error('Calibration requires explicit absolute source and isolated output roots');
 const selected=require('./agent-eval-reference.cjs').publicSelection(reference);
 if(!selected||selected.id==='auto'&&!selected.routing.visionModelId)throw Error('Freeze the actual visual-capable model or Auto visual routing first');
 if(!Array.isArray(input.samples)||input.samples.length!==definitions.length||new Set(input.samples.map(s=>s.id)).size!==definitions.length||input.samples.some(s=>!definitions.some(d=>d[0]===s.id)))throw Error('Supply all eight real calibration scenarios exactly once');
 await fs.mkdir(output,{recursive:true,mode:0o700});if((await fs.readdir(output)).length)throw Error('Calibration output must be new and empty');
 const samples=[];for(const sample of input.samples){
  if(!Array.isArray(sample.requirements)||!sample.requirements.length||sample.requirements.length>4||sample.requirements.some(r=>typeof r!=='string'||!r.trim()||r.length>4000))throw Error('Each real sample needs one to four original scoped requirements; scenario descriptions are not requirements');
  if(!Array.isArray(sample.images)||sample.images.length<1||sample.images.length>2)throw Error('Supply one actual image and, when relevant, its real reference image');
  const images=[];for(let i=0;i<sample.images.length;i++){
   const original=sample.images[i];if(!['actual','reference'].includes(original.role)||i===0&&original.role!=='actual')throw Error('The first image must be actual; label any reference explicitly');
   const source=await require('../apps/desktop/agent/workspace.cjs').resolveFile(root,original.path),bytes=await fs.readFile(source);if(!bytes.length||bytes.length>20*1024*1024)throw Error('Calibration raster image is empty or too large');
   const ext=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'.png':bytes[0]===255&&bytes[1]===216?'.jpg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'.webp':null;if(!ext)throw Error('Calibration requires actual supported raster image bytes');
   const relative='images/'+sample.id+'-'+i+ext;await fs.mkdir(path.join(output,'images'),{recursive:true});await fs.writeFile(path.join(output,relative),bytes,{flag:'wx',mode:0o400});images.push({path:relative,sha256:hash(bytes),role:original.role});
  }
  const base={id:sample.id,description:definitions.find(d=>d[0]===sample.id)[1],requirements:sample.requirements,context:typeof sample.context==='string'?sample.context.slice(0,8000):'',images};samples.push({...base,scopeFingerprint:hash(base),humanLabel:null,prediction:null});
 }
 const dataset={schemaVersion:2,kind:'visual_grader_calibration',reference:selected,samples};dataset.datasetFingerprint=hash(immutable(dataset));await fs.writeFile(path.join(output,'dataset.json'),JSON.stringify(dataset,null,2),{flag:'wx',mode:0o400});await reviewPack(dataset,{output});return dataset;
}
async function assertDataset(input,{root}={}){
 if(input?.schemaVersion!==2||hash(immutable(input))!==input.datasetFingerprint)throw Error('Frozen calibration requirements/images/model reference changed');
 require('./agent-eval-reference.cjs').publicSelection(input.reference);
 for(const s of input.samples){const {scopeFingerprint,humanLabel,prediction,...base}=s;if(scopeFingerprint!==hash(base))throw Error('Calibration sample scope changed');for(const image of s.images){const file=await require('../apps/desktop/agent/workspace.cjs').resolveFile(root,image.path);if(hash(await fs.readFile(file))!==image.sha256)throw Error('Frozen calibration image bytes changed');}}
 return true;
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function reviewPack(input,{output}={}){
 const labels={schemaVersion:1,datasetFingerprint:input.datasetFingerprint,reviewer:'',at:null,labels:input.samples.map(s=>({id:s.id,scopeFingerprint:s.scopeFingerprint,class:null,blocking:null,shouldClose:null,reason:''}))};
 const html='<!doctype html><html lang="zh"><meta charset="utf-8"><title>视觉校准独立审核</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;color:#222}section{border-top:1px solid #ccc;padding:20px 0}.images{display:flex;gap:12px}figure{margin:0;width:48%}img{width:100%;height:auto}pre{white-space:pre-wrap;background:#f4f5f7;padding:12px}</style><h1>视觉校准独立审核</h1><p>依据原要求与真实图像填写 review-template.json。先完成标注，再查看模型预测，避免模型意见污染人工判断。unknown / 看不清请选择 uncertain；不要照抄场景名称给结论。</p>'+input.samples.map(s=>'<section><h2>'+escape(s.id)+'</h2><p>'+escape(s.context)+'</p><ul>'+s.requirements.map(r=>'<li>'+escape(r)+'</li>').join('')+'</ul><div class="images">'+s.images.map(i=>'<figure><figcaption>'+escape(i.role)+'</figcaption><img src="'+escape(i.path)+'"></figure>').join('')+'</div><p>scope '+escape(s.scopeFingerprint)+'</p></section>').join('')+'</html>';
 await fs.writeFile(path.join(output,'review.html'),html,{flag:'wx',mode:0o600});await fs.writeFile(path.join(output,'review-template.json'),JSON.stringify(labels,null,2),{flag:'wx',mode:0o600});return labels;
}
async function review(input,labels,{root}={}){
 await assertDataset(input,{root});if(labels.datasetFingerprint!==input.datasetFingerprint||typeof labels.reviewer!=='string'||!labels.reviewer.trim()||!Number.isFinite(Date.parse(labels.at))||!Array.isArray(labels.labels)||labels.labels.length!==input.samples.length||new Set(labels.labels.map(l=>l.id)).size!==labels.labels.length)throw Error('Independent reviewer, time, full labels and frozen dataset binding are required');
 const output=structuredClone(input);for(const sample of output.samples){const l=labels.labels.find(l=>l.id===sample.id);if(!l||l.scopeFingerprint!==sample.scopeFingerprint||!['defect','no_defect','uncertain'].includes(l.class)||typeof l.blocking!=='boolean'||typeof l.shouldClose!=='boolean'||typeof l.reason!=='string'||!l.reason.trim())throw Error('Human label requires an explicit decision and reason for the exact original scope');sample.humanLabel={reviewer:labels.reviewer,at:labels.at,class:l.class,blocking:l.blocking,shouldClose:l.shouldClose,reason:l.reason,scopeFingerprint:sample.scopeFingerprint,imageFingerprint:hash(sample.images.map(({path,sha256})=>({path,sha256})))};}
 return output;
}
async function collect(input,{root,output,observe}={}){
 await assertDataset(input,{root});if(typeof observe!=='function')throw Error('Real visual observation callback required');await fs.mkdir(output,{recursive:true,mode:0o700});if((await fs.readdir(output)).length)throw Error('Prediction output must be new; never overwrite or replay an unknown prior run');
 await fs.writeFile(path.join(output,'.started'),new Date().toISOString(),{flag:'wx',mode:0o600});const result=structuredClone(input);
 for(const sample of result.samples){
  const actual=await observe({id:sample.id,requirements:sample.requirements,context:sample.context,images:sample.images.map(i=>({...i,file:path.join(root,i.path)})),reference:input.reference});
  if(actual.modelConfigurationFingerprint!==input.reference.configurationFingerprint||!/^[a-f0-9]{64}$/.test(actual.runtimeFingerprint||'')||!actual.review||!Array.isArray(actual.review.defects)||!Array.isArray(actual.review.checks))throw Error('Visual observation must preserve the frozen model routing, runtime and real structured report');
  sample.prediction=prediction(sample,actual,input.reference);
  await fs.writeFile(path.join(output,sample.id+'.json'),JSON.stringify({datasetFingerprint:input.datasetFingerprint,scopeFingerprint:sample.scopeFingerprint,...actual},null,2),{flag:'wx',mode:0o600});
 }
 await fs.writeFile(path.join(output,'predictions.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});return result;
}
function prediction(sample,actual,reference){
 const defects=actual.review.defects.filter(d=>d.subject!=='reference'),positive=defects.some(d=>d.certainty==='confirmed'),allMatched=sample.requirements.every((_,i)=>actual.review.checks.some(c=>c.id===sample.id+':'+i&&c.status==='matched')),uncertain=defects.some(d=>d.certainty!=='confirmed')||actual.review.uncertainties?.length||!allMatched;
 return {class:positive?'confirmed':uncertain?'uncertain':'none',blocking:positive,closed:!positive&&!uncertain,imageFingerprint:hash(sample.images.map(({path,sha256})=>({path,sha256}))),scopeFingerprint:sample.scopeFingerprint,modelConfigurationFingerprint:reference.configurationFingerprint,runtimeFingerprint:actual.runtimeFingerprint,modelId:actual.review.modelId,rawReportHash:hash(actual.review)};
}
async function assertPredictions(input,{directory}={}){
 if(!directory||!path.isAbsolute(directory))throw Error('Calibration accuracy requires the actual frozen raw prediction directory');let count=0;const runtimes=new Set();
 for(const sample of input.samples)if(sample.prediction){
  const record=JSON.parse(await fs.readFile(path.join(directory,sample.id+'.json'),'utf8'));
  if(record.datasetFingerprint!==input.datasetFingerprint||record.scopeFingerprint!==sample.scopeFingerprint||record.modelConfigurationFingerprint!==input.reference.configurationFingerprint||!/^[a-f0-9]{64}$/.test(record.runtimeFingerprint||'')||hash(prediction(sample,record,input.reference))!==hash(sample.prediction))throw Error('Raw model report or derived prediction changed');
  const ids=input.reference.id==='auto'?[input.reference.routing.visionModelId,...(input.reference.routing.failover?[input.reference.routing.visionFallbackId]:[])].filter(Boolean):[input.reference.id];if(!ids.includes(record.review.modelId))throw Error('Prediction came from outside the frozen visual routing lane');runtimes.add(record.runtimeFingerprint);count++;
 }
 if(runtimes.size>1)throw Error('Calibration cannot mix runtime/visual grader versions');return {verified:true,files:count,runtimeFingerprint:[...runtimes][0]};
}
async function main(argv=process.argv.slice(2)){
 const command=argv.shift(),options={};for(let i=0;i<argv.length;i++){const k={'--input':'input','--root':'root','--output':'output','--reference-config':'reference','--labels':'labels','--predictions':'predictions'}[argv[i]];if(!k||!argv[i+1])throw Error('Unknown calibration option');options[k]=argv[++i];}
 if(!options.input||!options.root||!options.output)throw Error('Use an input JSON, explicit image root and new output');const input=JSON.parse(await fs.readFile(options.input,'utf8')),root=path.resolve(options.root);let result;
 if(command==='prepare')result=await prepare(input,{root,output:path.resolve(options.output),reference:JSON.parse(await fs.readFile(options.reference,'utf8'))});
 else if(command==='review'){result=await review(input,JSON.parse(await fs.readFile(options.labels,'utf8')),{root});await fs.writeFile(options.output,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});}
 else if(command==='score'){await assertDataset(input,{root});if(options.predictions){const predictions=JSON.parse(await fs.readFile(options.predictions,'utf8'));await assertDataset(predictions,{root});if(predictions.datasetFingerprint!==input.datasetFingerprint)throw Error('Review and prediction datasets differ');for(const s of input.samples){const prediction=predictions.samples.find(p=>p.id===s.id);s.prediction=prediction.prediction;}}result=await evaluate(input,{root,predictionRoot:options.predictions?path.dirname(path.resolve(options.predictions)):undefined});await fs.writeFile(options.output,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});}
 else throw Error('Use prepare, review or score; real prediction collection has a separate explicit live command');
 console.log(JSON.stringify({status:result.status||'prepared',modelRequests:0,output:path.resolve(options.output)}));return result;
}
module.exports={definitions,template,score,evaluate,prepare,review,reviewPack,assertDataset,assertPredictions,collect,main};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});

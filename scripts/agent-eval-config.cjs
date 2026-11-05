const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
async function canonicalPath(value){
 let current=path.resolve(value),tail=[];
 for(;;)try{return path.join(await fs.realpath(current),...tail.reverse());}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(current);if(parent===current)throw e;tail.push(path.basename(current));current=parent;}
}
function args(argv,env=process.env){
 const options={version:'candidate',suite:'micro',repeats:3,concurrency:1,timeoutMs:1200000,reasoningEffort:'medium',stratum:'cold',modelId:env.AILO_EVAL_MODEL_ID};let positional=0;const explicit=new Set();
 const names={'output':'directory','source-root':'source','model-id':'modelId','reference-config':'referenceConfig','ablation':'ablation','data-dir':'dataDirectory','timeout-ms':'timeoutMs','max-model-requests':'maxModelRequests','max-decisions':'maxDecisions','repeats':'repeats','trial-repeat':'trialRepeat','concurrency':'concurrency','reasoning-effort':'reasoningEffort','suite':'suite','materials-dir':'materialsDirectory','environment-dir':'environmentDirectory','stratum':'stratum','version':'version','case':'filter','resume-from':'resumeFrom','review-note':'reviewNote'};
 for(let i=0;i<argv.length;i++){
  const token=argv[i];if(token==='--preflight'){options.preflight=true;continue;}if(token==='--retry-service'){options.retryService=true;continue;}
  if(token.startsWith('--')){const key=names[token.slice(2)];if(!key||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Invalid evaluation option: '+token);explicit.add(key);options[key]=argv[++i];}
  else if(positional++===0)options.version=token;else if(positional===2)options.repeats=token;else if(positional===3)options.filter=token;else throw Error('Unexpected evaluation argument');
 }
 if(options.resumeFrom){if(explicit.has('stratum')&&options.stratum!=='assisted_resume')throw Error('Resume trials must use assisted_resume, never cold or warm');if(explicit.has('suite')&&options.suite!=='weather')throw Error('Resume currently supports the fixed weather benchmark only');if(options.materialsDirectory)throw Error('Resume uses the exact preserved source materials; do not supply replacement materials');options.stratum='assisted_resume';options.suite='weather';options.resumeFrom=path.resolve(options.resumeFrom);if(!explicit.has('repeats')&&positional<2)options.repeats=1;}
 if(options.reviewNote){if(!options.resumeFrom)throw Error('--review-note requires --resume-from and is an explicit additional assistant input');options.reviewNote=path.resolve(options.reviewNote);}
 for(const [key,min,max]of [['repeats',1,100],['concurrency',1,8],['timeoutMs',1000,43200000]]){options[key]=Number(options[key]);if(!Number.isSafeInteger(options[key])||options[key]<min||options[key]>max)throw Error('Invalid evaluation '+key);}
 if(options.trialRepeat!==undefined){options.trialRepeat=Number(options.trialRepeat);if(!Number.isSafeInteger(options.trialRepeat)||options.trialRepeat<1||options.trialRepeat>options.repeats)throw Error('Invalid evaluation trial-repeat');}
 if(options.maxDecisions!==undefined){options.maxDecisions=Number(options.maxDecisions);if(!Number.isSafeInteger(options.maxDecisions)||options.maxDecisions<1||options.maxDecisions>120)throw Error('Invalid evaluation maxDecisions');if(!explicit.has('timeoutMs'))throw Error('--max-decisions requires an explicit --timeout-ms');options.evaluationPurpose='bounded_diagnostic';options.evaluationPolicy={maxDecisions:options.maxDecisions};}
 if(options.resumeFrom&&(options.repeats!==1||options.concurrency!==1))throw Error('Initial assisted resume supports repeats=1 and concurrency=1 only; do not multiply ancestor usage across branches');
 if(!['baseline','candidate'].includes(options.version)||!['micro','weather','net-gain'].includes(options.suite)||!['cold','warm','assisted_resume'].includes(options.stratum)||!['none','minimal','low','medium','high','xhigh'].includes(options.reasoningEffort)||options.stratum==='assisted_resume'&&!options.resumeFrom)throw Error('Invalid evaluation version/suite/stratum/reasoning effort');
 if(!options.modelId)throw Error('Select the exact configured model with --model-id or AILO_EVAL_MODEL_ID; no provider/model is chosen implicitly');
 if(options.ablation&&(!['candidate-preservation'].includes(options.ablation)||options.suite!=='net-gain'||options.version!=='candidate'))throw Error('Ablations require the candidate net-gain suite and an explicitly supported optional mechanism; necessary acceptance cannot be disabled');
 if(options.suite==='net-gain'&&options.concurrency!==1)throw Error('Net-gain instrumentation requires concurrency=1 for isolated scenario controls');
 if(options.suite==='net-gain'||options.maxModelRequests!==undefined){options.maxModelRequests=Number(options.maxModelRequests??40);if(!Number.isSafeInteger(options.maxModelRequests)||options.maxModelRequests<1||options.maxModelRequests>120)throw Error('Invalid evaluation maximum model requests');}
 if(!options.directory)throw Error('Use --output with a new experiment directory; the historical 20261020 experiment is read-only');
 options.directory=path.resolve(options.directory);
 if(options.version==='baseline'&&!options.source)throw Error('Baseline requires --source-root pointing to its frozen runtime');
 options.source=path.resolve(options.source||path.join(__dirname,'..'));
 if(options.suite==='weather'&&((!options.resumeFrom&&!options.materialsDirectory)||!options.environmentDirectory))throw Error('Weather evaluation requires explicit --materials-dir (or --resume-from) and isolated --environment-dir');
 if(options.suite==='weather'&&options.concurrency!==1)throw Error('Weather device evaluations require concurrency=1 for independent timing');
 return options;
}
function publicModel(model){
 if(model?.id==='auto'||!model?.baseUrl&&model?.configurationFingerprint)return require('./agent-eval-reference.cjs').publicSelection(model);
 const endpoint=new URL(model.baseUrl);const endpointFingerprint=hash(endpoint.href);
 const selected={id:model.id,name:model.name,model:model.model,contextWindow:model.contextWindow,maxOutputTokens:model.maxOutputTokens,imageInput:model.imageInput,endpointFingerprint};
 if(!selected.model||!selected.id)throw Error('Selected model is not configured');
 return {...selected,configurationFingerprint:hash(selected)};
}
async function fingerprint(source){
 const files=['package.json','package-lock.json',...(await fs.readdir(path.join(source,'apps/desktop'))).filter(name=>/\.(cjs|mjs)$/.test(name)&&!['forge.config.cjs','vite.config.mjs'].includes(name))];
 for(const entry of await fs.readdir(path.join(source,'apps/desktop/agent')))if(/\.(cjs|mjs)$/.test(entry))files.push('agent/'+entry);
 const entries=[];for(const file of files.sort())try{entries.push([file,hash(await fs.readFile(path.join(source,'apps/desktop',file),'utf8'))]);}catch(e){if(e.code!=='ENOENT')throw e;}
 return hash(entries);
}
function configuration(options,model,cases){
 const selected=publicModel(model),data={schemaVersion:2,suite:options.suite,stratum:options.stratum,model:selected,reasoningEffort:options.reasoningEffort,timeoutMs:options.timeoutMs,timeoutScope:'agent_model_and_tool_execution',repeats:options.repeats,concurrency:options.concurrency,cases:cases.map(c=>({id:c.id,category:c.category,requestHash:hash(c.request),rubric:c.rubric,materialFingerprint:c.materialFingerprint,environmentFingerprint:c.environmentFingerprint})),humanAcceptance:'pending',cost:'Provider token usage only; no price inferred'};
 if(options.reviewNoteMetadata){const note=options.reviewNoteMetadata;data.assistance=require('./agent-eval-review-note.cjs').assistance(note);data.pilotCheckPolicy={imageGoal:'new_device_inspection',firstImageRequestTarget:null};for(const c of data.cases){c.sourceMaterialFingerprint=c.materialFingerprint;c.materialFingerprint=hash({sourceMaterialFingerprint:c.materialFingerprint,supplementalKind:note.kind,supplementalSha256:note.sha256});}data.effectiveInputFingerprint=hash(data.cases.map(c=>[c.requestHash,c.materialFingerprint]));}
 if(options.evaluationPolicy){data.evaluationPurpose='bounded_diagnostic';data.evaluationPolicy={...options.evaluationPolicy};}
 if(options.ablation)data.ablation={mechanism:options.ablation,requiredAcceptance:'unchanged'};
 if(options.suite==='net-gain'||options.maxModelRequests)data.maxModelRequests=options.maxModelRequests||40;
 if(options.suite==='net-gain')data.harnessFingerprint=harnessFingerprint();
 if(options.resumeMetadata)data.resume={...options.resumeMetadata};
 return {...data,configurationFingerprint:hash(data)};
}
function harnessFingerprint(){const read=require('node:fs'),names=read.readdirSync(__dirname).filter(n=>/^agent-(?:eval-|live-eval|visual-live-eval).*\.cjs$/.test(n)&&!n.endsWith('.test.cjs')).sort();return hash(names.map(n=>[n,hash(read.readFileSync(path.join(__dirname,n)))]));}
async function assertConfiguration(directory,config,{write=false}={}){
 const file=path.join(directory,'configuration.json');let prior;
 try{prior=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(prior&&(!prior.schemaVersion||prior.configurationFingerprint!==config.configurationFingerprint))throw Error('Experiment configuration differs or belongs to a historical experiment; select a new --output directory');
 if(write&&!prior){await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.writeFile(file,JSON.stringify(config,null,2),{mode:0o600,flag:'wx'});}
}
async function verifyDiagnosticBudget(source,policy,{loadModule=require}={}){
 if(policy===undefined)return;
 const reject=()=>Object.assign(Error('Selected runtime cannot enforce the bounded diagnostic decision/segment limit; no model request was started'),{code:'EVAL_DIAGNOSTIC_POLICY_UNSUPPORTED'});
 if(!policy||!Number.isSafeInteger(policy.maxDecisions)||policy.maxDecisions<1||policy.maxDecisions>120)throw reject();
 try{
  const selected=loadModule(path.join(source,'apps/desktop/agent/execution-segments.cjs'));
  if(typeof selected.evaluationPolicy!=='function'||typeof selected.runSegments!=='function')throw reject();
  const effective=selected.evaluationPolicy({executionOrigin:'evaluation',evaluationPolicy:{maxDecisions:policy.maxDecisions}});
  if(!Number.isSafeInteger(effective?.segmentSteps)||effective.segmentSteps<1||effective.segmentSteps>policy.maxDecisions||effective.maxSegments!==1)throw reject();
  // Probe the actual selected runner API with a pure callback. Genuine progress
  // would normally qualify for another segment, so silently ignored policy is
  // detected before credentials, model calls, builds or devices are available.
  let calls=0,steps;await selected.runSegments(async options=>{
   if(++calls!==1||!Number.isSafeInteger(options?.maxSteps)||options.maxSteps<1||options.maxSteps>policy.maxDecisions)throw reject();steps=options.maxSteps;
   return {agentRun:{mode:'task',status:'paused'},continuation:{safe:true}};
  },{policy:effective,signal:new AbortController().signal,now:()=>0});
  if(calls!==1)throw reject();
  return {supported:true,maxDecisions:policy.maxDecisions,effectiveMaxDecisions:steps,maxSegments:1,verification:'selected_runtime_pure_api_probe'};
 }catch{throw reject();}
}
function interventions(record){
 const evidence=record.interventionEvidence;
 if(!evidence||evidence.complete!==true||!Array.isArray(evidence.events))return {executionInterventions:null,userContinuations:null,resumeOutcome:'not_measured'};
 const events=[...new Map(evidence.events.filter(e=>e&&typeof e.id==='string').map(e=>[e.id,e])).values()];
 if(events.some(e=>['user_continuation','user_resume'].includes(e.type)&&!['user','evaluation','scheduled','assistant','automatic'].includes(e.origin)))return {executionInterventions:null,userContinuations:null,resumeOutcome:'not_measured'};
 const continuations=events.filter(e=>['user_continuation','user_resume'].includes(e.type)&&e.origin==='user');
 const steering=events.filter(e=>e.type==='steering'||e.type==='user_intervention'&&e.origin==='user');
 return {executionInterventions:continuations.length+steering.length,userContinuations:continuations.length,resumeOutcome:continuations.length?(record.result?.agentRun?.status==='completed'?'completed_after_resume':'not_completed_after_resume'):'not_applicable'};
}
module.exports={args,publicModel,fingerprint,harnessFingerprint,configuration,assertConfiguration,interventions,hash,canonicalPath,verifyDiagnosticBudget};

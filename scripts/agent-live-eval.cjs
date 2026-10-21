// Electron main process: credentials are decrypted in memory, never copied into
// fixtures/logs. Uses the real createChat/transport/tool runtime for each version.
const {app,protocol,BrowserWindow,session,nativeImage,safeStorage,net}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {cases,records}=require('./agent-eval-cases.cjs');
const {serviceFailure}=require('./agent-eval-service.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'ailo-project',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);app.on('window-all-closed',()=>{});
app.setName('Ailo');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'.local/evals/iteration-20261020');
const profile=path.join(directory,'electron-profiles',String(process.pid));require('node:fs').mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
app.whenReady().then(async()=>{
 try{
  const version=process.argv[2]||'baseline',repeatCount=Number(process.argv[3]||3),filter=process.argv.slice(4).find(a=>!a.startsWith('--')),retryService=process.argv.includes('--retry-service');
  if(!['baseline','candidate'].includes(version)||!Number.isSafeInteger(repeatCount)||repeatCount<1||repeatCount>3)throw Error('invalid evaluation arguments');
  const source=version==='baseline'?path.join(directory,'baseline'):path.join(directory,'candidate-source');
  const live=require(path.join(root,'apps/desktop/storage.cjs')).createStorage(path.join(os.homedir(),'Library/Application Support/Ailo'),safeStorage);
  const configured=(await live.readWorkspace()).models?.find(m=>m.model==='glm-5.3-flash'&&new URL(m.baseUrl).hostname==='open.bigmodel.cn');
  const model=await live.modelCredentials(process.env.AILO_EVAL_MODEL_ID||configured?.id);
  if(model.model!=='glm-5.3-flash'||new URL(model.baseUrl).hostname!=='open.bigmodel.cn')throw Error('fixed evaluation model differs');
  const {apiKey,...publicModel}=model;
  await fs.mkdir(directory,{recursive:true});
  const configuration={model:publicModel,reasoningEffort:'medium',timeoutMs:1200000,repeats:3,cases:cases.map(c=>({id:c.id,request:c.request,rubric:c.rubric})),cost:'Provider token usage only; no price inferred',humanAcceptance:'pending'};
  const configFile=path.join(directory,'configuration.json');
  try{const old=JSON.parse(await fs.readFile(configFile));if(JSON.stringify(old)!==JSON.stringify(configuration))throw Error('Fixed evaluation configuration changed');}catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(configFile,JSON.stringify(configuration,null,2),{mode:0o600});}
  if(process.argv.includes('--preflight')){console.log('Preflight passed: fixed model credentials available; isolated Electron profile; no model request sent');app.exit(0);return;}
  const queue=[];for(let repeat=1;repeat<=repeatCount;repeat++)for(const fixture of cases.filter(c=>!filter||c.id===filter))queue.push({fixture,repeat});
  let serviceBlocked=false;
  async function worker(){for(;;){if(serviceBlocked)return;const job=queue.shift();if(!job)return;const {fixture,repeat}=job,trial=path.join(directory,version,fixture.id+'-'+repeat),resultFile=path.join(trial,'result.json');
   let existing;try{existing=JSON.parse(await fs.readFile(resultFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(existing){
    let records=[];try{records=JSON.parse(await fs.readFile(path.join(trial,'requests.json'),'utf8'));}catch{}
    if(!retryService||!serviceFailure(records,existing.error)){console.log('SKIP',version,fixture.id,repeat);continue;}
    const archive=path.join(directory,version,'service-blocked',fixture.id+'-'+repeat+'-'+Date.now());await fs.mkdir(path.dirname(archive),{recursive:true});await fs.rename(trial,archive);
   }
   await fs.mkdir(trial,{recursive:true});
   const base=path.join(trial,'workspace'),task={id:'eval',projectId:'eval',request:fixture.request,messages:[{id:'input',role:'user',content:fixture.request}]};
   const w=await require(path.join(source,'apps/desktop/agent/workspace.cjs')).createWorkspace(base,task);
   for(const [name,content]of Object.entries(fixture.files))await fs.writeFile(path.join(w.files,name),content);
   if(fixture.bundle)await fs.writeFile(path.join(w.files,'sample.bundle'),zlib.gzipSync(JSON.stringify({records})));
   const browser=require(path.join(source,'apps/desktop/agent/browser-observer.cjs')).createBrowserObserver({BrowserWindow,session});
   const requests=[],storage={agentDirectory:base,modelCredentials:async()=>model,readWorkspace:async()=>({tasks:[task],projects:[{id:'eval'}]}),imageObserver:require(path.join(source,'apps/desktop/agent/image-observer.cjs')).createImageObserver(nativeImage),browserObserver:browser,recordModelRequest:async r=>{const {providerRequestId,...safe}=r;requests.push(safe);await fs.writeFile(path.join(trial,'requests.json'),JSON.stringify(requests,null,2),{mode:0o600});}};
   const chat=require(path.join(source,'apps/desktop/chat.cjs')).createChat(storage,(url,options)=>net.fetch(url,options));
   const started=Date.now();let result,error,timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;chat.cancel('trial');},configuration.timeoutMs);
   console.log('START',version,fixture.id,repeat);
   try{result=await chat.complete({id:'trial',taskId:'eval',modelId:model.id,messages:task.messages,reasoningEffort:'medium',onRun:async run=>{await fs.writeFile(path.join(trial,'progress.json'),JSON.stringify(run),{mode:0o600});}});}catch(e){error={code:e.code,message:e.message};}finally{clearTimeout(timer);browser.dispose();}
   const blocked=serviceFailure(requests,error);if(blocked)serviceBlocked=true;
   const checks=[];for(const name of fixture.outputs){try{checks.push({check:'nonempty '+name,passed:(await fs.stat(path.join(w.files,name))).size>0});}catch{checks.push({check:'nonempty '+name,passed:false});}}
   if(fixture.expected){try{checks.push({check:'exact data result',passed:require('node:util').isDeepStrictEqual(JSON.parse(await fs.readFile(path.join(w.files,'result.json'),'utf8')),fixture.expected)});}catch{checks.push({check:'exact data result',passed:false});}}
   if(fixture.category==='code')try{const r=await require(path.join(source,'apps/desktop/agent/tools.cjs')).runCommand(w.files,'python3 test_ranges.py',new AbortController().signal,10000,{networkOutbound:false});checks.push({check:'independent code regression',passed:r.exitCode===0,output:r.output});}catch(e){checks.push({check:'independent code regression',passed:false,error:e.message});}
   if(fixture.bundle)try{const r=await require(path.join(source,'apps/desktop/agent/tools.cjs')).runCommand(w.files,'python3 -c \'import csv,json; r=list(csv.DictReader(open("records.csv"))); assert len(r)==2 and r[0]=={"id":"1","name":"甲,乙","note":"第一行\\n第二行"} and r[1]=={"id":"2","name":"丙","note":"正常"}\'',new AbortController().signal,10000,{networkOutbound:false});checks.push({check:'CSV roundtrip',passed:r.exitCode===0});}catch(e){checks.push({check:'CSV roundtrip',passed:false,error:e.message});}
   await fs.writeFile(resultFile,JSON.stringify({version,case:fixture.id,repeat,elapsedMs:Date.now()-started,timedOut,error,serviceBlocked:blocked,result,checks,humanAcceptance:'pending',rubric:fixture.rubric},null,2),{mode:0o600});
   console.log('END',version,fixture.id,repeat,result?.agentRun?.status||error?.code,'checks',checks.every(c=>c.passed));
  }}
  await Promise.all([worker(),worker(),worker()]);if(serviceBlocked)console.log('SERVICE BLOCKED: remaining trials not started; restore quota/service before --retry-service');app.exit(serviceBlocked?2:0);
 }catch(e){console.error(e.message);app.exit(1);}
});

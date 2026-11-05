// Explicit real-image calibration. --preflight reads metadata/images only.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..'),config=require('./agent-eval-config.cjs'),reference=require('./agent-eval-reference.cjs'),calibration=require('./agent-eval-visual-calibration.cjs');
const options={source:root,timeoutMs:180000,reasoningEffort:'medium'};
try{for(let i=2;i<process.argv.length;i++){if(process.argv[i]==='--preflight'){options.preflight=true;continue;}const k={'--dataset':'dataset','--root':'imageRoot','--output':'output','--source-root':'source','--data-dir':'dataDirectory','--timeout-ms':'timeoutMs','--reasoning-effort':'reasoningEffort'}[process.argv[i]];if(!k||!process.argv[i+1])throw Error('Invalid live calibration option');options[k]=process.argv[++i];}if(!options.dataset||!options.imageRoot||!options.output)throw Error('Use --dataset, --root and a new isolated --output');options.timeoutMs=Number(options.timeoutMs);if(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<1000||options.timeoutMs>600000||!['low','medium','high'].includes(options.reasoningEffort))throw Error('Invalid bounded calibration budget');}catch(e){console.error(e.message);process.exit(1);}
const {app,safeStorage,net}=require('electron');app.setPath('userData',require('node:fs').mkdtempSync(path.join(os.tmpdir(),'ailo-visual-eval-')));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{try{
 const source=path.resolve(options.source),imageRoot=path.resolve(options.imageRoot),output=path.resolve(options.output),dataDirectory=await config.canonicalPath(options.dataDirectory||path.join(os.homedir(),'Library/Application Support/Ailo'));
 for(const forbidden of [dataDirectory,source,imageRoot]){const actual=await config.canonicalPath(output),target=await config.canonicalPath(forbidden);if(actual===target||actual.startsWith(target+path.sep)&&!(target===source&&actual.startsWith(path.join(source,'.local')+path.sep)))throw Error('Calibration predictions must be isolated from user data, source and frozen image dataset');}
 const dataset=JSON.parse(await fs.readFile(options.dataset,'utf8'));await calibration.assertDataset(dataset,{root:imageRoot});
 const storage=require(path.join(source,'apps/desktop/storage.cjs')).createStorage(dataDirectory,safeStorage),state=await storage.readWorkspace(),selected=reference.freezeSelection(state,dataset.reference.id);
 if(selected.configurationFingerprint!==dataset.reference.configurationFingerprint)throw Error('Current model/Auto routing differs from the frozen real-image dataset');
 const runtimeFingerprint=await config.fingerprint(source);if(options.preflight){console.log(JSON.stringify({status:'preflight_passed',modelRequests:0,credentialsDecrypted:0,samples:dataset.samples.length,maximumVisionRequests:dataset.samples.length*4,referenceFingerprint:selected.configurationFingerprint,runtimeFingerprint}));app.exit(0);return;}
 const credentials=await reference.frozenCredentials(storage,selected),routingStorage={readWorkspace:async()=>({models:state.models,autoModel:selected.routing}),modelCredentials:credentials},requestLog=[];
 const result=await calibration.collect(dataset,{root:imageRoot,output,observe:async sample=>{
  if(await config.fingerprint(source)!==runtimeFingerprint)throw Error('Calibration runtime changed; refusing to mix graders');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeoutMs),routes=[];
  try{
   const routing=require(path.join(source,'apps/desktop/model-routing.cjs')),router=await routing.createModelRouter(routingStorage,selected.id,{signal:controller.signal,onRoute:e=>routes.push(e)}),effective=router.enabled?router:{...router,enabled:true,run:(_lane,request)=>router.run('primary',request)},prepare=routing.createVisualRouter(effective);
   const parts=[];for(const image of sample.images){parts.push({type:'text',text:image.role==='actual'?'当前实际画面':'原始参考画面'});const bytes=await fs.readFile(image.file),mime=/\.png$/i.test(image.file)?'image/png':/\.webp$/i.test(image.file)?'image/webp':'image/jpeg';parts.push({type:'image_url',image_url:{url:'data:'+mime+';base64,'+bytes.toString('base64')}});}
   const question={phase:'task',currentRequest:sample.requirements.join('\n'),goal:sample.context,visualQuality:{instruction:'仅核对提供的原始要求。看不清或只有怀疑时保持不确定；不得把参考图的标识算作实际画面缺陷。',constraints:sample.requirements.map((description,i)=>({id:sample.id+':'+i,description,status:'open',needsReview:true}))}};
   const prepared=await prepare([{role:'user',content:parts},{role:'user',content:JSON.stringify(question)}],async(messages,model)=>{
    const started=Date.now(),id=require('node:crypto').randomUUID(),record={id,modelId:model.id,routingLane:'vision',selectedModelId:selected.id,startedAt:new Date(started).toISOString(),runtimeFingerprint,referenceFingerprint:selected.configurationFingerprint};requestLog.push(record);
    try{
     const url=new URL(model.baseUrl);if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Invalid configured API endpoint');if(!url.pathname.replace(/\/$/,'').endsWith('/chat/completions'))url.pathname=url.pathname.replace(/\/$/,'')+'/chat/completions';
     const {prepareRequestBudget}=await import(path.join(source,'apps/desktop/context.mjs')),budget=prepareRequestBudget(messages,{},model,Math.min(8192,model.maxOutputTokens||8192));
     const body={model:model.model,messages,stream:true,max_tokens:budget.budget,...require(path.join(source,'apps/desktop/reasoning.cjs')).reasoningParameters(model,options.reasoningEffort)};
     const response=await net.fetch(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json','X-Ailo-Request-Id':id,...(model.apiKey?{Authorization:'Bearer '+model.apiKey}:{})},body:JSON.stringify(body)});record.httpStatus=response.status;
     if(!response.ok){await response.body?.cancel();throw Object.assign(Error('Calibration model request failed with HTTP '+response.status),{code:response.status===429?'MODEL_RATE_LIMIT':response.status>=500?'MODEL_HTTP_TRANSIENT':'MODEL_HTTP_ERROR'});}
     const reply=await require(path.join(source,'apps/desktop/chat-response.cjs')).readCompletion(response,{signal:controller.signal,onActivity(){}});record.providerUsage=reply.providerUsage;return reply;
    }catch(error){record.errorCode=error.code||'CALIBRATION_REQUEST_FAILED';throw error;}
    finally{record.elapsedMs=Date.now()-started;await fs.writeFile(path.join(output,'requests.json'),JSON.stringify(requestLog,null,2),{mode:0o600});}
   });
   if(prepared.reviews?.length!==1||prepared.failures?.length)throw Error('Actual visual observation did not produce one valid structured report; no prediction was invented');return {review:prepared.reviews[0],modelConfigurationFingerprint:selected.configurationFingerprint,runtimeFingerprint,routes};
  }finally{clearTimeout(timer);}
 }});
 console.log(JSON.stringify({status:'predictions_collected',samples:result.samples.length,modelRequests:requestLog.length,humanLabels:'not_created',output}));app.exit(0);
}catch(e){console.error(e.message);app.exit(1);}});

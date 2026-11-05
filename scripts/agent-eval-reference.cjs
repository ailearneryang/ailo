// Public routing references. Metadata inspection never decrypts credentials.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const config=require('./agent-eval-config.cjs');
const routing=require('../apps/desktop/model-routing-config.cjs');
const hex=value=>/^[a-f0-9]{64}$/.test(value||'');
function publicPhysical(value){
 if(value?.baseUrl)return config.publicModel(value);
 const model=Object.fromEntries(['id','name','model','contextWindow','maxOutputTokens','imageInput','endpointFingerprint'].filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
 if(!model.id||!model.model||!hex(model.endpointFingerprint)||config.hash(model)!==value.configurationFingerprint)throw Error('Public model metadata is incomplete or its fingerprint changed');
 return {...model,configurationFingerprint:value.configurationFingerprint};
}
function publicSelection(input){
 const value=input?.schemaVersion===2?input.model:input;
 if(!value)return null;
 if(value.id!=='auto')return publicPhysical(value);
 if(value.mode!=='auto'||!Array.isArray(value.models)||!value.routing)throw Error('Auto reference requires its frozen routing and all referenced models');
 const models=value.models.map(publicPhysical),ids=models.map(m=>m.id),keys=['primaryModelId','visionModelId','primaryFallbackId','visionFallbackId'];
 const selected={id:'auto',name:'Auto',model:'Auto',mode:'auto',routing:{failover:value.routing.failover===true,...Object.fromEntries(keys.filter(k=>value.routing[k]).map(k=>[k,value.routing[k]]))},models};
 const required=[...new Set(keys.map(k=>selected.routing[k]).filter(Boolean))].sort();
 if(!selected.routing.primaryModelId||new Set(ids).size!==ids.length||JSON.stringify(ids)!==JSON.stringify(required)||selected.routing.primaryModelId===selected.routing.primaryFallbackId||selected.routing.visionModelId&&selected.routing.visionModelId===selected.routing.visionFallbackId||selected.routing.visionFallbackId&&!selected.routing.visionModelId)throw Error('Auto reference contains missing, duplicate, or changed model references');
 if(config.hash(selected)!==value.configurationFingerprint)throw Error('Auto routing/reference fingerprint changed');
 return {...selected,configurationFingerprint:value.configurationFingerprint};
}
function freezeSelection(state,selectedId=state?.defaultModelId){
 if(!selectedId)throw Error('Select an existing model or Auto explicitly');
 if(selectedId!=='auto'){
  const model=state?.models?.find(m=>m.id===selectedId);if(!model)throw Error('The explicitly selected model ID is not configured');return publicPhysical(model);
 }
 const route=routing.validateRouting(state.autoModel,state.models||[]);if(!route)throw Error('Auto is not configured');
 const ids=[...new Set(['primaryModelId','visionModelId','primaryFallbackId','visionFallbackId'].map(k=>route[k]).filter(Boolean))].sort();
 const selected={id:'auto',name:'Auto',model:'Auto',mode:'auto',routing:route,models:ids.map(id=>publicPhysical(state.models.find(m=>m.id===id)))};
 return publicSelection({...selected,configurationFingerprint:config.hash(selected)});
}
async function frozenCredentials(storage,selection){
 const expected=publicSelection(selection),current=freezeSelection(await storage.readWorkspace(),expected.id);
 if(current.configurationFingerprint!==expected.configurationFingerprint)throw Error('Model or Auto routing changed since the frozen reference; no request was sent');
 const allowed=new Map((expected.id==='auto'?expected.models:[expected]).map(m=>[m.id,m]));
 return async id=>{
  // Auto itself is deliberately never resolved to a single physical model.
  const wanted=allowed.get(id);if(!wanted)throw Error('Runtime requested a model outside the frozen routing reference');
  const latest=freezeSelection(await storage.readWorkspace(),expected.id);if(latest.configurationFingerprint!==expected.configurationFingerprint)throw Error('Frozen routing changed during evaluation');
  const actual=await storage.modelCredentials(id);if(publicPhysical(actual).configurationFingerprint!==wanted.configurationFingerprint)throw Error('Model credentials resolved to changed public configuration');return actual;
 };
}
async function main(argv=process.argv.slice(2)){
 const o={};for(let i=0;i<argv.length;i++){const k={'--data-dir':'data','--model-id':'model','--output':'output'}[argv[i]];if(!k||!argv[i+1])throw Error('Invalid reference option');o[k]=argv[++i];}
 if(!o.output)throw Error('Use --output with a new public reference file');
 const storage=require('../apps/desktop/storage.cjs').createStorage(o.data||path.join(os.homedir(),'Library/Application Support/Ailo'),{});
 const state=await storage.readWorkspace(),selected=freezeSelection(state,o.model||state.defaultModelId);
 await fs.mkdir(path.dirname(path.resolve(o.output)),{recursive:true,mode:0o700});await fs.writeFile(o.output,JSON.stringify(selected,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({modelRequests:0,credentialsDecrypted:0,selectedId:selected.id,configurationFingerprint:selected.configurationFingerprint,referencedModels:selected.models?.length||1,output:path.resolve(o.output)}));return selected;
}
module.exports={publicSelection,freezeSelection,frozenCredentials,main};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});

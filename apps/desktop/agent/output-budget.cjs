const {createHash}=require('node:crypto');
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validTokens=value=>Number.isSafeInteger(value)&&value>0;
// Only controls actually sent by the transport belong here. An unknown endpoint
// has no inferred effort/enableThinking; caller configuration is not proof.
function controlKey(controls){
 const known={};
 for(const name of ['reasoningControlSent','enableThinking'])if(typeof controls?.[name]==='boolean')known[name]=controls[name];
 if(typeof controls?.reasoningEffort==='string'&&controls.reasoningEffort.length<=32)known.reasoningEffort=controls.reasoningEffort;
 return fingerprint(known);
}
function outputBudgetPressure(budget,usage,diagnostics={}){
 const used=usage?.outputTokens??diagnostics.completionTokens??diagnostics.outputTokens;
 const reasoning=usage?.reasoningTokens??diagnostics.reasoningTokens;
 const atLimit=validTokens(budget)&&validTokens(used)&&used>=Math.floor(budget*.98);
 const truncated=diagnostics.finishReason==='length';
 return {pressured:truncated||atLimit,atLimit,truncated,...(validTokens(used)?{outputTokens:used}:{}),...(Number.isSafeInteger(reasoning)&&reasoning>=0?{reasoningTokens:reasoning}:{}),reason:truncated?'length':atLimit?'usage_near_limit':null};
}
// Learned budgets are isolated by stage. Legacy single budgets are deliberately
// not inherited: one large file/reasoning response must not inflate routing.
function createOutputBudget(model,configuredLimit,saved){
 const key=fingerprint([model.id,model.baseUrl,model.model,model.name]);
 const configurationKey=fingerprint([configuredLimit,model.contextWindow]);
 const settings={route:[4096,16384],summary:[8192,32768],review:[8192,32768],action:[8192,65536]},profiles={};
 const compatible=saved?.key===key&&saved.version===3&&saved.configurationKey===configurationKey;
 function restore(priors,withFloor){const stages={};for(const [name,[base,ceiling]] of Object.entries(settings)){
  const cap=Math.min(configuredLimit,ceiling),prior=priors?.[name],minimum=Math.min(base,cap);
  const floor=Math.min(cap,Math.max(minimum,withFloor&&validTokens(prior?.floor)?prior.floor:minimum));
  stages[name]={preferred:Math.min(cap,Math.max(floor,validTokens(prior?.preferred)?prior.preferred:minimum)),floor,smallSuccesses:Number.isSafeInteger(prior?.smallSuccesses)?Math.min(1,Math.max(0,prior.smallSuccesses)):0};
 }return stages;}
 // v2 retained a transient preference, not evidence of a durable floor. Preserve
 // that preference only for the legacy unknown-controls profile.
 const stages=restore(compatible?saved.stages:saved?.key===key&&saved.version===2?saved.stages:undefined,compatible);
 if(compatible)for(const [id,value]of Object.entries(saved.profiles||{}).slice(0,32))if(/^[a-f0-9]{64}$/.test(id))profiles[id]=restore(value,true);
 const stage=name=>Object.hasOwn(stages,name)?name:'action';
 const unknown=controlKey();
 const values=(name,controls)=>{
  const id=controlKey(controls);if(id===unknown)return stages[stage(name)];
  // There are few actual effort modes. Bound hostile/corrupt saved profiles;
  // overflow still obeys caps and cannot acquire a shared incorrect floor.
  if(!profiles[id]){if(Object.keys(profiles).length>=32)return restore()[stage(name)];profiles[id]=restore();}
  return profiles[id][stage(name)];
 };
 return {
  budget(remaining,name='action',controls){return Math.min(values(name,controls).preferred,remaining);},
  snapshot(){return {key,configurationKey,version:3,stages:structuredClone(stages),profiles:structuredClone(profiles)};},
  reset(name='action',controls){Object.assign(values(name,controls),restore()[stage(name)]);},
  limited(budget,diagnostics={},name='action',controls){
   const reasoning=diagnostics.contentChars===0&&!(diagnostics.toolArgumentChars>0)&&(diagnostics.reasoningChars>0||diagnostics.reasoningTokens>0);
   name=stage(name);const value=values(name,controls),cap=Math.min(configuredLimit,settings[name][1]);
   const next=Math.min(cap,reasoning?32768:cap,Math.max(value.preferred,budget*2));
   const observed=diagnostics.finishReason==='length'||['contentChars','toolArgumentChars','reasoningChars','reasoningTokens','completionTokens','outputTokens'].some(k=>diagnostics[k]>0);
   // A confirmed truncated response is censored usage, not a small sample. Two
   // cheap install/read/build actions cannot disprove the observed requirement.
   if(observed)value.floor=Math.max(value.floor,next);
   value.preferred=Math.max(value.floor,next);value.smallSuccesses=0;
   return reasoning?'reasoning':'action';
  },
  pressured(budget,usage,diagnostics={},name='action',controls){
   const pressure=outputBudgetPressure(budget,usage,diagnostics);
   if(pressure.pressured)this.limited(budget,{...diagnostics,...pressure},name,controls);
   return pressure;
  },
  succeeded(usage,name='action',controls){
   // max_tokens covers reasoning as well as action arguments. Learning only the
   // argument size repeatedly starves models whose thinking cannot be disabled.
   const used=usage?.outputTokens;if(!Number.isSafeInteger(used)||used<=0)return;
   name=stage(name);const value=values(name,controls),base=Math.min(configuredLimit,settings[name][0]);
   const target=Math.min(configuredLimit,settings[name][1],Math.max(base,Math.ceil(used*1.25/1024)*1024));
   value.floor=Math.max(value.floor,target);
   if(target>value.preferred){value.preferred=target;value.smallSuccesses=0;}
   else if(target<=value.preferred/2){if(++value.smallSuccesses>=2){value.preferred=Math.max(value.floor,target,Math.ceil(value.preferred/2/1024)*1024);value.smallSuccesses=0;}}
   else value.smallSuccesses=0;
  }
 };
}
module.exports={createOutputBudget,outputBudgetPressure};

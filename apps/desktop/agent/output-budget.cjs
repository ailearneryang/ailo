const {createHash}=require('node:crypto');
// Learned budgets are isolated by stage. Legacy single budgets are deliberately
// not inherited: one large file/reasoning response must not inflate routing.
function createOutputBudget(model,configuredLimit,saved){
 const key=createHash('sha256').update(JSON.stringify([model.id,model.baseUrl,model.model,model.name])).digest('hex');
 const settings={route:[4096,16384],summary:[8192,32768],review:[8192,32768],action:[8192,65536]},stages={};
 for(const [name,[base,ceiling]] of Object.entries(settings)){
  const cap=Math.min(configuredLimit,ceiling),prior=saved?.key===key&&saved.version===2?saved.stages?.[name]:undefined;
  stages[name]={preferred:Math.min(cap,Math.max(Math.min(base,cap),Number.isSafeInteger(prior?.preferred)?prior.preferred:base)),smallSuccesses:Number.isSafeInteger(prior?.smallSuccesses)?Math.min(1,Math.max(0,prior.smallSuccesses)):0};
 }
 const stage=name=>Object.hasOwn(stages,name)?name:'action';
 return {
  budget(remaining,name='action'){return Math.min(stages[stage(name)].preferred,remaining);},
  snapshot(){return {key,version:2,stages:structuredClone(stages)};},
  reset(name='action'){name=stage(name);stages[name]={preferred:Math.min(settings[name][0],configuredLimit),smallSuccesses:0};},
  limited(budget,diagnostics={},name='action'){
   const reasoning=diagnostics.contentChars===0&&!(diagnostics.toolArgumentChars>0)&&(diagnostics.reasoningChars>0||diagnostics.reasoningTokens>0);
   name=stage(name);const value=stages[name];if(reasoning){value.preferred=Math.min(value.preferred,settings[name][0]);value.smallSuccesses=0;return 'reasoning';}
   value.preferred=Math.min(configuredLimit,settings[name][1],Math.max(value.preferred,budget*2));value.smallSuccesses=0;
   return diagnostics.contentChars===0&&diagnostics.toolCalls===0&&(diagnostics.reasoningChars>0||diagnostics.reasoningTokens>0)?'reasoning':'action';
  },
  succeeded(usage,name='action'){
   const used=Number.isSafeInteger(usage?.reasoningTokens)&&Number.isSafeInteger(usage?.outputTokens)?usage.outputTokens-usage.reasoningTokens:usage?.outputTokens;if(!Number.isSafeInteger(used)||used<=0)return;
   name=stage(name);const value=stages[name],base=Math.min(configuredLimit,settings[name][0]);
   const target=Math.min(configuredLimit,settings[name][1],Math.max(base,Math.ceil(used*1.25/1024)*1024));
   if(target>value.preferred){value.preferred=target;value.smallSuccesses=0;}
   else if(target<=value.preferred/2){if(++value.smallSuccesses>=2){value.preferred=Math.max(target,Math.ceil(value.preferred/2/1024)*1024);value.smallSuccesses=0;}}
   else value.smallSuccesses=0;
  }
 };
}
module.exports={createOutputBudget};

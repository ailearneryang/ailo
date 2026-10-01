const {createHash}=require('node:crypto');
// Only numeric policy state persists; model identity is hashed, credentials excluded.
function createOutputBudget(model, configuredLimit, saved) {
  const key=createHash('sha256').update(JSON.stringify([model.id,model.baseUrl,model.model,model.name])).digest('hex');
  const cap=Math.min(configuredLimit,65536);
  let preferred=saved?.key===key&&Number.isSafeInteger(saved.preferred)?Math.max(8192,saved.preferred):8192;
  preferred=Math.min(cap,preferred);
  return {
    budget(remaining){return Math.min(preferred,remaining);},
    snapshot(){return {key,preferred};},
    limited(budget,diagnostics={}) {
      const thinkingOnly=diagnostics.contentChars===0 && diagnostics.toolCalls===0 && (diagnostics.reasoningChars>0||diagnostics.reasoningTokens>0);
      preferred=Math.min(cap,Math.max(preferred,budget*2));
      return thinkingOnly?'reasoning':'action';
    },
    succeeded(usage) {
      const used=usage?.outputTokens;
      // Headroom avoids another failure near the previous successful budget.
      if(Number.isSafeInteger(used)&&used>0)preferred=Math.min(cap,Math.max(preferred,Math.ceil(used*1.25/1024)*1024));
    }
  };
}
module.exports={createOutputBudget};

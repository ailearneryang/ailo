// Provider controls are scoped to documented hosts and model IDs.
// https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash
// https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3
// https://docs.bigmodel.cn/cn/guide/capabilities/stream-tool
function isBigmodel53(model){
 try{const url=new URL(model.baseUrl);return url.protocol==='https:'&&url.hostname==='open.bigmodel.cn'&&['glm-5.3','glm-5.3-flash','glm-5.3-flashx'].includes(model.model);}catch{return false;}
}
function supportsReasoning(model) {
  if(isBigmodel53(model))return true;
  try {
    const url = new URL(model.baseUrl);
    return url.protocol === 'https:' && (url.hostname === 'dashscope.aliyuncs.com' || /^[a-z0-9-]+\.(cn-beijing|ap-southeast-1|us-east-1|eu-central-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(url.hostname)) && model.model === 'glm-5.2';
  } catch { return false; }
}
function reasoningParameters(model, effort) {
  if (effort === undefined) return {};
  if (!['low','medium','high'].includes(effort)) throw Error('思考强度无效。');
  if(isBigmodel53(model))return {thinking:{type:'enabled'},reasoning_effort:{low:'low',medium:'high',high:'max'}[effort]};
  return supportsReasoning(model) ? {reasoning_effort:effort,enable_thinking:true} : {};
}
function toolStreamingParameters(model){return isBigmodel53(model)?{tool_stream:true}:{};}
function recoveryReasoningParameters(model,stage='small_action'){
 if(isBigmodel53(model))return reasoningParameters(model,'low');
 // GLM-5.2 on Model Studio supports disabling thinking for recovery decisions.
 if(supportsReasoning(model))return stage==='small_action'?reasoningParameters(model,'low'):{enable_thinking:false,reasoning_effort:'none'};
 return {};
}
function decisionReasoningParameters(model,stage){return ['route','state'].includes(stage)&&supportsReasoning(model)?reasoningParameters(model,'low'):{};}
module.exports={decisionReasoningParameters,supportsReasoning,reasoningParameters,isBigmodel53,toolStreamingParameters,recoveryReasoningParameters};

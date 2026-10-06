// Enable only the provider/model combination verified against Bailian's GLM docs.
function supportsReasoning(model) {
  try {
    const url = new URL(model.baseUrl);
    return url.protocol === 'https:' && (url.hostname === 'dashscope.aliyuncs.com' || /^[a-z0-9-]+\.(cn-beijing|ap-southeast-1|us-east-1|eu-central-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(url.hostname)) && model.model === 'glm-5.2';
  } catch { return false; }
}
function reasoningParameters(model, effort) {
  if (effort === undefined) return {};
  if (!['low','medium','high'].includes(effort)) throw Error('思考强度无效。');
  return supportsReasoning(model) ? {reasoning_effort:effort,enable_thinking:true} : {};
}
module.exports = {supportsReasoning,reasoningParameters};

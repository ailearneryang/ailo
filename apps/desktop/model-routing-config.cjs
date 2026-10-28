const {observationCapabilities}=require('./agent/model-capabilities.cjs');
const AUTO_ID='auto';
const visionCapable=model=>model?.imageInput==='enabled'&&observationCapabilities(model).imageTransport;
function validateRouting(value,models){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Auto 模型配置无效');
 const result={failover:value.failover===true};
 if(value.failover!==undefined&&typeof value.failover!=='boolean')throw Error('自动备用切换配置无效');
 for(const key of ['primaryModelId','visionModelId','primaryFallbackId','visionFallbackId']){
  const id=value[key];if(id===undefined||id==='')continue;
  const model=models.find(m=>m.id===id);
  if(typeof id!=='string'||!model)throw Error('Auto 中的模型已移除，请重新选择');
  if(key.startsWith('vision')&&!visionCapable(model))throw Error('视觉模型须在图像输入中标为已确认支持图像，且不能是已知纯文本模型');
  result[key]=id;
 }
 if(!result.primaryModelId)throw Error('请选择 Auto 的主模型');
 if(result.primaryModelId===result.primaryFallbackId||result.visionModelId&&result.visionModelId===result.visionFallbackId)throw Error('备用模型不能与同类首选模型相同');
 if(result.visionFallbackId&&!result.visionModelId)throw Error('请先选择视觉模型');
 return result;
}
module.exports={AUTO_ID,visionCapable,validateRouting};

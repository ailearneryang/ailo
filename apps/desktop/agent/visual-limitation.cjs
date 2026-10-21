const issueId='capability_visual_unavailable';
const description='当前仅有文本模型，未进行视觉核验；布局、外观与还原度需人工看图确认';
function prepare(run,action,review,criteria){
 const pending=criteria.filter(c=>c.type==='visual'&&!c.check);
 if(action.outcome!=='limited'||run.observationCapabilities?.images!==false||!pending.length)return null;
 const entries=new Set(review.unverified);
 if(pending.some(c=>!entries.has(c.id)&&!entries.has(c.text))||review.unverified.some(s=>!pending.some(c=>s===c.id||s===c.text)))throw Error('无图像能力时，带限制交付须在 review.unverified 逐项列出未核验视觉要求的 ID 或原文；其他要求仍须通过检查');
 return {ids:pending.map(c=>c.id),review:{...review,issues:[...new Set([...review.issues,issueId])]},issue:{id:issueId,status:'limitation',description,requirementIds:pending.map(c=>c.id),reason:'当前运行未提供模型图像观察能力，保留原视觉要求，明确交由人工核验'},notice:'\n\n'+description+'。未核验项：'+pending.map(c=>c.text).join('；')+'。'};
}
module.exports={prepare,issueId,description};

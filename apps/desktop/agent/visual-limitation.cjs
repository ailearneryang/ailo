const issueId='capability_visual_unavailable';
const description='当前未确认具备视觉核验能力，未进行视觉核验；布局、外观与还原度需人工看图确认';
const unavailable=run=>run.observationCapabilities?.images===false||run.observationCapabilities?.visualReview===false;
function prepare(run,action,review,criteria){
 const pending=criteria.filter(c=>c.type==='visual'&&!c.check);
 if(action.outcome!=='limited'||!unavailable(run)||!pending.length)return null;
 const resolve=value=>pending.find(c=>value===c.id||value===c.text||value.startsWith(c.id+':')||value.startsWith(c.id+'：'))?.id;
 const canonical=review.unverified.map(resolve),entries=new Set(canonical);
 if(pending.some(c=>!entries.has(c.id))||canonical.some(id=>!id))throw Error('无图像能力时，带限制交付须在 review.unverified 逐项列出未核验视觉要求的 ID 或原文；其他要求仍须通过检查');
 return {ids:pending.map(c=>c.id),review:{...review,unverified:[...entries],issues:[...new Set([...review.issues,issueId])]},issue:{id:issueId,status:'limitation',description,requirementIds:pending.map(c=>c.id),reason:'当前运行未提供模型图像观察能力，保留原视觉要求，明确交由人工核验'},notice:'\n\n'+description+'。未核验项：'+pending.map(c=>c.text).join('；')+'。'};
}
module.exports={prepare,issueId,description,unavailable};

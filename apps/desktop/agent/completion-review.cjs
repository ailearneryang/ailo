const schema={type:'object',additionalProperties:false,required:['summary','issues','unverified'],properties:{summary:{type:'string',minLength:1,maxLength:1200},issues:{type:'array',maxItems:12,items:{type:'string',minLength:1,maxLength:500}},unverified:{type:'array',maxItems:12,items:{type:'string',minLength:1,maxLength:500}}}};
function validate(review,allowIncomplete=false){
 if(!review||typeof review.summary!=='string'||!review.summary.trim()||review.summary.length>1200||!['issues','unverified'].every(k=>Array.isArray(review[k])&&review[k].length<=12&&review[k].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)))throw Error('finish.review 必须包含 summary、issues 和 unverified；如实记录质量复核、已知问题和未验证项');
 if(!allowIncomplete&&(review.issues.length||review.unverified.length))throw Error('仍有已知问题或未验证要求，不能声明全部完成；请继续修复，或 blocked 交付已完成部分并说明限制');
 return {summary:review.summary,issues:[...review.issues],unverified:[...review.unverified]};
}
module.exports={schema,validate};

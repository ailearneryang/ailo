// One contract for standalone checkpoints and memory attached to real actions.
// Validation never pads, truncates or fabricates a task summary.
const schema={type:'string',minLength:20,maxLength:10000,description:'累计摘要：需求、真实来源、缺口和下一步。'};
function diagnostics(value){
 const receivedType=value===null?'null':Array.isArray(value)?'array':typeof value;
 if(typeof value!=='string')return {receivedType};
 if(value.trim().length<schema.minLength||value.length>schema.maxLength)return {receivedType,receivedLength:value.length,trimmedLength:value.trim().length};
}
function validate(value,field){
 if(diagnostics(value))throw Error(`${field} 需要20–10000字符的累计任务摘要，包含需求、真实来源、缺口和下一步`);
 return value;
}
module.exports={schema,diagnostics,validate};

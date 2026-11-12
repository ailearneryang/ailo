// Steering accepts the same imported material records as an ordinary message.
// Raw originals may come only from imports or this task's recorded lineage.
async function validate(input,{base,task}={}){
 const {hasMessageContent,canSendMaterial}=await import('./attachments.mjs');
 const content=typeof input.content==='string'?input.content.trim():'';
 const materials=input.materials===undefined?[]:input.materials;
 if(typeof input.content!=='string'||content.length>20000||!Array.isArray(materials)||materials.length>10||JSON.stringify(materials).length>1000000||!hasMessageContent(content,materials))throw Error('补充内容须为1–20000字符或至多10项有效材料');
 const safe=[];
 for(const m of materials){
  if(!m||typeof m.name!=='string'||!m.name.trim()||m.name.length>300||!canSendMaterial(m)||m.sourceId!==undefined&&(typeof m.sourceId!=='string'||!/^[a-f0-9-]{36}$/.test(m.sourceId))||m.text!==undefined&&m.text!==null&&typeof m.text!=='string')throw Error('补充材料尚未解析或原文件ID无效');
  if(m.sourceId){
   if(!base||!task)throw Error('材料所属任务不可用');
   if(!await require('./material-originals.cjs').findMaterialOriginal(base,task,m.sourceId))throw Error('补充材料原文件缺失或不属于当前任务，请重新添加');
  }
  safe.push(structuredClone(Object.fromEntries(['name','size','text','summary','sourceId','archive'].filter(k=>m[k]!==undefined).map(k=>[k,m[k]]))));
 }
 return {content,materials:safe};
}
module.exports={validate};

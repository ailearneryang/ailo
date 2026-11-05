// Hoist repeated schema annotations into one system glossary. Validation
// keywords, field order and per-action constraints remain byte-for-byte intact.
function compactToolDescriptions(tools){
 const counts=new Map();
 function visit(value,path,fn){
  if(!value||typeof value!=='object')return;
  if(!Array.isArray(value)&&typeof value.description==='string')fn(value,path);
  for(const [key,child]of Object.entries(value)){
   if(key==='description')continue;
   visit(child,[...path,...(key==='properties'?[]:[key==='items'?'[]':key])],fn);
  }
 }
 for(const tool of tools)visit(tool.function.parameters,[],(node,path)=>{
  const entry=counts.get(node.description)||{count:0,paths:new Set()};entry.count++;entry.paths.add(path.join('.'));counts.set(node.description,entry);
 });
 const shared=[...counts].filter(([,entry])=>entry.count>1);
 if(!shared.length)return {tools,guidance:''};
 const descriptions=new Set(shared.map(([description])=>description));
 const compact=structuredClone(tools);
 for(const tool of compact)visit(tool.function.parameters,[],node=>{if(descriptions.has(node.description))delete node.description;});
 return {tools:compact,guidance:'\n共享参数说明（适用于各工具的同名字段，参数约束仍见对应 schema）：\n'+shared.map(([description,entry])=>[...entry.paths].join(' / ')+'：'+description).join('\n')};
}
module.exports={compactToolDescriptions};

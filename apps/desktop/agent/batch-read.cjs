const {normalizeProjectPath}=require('./workspace.cjs');
const actions=['read_file','read_material','read_source','inspect_source','search_materials','list_files','read_execution'];
const fields=['action','itemId','path','id','view','entry','pointer','query','offset','limit'];
function validate(items){
 if(!Array.isArray(items)||!items.length||items.length>6)throw Error('batch_read.items 必须为1–6个独立只读操作');
 const ids=new Set();return items.map((item,index)=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||!actions.includes(item.action)||Object.keys(item).some(k=>!fields.includes(k)))throw Error('batch_read 只允许指定的本地只读操作，不能嵌套批量、写入、命令或应用调用');
  if(item.view!==undefined&&(item.action!=='read_execution'||!['record','result'].includes(item.view)))throw Error('view 仅支持 read_execution 的 record/result 视图');
  const value={...item},itemId=value.itemId||String(index+1);
  if(typeof itemId!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(itemId)||ids.has(itemId))throw Error('批量 itemId 必须唯一且为1–40位字母、数字、下划线或连字符');
  ids.add(itemId);
  if(['read_file','list_files'].includes(value.action))value.path=normalizeProjectPath(value.path??(value.action==='list_files'?'.':undefined),value.action==='list_files');
  if(['read_material','read_source','inspect_source'].includes(value.action)&&(typeof value.id!=='string'||!value.id))throw Error('批量材料读取缺少 id');
  if(value.action==='search_materials'&&(typeof value.query!=='string'||!value.query.trim()||value.query.length>200))throw Error('批量检索词无效');
  if(['read_file','read_material','read_execution'].includes(value.action))value.limit??=3000;
  for(const field of ['offset','limit'])if(value[field]!==undefined&&(!Number.isSafeInteger(value[field])||value[field]<(field==='limit'?1:0)||field==='limit'&&value[field]>4000))throw Error('批量分页须使用整数，offset不小于0，limit为1–4000');
  return {...value,itemId};
 });
}
// Validate the whole batch before starting anything. Only these local read tools
// may run concurrently. Failures are per item; successful items are not replayed.
async function execute(items,signal,read){
 const checked=validate(items),results=Array(checked.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(3,checked.length)},async()=>{
  for(;;){signal.throwIfAborted();const index=cursor++;if(index>=checked.length)return;const item=checked[index],started=Date.now();
   try{results[index]={itemId:item.itemId,action:item.action,result:await read(item),durationMs:Date.now()-started};}
   catch(error){signal.throwIfAborted();results[index]={itemId:item.itemId,action:item.action,error:error.message,durationMs:Date.now()-started};}
  }
 }));return results;
}
function preview(result,budget){
 if(typeof result?.text==='string'&&result.text.length>budget)return {...result,text:result.text.slice(0,budget),next:Number.isInteger(result.offset)?result.offset+budget:result.next,truncated:true};
 return result;
}
module.exports={actions,fields,validate,execute,preview};

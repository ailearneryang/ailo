// Raw observations live in the workspace archive. This is only a preview for
// the next inference; receipts and archive IDs survive pause and restart.
const RECENT_COUNT=6, PREVIEW_CHARS=6000;
function preview(value,limit=PREVIEW_CHARS){
 if(JSON.stringify(value).length<=limit)return value;
 let remaining=Math.floor(limit*.7),truncated=false;
 function visit(v,depth=0,field){
  if(typeof v==='string'){const n=Math.max(0,Math.min(v.length,remaining,3000));remaining-=n;if(n<v.length){truncated=true;if(field==='output'&&n>100){const half=Math.floor((n-32)/2);return v.slice(0,half)+'\n[完整输出见归档]\n'+v.slice(-half);}}return v.slice(0,n);}
  if(!v||typeof v!=='object')return v;
  if(depth>6||remaining<=0){truncated=true;return '[完整内容见归档]';}
  if(Array.isArray(v)){if(v.length>16)truncated=true;return v.slice(0,16).map(x=>visit(x,depth+1));}
  const result={};for(const [key,value] of Object.entries(v)){if(Object.keys(result).length>=24){truncated=true;break;}result[key]=visit(value,depth+1,key);if(typeof value==='string'&&result[key].length<value.length)result.truncated=true;}
  if(typeof v.text==='string'&&typeof result.text==='string'&&result.text.length<v.text.length&&Number.isInteger(v.offset))result.next=v.offset+result.text.length;
  return result;
 }
 let result=visit(value);
 if(JSON.stringify(result).length>limit)result={preview:JSON.stringify(result).slice(0,limit-300)};
 return {...result,truncated,notice:'当前仅为工具结果预览，完整内容使用 read_execution 的 id 和 offset 回查。'};
}
function receipt(observation){
 const a=observation.action,r=observation.response,result=r.result||r;
 const text=(value,max)=>typeof value==='string'?value.slice(0,max):undefined;
 return {id:observation.observationId,eventId:text(r.eventId,128),action:a.action,path:text(a.path,500),materialId:text(a.id,128),entry:text(a.entry,500),offset:Number.isInteger(a.offset)?a.offset:undefined,purpose:text(a.purpose,200),error:text(r.error,300),exitCode:result.exitCode,timedOut:result.timedOut,next:result.next,revision:result.revision};
}
function recent(observations){return observations.slice(-RECENT_COUNT).map(o=>({...preview(o.response),observationId:o.observationId}));}
function conversation(history){return history.slice(-4).map(m=>({...m,content:m.content?.slice(0,3000),...(m.content?.length>3000?{truncated:true,notice:'完整对话使用 read_history 回查，不能将此预览视为完整要求。'}:{})}));}
module.exports={RECENT_COUNT,preview,receipt,recent,conversation};

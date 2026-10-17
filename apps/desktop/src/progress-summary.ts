// Preview only explicitly labelled facts; the original remains in step details.
export function progressSummary(text:string):{label:string;text:string}[] {
  const markers=Array.from(text.matchAll(/(已完成|正在处理|剩余(?:逐文件)?|待处理|当前进展)[：:]/g));
  const clean=(value:string)=>value
    .replace(/[（(][^()（）]*(?:eventId|obs|event_id)\s*[=:][^()（）]*[）)]/gi,'')
    .replace(/\b(?:eventId|obs|event_id)\s*[=:]\s*[\w-]+/gi,'')
    .replace(/\s+/g,' ').replace(/^[；;，,\s]+|[；;，,\s]+$/g,'').trim();
  const parts=markers.map((match,index)=>({label:match[1]==='已完成'?'已完成':match[1]==='当前进展'?'当前进展':match[1]==='正在处理'?'正在处理':'待处理',text:clean(text.slice(match.index!+match[0].length,markers[index+1]?.index))})).filter(part=>part.text);
  const done=parts.find(part=>part.label==='已完成');
  const current=parts.find(part=>part.label!=='已完成');
  return parts.length?[...(done?[done]:[]),...(current?[current]:[])]:clean(text)?[{label:'进展',text:clean(text)}]:[];
}

export function progressHeadline(text:string,paused=false):string {
  const parts=progressSummary(text);
  const readable=parts.filter(part=>!/(?:[^\s，；（）()]+\.(?:md|py|html|js|cjs|json|docx|xlsx)\b|\d+\s*→\s*\d+|\/(?:[^\s/]+\/)+)/i.test(part.text));
  if(parts.length&&!readable.length)return '详细进展已记录，可展开本步查看。';
  const ordered=[...readable.filter(part=>part.label!=='已完成'),...readable.filter(part=>part.label==='已完成')];
  return ordered.map(part=>`${paused&&part.label==='正在处理'?'暂停前进展':part.label}：${part.text}`).join('；');
}
export function confirmationNotice(needsConfirmation:boolean,stepStatus:string,runStatus:string,isFirstUnfinished:boolean):string {
  if(!needsConfirmation||stepStatus==='done')return '';
  return runStatus==='waiting_user'&&isFirstUnfinished?'需你确认':'执行到此时需你确认';
}

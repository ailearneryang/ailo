// A completed response and a verified task outcome are different facts.
const unresolved=e=>['unknown','running'].includes(e.status)||e.status==='interrupted'&&!e.readOnly;
const label=value=>typeof value==='string'?value.replace(/https?:\/\/\S+/g,'相关地址').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120).replace(/[\\`*_{}\[\]<>#|]/g,''):'';
function pendingOutcomeMessage(run){
 const entries=(run?.actionJournal||[]).filter(unresolved);
 const unknown=run?.taskContinuation?.state==='waiting_result_check'||run?.recoverySummary?.unknown>0||entries.length;
 if(!unknown)return;
 const entry=entries.at(-1);
 // Bind the cause to this operation, never to a timeout elsewhere in history.
 const event=entry?.id?(run.events||[]).findLast(e=>e.detail?.actionId===entry.id):undefined;
 const timedOut=entry?.timedOut||entry?.errorCode==='ETIMEDOUT'||event?.detail?.timedOut||event?.detail?.result?.timedOut;
 const purpose=label(entry?.purpose||event?.detail?.purpose||(entry?.stepId&&(run.steps||[]).find(s=>s.id===entry.stepId)?.title));
 const lines=[purpose?`尚未确认「${purpose}」是否完成。`:'尚未确认这次任务是否完成。',timedOut?'这项操作超时，Ailo 没有收到完整结果。超时本身不能说明操作成功或失败。':'Ailo 没有收到这项操作的完整结果，目前无法判断它是否成功。'];
 const rows=(entry?.resultInspection?.rows||[]).slice(0,3);
 if(rows.length){
  lines.push('已自动检查相关文件：\n'+rows.map(r=>'- '+label(r.path)+'：'+({file:`文件存在（${r.bytes} 字节），内容是否完整尚未确认`,directory:'目录存在，内容是否完整尚未确认',missing:'检查时未找到',unavailable:'无法读取，未能确认'}[r.state]||'未能确认')).join('\n'));
  lines.push('这些检查仍不足以确认任务完成。Ailo 还需要核实操作结果及任务要求，不能把已有文件直接当作成功结果。');
 }else lines.push('Ailo 尚未完成结果核查，暂时不能给出确定结论。');
 if(entries.length>1)lines.push(`另有 ${entries.length-1} 项操作的结果尚未确认。`);
 return lines.join('\n\n');
}
function isInternalPendingReply(text){return typeof text==='string'&&(/^(?:此前操作的结果尚未核对，禁止自动重放|此前相同操作的结果尚未核对，禁止自动重放)/.test(text)||/^任务保留，等待处理后继续。存在结果未知的操作/.test(text));}
module.exports={pendingOutcomeMessage,isInternalPendingReply};

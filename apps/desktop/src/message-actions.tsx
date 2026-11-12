import React,{useEffect,useState,useRef} from 'react';
import type {Message} from './types';
import {Icon} from './icon';
import {AnswerFeedback,type FeedbackDetails} from './answer-feedback';

export function MessageActions({message,taskId,createdAt,onEdit,onBranch,onRegenerate,onImprove,onFeedback,rememberFeedback=true,disabled}:{message:Message;taskId?:string;createdAt?:string;onEdit?:()=>void;onBranch?:()=>void;onRegenerate?:()=>void;onImprove?:()=>void;onFeedback?:(rating:'up'|'down'|null,details?:FeedbackDetails)=>Promise<void>;rememberFeedback?:boolean;disabled:boolean}){
 const [copied,setCopied]=useState(false),[error,setError]=useState('');
 const [sharing,setSharing]=useState(false),[shareBusy,setShareBusy]=useState(false),[shareProvider,setShareProvider]=useState<'gitee'|'github'>('gitee'),[shareError,setShareError]=useState(''),[shareToken,setShareToken]=useState(''),[shareConnected,setShareConnected]=useState(false),[shareUrl,setShareUrl]=useState('');
 const [shareEditing,setShareEditing]=useState(false),[shareLoading,setShareLoading]=useState(false);
 const shareLoad=useRef(0);
 useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),2000);return()=>clearTimeout(timer);},[copied]);
 const [feedbackOpen,setFeedbackOpen]=useState(false);
 const feedbackLock=useRef(false);const [savingFeedback,setSavingFeedback]=useState(false);
 async function rate(rating:'up'|'down'|null,details?:FeedbackDetails,improve=false){if(!onFeedback||feedbackLock.current)return false;feedbackLock.current=true;setSavingFeedback(true);try{await onFeedback(rating,details);setError('');if(improve){setFeedbackOpen(false);onImprove?.();}return true;}catch{setError('评价保存失败，请重试');return false;}finally{feedbackLock.current=false;setSavingFeedback(false);}}
 async function chooseRating(rating:'up'|'down'){setError('');const next=message.feedback?.rating===rating?null:rating;if(await rate(next,next==='up'?{remember:rememberFeedback}:undefined))setFeedbackOpen(next==='down');}
 const usage=message.replyDetails?.usage;
 const actualModels=usage?.models||[];
 const primary=[...actualModels].reverse().find(m=>m.lane==='primary')||actualModels.at(-1);
 const modelNames=[...new Set(actualModels.map(m=>m.name||m.model||'模型未记录'))];
 const modelName=primary?.name||primary?.model||message.modelName||'模型未记录';
 const usageTitle=usage?`输入 ${usage.inputTokens.toLocaleString()} · 输出 ${usage.outputTokens.toLocaleString()} Tokens${usage.reasoningTokens?`（含推理 ${usage.reasoningTokens.toLocaleString()}）`:''}；${usage.reportedRequests}/${usage.requestCount} 次请求返回完整用量`: '服务未返回用量，或历史回答未记录用量';
 const date=createdAt?new Date(createdAt):null;
 const valid=date&&Number.isFinite(date.getTime());
 const parts=valid?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date):[];
 const part=(type:string)=>parts.find(p=>p.type===type)?.value;
 const content=message.content||message.materials?.map(m=>m.name).join('\n')||'';
 async function copy(){try{await navigator.clipboard.writeText(content);setError('');setCopied(true);}catch{setCopied(false);setError('复制失败，请选中文字后复制');}}
 async function loadShare(platform:'gitee'|'github'){if(!taskId)return;const request=++shareLoad.current;setShareProvider(platform);setShareError('');setShareToken('');setShareUrl('');setShareConnected(false);setShareEditing(false);setShareLoading(true);try{const status=await window.ailo.shareStatus({taskId,messageId:message.id,provider:platform});if(request===shareLoad.current){setShareConnected(status.connected);setShareUrl(status.url);}}catch(e){if(request===shareLoad.current)setShareError(e instanceof Error?e.message:'连接状态读取失败');}finally{if(request===shareLoad.current)setShareLoading(false);}}
 async function openShare(){setSharing(true);await loadShare('gitee');}
 async function connectShare(){const status=await window.ailo.shareConnect({provider:shareProvider,token:shareToken});if(!status.connected)throw Error('账号已变更，请重新连接');setShareConnected(true);setShareEditing(false);setShareToken('');}
 async function saveShareConnection(){if(shareBusy)return;setShareBusy(true);setShareError('');try{await connectShare();setShareError('账号已连接，重启 Ailo 后仍可直接分享。');}catch(e){setShareError(e instanceof Error?e.message:'连接失败');}finally{setShareBusy(false);}}
 async function disconnectShare(){if(shareBusy)return;setShareBusy(true);try{await window.ailo.shareDisconnect({provider:shareProvider});setShareConnected(false);setShareEditing(false);setShareToken('');setShareError('已删除本机分享授权，已生成的分享链接仍可访问。');}catch(e){setShareError(e instanceof Error?e.message:'断开失败');}finally{setShareBusy(false);}}
 async function publishShare(){if(!taskId||shareBusy)return;setShareBusy(true);setShareError('');try{if(shareToken.trim())await connectShare();const result=await window.ailo.sharePublish({taskId,messageId:message.id,provider:shareProvider});setShareUrl(result.url);setShareToken('');try{await navigator.clipboard.writeText(result.url);if(result.recorded===false)setShareError('链接已复制，但未能保存到本地记录，请保留链接。');else if(result.authorizationSaved===false)setShareError('链接已复制，但授权未能保存；本次仍可使用，下次启动需重新连接。');}catch{setShareError('链接已生成，请点击“复制链接”或手动复制。');}}catch(e){setShareError(e instanceof Error?e.message:'分享失败，请重试');}finally{setShareBusy(false);}}
 async function copyShare(){try{await navigator.clipboard.writeText(shareUrl);setShareError('链接已复制，可粘贴到微信或其他平台');}catch{setShareError('复制链接失败');}}
 async function openGiteeManual(){try{await navigator.clipboard.writeText(content);await window.ailo.openWeb('https://gitee.com/');setShareError('回答正文已复制。请在 Gitee 网页选择“发布代码片段”，粘贴后取得链接。');}catch{setShareError('打开 Gitee 或复制正文失败，请手动复制回答。');}}
 return <div className="message-actions" data-copy-error={!!error}>
  {valid?<time className="message-date" dateTime={date.toISOString()} title={date.toLocaleString('zh-CN')}>{part('month')}月{part('day')}日 {part('hour')}:{part('minute')}</time>:<span className="message-date" title="此历史消息未记录发送时间">时间未记录</span>}
  <button type="button" title={copied?'已复制':'复制消息'} aria-label={copied?'已复制':'复制消息'} disabled={!content} onClick={()=>void copy()}><Icon name={copied?'check':'copy'}/></button>
  {onFeedback&&(['up','down'] as const).map(rating=><button key={rating} type="button" title={rating==='up'?'有帮助':'没有帮助'} aria-label={rating==='up'?'有帮助':'没有帮助'} aria-pressed={message.feedback?.rating===rating} disabled={savingFeedback} onClick={()=>void chooseRating(rating)}><Icon name={rating==='up'?'thumbs-up':'thumbs-down'}/></button>)}
  {message.role==='assistant'&&taskId&&content&&<button type="button" title="通过链接分享回答" aria-label="分享回答" onClick={()=>void openShare()}><Icon name="share"/></button>}
  {onEdit&&<button type="button" title="编辑消息" aria-label="编辑消息" disabled={disabled} onClick={onEdit}><Icon name="edit"/></button>}
  {onBranch&&<button type="button" title="从此处在当前会话分支" aria-label="从此处在当前会话分支" disabled={disabled} onClick={onBranch}><Icon name="branch"/></button>}
  {onRegenerate&&<button type="button" title="在当前会话重新生成" aria-label="重新生成" disabled={disabled} onClick={onRegenerate}><Icon name="refresh"/></button>}
  {message.role==='assistant'&&<span className="reply-metadata"><span title={usageTitle}>{usage?.reportedRequests?`${usage.reportedRequests===usage.requestCount?'共消耗':'已报告'} ${usage.totalTokens.toLocaleString()} Tokens${usage.reportedRequests<usage.requestCount?'（部分）':''}`:'Token 用量未提供'}</span><span className="reply-model" title={actualModels.length?actualModels.map(m=>`${m.name||m.model||'模型未记录'}${m.model&&m.name!==m.model?' · '+m.model:''}（${m.lane||'primary'}）`).join('\n'):modelName}><Icon name="sparkles"/>{modelName}{modelNames.length>1?` +${modelNames.length-1}`:''}</span></span>}
  {error&&<span className="message-copy-error" role="status">{error}</span>}
  {feedbackOpen&&<AnswerFeedback busy={savingFeedback} onClose={()=>setFeedbackOpen(false)} onSave={(details,improve)=>rate('down',details,improve)} canImprove={!!onImprove&&!disabled}/>}
  {sharing&&<div className="share-backdrop" onClick={()=>!shareBusy&&setSharing(false)}><section className="share-dialog" role="dialog" aria-modal="true" aria-label="分享回答" onClick={event=>event.stopPropagation()}>
   <div className="share-dialog-heading"><h2>分享这条回答</h2><button type="button" aria-label="关闭分享" disabled={shareBusy} onClick={()=>setSharing(false)}><Icon name="close"/></button></div>
   <div className="share-provider" role="group" aria-label="分享平台"><button type="button" className={shareProvider==='gitee'?'selected':''} aria-pressed={shareProvider==='gitee'} disabled={shareBusy} onClick={()=>void loadShare('gitee')}>Gitee（默认）</button><button type="button" className={shareProvider==='github'?'selected':''} aria-pressed={shareProvider==='github'} disabled={shareBusy} onClick={()=>void loadShare('github')}>GitHub</button></div>
   <p>仅分享这条回答的正文和对话标题，不包含其他消息、附件或执行记录。{shareProvider==='gitee'?'Gitee 将创建公开代码片段，任何人都可能发现和查看。':'GitHub 将创建不公开列出的 Gist；知道链接的人可以查看。'}</p>
   <pre className="share-preview">{content.slice(0,3000)}{content.length>3000?'\n…预览仅显示前 3000 字，发布时包含完整正文。':''}</pre>
   {shareLoading?<p role="status">正在检查连接…</p>:<>
    {shareConnected&&!shareEditing&&<div className="share-connection"><span><Icon name="check"/>{shareProvider==='gitee'?'Gitee':'GitHub'} 已连接</span><button type="button" disabled={shareBusy} onClick={()=>{setShareEditing(true);setShareError('');}}>更换授权</button><button type="button" disabled={shareBusy} onClick={()=>void disconnectShare()}>断开</button></div>}
    {((!shareConnected&&!shareUrl)||shareEditing)&&<div className="share-authorization"><label>{shareEditing?'更换分享授权':'首次连接账号（只需一次）'}<input type="password" autoComplete="off" disabled={shareBusy} value={shareToken} onChange={event=>setShareToken(event.target.value)} placeholder={`粘贴具有代码片段权限的 ${shareProvider==='gitee'?'Gitee':'GitHub'} Token`}/></label><p>授权加密保存在本机，以后分享及重启都无需重新填写。</p><div className="share-dialog-actions"><button type="button" disabled={shareBusy} onClick={()=>void window.ailo.openWeb(shareProvider==='gitee'?'https://gitee.com/profile/personal_access_tokens':'https://github.com/settings/tokens/new?scopes=gist&description=Ailo%20Share')}>获取授权</button>{(shareUrl||shareEditing)&&<button type="button" disabled={shareBusy||!shareToken.trim()} onClick={()=>void saveShareConnection()}>{shareBusy?'正在连接…':'连接并保存'}</button>}{shareEditing&&<button type="button" disabled={shareBusy} onClick={()=>{setShareEditing(false);setShareToken('');}}>取消</button>}</div></div>}
    {shareUrl?<><label>分享链接<input readOnly value={shareUrl} onFocus={event=>event.target.select()}/></label><div className="share-dialog-actions"><button type="button" onClick={()=>void copyShare()}>复制链接</button><button type="button" onClick={()=>void window.ailo.openWeb(shareUrl)}>在浏览器打开</button></div></>:<div className="share-dialog-actions"><button className="primary" type="button" disabled={shareBusy||((!shareConnected||shareEditing)&&!shareToken.trim())} onClick={()=>void publishShare()}>{shareBusy?'正在生成链接…':(!shareConnected||shareEditing)?'连接并分享':'生成链接并复制'}</button></div>}
   </>}
   {shareError&&<p className="share-dialog-feedback" role="status">{shareError}</p>}
   {shareError&&shareProvider==='gitee'&&!shareUrl&&<div className="share-dialog-actions"><button type="button" onClick={()=>void openGiteeManual()}>复制正文并打开 Gitee</button><button type="button" onClick={()=>void loadShare('github')}>改用 GitHub</button></div>}
  </section></div>}
 </div>;
}

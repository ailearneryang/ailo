import {deliveryForMessage} from './delivery-artifacts';
import {FileActionsMenu} from './file-actions-menu';
import React,{useEffect,useRef,useState} from 'react';
import type {AgentRun,ArtifactPreview,Task} from './types';
import {ArtifactViewer} from './artifact-viewer';
import {Icon} from './icon';
import {ArtifactPreviewDialog} from './artifact-preview-dialog';
import './delivery-result.css';
import {deliveryStatus} from './delivery-status';
import {groupArtifacts} from '../artifact-presentation.cjs';
type PreviewTarget={path:string;label?:string;sha256:string;candidateId?:string;origin:'candidate'|'current'};
export function deliveryPreviewTarget(run:AgentRun):PreviewTarget|undefined{
 const selected=run.delivery?.selectedCandidate;
 if(selected){const groups=groupArtifacts(selected.artifacts,{request:run.goal}),file=groups.featured||groups.primary[0]||selected.artifacts[0];return file?{...file,origin:'candidate',candidateId:selected.candidateId}:undefined;}
 if(run.resultPreview&&!run.resultPreview.available)return;
 if(run.resultPreview?.available)return {path:run.resultPreview.path,label:'运行效果截图',sha256:run.resultPreview.sha256,origin:'current'};
 const groups=groupArtifacts(run.delivery?.availableArtifacts||run.artifacts,{request:run.goal,changedPaths:(run.delivery?.changes||run.resultChanges)?.changedArtifacts});return groups.featured?{...groups.featured,origin:'current'}:undefined;
}
function hasOutcomeReply(task:Task,run:AgentRun){
 const messages=task.messages||[],trigger=run.currentInputId||run.progressInputId,index=messages.findIndex(m=>m.role==='user'&&m.id===trigger);
 if(index>=0){const next=messages.findIndex((m,i)=>i>index&&m.role==='user');return messages.slice(index+1,next<0?messages.length:next).some(m=>m.role==='assistant');}
 return messages.at(-1)?.role==='assistant'&&messages.at(-1)?.replyDetails?.status===run.status;
}
export function showStandaloneResult(task:Task,running:boolean){
 const run=task.agentRun;
 if(running||!run||run.currentIntent==='chat')return false;
 if(!run.artifacts.length&&!run.delivery?.availableArtifacts?.length&&!run.resultPreview?.available&&!run.delivery?.selectedCandidate&&hasOutcomeReply(task,run))return false;
 const stoppedTask=(run.currentIntent==='task'||run.mode==='task')&&['partial','paused','blocked','failed','waiting_permission','waiting_user'].includes(run.status);
 if(!stoppedTask&&!run.resultPreview&&!groupArtifacts(run.artifacts,{request:run.goal}).primary.length)return false;
 return !(task.messages||[]).some(m=>m.role==='assistant'&&deliveryForMessage(task,task.messages||[],m.id)===run);
}
export function resultStopReason(run:AgentRun):string|undefined{
 if(run.delivery?.outcome==='complete')return;
 if(run.delivery?.stopReason)return run.delivery.stopReason;
 if(run.taskContinuation?.state==='waiting_result_check'||(run.recoverySummary?.unknown||0)>0)return '有操作结果尚未确认，已暂停后续执行，避免重复操作。';
 if(run.status==='waiting_permission')return '任务正在等待授权，尚未完成。';
 if(run.status==='waiting_user')return '任务需要补充信息，尚未完成。';
 if(run.status==='paused')return '任务已暂停，尚未完成。';
 if(run.taskContinuation?.state==='waiting_service'||/^MODEL_/.test(run.waitingError?.code||''))return '模型服务暂未提供可用结果，原任务和记录已保留。';
 if(run.delivery?.reasonCode==='REPAIR_VALUE_EXHAUSTED')return '本轮调整未完成最终复验，任务尚未完成。';
 if(['blocked','failed','partial'].includes(run.status))return '本轮未能完成全部要求，原任务和记录已保留。';
}
export async function loadDeliveryPreview(taskId:string,target:PreviewTarget){
 const preview=target.candidateId?await window.ailo.previewCandidate(taskId,target.candidateId,target.path):await window.ailo.preview(taskId,target.path);
 if(preview.version!==target.sha256)throw Error(target.candidateId?'保留版本预览与已选择的文件版本不一致':'文件版本与预览记录不一致，请刷新后查看；未用其他版本替代。');
 return preview;
}
export function DeliveryResult({task,run,onOpen,live=false}:{task:Task;run:AgentRun;onOpen:(path?:string)=>void;live?:boolean}){
 const [historyOpen,setHistoryOpen]=useState(false);
 const historical=!live&&run!==task.agentRun;
 const [all,setAll]=useState(false),[preview,setPreview]=useState<ArtifactPreview>(),[previewIdentity,setPreviewIdentity]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[visible,setVisible]=useState(false);
 const [opened,setOpened]=useState<{path:string;label:string;candidateId?:string;expectedVersion?:string}>();
 const root=useRef<HTMLElement>(null);
 const status=live?{tone:'pending',icon:'◌',label:'当前效果 · 正在调整',description:'执行仍在继续，当前预览不代表最终完成或验收通过。'}:deliveryStatus(run);
 const badge=<span className={`delivery-outcome delivery-outcome-${status.tone}`} title={status.description}><span aria-hidden="true">{status.icon}</span>{status.label}</span>;
 const previewFile=run.resultPreview?.available?{path:run.resultPreview.path,label:'运行效果截图（待核验）',size:run.resultPreview.size,sha256:run.resultPreview.sha256}:undefined;
 const files=[...(live?run.artifacts:run.delivery?.availableArtifacts||run.artifacts),...(previewFile?[previewFile]:[])].filter((file,index,list)=>list.findIndex(f=>f.path===file.path)===index&&!(run.resultPreview?.available===false&&file.path===run.resultPreview.path));
 const groups=groupArtifacts(files,{request:task.messages?.filter(m=>m.role==='user').at(-1)?.content||run.goal||task.request,changedPaths:(run.delivery?.changes||run.resultChanges)?.changedArtifacts? [...(run.delivery?.changes||run.resultChanges)!.changedArtifacts,...(run.resultPreview?.changedSinceInput?[run.resultPreview.path]:[])]:undefined});
 const selected=run.delivery?.selectedCandidate,featured=deliveryPreviewTarget(run);
 const targetIdentity=featured?`${featured.candidateId||'current'}\0${featured.path}\0${featured.sha256}`:'';
 const shownPreview=previewIdentity===targetIdentity?preview:undefined;
 const pairedApk=run.resultPreview?.available&&run.resultPreview.apk&&run.resultPreview.apkAvailable!==false?files.find(f=>f.path===run.resultPreview!.apk!.path&&f.sha256===run.resultPreview!.apk!.sha256):undefined;
 const protection=run.candidateProtection,savedSnapshot=protection?.best||protection?.previous?.at(-1),currentProtection=task.agentRun?.candidateProtection;
 const retainedIds=new Set([currentProtection?.best,currentProtection?.latest,...(currentProtection?.previous||[])].filter(Boolean).map(s=>s!.id));
 const snapshot=savedSnapshot&&(!historical||retainedIds.has(savedSnapshot.id))?savedSnapshot:undefined;
 const snapshotFiles=snapshot?groupArtifacts(snapshot.files,{request:run.goal}):undefined,snapshotFile=snapshotFiles?.featured||snapshotFiles?.primary[0]||snapshot?.files[0];
 useEffect(()=>{
  if(!root.current||historical&&!historyOpen)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});
  observer.observe(root.current);return()=>observer.disconnect();
 },[historical,historyOpen]);
 useEffect(()=>{
  let cancelled=false;setPreview(undefined);setError('');setLoading(false);
  if(!visible||!featured||historical&&!historyOpen)return;
  setLoading(true);
  loadDeliveryPreview(task.id,featured).then(value=>{if(!cancelled){setPreview(value);setPreviewIdentity(targetIdentity);}}).catch(()=>{if(!cancelled)setError(featured.candidateId?'保留版本暂时无法预览，可尝试查看快照文件；当前工作区未被替换。':'暂时无法预览，可在文件夹中查看原文件。');}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[task.id,featured?.path,featured?.sha256,featured?.candidateId,visible,historical,historyOpen]);
 async function reveal(){try{await window.ailo.reveal(task.id);}catch{setError('无法打开文件夹，请稍后重试。');}}
 const effect=run.resultPreview;
 const effectNote=effect?.available===false?'最近的运行截图已缺失或与记录不一致，暂不作为效果预览。':effect?.available?(effect.changedSinceInput?'本轮截图已更新，效果仍以实际核验为准。':effect.capturedThisInput?'本轮截图与此前版本一致，尚无新的效果变化。':'本轮暂无新预览，以下展示此前取得的效果。'):groups.retained?'本轮暂无新的可展示成果，已有文件可继续查看。':undefined;
 const stopReason=!live?resultStopReason(run):undefined;
 const nextAction=!live?(run.delivery?.nextAction||run.taskContinuation?.question):undefined;
 if(!groups.primary.length&&!snapshotFile&&!selected&&!groups.development.length){const hasReply=hasOutcomeReply(task,run);if(hasReply||!stopReason&&!nextAction)return null;return <div className="compact-state-note" role="status">{stopReason&&<p>{stopReason}</p>}{nextAction&&nextAction!==stopReason&&<p>{nextAction}</p>}</div>;}
 if(!groups.primary.length&&!snapshotFile&&!selected)return <div className="delivery-result" aria-label="任务结果">{!live&&run.delivery?.outcome==='partial'&&!run.delivery.findings?.length?<span className="delivery-outcome delivery-outcome-incomplete">尚未完成</span>:badge}<p className="delivery-result-note">本轮尚未形成可展示的成果。</p>{stopReason&&<p className="delivery-result-note">{stopReason}</p>}{nextAction&&<p className="delivery-result-note">{nextAction}</p>}{!!groups.development.length&&<details className="delivery-development"><summary>开发文件（{groups.development.length}）</summary><p className="delivery-result-note">已有源码和配置已保留，不代表已生成可用版本。</p><button className="delivery-show-more" onClick={()=>onOpen()}>查看开发文件</button></details>}</div>;
 const currentFiles=<><ul className="delivery-result-files">{(all?groups.shown:groups.shown.slice(0,3)).map(file=><li key={file.path}><button className="delivery-file-link" title={file.path} onClick={()=>/\.apk$/i.test(file.path)?void window.ailo.reveal(task.id,file.path).catch(()=>setError('无法打开安装包所在文件夹。')):setOpened({path:file.path,expectedVersion:file.sha256,label:file.label||file.path.split('/').at(-1)||file.path})}><Icon name="file"/><span>{file.label||file.path.split('/').at(-1)}</span><small>{file.path.split('/').at(-1)}</small><span aria-hidden="true">↗</span></button></li>)}</ul>{groups.shown.length>3&&<button className="delivery-show-more" aria-expanded={all} onClick={()=>setAll(v=>!v)}>{all?'收起文件列表':`查看其余 ${groups.shown.length-3} 项成果`}</button>}{!!groups.development.length&&<details className="delivery-development"><summary>开发文件（{groups.development.length}）</summary><p className="delivery-result-note">源码和中间文件保留在项目中，可按需查看。</p><button className="delivery-show-more" onClick={()=>onOpen()}>查看开发文件</button></details>}</>;
 const content=<section ref={root} className="delivery-result" aria-label="交付产物">
  <div className="delivery-result-heading"><strong>{live?'当前成果':selected?'保留版本（待复验）':groups.shown.length?(groups.retained?'已有成果':'本轮成果'):'开发文件'} <small>{selected?selected.artifacts.length:groups.shown.length||groups.development.length}</small>{badge}</strong><FileActionsMenu className="delivery-more"><button onClick={()=>onOpen()}>查看全部文件</button><button onClick={()=>void reveal()}><Icon name="folder"/>在文件夹中查看</button></FileActionsMenu></div>
  {effectNote&&!selected&&<p className="delivery-result-note">{effectNote}</p>}
  {selected&&<div className="delivery-selected-candidate" data-preview-origin="candidate" data-candidate-id={selected.candidateId}><p className="delivery-result-note">优先展示已保留的较好历史成果。此版本待重新核验，未完成要求继续保留，不计本轮完成。</p>{featured&&<button className="delivery-show-more" onClick={()=>setOpened({path:featured.path,expectedVersion:featured.sha256,label:featured.label||featured.path,candidateId:selected.candidateId})}>预览保留版本 ↗</button>}{featured&&<button className="delivery-show-more" onClick={()=>void window.ailo.revealCandidate(task.id,selected.candidateId,featured.path).catch(()=>setError('该保留版本暂时无法打开。'))}>查看保留文件</button>}{!!selected.optionalUnverifiedIds?.length&&<p className="delivery-result-note">另有 {selected.optionalUnverifiedIds.length} 项可选优化尚未核验。</p>}</div>}
  {selected&&effect?.available&&effect.path!==featured?.path&&<div className="delivery-result-note"><p>本轮另有运行截图，尚未完成验收；与保留版本分别展示。</p><button className="delivery-show-more" onClick={()=>setOpened({path:effect.path,label:'本轮运行效果（待核验）',expectedVersion:effect.sha256})}>查看本轮最新效果 ↗</button></div>}
  {!stopReason&&!effect&&run.delivery?.outcome==='partial'&&<p className="delivery-result-note">已有文件可查看，未完成及未核验项见本轮说明。</p>}
  {run.delivery?.outcome==='limited'&&!!run.completionReview?.unverified.length&&<p className="delivery-result-note">{run.delivery?.visualReviewPending?'任务已完成，视觉效果待人工确认。':'已交付，部分要求待人工确认。'}详见本轮交付说明。</p>}
  {featured&&!selected&&!shownPreview&&<button className="delivery-show-more" onClick={()=>setOpened({path:featured.path,expectedVersion:featured.sha256,label:featured.label||featured.path})}>查看当前效果 ↗</button>}
  {loading&&<p role="status" className="delivery-result-note">正在加载产物预览…</p>}
  {shownPreview&&featured&&<div className={'delivery-result-preview delivery-preview-'+shownPreview.kind}>
   <div className="delivery-preview-heading"><span>{featured.label||featured.path.split('/').at(-1)}{featured.candidateId?' · 保留版本（待复验）':''}</span><button onClick={()=>setOpened({path:featured.path,expectedVersion:featured.sha256,label:featured.label||featured.path,candidateId:featured.candidateId})}>完整预览 <span aria-hidden="true">↗</span></button>{!featured.candidateId&&/\.html?$/i.test(featured.path)&&<button onClick={()=>void window.ailo.openArtifact(task.id,featured.path).catch(()=>setError('无法打开浏览器，请尝试完整预览。'))}>在浏览器中打开</button>}</div>
   <div className="delivery-preview-content">{shownPreview.kind==='image'&&<button className="delivery-image-open" aria-label="查看大图" onClick={()=>setOpened({path:featured.path,expectedVersion:featured.sha256,label:featured.label||featured.path,candidateId:featured.candidateId})}/>}<ArtifactViewer key={(featured.candidateId||'current')+featured.path+shownPreview.version} preview={shownPreview} path={featured.path} taskId={task.id} readOnly onChanged={()=>{}} onRequest={()=>{}}/></div>
   {shownPreview.truncated&&<p className="delivery-result-note">当前为部分内容，完整文件可在文件夹中查看。</p>}
  </div>}
  {!selected&&pairedApk&&<button className="delivery-show-more" onClick={()=>void window.ailo.reveal(task.id,pairedApk.path).catch(()=>setError('无法打开安装包所在文件夹。'))}>查看截图对应安装包 ↗</button>}
  {stopReason&&<p className="delivery-result-note">{stopReason}</p>}
  {nextAction&&<p className="delivery-result-note">{nextAction}</p>}
  {effect?.available&&!selected&&<details className="delivery-development"><summary>预览版本与说明</summary><p className="delivery-result-note">截图时间：{new Date(effect.capturedAt).toLocaleString()}{effect.apk?' · 运行版本 '+effect.apk.sha256.slice(0,12):''}。{effect.sourceStatus==='changed'?'截图后的变更尚未重新核对，当前预览不代表全部最新修改。':effect.sourceStatus==='unknown'?'预览对应所示运行版本，当前源码一致性尚未确认。':''}{effect.apk&&effect.apkAvailable===false?'当前安装包与截图版本不同，不能把两者当作同一版本。':''}</p></details>}
  {selected?<><ul className="delivery-result-files">{selected.artifacts.slice(0,3).map(file=><li key={file.path}><button className="delivery-file-link" title={file.path} onClick={()=>setOpened({path:file.path,expectedVersion:file.sha256,label:file.label||file.path,candidateId:selected.candidateId})}><Icon name="file"/><span>{file.label||file.path.split('/').at(-1)}</span><small>保留版本 · 待复验</small><span aria-hidden="true">↗</span></button></li>)}</ul>{selected.artifacts.length>3&&featured&&<button className="delivery-show-more" onClick={()=>void window.ailo.revealCandidate(task.id,selected.candidateId,featured.path).catch(()=>setError('该保留版本暂时无法打开。'))}>查看全部 {selected.artifacts.length} 项保留文件</button>}{!!files.length&&<details className="delivery-development"><summary>当前工作区文件（待核验）</summary>{currentFiles}</details>}</>:currentFiles}
  {snapshot&&snapshotFile&&<details className="delivery-development"><summary>已保留的核验快照</summary><p className="delivery-result-note">保留时 {snapshot.passedIds.length}/{snapshot.totalRequirements} 项要求通过、{snapshot.resolvedIds.length} 项问题解决。这是历史版本，不代表当前任务通过。</p>{protection?.lastAttempt?.comparison==='regressed'&&<p className="delivery-result-note">本轮核验覆盖有回退，原快照仍保留。</p>}{protection?.lastAttempt?.comparison==='incomparable'&&<p className="delivery-result-note">本轮新增差异尚未核清，保留版本未被替换。</p>}{protection?.lastAttempt?.status==='unavailable'&&<p className="delivery-result-note">本轮快照未能保存，已有保留版本仍可查看。</p>}{snapshot.resourceCoverage?.complete===false&&<p className="delivery-result-note">部分引用资源未保留，预览可能不完整。</p>}<button className="delivery-show-more" onClick={()=>setOpened({path:snapshotFile.path,expectedVersion:snapshotFile.sha256,label:snapshotFile.label||snapshotFile.path,candidateId:snapshot.id})}>查看保留版本</button><button className="delivery-show-more" onClick={()=>void window.ailo.revealCandidate(task.id,snapshot.id,snapshotFile.path).catch(()=>setError('该快照暂时无法打开。'))}>查看快照文件</button></details>}
  {opened&&<ArtifactPreviewDialog taskId={task.id} path={opened.path} label={opened.label} candidateId={opened.candidateId} expectedVersion={opened.expectedVersion} onClose={()=>setOpened(undefined)} onDetails={()=>{onOpen(opened.path);setOpened(undefined);}}/>}
  {error&&<p role="status" className="delivery-result-note">{error}</p>}
 </section>;
 return historical?<details className="delivery-history" open={historyOpen} onToggle={e=>setHistoryOpen(e.currentTarget.open)}><summary>此前成果 · {status.label} · {groups.primary.length||groups.development.length} 项</summary>{historyOpen&&content}</details>:content;
}

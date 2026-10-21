import React,{useEffect,useRef,useState} from 'react';
import type {AgentRun,ArtifactPreview,Task} from './types';
import {ArtifactViewer} from './artifact-viewer';
import {Icon} from './icon';
import './delivery-result.css';
export function DeliveryResult({task,run,onOpen}:{task:Task;run:AgentRun;onOpen:(path?:string)=>void}){
 const [all,setAll]=useState(false),[preview,setPreview]=useState<ArtifactPreview>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[visible,setVisible]=useState(false);
 const root=useRef<HTMLElement>(null);
 const files=run.artifacts.filter((file,index,list)=>list.findIndex(f=>f.path===file.path)===index);
 const featured=files.find(f=>/\.(png|jpe?g|webp|svg)$/i.test(f.path))||files.find(f=>/\.html?$/i.test(f.path))||files.find(f=>/\.pdf$/i.test(f.path))||files[0];
 useEffect(()=>{
  if(!root.current)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});
  observer.observe(root.current);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  let cancelled=false;setPreview(undefined);setError('');
  if(!visible||!featured)return;
  setLoading(true);
  window.ailo.preview(task.id,featured.path).then(value=>{if(!cancelled)setPreview(value);}).catch(()=>{if(!cancelled)setError('暂时无法预览，可在文件夹中查看原文件。');}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[task.id,featured?.path,featured?.sha256,visible]);
 async function reveal(){try{await window.ailo.reveal(task.id);}catch{setError('无法打开文件夹，请稍后重试。');}}
 if(!files.length)return null;
 return <section ref={root} className="delivery-result" aria-label="交付产物">
  <div className="delivery-result-heading"><strong>交付产物 <small>{files.length}</small></strong><button onClick={()=>void reveal()}><Icon name="folder"/>在文件夹中查看</button></div>
  <ul className="delivery-result-files">{(all?files:files.slice(0,5)).map(file=><li key={file.path}><button className="delivery-file-link" title={file.path} onClick={()=>onOpen(file.path)}><Icon name="file"/><span>{file.label||file.path.split('/').at(-1)}</span><small>{file.path.split('/').at(-1)}</small><span aria-hidden="true">↗</span></button></li>)}</ul>
  {files.length>5&&<button className="delivery-show-more" aria-expanded={all} onClick={()=>setAll(v=>!v)}>{all?'收起文件列表':`查看全部 ${files.length} 个产物`}</button>}
  {run.delivery?.outcome==='limited'&&!!run.completionReview?.unverified.length&&<p className="delivery-result-note">{run.delivery?.visualReviewPending?'任务已完成，视觉效果待人工确认。':'已交付，部分要求待人工确认。'}详见本轮交付说明。</p>}
  {loading&&<p role="status" className="delivery-result-note">正在加载产物预览…</p>}
  {preview&&featured&&<div className={'delivery-result-preview delivery-preview-'+preview.kind}>
   <div className="delivery-preview-heading"><span>{featured.label||featured.path.split('/').at(-1)}</span><button onClick={()=>onOpen(featured.path)}>打开完整预览 <span aria-hidden="true">↗</span></button></div>
   <div className="delivery-preview-content"><ArtifactViewer key={featured.path+preview.version} preview={preview} path={featured.path} taskId={task.id} readOnly onChanged={()=>{}} onRequest={()=>{}}/></div>
   {preview.version!==featured.sha256&&<p className="delivery-result-note">文件在交付后有更新，这里显示当前版本。</p>}
   {preview.truncated&&<p className="delivery-result-note">当前为部分内容，完整文件可在文件夹中查看。</p>}
  </div>}
  {error&&<p role="status" className="delivery-result-note">{error}</p>}
 </section>;
}

import {FileActionsMenu} from './file-actions-menu';
import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArtifactViewer} from './artifact-viewer';
import type {ArtifactPreview} from './types';
export function checkedPreview(preview:ArtifactPreview,expectedVersion?:string){if(expectedVersion&&preview.version!==expectedVersion)throw Error('预览文件版本不一致，请刷新后查看；未用其他版本替代。');return preview;}
export function ArtifactPreviewDialog({taskId,path,label,candidateId,expectedVersion,onClose,onDetails}:{taskId:string;path:string;label:string;candidateId?:string;expectedVersion?:string;onClose:()=>void;onDetails:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [preview,setPreview]=useState<ArtifactPreview>(),[error,setError]=useState(''),[zoom,setZoom]=useState(100);
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 useEffect(()=>{let active=true;setPreview(undefined);setError('');setZoom(100);(candidateId?window.ailo.previewCandidate(taskId,candidateId,path):window.ailo.preview(taskId,path)).then(p=>{checkedPreview(p,expectedVersion);if(active)setPreview(p);}).catch(error=>{if(active)setError(error.message?.includes('版本不一致')?error.message:candidateId?'此保留文件暂时无法预览，可在快照文件夹查看。':'暂时无法预览，请尝试用默认应用打开。');});return()=>{active=false;};},[taskId,path,candidateId,expectedVersion]);
 async function reveal(){try{if(candidateId)await window.ailo.revealCandidate(taskId,candidateId,path);else await window.ailo.reveal(taskId,path);}catch{setError('无法打开文件夹。');}}
 async function open(){try{await window.ailo.openArtifact(taskId,path);}catch{setError('无法打开文件，可从更多菜单在文件夹中查看。');}}
 return createPortal(<dialog ref={dialog} className="artifact-full-preview" aria-label={label+'完整预览'} onClose={onClose} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.current?.close();}}}>
  <div className="artifact-full-toolbar"><strong title={path}>{label}</strong>{candidateId?<><span>保留版本 · 只读</span><button onClick={()=>void reveal()}>查看快照文件</button></>:<><button onClick={()=>void open()}>{/\.html?$/i.test(path)?'在浏览器中打开':'用默认应用打开'}</button><button onClick={onDetails}>查看详情</button><FileActionsMenu label="更多文件操作"><button onClick={()=>void reveal()}>在文件夹中查看</button></FileActionsMenu></>}<button aria-label="关闭完整预览" onClick={()=>dialog.current?.close()}>×</button></div>
  {preview?.kind==='image'&&<div className="artifact-image-zoom"><button aria-label="缩小图片" disabled={zoom<=25} onClick={()=>setZoom(v=>v-25)}>−</button><span>{zoom}%</span><button aria-label="放大图片" disabled={zoom>=300} onClick={()=>setZoom(v=>v+25)}>＋</button><button onClick={()=>setZoom(100)}>适合窗口</button></div>}
  <div className="artifact-full-content">{candidateId&&<p>这是当时保留的核验快照，不代表当前版本已通过验收。</p>}{!preview&&!error&&<p role="status">正在加载预览…</p>}{error&&<p role="alert">{error}</p>}{preview&&(preview.kind==='image'?<img className="artifact-full-image" alt={label} src={preview.content} style={{width:zoom+'%',maxWidth:'none'}}/>:<ArtifactViewer key={path+preview.version} preview={preview} path={path} taskId={taskId} readOnly onChanged={()=>{}} onRequest={()=>{}}/>)}{preview?.truncated&&<p>{candidateId?'当前预览显示部分内容，完整文件保留在快照文件夹。':'当前预览显示部分内容，可用默认应用打开完整文件。'}</p>}</div>
 </dialog>,document.body);
}

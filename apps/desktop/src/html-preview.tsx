import React,{useEffect,useState} from 'react';
import type {ArtifactPreview} from './types';

export function HtmlPreview({preview,path}:{preview:ArtifactPreview;path:string}){
 const [failed,setFailed]=useState(0);
 useEffect(()=>{
  setFailed(0);let stopped=false;const images:HTMLImageElement[]=[];let failures=0;
  // Validate embedded images in the trusted renderer; keep the iframe script-free.
  const template=document.createElement('template');template.innerHTML=preview.content;
  const sources=new Set(Array.from(template.content.querySelectorAll('img')).map(i=>i.getAttribute('src')).filter((s):s is string=>!!s&&/^data:/i.test(s)));
  for(const src of sources){const image=new Image();images.push(image);image.onerror=()=>{if(!stopped)setFailed(++failures);};image.src=src;}
  return()=>{stopped=true;images.forEach(i=>{i.onerror=null;i.src='';});};
 },[preview.content]);
 const info=preview.htmlResources,issues=info?.issues||[];
 return <>
  {(issues.length>0||failed>0)&&<div className="html-preview-notice" role="status"><strong>预览有资源未能加载，不能据此判断文件为空。</strong><p>请使用“在文件夹中查看”核对完整效果。{failed>0&&` ${failed} 个图片资源未能显示。`}</p>{issues.length>0&&<details><summary>查看资源加载详情</summary><ul>{issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></details>}</div>}
  {!!info?.scriptsBlocked&&<p className="html-preview-notice">此为静态预览，文件中的脚本未运行，动态内容和交互可能不完整。可在文件夹中打开原文件查看。</p>}
  <iframe title={path} sandbox="" referrerPolicy="no-referrer" srcDoc={'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; base-uri \'none\'; form-action \'none\';">'+preview.content} style={{width:'100%',minHeight:420,border:0}}/>
 </>;
}

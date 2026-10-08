import React,{useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Only render Markdown elements; provider HTML and remote images stay disabled.
export function AssistantText({content}:{content:string}){
 const [error,setError]=useState('');
 return <><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
  table:({children})=><div className="assistant-table-scroll" role="region" aria-label="回复表格"><table>{children}</table></div>,
  a:({href,children})=>{
   let url:URL;try{url=new URL(href||'');}catch{return <>{children}</>;}
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return <>{children}</>;
   return <a href={url.href} onClick={e=>{e.preventDefault();void window.ailo.openWeb(url.href).catch(()=>setError('无法打开链接，请稍后重试。'));}}>{children}</a>;
  },
  img:({alt})=>alt?<span className="assistant-image-description">{alt}</span>:null,
 }}>{content}</ReactMarkdown>{error&&<span role="alert">{error}</span>}</>;
}

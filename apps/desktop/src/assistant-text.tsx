import React,{useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {documentHtml,replyHtml} from '../reply-html.cjs';
import {HtmlPreview} from './html-preview';
function ReplyHtml({html}:{html:string}){
 const [source,setSource]=useState(false);
 return <section aria-label="网页成果"><div><strong>网页成果</strong> · <button onClick={()=>setSource(v=>!v)}>{source?'查看预览':'查看源码'}</button> · <a download="Ailo-output.html" href={'data:text/html;charset=utf-8,'+encodeURIComponent(html)}>下载 HTML</a></div>{source?<pre><code>{html}</code></pre>:<HtmlPreview path="回复网页预览" preview={{kind:'html',content:html,version:'reply',htmlResources:{loaded:0,scriptsBlocked:1,issues:[]}}}/>}</section>;
}

// Only render Markdown elements; provider HTML and remote images stay disabled.
// Memoized so that streaming updates of one message do not re-parse the others.
export const AssistantText=React.memo(function AssistantText({content}:{content:string}){
 const [error,setError]=useState('');
 const raw=replyHtml(content);
 if(raw.length===1&&raw[0]===content.trim())return <ReplyHtml html={raw[0]}/>;
 return <><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
  pre:({children})=>{const child=React.Children.toArray(children)[0];const text=React.isValidElement<{children?:React.ReactNode}>(child)?String(child.props.children||''):'';const html=documentHtml(text);return html?<ReplyHtml html={html}/>:<pre>{children}</pre>;},
  table:({children})=><div className="assistant-table-scroll" role="region" aria-label="回复表格"><table>{children}</table></div>,
  a:({href,children})=>{
   let url:URL;try{url=new URL(href||'');}catch{return <>{children}</>;}
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return <>{children}</>;
   return <a href={url.href} onClick={e=>{e.preventDefault();void window.ailo.openWeb(url.href).catch(()=>setError('无法打开链接，请稍后重试。'));}}>{children}</a>;
  },
  img:({alt})=>alt?<span className="assistant-image-description">{alt}</span>:null,
 }}>{content}</ReactMarkdown>{error&&<span role="alert">{error}</span>}</>;
});

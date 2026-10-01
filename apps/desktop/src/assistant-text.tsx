import React,{useState} from 'react';
// Render links as React text nodes; never interpret provider HTML.
export function AssistantText({content}:{content:string}){
 const [error,setError]=useState('');const parts:React.ReactNode[]=[];const pattern=/\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+)\)/g;let offset=0;
 for(const match of content.matchAll(pattern)){const index=match.index!;let url;try{url=new URL(match[2]);}catch{continue;}if(url.username||url.password)continue;parts.push(content.slice(offset,index));parts.push(<a key={index} href={url.href} onClick={e=>{e.preventDefault();void window.ailo.openWeb(e.currentTarget.href).catch(()=>setError('无法打开链接，请稍后重试。'));}}>{match[1]}</a>);offset=index+match[0].length;}
 parts.push(content.slice(offset));return <>{parts}{error&&<span role="alert">{error}</span>}</>;
}

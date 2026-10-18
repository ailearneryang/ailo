import {useEffect,useMemo,useRef,useState} from 'react';
import {Icon} from './icon';
import {searchConversations} from './conversation-search';
import type {Task,Project} from './types';
import './conversation-search.css';
function Highlight({text,query}:{text:string;query:string}){
 const terms=query.trim().split(/\s+/u).filter(Boolean).map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 if(!terms.length)return <>{text}</>;
 const regex=new RegExp('('+terms.join('|')+')','giu');return <>{text.split(regex).map((part,i)=>i%2?<mark key={i}>{part}</mark>:part)}</>;
}
export function ConversationSearch({tasks,projects,onOpen,onClose}:{tasks:Task[];projects:Project[];onOpen:(taskId:string,messageId?:string)=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
 const [query,setQuery]=useState(''),[active,setActive]=useState(0),[limit,setLimit]=useState(50);
 const results=useMemo(()=>searchConversations(tasks,query),[tasks,query]),visible=results.slice(0,limit);const selected=Math.min(active,Math.max(0,visible.length-1));
 useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.showModal();input.current?.focus();return()=>{dialog.current?.close();if(previous?.isConnected)previous.focus();};},[]);
 useEffect(()=>{dialog.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});},[selected]);
 function open(index:number){const hit=visible[index];if(hit){onClose();onOpen(hit.taskId,hit.messageId);}}
 return <dialog ref={dialog} className="conversation-search" aria-label="搜索对话" onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.preventDefault();e.stopPropagation();onClose();}}} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
 <div className="conversation-search-input"><Icon name="search"/><input ref={input} type="search" role="combobox" aria-label="搜索对话标题和内容" aria-autocomplete="list" aria-expanded="true" aria-controls="conversation-search-results" aria-activedescendant={visible.length?'search-hit-'+selected:undefined} placeholder="搜索对话标题和内容…" maxLength={200} value={query} onChange={e=>{setQuery(e.target.value);setActive(0);setLimit(50);}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,Math.min(visible.length-1,i+(e.key==='ArrowDown'?1:-1))));}if(e.key==='Enter'){e.preventDefault();open(selected);}}}/><button type="button" aria-label="关闭搜索" onClick={onClose}><Icon name="close"/></button></div>
 <div className="conversation-search-summary" role="status">{query.trim()?`找到 ${results.length} 个对话`:'最近的对话'}<span>仅搜索本地聊天记录</span></div>
 <div className="conversation-search-results" id="conversation-search-results" role="listbox" aria-label="对话搜索结果">{visible.map((hit,index)=><button type="button" role="option" aria-selected={index===selected} id={'search-hit-'+index} key={hit.taskId} onFocus={()=>setActive(index)} onClick={()=>open(index)}><Icon name="chat"/><div><strong><Highlight text={hit.title} query={query}/></strong><p><Highlight text={hit.snippet} query={query}/></p><small>{hit.taskId==='my-ailo-assistant'?'我的 Ailo':projects.find(p=>p.id===hit.projectId)?.name||'未归类'}{tasks.find(t=>t.id===hit.taskId)?.archived?' · 已归档':''} · {new Date(hit.created).toLocaleDateString('zh-CN')}</small></div><Icon name="chevron-right"/></button>)}</div>
 {!results.length&&<div className="conversation-search-empty"><Icon name="search"/><p>{query.trim()?'没有找到相关对话':'还没有对话记录'}</p><small>{query.trim()?'试试更短的关键词，或对话中出现过的内容。':'开始聊天后，可以在这里快速找回。'}</small></div>}
 {results.length>limit&&<button type="button" className="conversation-search-more" onClick={()=>setLimit(v=>v+50)}>显示更多（还有 {results.length-limit} 个）</button>}
 <footer><span>↑ ↓ 选择 · Enter 打开</span><span>Esc 关闭</span></footer>
 </dialog>;
}

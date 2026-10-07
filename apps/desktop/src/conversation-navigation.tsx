import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Message} from './types';

export function ConversationNavigation({messages,conversationId}:{messages:Message[];conversationId:string}){
 const rail=useRef<HTMLSpanElement>(null);
 const [active,setActive]=useState('');
 const [position,setPosition]=useState<{left:number;top:number;height:number}|null>(null);
 const [preview,setPreview]=useState<{index:number;left:number;top:number}|null>(null);
 const plain=(text:string)=>text.replace(/!?(\[([^\]]*)\])\([^)]*\)/g,'$2').replace(/[#*_`>]/g,'').replace(/\s+/g,' ').trim();
 function show(index:number,element:HTMLElement){
  const bounds=element.getBoundingClientRect();
  const width=Math.min(340,window.innerWidth-24);
  setPreview({index,left:Math.max(12,Math.min(bounds.left+40,window.innerWidth-width-12)),top:Math.max(12,Math.min(bounds.top-60,window.innerHeight-200))});
 }
 const turns=messages.filter(message=>message.role==='user');
 const turnIds=turns.map(message=>message.id).join('\n');
 useEffect(()=>{
  const viewport=rail.current?.parentElement;
  if(!viewport)return;
  let frame=0;
  const update=()=>{setPreview(null);cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   const bounds=viewport.getBoundingClientRect();
   const conversation=viewport.closest('.conversation')?.getBoundingClientRect();
   const height=Math.min(240,bounds.height*.5);
   setPosition({left:(conversation?.left??bounds.left)+12,top:bounds.top+bounds.height/2,height});
   const top=bounds.top+60;
   const anchors=[...viewport.querySelectorAll<HTMLElement>('[data-conversation-turn]')];
   let current=anchors[0];
   for(const anchor of anchors){if(anchor.getBoundingClientRect().top<=top)current=anchor;else break;}
   setActive(current?.dataset.conversationTurn||'');
  });};
  const observer=new ResizeObserver(update);observer.observe(viewport);
  const conversation=viewport.closest('.conversation');if(conversation)observer.observe(conversation);
  window.addEventListener('resize',update);
  viewport.addEventListener('scroll',update,{passive:true});update();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();viewport.removeEventListener('scroll',update);window.removeEventListener('resize',update);};
 },[conversationId,turnIds]);
 if(turns.length<3)return null;
 function jump(id:string){
  const viewport=rail.current?.parentElement;if(!viewport)return;
  const target=[...viewport.querySelectorAll<HTMLElement>('[data-conversation-turn]')].find(element=>element.dataset.conversationTurn===id);
  if(!target)return;
  viewport.scrollTo({top:viewport.scrollTop+target.getBoundingClientRect().top-viewport.getBoundingClientRect().top-16,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 }
 const selected=preview?turns[preview.index]:undefined;
 const selectedIndex=selected?messages.findIndex(message=>message.id===selected.id):-1;
 const following=selectedIndex>=0?messages.slice(selectedIndex+1):[];
 const nextUser=following.findIndex(message=>message.role==='user');
 const answer=following.slice(0,nextUser<0?following.length:nextUser).filter(message=>message.role==='assistant').map(message=>plain(message.content)).join(' ');
 return <><span ref={rail} className="conversation-navigation-anchor" aria-hidden="true"/>{position&&createPortal(<nav style={{left:position.left,top:position.top}} className="conversation-navigation" aria-label="对话快速导航" onMouseLeave={()=>setPreview(null)} onKeyDown={event=>{if(event.key==='Escape')setPreview(null);}}><div className="conversation-navigation-marks" style={{maxHeight:position.height}}>{turns.map((turn,index)=>{
  const text=plain(turn.content).slice(0,100)||'附件消息';
  const distance=preview?Math.abs(index-preview.index):Infinity;
  const width=distance<=4?[26,20,14,10,7][distance]:active===turn.id?9:6;
  return <button style={{height:Math.max(4,Math.min(10,position.height/turns.length)),minHeight:Math.max(4,Math.min(10,position.height/turns.length))}} key={turn.id} className={(active===turn.id?'current ':'')+(distance===0?'hovered':'')} aria-current={active===turn.id?'location':undefined} aria-label={`跳到第 ${index+1} 轮：${text}`} onMouseEnter={event=>show(index,event.currentTarget)} onFocus={event=>show(index,event.currentTarget)} onBlur={()=>setPreview(null)} onClick={()=>{setPreview(null);jump(turn.id);}}><span className="conversation-navigation-line" style={{width}}/></button>;
 })}</div></nav>,document.body)}{preview&&selected&&createPortal(<div className="conversation-navigation-preview" style={{left:preview.left,top:preview.top}} aria-hidden="true"><strong>{plain(selected.content)||'附件消息'}</strong><p>{answer||'这一轮还没有回复。'}</p></div>,document.body)}</>;
}

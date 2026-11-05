import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

// Outside the scrollable content: showing this control never changes its height.
export function ChatScrollButton(){
 const anchor=useRef<HTMLSpanElement>(null);
 const [position,setPosition]=useState<{left:number;top:number}|null>(null);
 useEffect(()=>{
  const viewport=anchor.current?.parentElement;if(!viewport)return;
  const update=()=>{const rect=viewport.getBoundingClientRect();setPosition(viewport.scrollHeight-viewport.clientHeight-viewport.scrollTop>48?{left:rect.left+rect.width/2,top:rect.bottom-44}:null);};
  const observer=new ResizeObserver(update);observer.observe(viewport);
  const content=viewport.querySelector('.thread-content');if(content)observer.observe(content);
  viewport.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);update();
  return()=>{observer.disconnect();viewport.removeEventListener('scroll',update);window.removeEventListener('resize',update);};
 },[]);
 return <><span ref={anchor} aria-hidden="true"/>{position&&createPortal(<button className="chat-latest" style={position} onClick={()=>anchor.current?.parentElement?.dispatchEvent(new Event('ailo-follow-latest'))}>↓ 回到最新</button>,document.body)}</>;
}

import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {WaveDots} from './wave-dots';
import {Icon} from './icon';

// Outside the scrollable content: showing this control never changes its height.
export function ChatScrollButton({running=false,status='任务正在执行'}:{running?:boolean;status?:string}){
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
 return <><span ref={anchor} aria-hidden="true"/>{position&&createPortal(<button className={'chat-latest'+(running?' chat-latest-running':'')} style={position} aria-label={running?`${status}，点击查看最新问题及回复`:'回到最新问题开头'} title={running?`${status} · 点击查看最新问题及回复`:'回到最新问题开头'} onClick={()=>anchor.current?.parentElement?.dispatchEvent(new Event('ailo-latest-question'))}>{running?<WaveDots/>:<Icon name="arrow-down"/>}</button>,document.body)}</>;
}

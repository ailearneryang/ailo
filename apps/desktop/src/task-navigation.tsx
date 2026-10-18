import {taskPresentation,type LiveSession} from './task-presentation';
import {ConversationActions} from './conversation-management';
import {useRef,useState,useContext,useEffect,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {Task} from './types';
import {Icon} from './icon';
import {petResultToken} from './pet-state';

export function TaskNavigation({task,selected,busy,running=false,session,onSelect,onPin,children}:{task:Task;selected:boolean;busy:boolean;running?:boolean;session?:LiveSession;onSelect:()=>void;onPin:()=>Promise<void>;children?:ReactNode}) {
 const current=taskPresentation(task,session);
 const onAction=useContext(ConversationActions);
 const resultToken=!running && !['running','understanding'].includes(task.agentRun?.status||'') ? petResultToken(task) : undefined;
 const unread=!!resultToken && resultToken!==task.petReadToken;
 const menu=useRef<HTMLDialogElement>(null);
 const titleViewport=useRef<HTMLSpanElement>(null);
 const titleText=useRef<HTMLSpanElement>(null);
 const titleAnimation=useRef<Animation|null>(null);
 const [revealing,setRevealing]=useState(false);
 const stopTitle=()=>{titleAnimation.current?.cancel();titleAnimation.current=null;setRevealing(false);};
 const revealTitle=()=>{
  if(titleAnimation.current)return;
  const viewport=titleViewport.current,text=titleText.current;
  if(!viewport||!text)return;
  const distance=text.scrollWidth-viewport.clientWidth;
  if(distance<=1)return;
  setRevealing(true);
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
   titleAnimation.current=text.animate([{transform:`translateX(${-distance}px)`}],{duration:0,fill:'forwards'});
  }else{
   titleAnimation.current=text.animate([{transform:'translateX(0)'},{transform:`translateX(${-distance}px)`}],{delay:650,duration:Math.max(1200,distance/45*1000),easing:'linear',fill:'forwards'});
  }
 };
 useEffect(()=>{stopTitle();return ()=>titleAnimation.current?.cancel();},[task.title]);
 const [position,setPosition]=useState({top:0,left:0});
 return <div className={'task-nav-row'+(selected?' selected':'')} onMouseEnter={revealTitle} onMouseLeave={stopTitle} onFocusCapture={revealTitle} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))stopTitle();}}>
  <button className={'task-nav-name'+(task.scheduledTaskId?' scheduled-recent':'')} aria-current={selected?'page':undefined} disabled={busy} title={task.title} onClick={onSelect}><span ref={titleViewport} className={'task-nav-title'+(revealing?' revealing':'')}><span ref={titleText}>{task.title}</span></span>{current.state!=='idle'&&<small className="session-status" data-task-state={current.state}>{current.label}</small>}{children}</button>
  {unread&&<span className="task-unread-dot" role="img" aria-label="有未查看的结果" title="有未查看的结果"/>}
  <button className="task-nav-menu" disabled={busy} aria-label={`${task.title} 对话操作`} aria-haspopup="dialog" onClick={e=>{const b=e.currentTarget.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(b.right+8,window.innerWidth-260)),top:Math.max(8,Math.min(b.top,window.innerHeight-350))});menu.current?.showModal();}}><Icon name="more"/></button>
  {createPortal(<dialog ref={menu} className="project-menu-dialog" style={position} aria-label={`${task.title} 对话操作`} onClick={e=>{if(e.target===e.currentTarget){const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)e.currentTarget.close();}}}>
   <strong>{task.title}</strong><button disabled={busy} onClick={()=>{menu.current?.close();void onPin();}}><Icon name="pin"/><span>{task.pinned?'取消置顶':'置顶对话'}</span></button>
   {([['rename','edit','重命名'],['move','folder','移动到项目'],['archive','archive','归档对话'],['delete','trash','删除对话']] as const).map(([action,icon,label])=><button key={action} disabled={busy||running||action==='move'&&!!task.scheduledTaskId} onClick={()=>{menu.current?.close();onAction(task.id,action);}}><Icon name={icon}/><span>{label}</span></button>)}
   <button onClick={()=>{menu.current?.close();onAction(task.id,'export');}}><Icon name="file"/><span>导出 Markdown</span></button>
  </dialog>,document.body)}
 </div>;
}

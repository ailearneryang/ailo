import {useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {Task} from './types';
import {Icon} from './icon';
import {petResultToken} from './pet-state';

export function TaskNavigation({task,selected,busy,running=false,onSelect,onPin,children}:{task:Task;selected:boolean;busy:boolean;running?:boolean;onSelect:()=>void;onPin:()=>Promise<void>;children?:ReactNode}) {
 const resultToken=!running && !['running','understanding'].includes(task.agentRun?.status||'') ? petResultToken(task) : undefined;
 const unread=!!resultToken && resultToken!==task.petReadToken;
 const menu=useRef<HTMLDialogElement>(null);
 const [position,setPosition]=useState({top:0,left:0});
 return <div className={'task-nav-row'+(selected?' selected':'')}>
  <button className={'task-nav-name'+(task.scheduledTaskId?' scheduled-recent':'')} aria-current={selected?'page':undefined} disabled={busy} title={task.title} onClick={onSelect}><span>{task.title}</span>{children}</button>
  {unread&&<span className="task-unread-dot" role="img" aria-label="有未查看的结果" title="有未查看的结果"/>}
  <button className="task-nav-menu" disabled={busy} aria-label={`${task.title} 对话操作`} aria-haspopup="dialog" onClick={e=>{const b=e.currentTarget.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(b.right+8,window.innerWidth-260)),top:Math.max(8,Math.min(b.top,window.innerHeight-120))});menu.current?.showModal();}}><Icon name="more"/></button>
  {createPortal(<dialog ref={menu} className="project-menu-dialog" style={position} aria-label={`${task.title} 对话操作`} onClick={e=>{if(e.target===e.currentTarget){const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)e.currentTarget.close();}}}>
   <strong>{task.title}</strong><button disabled={busy} onClick={()=>{menu.current?.close();void onPin();}}><Icon name="pin"/><span>{task.pinned?'取消置顶':'置顶对话'}</span></button>
  </dialog>,document.body)}
 </div>;
}

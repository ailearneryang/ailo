import React,{useEffect,useRef,useState} from 'react';
import type {TaskNotification} from './experience-types';
import {Icon} from './icon';
export function TaskNotificationToast({onOpen}:{onOpen:(taskId:string)=>void}){
 const [item,setItem]=useState<TaskNotification>(),seen=useRef(new Set<string>());
 useEffect(()=>window.ailo.onTaskNotification(value=>{if(!value?.id||seen.current.has(value.id))return;seen.current.add(value.id);if(seen.current.size>300)seen.current.delete(seen.current.values().next().value!);setItem(value);}),[]);
 useEffect(()=>{if(!item)return;const timer=setTimeout(()=>setItem(undefined),8000);return()=>clearTimeout(timer);},[item?.id]);
 if(!item)return null;
 return <aside className="task-notification-toast" aria-label="任务提醒"><div role="status"><Icon name={item.kind==='attention'?'info':item.kind==='completed'?'check':'file'}/><span><strong>{item.message||'任务有新进展'}</strong><small>{item.title}</small></span></div><button className="task-notification-open" onClick={()=>{void window.ailo.notificationsUpdate({action:'read',id:item.id}).catch(()=>{});onOpen(item.taskId);setItem(undefined);}}>查看任务</button><button className="task-notification-dismiss" aria-label="关闭任务提醒" onClick={()=>setItem(undefined)}><Icon name="close"/></button></aside>;
}

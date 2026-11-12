import React,{useEffect,useRef,useState} from 'react';
import type {TaskNotification} from './experience-types';
import {Icon} from './icon';
export function TaskNotificationToast({onOpen}:{onOpen:(taskId:string)=>void}){
 const [item,setItem]=useState<TaskNotification>(),seen=useRef(new Set<string>());
 useEffect(()=>window.ailo.onTaskNotification(value=>{if(!value?.id||seen.current.has(value.id))return;seen.current.add(value.id);if(seen.current.size>300)seen.current.delete(seen.current.values().next().value!);setItem(value);}),[]);
 useEffect(()=>{if(!item)return;const timer=setTimeout(()=>setItem(undefined),8000);return()=>clearTimeout(timer);},[item?.id]);
 if(!item)return null;
 const date=new Date(item.at),seconds=item.durationMs===undefined?undefined:Math.round(item.durationMs/1000);
 const elapsed=seconds===undefined?'':seconds>=60?`${Math.floor(seconds/60)}分${seconds%60}秒`:`${seconds}秒`;
 return <aside className="task-notification-toast" aria-label="任务提醒"><div role="status"><img className="task-notification-brand" src="./ailo.png" alt="Ailo"/><span><strong>Ailo · {item.message||'任务有新进展'}</strong><small className="task-notification-subject" title={item.subject||item.title}>{item.subject||item.title}</small>{item.preview&&<p className="task-notification-preview">{item.preview}</p>}<span className="task-notification-meta">{Number.isFinite(date.getTime())&&<time dateTime={item.at}>{date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}</time>}{item.modelName&&<span>{item.modelName}</span>}{elapsed&&<span>用时 {elapsed}</span>}</span></span></div><button className="task-notification-open" onClick={()=>{void window.ailo.notificationsUpdate({action:'read',id:item.id}).catch(()=>{});onOpen(item.taskId);setItem(undefined);}}>查看回复</button><button className="task-notification-dismiss" aria-label="关闭任务提醒" onClick={()=>setItem(undefined)}><Icon name="close"/></button></aside>;
}

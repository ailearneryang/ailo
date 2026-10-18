import {useState} from 'react';
import {Icon} from './icon';
import {pendingAttention} from './pending-attention';
import type {Workspace} from './types';
export function PendingAttentionPanel({data,runningIds,onOpen}:{data:Workspace;runningIds:string[];onOpen:(id:string)=>void}){
 const [expanded,setExpanded]=useState(false);
 const items=pendingAttention(data.tasks,runningIds),visible=expanded?items:items.slice(0,2);
 if(!items.length)return null;
 return <section className="pending-attention" aria-labelledby="pending-attention-title">
  <div className="pending-attention-heading"><h2 id="pending-attention-title">待你处理 <span>{items.length}</span></h2><p>补充信息或处理问题，让事情继续往前。</p></div>
  <div className="pending-attention-list">{visible.map(({task,kind,label,action,description})=><button key={task.id} className="pending-attention-item" onClick={()=>onOpen(task.id)} aria-label={`${action}：${task.title}`}>
   <span className={`pending-attention-icon ${kind}`}><Icon name={kind==='permission'?'lock':kind==='reply'?'chat':'info'}/></span>
   <span className="pending-attention-content"><span className="pending-attention-title"><strong>{task.title}</strong><span>{label}</span></span><span className="pending-attention-description">{description}</span><span className="pending-attention-source">{task.scheduledTaskId?'定时任务':'任务'}{task.projectId?` · ${data.projects.find(p=>p.id===task.projectId)?.name||'项目'}`:''}</span></span>
   <span className="pending-attention-action">{action}<Icon name="chevron-right"/></span>
  </button>)}</div>
  {items.length>2&&<button className="pending-attention-more" onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded}>{expanded?'收起':`查看其余 ${items.length-2} 项`}<Icon name={expanded?'chevron':'chevron-right'}/></button>}
 </section>;
}

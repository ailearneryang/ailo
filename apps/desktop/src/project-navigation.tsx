import {useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Project,Extension,Task} from './types';
import {Icon} from './icon';
import {TaskNavigation} from './task-navigation';
export function ProjectNavigation({project,expanded,selected,tasks,active,runningIds,extensions,busy,onExpand,onOpen,onNew,onSelect,onPin,onSave,onDelete,onError}:{
 project:Project;expanded:boolean;selected:boolean;tasks:Task[];active:string|null;runningIds:string[];extensions:Extension[];busy:boolean;
 onPin:(task:Task)=>Promise<void>;onExpand:()=>void;onOpen:()=>void;onNew:()=>void;onSelect:(id:string)=>void;onSave:(project:Project)=>Promise<boolean>;onDelete:()=>Promise<void>;onError:(message:string)=>void;
}){
 const menu=useRef<HTMLDialogElement>(null),editor=useRef<HTMLDialogElement>(null);
 const [position,setPosition]=useState({top:0,left:0}),[name,setName]=useState(project.name),[description,setDescription]=useState(project.description||''),[ids,setIds]=useState(project.extensionIds||[]),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const experts=extensions.filter(e=>e.kind==='expert'),skills=extensions.filter(e=>e.kind==='skill');
 function edit(){menu.current?.close();setName(project.name);setDescription(project.description||'');setIds(project.extensionIds||[]);setError('');editor.current?.showModal();}
 async function openFolder(){menu.current?.close();try{await window.ailo.openProjectFolder(project.id);}catch(e){onError((e as Error).message);}}
 return <div>
  <div className="project-nav-row" onClick={event=>{if(event.target===event.currentTarget)onExpand();}}>
   <button className="project-nav-name" aria-label={`${expanded?'收起':'展开'} ${project.name}`} aria-expanded={expanded} aria-controls={'project-threads-'+project.id} title={project.name} onClick={onExpand}><span className="project-folder-icon"><Icon name={expanded?"folder-open":"folder"}/></span><span>{project.name}</span>{project.pinned&&<small aria-label="已置顶"><Icon name="pin"/></small>}</button>
   <div className="project-nav-actions"><button aria-label={`在 ${project.name} 新建对话`} title="新建对话" disabled={busy} onClick={onNew}><Icon name="edit"/></button><button aria-label={`${project.name} 项目操作`} title="项目操作" aria-haspopup="dialog" disabled={busy} onClick={e=>{const box=e.currentTarget.getBoundingClientRect();setPosition({left:Math.min(box.right+8,window.innerWidth-260),top:Math.max(12,Math.min(box.top,window.innerHeight-295))});menu.current?.showModal();}}><Icon name="more"/></button></div>
  </div>
  {expanded&&<div id={'project-threads-'+project.id} className="sidebar-project-threads">{tasks.map(t=><TaskNavigation key={t.id} task={t} busy={busy} selected={active===t.id} onSelect={()=>onSelect(t.id)} onPin={()=>onPin(t)}>{runningIds.includes(t.id)&&<small>执行中</small>}</TaskNavigation>)}<button disabled={busy} onClick={onNew} className="project-new-thread"><Icon name="plus"/><span>新建对话</span></button></div>}
  {createPortal(<><dialog ref={menu} className="project-menu-dialog" style={{top:position.top,left:position.left}} aria-label={`${project.name} 项目操作`} onClick={e=>{if(e.target===e.currentTarget){const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)e.currentTarget.close();}}}>
   <strong>{project.name}</strong><small>{tasks.length} 个对话</small>
   <button aria-current={selected?'page':undefined} onClick={()=>{menu.current?.close();if(!expanded)onExpand();onOpen();}}><Icon name="grid"/><span>查看项目概览</span></button>
   <button onClick={()=>{menu.current?.close();void onSave({...project,pinned:!project.pinned});}}><Icon name="pin"/><span>{project.pinned?'取消置顶':'置顶项目'}</span></button>
   <button onClick={()=>void openFolder()}><Icon name="folder"/><span>打开项目文件夹</span></button>{project.localPath&&<p title={project.localPath}>{project.localPath}</p>}
   <button onClick={edit}><Icon name="edit"/><span>编辑项目</span></button>
   <button className="project-delete" onClick={()=>{menu.current?.close();void onDelete();}}><Icon name="trash"/><span>删除项目</span></button>
  </dialog>
  <dialog ref={editor} className="project-edit-dialog" aria-labelledby={'edit-project-'+project.id}>
   <div className="project-edit-heading"><h2 id={'edit-project-'+project.id}>编辑项目</h2><button aria-label="关闭编辑项目" disabled={saving} onClick={()=>editor.current?.close()}><Icon name="close"/></button></div>
   <form onSubmit={e=>{e.preventDefault();if(!name.trim())return;setSaving(true);setError('');void onSave({...project,name:name.trim(),description:description.trim(),extensionIds:ids}).then(ok=>{if(ok)editor.current?.close();else setError('保存失败，请重试。');}).catch(e=>setError(e.message)).finally(()=>setSaving(false));}}>
    <label>项目名称<input required maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>项目说明<textarea rows={3} maxLength={4000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="项目目标、背景与共同要求"/></label>
    <label>默认专家<select value={ids.find(id=>experts.some(e=>e.id===id))||''} onChange={e=>setIds([...ids.filter(id=>!experts.some(x=>x.id===id)),...(e.target.value?[e.target.value]:[])])}><option value="">不使用默认专家</option>{experts.map(e=><option key={e.id} value={e.id}>{e.name}{!e.enabled?'（已停用）':''}</option>)}</select></label>
    <fieldset><legend>默认技能</legend>{skills.length?skills.map(skill=><label className="project-skill-choice" key={skill.id}><input type="checkbox" checked={ids.includes(skill.id)} disabled={!ids.includes(skill.id)&&ids.filter(id=>skills.some(s=>s.id===id)).length>=5} onChange={e=>setIds(e.target.checked?[...ids,skill.id]:ids.filter(id=>id!==skill.id))}/>{skill.name}{!skill.enabled?'（已停用）':''}</label>):<p className="muted">暂无技能，可在扩展中添加。</p>}</fieldset>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="project-edit-actions"><button type="button" disabled={saving} onClick={()=>editor.current?.close()}>取消</button><button className="primary" disabled={saving||!name.trim()}>保存项目</button></div>
   </form>
  </dialog></>,document.body)}
 </div>;
}

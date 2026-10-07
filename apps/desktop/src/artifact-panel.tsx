import React, {useEffect,useState,useRef} from 'react';
import {ArtifactViewer} from './artifact-viewer';
import type {Task,ArtifactPreview} from './types';
import {Icon} from './icon';
export function ArtifactPanel({task,onClose,onRequest}:{task:Task;onClose:()=>void;onRequest:(text:string)=>void}) {
  const previewElement=useRef<HTMLDivElement>(null);
  const [expanded,setExpanded]=useState(false);
  const [selected,setSelected]=useState<string>();
  useEffect(()=>{if(selected)previewElement.current?.scrollIntoView({block:'start'});},[selected]);
  const [preview,setPreview]=useState<ArtifactPreview>();
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [scope,setScope]=useState<'project'|'delivery'>('project');
  const [files,setFiles]=useState<{path:string;label:string;size:number;sha256:string}[]>([]);
  const [filesLoading,setFilesLoading]=useState(true);
  const [filesError,setFilesError]=useState('');
  const [truncated,setTruncated]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const deliveries=task.agentRun?.artifacts||[];
  useEffect(()=>{
    let cancelled=false;
    window.ailo.projectFiles(task.id).then(result=>{if(!cancelled){setFiles(result.files);setTruncated(result.truncated);setFilesError('');}}).catch(e=>{if(!cancelled)setFilesError(String(e).replace(/^Error: /,''));}).finally(()=>{if(!cancelled)setFilesLoading(false);});
    return ()=>{cancelled=true;};
  },[task.id,task.agentRun?.updatedAt,refresh]);
  const artifacts=scope==='project'?files:deliveries;
  const artifact=artifacts.find(a=>a.path===selected);
  useEffect(()=>{
    let cancelled=false;setPreview(undefined);setError('');setLoading(!!artifact);
    if(artifact)window.ailo.preview(task.id,artifact.path,scope==='project').then(value=>{if(!cancelled)setPreview(value);}).catch(e=>{if(!cancelled)setError(String(e).replace(/^Error: /,''));}).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[task.id,artifact?.path,artifact?.sha256,scope,refresh]);
  async function reveal(path:string){try{await window.ailo.reveal(task.id,path,scope==='project');}catch(e){setError(String(e).replace(/^Error: /,''));}}
  return <aside id="artifact-panel" className={'artifact-panel'+(expanded?' expanded':'')} aria-label="当前任务产物" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
    <div className="artifact-panel-heading"><div><strong>产物</strong><span className="artifact-count">{files.length || deliveries.length}</span></div><div>
      <button title={expanded?'还原产物栏':'展开产物栏'} aria-label={expanded?'还原产物栏':'展开产物栏'} aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)}><Icon name="expand"/></button>
      <button title="收起产物栏" aria-label="收起产物栏" onClick={onClose}><Icon name="panel"/></button>
    </div></div>
    <div className="artifact-panel-body">
      <p className="artifact-task-name" title={task.title}>{task.title}</p>
      <div className="artifact-scopes"><button aria-pressed={scope==='project'} onClick={()=>{setScope('project');setSelected(undefined);}}>项目文件（{files.length}）</button><button aria-pressed={scope==='delivery'} onClick={()=>{setScope('delivery');setSelected(undefined);}}>交付成果（{deliveries.length}）</button><button aria-label="刷新项目文件" onClick={()=>setRefresh(v=>v+1)}>刷新</button></div>
      <button className="artifact-reveal" onClick={()=>void window.ailo.reveal(task.id).catch(e=>setError(String(e)))}><Icon name="folder"/>打开项目文件夹</button>
      {scope==='project'&&<p className="muted artifact-note">当前项目的源代码和文档；文件存在不代表已完成验证。隐藏文件、依赖及构建缓存不在此列。</p>}
      {scope==='project'&&filesLoading&&<p role="status">正在读取项目文件…</p>}
      {scope==='project'&&filesError&&<p className="error" role="alert">{filesError}</p>}
      {scope==='project'&&truncated&&<p className="muted">文件较多，仅显示前 500 项，请打开项目文件夹查看全部。</p>}
      {!artifacts.length?<div className="artifact-empty"><Icon name="folder"/><strong>{scope==='project'?'暂无项目文件':'暂无交付成果'}</strong><p>{scope==='project'?'文件生成后会自动显示，可点击刷新重新检查。':'Agent 尚未登记交付成果；已生成的代码和文档可在项目文件中查看。'}</p></div>:<>
        <div className="artifact-list">{artifacts.map(a=><button className={selected===a.path?'selected':''} aria-pressed={selected===a.path} onClick={()=>setSelected(a.path)} key={a.path}><Icon name="file"/><span><strong>{a.label}</strong><small>{a.path}</small><small>{a.size<1024?`${a.size} B`:a.size<1048576?`${(a.size/1024).toFixed(1)} KB`:`${(a.size/1048576).toFixed(1)} MB`}</small></span></button>)}</div>
        <p className="muted artifact-note">{task.agentRun?.status==='completed'?'当前任务已完成。':'任务进行中，产物可能仍需修改或验证。'}</p>
        {artifact?<div ref={previewElement} className="artifact-preview"><div className="artifact-preview-heading"><strong>{artifact.label}</strong><button aria-label="关闭预览" onClick={()=>setSelected(undefined)}>×</button></div>
          <button className="artifact-reveal" onClick={()=>void reveal(artifact.path)}><Icon name="folder"/>在文件夹中查看</button>
          {loading&&<p role="status">正在加载预览…</p>}
          {preview&&<ArtifactViewer preview={preview} path={artifact.path} taskId={task.id} onChanged={()=>setRefresh(v=>v+1)} onRequest={onRequest}/>}
          {preview?.truncated&&<p className="muted">仅显示部分内容，完整文件可在文件夹中查看。</p>}
        </div>:<p className="artifact-select-hint">选择产物查看内容</p>}
      </>}
      {error&&<p className="error" role="alert">{error}</p>}
    </div>
  </aside>;
}

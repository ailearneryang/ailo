import {dismissedFileMenus,FileActionsMenu} from './file-actions-menu';
import React, {useEffect,useState,useRef} from 'react';
import {ArtifactViewer} from './artifact-viewer';
import type {Task,ArtifactPreview,Material} from './types';
import {Icon} from './icon';
import {useResourcePanelSize} from './resource-panel-size';
import './task-sidebar.css';

type FileEntry={path:string;label:string;size:number;sha256:string};
type Scope='delivery'|'project';
type View='overview'|Scope|'materials';
type Selection={scope:Scope;path:string}|{scope:'material';material:Material};
const viewNames:Record<View,string>={overview:'概览',delivery:'产物',project:'项目文件',materials:'材料'};
const sizeLabel=(size:number)=>size<1024?`${size} B`:size<1048576?`${(size/1024).toFixed(1)} KB`:`${(size/1048576).toFixed(1)} MB`;
function FileBadge({name}:{name:string}) {
  const ext=name.split('.').at(-1)?.toLowerCase()||'';
  const types:Record<string,[string,string]>={md:['MD','text'],markdown:['MD','text'],txt:['TXT','text'],js:['JS','code'],ts:['TS','code'],tsx:['TS','code'],jsx:['JS','code'],py:['PY','python'],html:['H','web'],css:['CSS','web'],json:['{}','code'],zip:['ZIP','archive'],sketch:['S','design'],pdf:['PDF','pdf'],docx:['DOC','document'],xlsx:['XLS','sheet'],pptx:['PPT','slides'],png:['IMG','image'],jpg:['IMG','image'],jpeg:['IMG','image'],svg:['SVG','image']};
  const type=types[ext];
  return <span className={'resource-file-icon '+(type?'resource-'+type[1]:'')} aria-hidden="true">{type?<span>{type[0]}</span>:<Icon name="file"/>}</span>;
}
function ResourceGroup({title,count,empty,children}:{title:string;count:number;empty:string;children:React.ReactNode}) {
  const [open,setOpen]=useState(true);
  return <section className="resource-group"><button className="resource-group-heading" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><span>{title}</span><small>{count}</small><Icon name="chevron-right"/></button>{open&&(count?children:<p className="resource-empty">{empty}</p>)}</section>;
}
function ResourceList<T>({items,render}:{items:T[];render:(item:T,index:number)=>React.ReactNode}) {
  const [all,setAll]=useState(false);
  return <><div className="resource-file-list">{(all?items:items.slice(0,5)).map(render)}</div>{items.length>5&&<button className="resource-more" aria-expanded={all} onClick={()=>setAll(v=>!v)}>{all?'收起':`展开更多（${items.length-5}）`}</button>}</>;
}
export function ArtifactPanel({task,selectionRequest,temporary=false,onDismiss,materials=task.materials,onClose,onRequest,onAttach,attaching=false}:{task:Task;selectionRequest?:{path:string};temporary?:boolean;onDismiss?:()=>void;materials?:Material[];onClose:()=>void;onRequest:(text:string)=>void;onAttach?:()=>void;attaching?:boolean}) {
  const [expanded,setExpanded]=useState(false),[selected,setSelected]=useState<Selection>(),[view,setView]=useState<View>('overview');
  const panel=useRef<HTMLElement>(null),backButton=useRef<HTMLButtonElement>(null),lastResource=useRef<string|undefined>(undefined);
  const [preview,setPreview]=useState<ArtifactPreview>(),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [files,setFiles]=useState<FileEntry[]>([]),[filesLoading,setFilesLoading]=useState(true),[filesError,setFilesError]=useState('');
  const [truncated,setTruncated]=useState(false),[refresh,setRefresh]=useState(0),[materialOffset,setMaterialOffset]=useState(0);
  const deliveries=task.agentRun?.artifacts||[];
  useEffect(()=>{if(selectionRequest){setView('delivery');setSelected({scope:'delivery',path:selectionRequest.path});}},[selectionRequest]);
  const projectFiles=view==='overview'?files.filter(f=>!deliveries.some(a=>a.path===f.path)):files;
  const scope=selected?.scope==='project'?'project':'delivery';
  const artifact=selected&&selected.scope!=='material'?(scope==='project'?files:deliveries).find(a=>a.path===selected.path):undefined;
  const material=selected?.scope==='material'?materials.find(m=>m.name===selected.material.name&&m.size===selected.material.size&&m.sourceId===selected.material.sourceId&&m.text===selected.material.text):undefined;
  const previewing=!!(artifact||material);
  const sizing=useResourcePanelSize(panel,previewing,expanded,()=>setExpanded(false));
  useEffect(()=>{
    let cancelled=false;setFilesLoading(true);
    window.ailo.projectFiles(task.id).then(result=>{if(!cancelled){setFiles(result.files);setTruncated(result.truncated);setFilesError('');}}).catch(e=>{if(!cancelled)setFilesError(String(e).replace(/^Error: /,''));}).finally(()=>{if(!cancelled)setFilesLoading(false);});
    return ()=>{cancelled=true;};
  },[task.id,task.agentRun?.updatedAt,refresh]);
  useEffect(()=>{
    if(previewing)backButton.current?.focus({preventScroll:true});
    else if(lastResource.current){[...panel.current?.querySelectorAll<HTMLButtonElement>('[data-resource]')||[]].find(button=>button.dataset.resource===lastResource.current)?.focus({preventScroll:true});lastResource.current=undefined;}
  },[previewing,artifact?.path,selected?.scope==='material'?selected.material.name:undefined]);
  useEffect(()=>{if(selected&&!previewing&&!filesLoading&&!filesError){setSelected(undefined);setExpanded(false);}},[selected,previewing,filesLoading,filesError]);
  useEffect(()=>{
    let cancelled=false;setPreview(undefined);setError('');setLoading(!!artifact);
    if(artifact)window.ailo.preview(task.id,artifact.path,scope==='project').then(value=>{if(!cancelled)setPreview(value);}).catch(e=>{if(!cancelled)setError(String(e).replace(/^Error: /,''));}).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[task.id,artifact?.path,artifact?.sha256,scope,refresh]);
  useEffect(()=>{
    if(!temporary)return;
    const outside=(event:PointerEvent)=>{
      const target=event.target;
      if(event.button!==0||dismissedFileMenus.has(event)||!(target instanceof Element)||panel.current?.contains(target)||target.closest('dialog,[role="dialog"],[role="menu"],[role="listbox"]'))return;
      if(target.closest('.conversation-stage,.chat-compose'))onDismiss?.();
    };
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[temporary,onDismiss]);
  async function reveal(path?:string){try{await window.ailo.reveal(task.id,path,scope==='project');}catch(e){setError(String(e).replace(/^Error: /,''));}}
  function back(){setSelected(undefined);setError('');setExpanded(false);setMaterialOffset(0);}
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||event.defaultPrevented||event.isComposing)return;
      if([...document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]')].some(element=>!panel.current?.contains(element)&&element.getClientRects().length))return;
      event.preventDefault();if(previewing)back();else onClose();
    };
    document.addEventListener('keydown',escape);
    return ()=>document.removeEventListener('keydown',escape);
  },[previewing,onClose]);
  function selectFile(file:FileEntry,source:Scope){lastResource.current=source+':'+file.path;setSelected({scope:source,path:file.path});}
  function fileRow(file:FileEntry,source:Scope){return <button key={file.path} className="resource-file-row" data-resource={source+':'+file.path} title={`${file.label}\n${file.path}\n${sizeLabel(file.size)}`} aria-label={'查看文件 '+file.path} onClick={()=>selectFile(file,source)}><FileBadge name={file.path}/><span className="resource-file-name">{file.path.split('/').at(-1)}</span><small className="resource-file-size">{sizeLabel(file.size)}</small></button>;}
  function materialRow(item:Material,index:number){return <button key={index} className="resource-file-row" data-resource={'material:'+index} title={item.name+(item.summary?'\n'+item.summary:'')} aria-label={'查看材料 '+item.name} onClick={()=>{lastResource.current='material:'+index;setMaterialOffset(0);setSelected({scope:'material',material:item});}}><FileBadge name={item.name}/><span className="resource-file-name">{item.name}</span><small className="resource-file-size">{sizeLabel(item.size)}</small></button>;}
  return <aside ref={panel} id="artifact-panel" style={sizing.style} className={'artifact-panel resource-sidebar'+(previewing?' previewing':'')+(expanded?' expanded':'')+(sizing.resizing?' resizing':'')} aria-label="任务侧栏">
    {sizing.resizeHandle}
    {sizing.resizing&&<div className="resource-resize-shield" aria-hidden="true"/>}
    <div className="artifact-panel-heading"><div>
      {previewing?<><button ref={backButton} title="返回概览" aria-label="返回概览" onClick={back}><Icon name="chevron-right"/></button><strong title={artifact?.label||material?.name}>{artifact?.label||material?.name}</strong></>:<><span className="resource-view-select"><Icon name="queue"/><select aria-label="选择侧栏视图" value={view} onChange={e=>setView(e.target.value as View)}>{(Object.keys(viewNames) as View[]).map(value=><option key={value} value={value}>{viewNames[value]}</option>)}</select><Icon name="chevron"/></span>{onAttach&&<button title="添加材料到对话" aria-label="添加材料到对话" disabled={attaching} onClick={onAttach}><Icon name="plus"/></button>}</>}
    </div><div>
      <button title={expanded?'还原侧栏宽度':'展开侧栏'} aria-label={expanded?'还原侧栏宽度':'展开侧栏'} aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)}><Icon name="expand"/></button>
      <button title="收起任务侧栏" aria-label="收起任务侧栏" onClick={onClose}><Icon name="panel"/></button>
    </div></div>
    {artifact?<>
      <div className="artifact-preview-toolbar"><span title={artifact.path}>{artifact.path}</span><button onClick={()=>void window.ailo.openArtifact(task.id,artifact.path,scope==='project').catch(()=>setError('无法直接打开此文件，请在文件夹中查看。'))}>{/\.html?$/i.test(artifact.path)?'在浏览器中打开':'用默认应用打开'}</button><FileActionsMenu><button onClick={()=>void reveal(artifact.path)}><Icon name="folder"/>在文件夹中查看</button></FileActionsMenu></div>
      <div className="artifact-panel-body artifact-preview-body" key={scope+':'+artifact.path}>
        {loading&&<p role="status">正在加载预览…</p>}
        {preview&&<ArtifactViewer preview={preview} path={artifact.path} taskId={task.id} onChanged={()=>setRefresh(v=>v+1)} onRequest={onRequest}/>}
        {preview?.truncated&&<p className="muted">仅显示部分内容，完整文件可在文件夹中查看。</p>}
        {error&&<p className="error" role="alert">{error}</p>}
      </div>
    </>:material?<div className="artifact-panel-body artifact-preview-body">
      <p className="resource-material-summary">{material.summary||(material.text!==null?'对话中的文本材料':'原始附件，可在对话中使用。')}</p>
      {material.text!==null&&<><pre>{material.text.slice(materialOffset,materialOffset+12000)}</pre>{material.text.length>12000&&<div className="resource-material-pages"><button disabled={!materialOffset} onClick={()=>setMaterialOffset(v=>Math.max(0,v-12000))}>上一段</button><span>{Math.floor(materialOffset/12000)+1} / {Math.ceil(material.text.length/12000)}</span><button disabled={materialOffset+12000>=material.text.length} onClick={()=>setMaterialOffset(v=>v+12000)}>下一段</button></div>}</>}
    </div>:null}
    <div className="artifact-panel-body resource-overview" hidden={previewing}>
      {(view==='overview'||view==='delivery')&&<ResourceGroup title="产物" count={deliveries.length} empty="已登记的交付成果会显示在这里。"><ResourceList items={deliveries} render={file=>fileRow(file,'delivery')}/></ResourceGroup>}
      {(view==='overview'||view==='project')&&<ResourceGroup title="项目文件" count={projectFiles.length} empty={filesLoading?'正在读取项目文件…':'生成的代码和文档会显示在这里。'}><ResourceList items={projectFiles} render={file=>fileRow(file,'project')}/></ResourceGroup>}
      {(view==='overview'||view==='materials')&&<ResourceGroup title="材料" count={materials.length} empty="尚未添加材料，可点击上方 ＋ 添加。"><ResourceList items={materials} render={materialRow}/></ResourceGroup>}
      {(view==='overview'||view==='project')&&<><div className="resource-folder-actions"><button onClick={()=>void reveal()}><Icon name="folder"/>打开项目文件夹</button><button aria-label="刷新项目文件" title="刷新项目文件" disabled={filesLoading} onClick={()=>setRefresh(v=>v+1)}><Icon name="refresh"/></button></div>{filesError&&<p className="error" role="alert">{filesError}</p>}{truncated&&<p className="muted">仅显示前 500 个项目文件，完整内容可在文件夹中查看。</p>}</>}
      {error&&<p className="error" role="alert">{error}</p>}
    </div>
  </aside>;
}

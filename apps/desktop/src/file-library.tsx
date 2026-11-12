import {useEffect,useRef,useState} from 'react';
import type {Workspace,ArtifactPreview} from './types';
import type {LibraryFile} from './experience-types';
import {Icon} from './icon';
import {ArtifactViewer} from './artifact-viewer';
const formats=[{name:'文档',extensions:['md','markdown','txt','pdf','doc','docx']},{name:'表格',extensions:['csv','tsv','xls','xlsx']},{name:'图片',extensions:['png','jpg','jpeg','webp','gif','svg']},{name:'网页',extensions:['html','htm']},{name:'演示',extensions:['ppt','pptx']}];
const extension=(file:LibraryFile)=>file.path.split('.').at(-1)?.toLowerCase()||'';
const category=(file:LibraryFile)=>formats.find(group=>group.extensions.includes(extension(file)))?.name||'其他';
const date=(value:string)=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleDateString('zh-CN',{month:'short',day:'numeric'}):'日期未知';
const size=(bytes:number)=>bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':bytes>=1024?Math.ceil(bytes/1024)+' KB':bytes+' B';
function RecentFile({file,onSelect}:{file:LibraryFile;onSelect:()=>void}){
 const [preview,setPreview]=useState<ArtifactPreview>(),[unavailable,setUnavailable]=useState(false);
 useEffect(()=>{let live=true;window.ailo.libraryPreview({id:file.id}).then(value=>{if(live)setPreview(value);}).catch(()=>{if(live)setUnavailable(true);});return()=>{live=false;};},[file.id]);
 const text=preview&&['markdown','text'].includes(preview.kind)?preview.content.slice(0,600):'';
 return <button className="result-card" onClick={onSelect} aria-label={'预览 '+file.label}>
  <div className={'result-card-cover result-cover-'+category(file)}>{preview?.kind==='image'?<img src={preview.content} alt="" loading="lazy"/>:preview?.kind==='spreadsheet'?<div className="result-sheet">{preview.sheets?.[0]?.cells.slice(0,12).map(cell=><span key={cell.address}>{cell.text.slice(0,22)}</span>)}</div>:text?<div className="result-document"><small>{category(file).toUpperCase()}</small><p>{text}</p></div>:<div className="result-cover-icon"><Icon name={category(file)==='图片'?'image':category(file)==='网页'?'globe':category(file)==='表格'?'grid':'file'}/><span>{unavailable?'点击查看详情':preview?extension(file).toUpperCase():'正在加载预览…'}</span></div>}<span className="result-format">{extension(file).toUpperCase()||'FILE'}</span></div>
  <div className="result-card-info"><strong title={file.label}>{file.label}</strong><small title={file.taskTitle}>{file.taskTitle}</small><span>{date(file.at)}<span>{size(file.size)} · 查看预览 ↗</span></span></div>
 </button>;
}
export function FileLibrary({workspace,onOpen}:{workspace:Workspace;onOpen:(id:string)=>void}){
 const [items,setItems]=useState<LibraryFile[]>([]),[query,setQuery]=useState(''),[project,setProject]=useState('all'),[kind,setKind]=useState('delivery'),[period,setPeriod]=useState('all'),[sort,setSort]=useState('newest'),[type,setType]=useState('all'),[selected,setSelected]=useState<LibraryFile>(),[preview,setPreview]=useState<ArtifactPreview & {registeredVersionChanged?:boolean}>(),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[loading,setLoading]=useState(true),[loaded,setLoaded]=useState(false),[reload,setReload]=useState(0);
 const [pagination,setPagination]=useState({filter:'',page:1});
 const previewPanel=useRef<HTMLElement>(null),fileList=useRef<HTMLElement>(null),previewId=useRef<string|undefined>(undefined);
 // Workspace polling replaces object identities even when no data changed.
 // Only changed contents should trigger a background library read.
 const workspaceVersion=JSON.stringify(workspace.tasks);
 const initialLoading=loading&&!loaded;
 useEffect(()=>{let live=true;setLoading(true);setLoadError('');window.ailo.libraryFiles().then(v=>{if(live){setItems(v);setLoaded(true);setSelected(current=>{const next=current?v.find(file=>file.id===current.id):undefined;return JSON.stringify(current)===JSON.stringify(next)?current:next;});}}).catch(e=>{if(live)setLoadError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[workspaceVersion,reload]);
 const selectedVersion=selected?JSON.stringify([selected.id,selected.sha256,selected.version,selected.at]):'';
 useEffect(()=>{
  let live=true;
  if(previewId.current!==selected?.id){setPreview(undefined);previewId.current=selected?.id;}
  setError('');
  if(selected)window.ailo.libraryPreview({id:selected.id}).then(v=>{if(live)setPreview(v);}).catch(e=>{if(live)setError(e.message);});
  return()=>{live=false;};
 },[selectedVersion,reload]);
 function select(file:LibraryFile){setSelected(file);requestAnimationFrame(()=>previewPanel.current?.scrollIntoView({behavior:'smooth',block:'nearest'}));}
 // A file's older registered versions are retained in the list, not counted
 // again in the dashboard. Attachments are separate from generated results.
 const latest=new Map<string,LibraryFile>();
 for(const file of [...items].sort((a,b)=>b.at.localeCompare(a.at)||b.version-a.version))if(file.kind==='delivery'&&!latest.has(file.taskId+'\0'+file.path))latest.set(file.taskId+'\0'+file.path,file);
 const results=[...latest.values()],recent=results.slice(0,4),week=results.filter(file=>Date.parse(file.at)>=Date.now()-7*86400000).length;
 const groups=[...formats.map(group=>group.name),'其他'].map(name=>({name,count:results.filter(file=>category(file)===name).length})).filter(group=>group.count>0);
 const filtered=items.filter(f=>(period==='all'||Date.parse(f.at)>=Date.now()-Number(period)*86400000)&&(project==='all'||f.projectId===project||project==='none'&&!f.projectId)&&f.kind===kind&&(type==='all'||extension(f)===type)&&(f.label+' '+f.taskTitle+' '+f.path).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='name'?a.label.localeCompare(b.label):sort==='oldest'?a.at.localeCompare(b.at):b.at.localeCompare(a.at));
 const pageSize=20,filterKey=JSON.stringify([query,project,kind,period,sort,type]);
 const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
 const page=Math.min(totalPages,pagination.filter===filterKey?pagination.page:1);
 const pageStart=(page-1)*pageSize,pageItems=filtered.slice(pageStart,pageStart+pageSize);
 const firstPage=Math.max(1,Math.min(page-2,totalPages-4));
 const pageNumbers=Array.from({length:Math.min(5,totalPages)},(_,index)=>firstPage+index);
 function changePage(next:number){setPagination({filter:filterKey,page:Math.max(1,Math.min(totalPages,next))});fileList.current?.scrollIntoView({behavior:'smooth',block:'start'});}
 return <div className="experience-page file-library results-dashboard">
  <div className="experience-heading results-heading"><div><span className="results-eyebrow">你的创作与交付</span><h1>文件与成果</h1><p className="muted">把每一次完成的工作，沉淀成随时可用的成果。</p></div><button onClick={()=>setReload(value=>value+1)} disabled={loading}><Icon name="refresh"/>{loading?'更新中':'刷新'}</button></div>
  {loadError&&<p className="error" role="alert">{loadError} <button onClick={()=>setReload(value=>value+1)}>重新加载</button></p>}
  <div className="library-tabs" role="tablist" aria-label="文件分类"><button role="tab" aria-selected={kind==='delivery'} onClick={()=>{setKind('delivery');setSelected(undefined);}}>交付成果 <span>{results.length}</span></button><button role="tab" aria-selected={kind==='material'} onClick={()=>{setKind('material');setSelected(undefined);}}>聊天附件 <span>{items.filter(file=>file.kind==='material').length}</span></button></div>
  {kind==='delivery'&&<>
  <section className="results-stats" aria-label="成果统计">{[{label:'累计成果',value:results.length,note:'文件去重，不重复计算历史版本',icon:'folder' as const},{label:'近 7 天更新',value:week,note:'最近更新的成果文件',icon:'clock' as const},{label:'成果来源',value:new Set(results.map(file=>file.taskId)).size,note:'产生成果的对话',icon:'chat' as const},{label:'成果类型',value:groups.length,note:'文档、表格、图片等文件类型',icon:'grid' as const}].map(stat=><div className="results-stat" key={stat.label}><div><span>{stat.label}</span><Icon name={stat.icon}/></div><strong>{!loaded?'—':stat.value}</strong><small>{stat.note}</small></div>)}</section>
  <section className="results-recent" aria-label="最近成果"><div className="results-section-heading"><div><h2>最近成果</h2><p>从最近一次交付，接着往前。</p></div><button onClick={()=>{setKind('delivery');fileList.current?.scrollIntoView({behavior:'smooth'});}}>查看全部 <Icon name="arrow-down"/></button></div>{initialLoading?<div className="results-loading" role="status">正在整理成果…</div>:recent.length?<div className="results-cards">{recent.map(file=><RecentFile key={file.id} file={file} onSelect={()=>select(file)}/>)}</div>:<div className="experience-empty"><Icon name="folder"/><p>你的第一份成果，从下一次任务开始</p><small>让 Ailo 生成一份报告、表格或网页，登记后的交付文件会自动汇集到这里。</small></div>}</section>
  {!!groups.length&&<section className="results-distribution" aria-label="成果类型分布"><strong>成果构成</strong><div className="results-distribution-bar" aria-hidden="true">{groups.map((group,index)=><span key={group.name} style={{flex:group.count,background:`var(--result-color-${index%6})`}}/>)}</div><div className="results-distribution-legend">{groups.map((group,index)=><span key={group.name}><i style={{background:`var(--result-color-${index%6})`}}/>{group.name}<b>{group.count}</b></span>)}</div></section>}
  </>}
  <section ref={fileList} className="results-all" aria-label="所有文件"><div className="results-section-heading"><div><h2>{kind==='material'?'聊天附件':'全部成果'}</h2><p>{kind==='material'?'对话中上传的参考资料，与交付成果分别保存和查看。':'查找交付成果与历史登记版本，追溯每一份文件的来源。'}</p></div><span className="muted">{filtered.length} 条记录</span></div>
  <div className="experience-filters"><input aria-label="搜索文件与成果" placeholder="搜索文件名、来源对话…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="文件所属项目" value={project} onChange={e=>setProject(e.target.value)}><option value="all">所有项目</option><option value="none">未归类</option>{workspace.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><select aria-label="文件时间范围" value={period} onChange={e=>setPeriod(e.target.value)}><option value="all">全部时间</option><option value="7">最近7天</option><option value="30">最近30天</option><option value="365">最近一年</option></select><select aria-label="文件排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">最近更新</option><option value="oldest">最早记录</option><option value="name">文件名称</option></select><select aria-label="文件格式" value={type} onChange={e=>setType(e.target.value)}><option value="all">所有格式</option>{[...new Set(items.map(extension).filter(Boolean))].map(v=><option key={v}>{v}</option>)}</select></div>
  <div className="file-library-layout"><section aria-label="文件列表">{initialLoading?<p role="status">正在读取文件记录…</p>:!filtered.length?<div className="experience-empty"><Icon name="search"/><p>{items.length?'没有匹配的文件':'还没有文件记录'}</p>{!!items.length&&<button onClick={()=>{setQuery('');setProject('all');setPeriod('all');setType('all');}}>清除筛选</button>}</div>:pageItems.map(f=><button className={'library-file'+(selected?.id===f.id?' selected':'')} key={f.id} onClick={()=>select(f)}><span className="library-file-format">{extension(f).toUpperCase().slice(0,5)||'FILE'}</span><span><strong>{f.label}</strong><small>{f.taskTitle} · {f.kind==='delivery'?'成果':'附件'}{f.archived?' · 已归档':''}</small><small>{date(f.at)} · {size(f.size)}{f.kind==='delivery'?` · 登记版本 ${f.version}`:''}</small></span><Icon name="chevron-right"/></button>)}{!initialLoading&&filtered.length>0&&<nav className="library-pagination" aria-label="文件列表分页"><span role="status">第 {pageStart+1}–{Math.min(pageStart+pageSize,filtered.length)} 条，共 {filtered.length} 条</span><div><button disabled={page===1} onClick={()=>changePage(page-1)} aria-label="上一页">上一页</button>{firstPage>1&&<><button onClick={()=>changePage(1)}>1</button>{firstPage>2&&<span>…</span>}</>}{pageNumbers.map(number=><button key={number} aria-label={'第 '+number+' 页'} aria-current={page===number?'page':undefined} onClick={()=>changePage(number)}>{number}</button>)}{firstPage+pageNumbers.length-1<totalPages&&<>{firstPage+pageNumbers.length<totalPages&&<span>…</span>}<button onClick={()=>changePage(totalPages)}>{totalPages}</button></>}<button disabled={page===totalPages} onClick={()=>changePage(page+1)} aria-label="下一页">下一页</button></div></nav>}</section>{selected&&<section ref={previewPanel} className="library-preview" aria-label="文件预览"><div className="experience-heading"><strong>{selected.label}</strong><button aria-label="关闭文件预览" onClick={()=>setSelected(undefined)}><Icon name="close"/></button></div><div className="experience-actions"><button onClick={()=>onOpen(selected.taskId)}>来源对话</button><button onClick={()=>void window.ailo.libraryReveal({id:selected.id}).catch(e=>setError(e.message))}>在文件夹中查看</button></div>{preview?<>{preview.registeredVersionChanged&&<p className="experience-note">文件已在登记后更新，当前显示磁盘上的最新内容。</p>}<ArtifactViewer readOnly preview={preview} path={selected.path} taskId={selected.taskId} onChanged={()=>{}} onRequest={()=>onOpen(selected.taskId)}/></>:!error&&<p role="status">正在加载预览…</p>}{error&&<p className="error" role="alert">{error}</p>}</section>}</div></section>
  <p className="results-footnote">{kind==='material'?'附件来自对话上传的原文件，不计入成果统计。':'成果按文件统计，历史版本不重复计数；包含已归档对话中的成果。'}</p>
 </div>;
}

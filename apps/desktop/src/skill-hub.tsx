import React, { useEffect, useRef, useState } from 'react';
import type { Extension, HubSkill } from './types';
function SkillIcon({skill}:{skill:HubSkill}) {
 const [src,setSrc]=useState('');
 useEffect(()=>{let active=true;setSrc('');if(skill.iconUrl)void window.ailo.skillHubIcon(skill.iconUrl).then(value=>{if(active)setSrc(value);}).catch(()=>{});return()=>{active=false;};},[skill.iconUrl]);
 return <span className="hub-icon" aria-hidden="true">{src?<img src={src} alt="" onError={()=>setSrc('')}/>:<span>{Array.from(skill.name)[0]?.toUpperCase()||'S'}</span>}</span>;
}
const metric=(value:number|null)=>value===null?'—':new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(value);
export function SkillHub({items,busy,onSave,onWorking}:{onWorking:(value:boolean)=>void;items:Extension[];busy:boolean;onSave:(items:Extension[])=>Promise<boolean>}) {
 const [categories,setCategories]=useState<{key:string;name:string}[]>([]),[category,setCategory]=useState(''),[sortBy,setSortBy]=useState('downloads'),[categoryError,setCategoryError]=useState('');
 const [keyword,setKeyword]=useState(''),[page,setPage]=useState(1),[result,setResult]=useState<{total:number;skills:HubSkill[]}>({total:0,skills:[]});
 const [loading,setLoading]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<HubSkill|null>(null),[notice,setNotice]=useState('');
 useEffect(()=>{onWorking(working);return()=>onWorking(false);},[working,onWorking]);
 const sequence=useRef(0),lock=useRef(false);
 async function search(nextPage=1,nextCategory=category,nextSort=sortBy) {
  const id=++sequence.current;setLoading(true);setResult({total:0,skills:[]});setPage(nextPage);setError('');setNotice('');setSelected(null);
  try { const data=await window.ailo.skillHubSearch({keyword,page:nextPage,category:nextCategory,sortBy:nextSort});if(sequence.current===id){setResult(data);setPage(nextPage);} }
  catch(e){if(sequence.current===id)setError(String(e).replace(/^Error: /,''));}
  finally{if(sequence.current===id)setLoading(false);}
 }
 async function loadCategories(){setCategoryError('');try{setCategories(await window.ailo.skillHubCategories());}catch{setCategoryError('分类暂时无法加载');}}
 useEffect(()=>{void loadCategories();void search();return()=>{sequence.current++;};},[]);
 async function detail(slug:string){
  if(lock.current)return;lock.current=true;setWorking(true);setError('');setNotice('');
  try{setSelected(await window.ailo.skillHubDetail(slug));}catch(e){setError(String(e).replace(/^Error: /,''));}finally{lock.current=false;setWorking(false);}
 }
 async function install(){
  if(!selected||lock.current||busy)return;lock.current=true;setWorking(true);setError('');
  try{
   const installed=await window.ailo.skillHubInstall({slug:selected.slug,version:selected.version});
   const old=items.find(i=>i.source?.provider==='skillhub'&&i.source.slug===selected.slug);
   const next=old?items.map(i=>i.id===old.id?{...installed,id:old.id,enabled:old.enabled}:i):[...items,installed];
   if(await onSave(next)){setNotice('已安装“'+installed.name+'”，可在“已安装”中选用。');setSelected(null);}else setError('技能未保存，请重试。');
  }catch(e){setError(String(e).replace(/^Error: /,''));}finally{lock.current=false;setWorking(false);}
 }
 return <section className="skill-hub" aria-label="SkillHub 技能市场">
  <form className="extension-toolbar" onSubmit={e=>{e.preventDefault();void search();}}><input aria-label="搜索 SkillHub" placeholder="搜索 SkillHub 技能，例如：PPT、数据分析…" maxLength={200} value={keyword} disabled={working||busy} onChange={e=>setKeyword(e.target.value)}/><button disabled={loading||working||busy}>{loading?'搜索中…':'搜索'}</button></form>
  <div className="hub-browse-bar"><div className="hub-categories" role="group" aria-label="技能分类">{[{key:'',name:'全部'},...categories].map(c=><button key={c.key} aria-pressed={category===c.key} disabled={working||busy} onClick={()=>{setCategory(c.key);void search(1,c.key,sortBy);}}>{c.name}</button>)}</div><label className="hub-sort">排序<select aria-label="技能排序" value={sortBy} disabled={working||busy} onChange={e=>{setSortBy(e.target.value);void search(1,category,e.target.value);}}><option value="downloads">下载量</option><option value="stars">收藏数</option><option value="score">综合热度</option><option value="updated_at">最近更新</option></select></label></div>
  {categoryError&&<p className="extension-note">{categoryError} <button onClick={()=>void loadCategories()}>重试</button></p>}
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {selected&&<dialog className="hub-detail-backdrop" ref={node=>{if(node&&!node.open)node.showModal();}} onCancel={e=>{if(working)e.preventDefault();else setSelected(null);}} onClick={e=>{if(e.target===e.currentTarget&&!working)setSelected(null);}}><section className="hub-detail" role="dialog" aria-modal="true" aria-label={selected.name} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'&&!working)setSelected(null);}}><div className="hub-detail-heading"><SkillIcon skill={selected}/><h2>{selected.name}</h2><button autoFocus aria-label="关闭技能详情" disabled={working} onClick={()=>setSelected(null)}>×</button></div><p className="hub-detail-meta">作者：{selected.owner||'未提供'} · 版本：{selected.version}</p><p className="hub-detail-description">{selected.description}</p><p className="extension-note">{selected.requiresKey?'需要 API Key。 ':''}{selected.paid?'涉及付费服务。 ':''}安装会保留配套文件，不会自动执行脚本。重新安装会替换本地编辑过的指令。</p><div className="extension-actions"><button className="primary" disabled={working||busy} onClick={()=>void install()}>{working?'安装中…':items.some(i=>i.source?.slug===selected.slug)?'重新安装此版本':'安装此版本'}</button><button disabled={working} onClick={()=>setSelected(null)}>取消</button></div></section></dialog>}
  {loading&&<p className="hub-loading" role="status">正在加载{categories.find(c=>c.key===category)?.name||'全部技能'}…</p>}
  <div className="hub-grid" aria-busy={loading}>{result.skills.map(skill=>{const installed=items.find(i=>i.source?.provider==='skillhub'&&i.source.slug===skill.slug);return <article className="hub-card" key={skill.rowKey}><div className="hub-card-heading"><SkillIcon skill={skill}/><button className="hub-name" title={skill.name} disabled={working||busy||loading} onClick={()=>void detail(skill.slug)}>{skill.name}</button><button className="hub-add" aria-label={'查看并安装 '+skill.name} title={installed?'已安装，查看详情':'查看并安装'} disabled={working||busy||loading} onClick={()=>void detail(skill.slug)}>{installed?'✓':'＋'}</button></div><p className="hub-summary">{skill.description||'暂无用途说明'}</p><div className="hub-card-footer"><span title={skill.downloads===null?'下载量未提供':skill.downloads+' 次下载'}>↓ {metric(skill.downloads)}</span><span title={skill.stars===null?'收藏数未提供':skill.stars+' 次收藏'}>☆ {metric(skill.stars)}</span><span className="hub-card-badge">{installed?'已安装':skill.requiresKey?'需要密钥':skill.paid?'付费服务':categories.find(c=>c.key===skill.category)?.name||''}</span></div></article>;})}</div>
  {!loading&&!error&&!result.skills.length&&<p className="extension-empty">没有找到技能，试试其他关键词。</p>}
  <div className="extension-actions"><button disabled={page<=1||loading||working||busy} onClick={()=>void search(page-1)}>上一页</button><span>第 {page} 页 · 共 {result.total} 个技能</span><button disabled={page*20>=result.total||loading||working||busy} onClick={()=>void search(page+1)}>下一页</button></div>
 </section>;
}

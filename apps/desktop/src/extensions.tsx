import React, { useRef, useState } from 'react';
import { FeishuCliConnection } from './feishu-cli-connection';
import { FeishuConnection } from './feishu-connection';
import type { Material, Extension, ConnectionTarget } from './types';
import './extensions.css';
import { Icon } from './icon';
export function ExtensionCenter({ initialTab='expert', items, busy, onSave, onUse, onMaterial, onImporting, onTryConnection }: { initialTab?:'expert'|'skill'|'connector'; onTryConnection:(text:string,connector:ConnectionTarget)=>void; onImporting:(busy:boolean)=>void; onMaterial:(material:Material)=>void; items: Extension[]; busy: boolean; onSave: (items: Extension[]) => Promise<boolean>; onUse: (item: Extension) => void }) {
  const [tab, setTab] = useState<'expert' | 'skill' | 'connector'>(initialTab);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Extension | null>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  function create() { setError(''); setDraft({ id: crypto.randomUUID(), kind: tab === 'expert' ? 'expert' : 'skill', name: '', description: '', instructions: '', enabled: true }); }
  async function importSkill(f?: File) {
    if (!f || importing) return;
    setError('');
    setImporting(true);
    try {
      if (!/\.(md|zip)$/i.test(f.name)) throw Error('请选择 SKILL.md、Markdown 或 ZIP 技能包。');
      if (f.size > (/\.zip$/i.test(f.name) ? 20 * 1024 * 1024 : 80000)) throw Error(/\.zip$/i.test(f.name) ? '技能 ZIP 不能超过 20 MB。' : 'SKILL.md 不能超过 80 KB。');
      setDraft(await window.ailo.importSkill({name:f.name,buffer:await f.arrayBuffer()}));
    } catch(e) { setError(String(e).replace(/^Error: /,'')); }
    finally { setImporting(false); }
  }
  return <div className="extension-center">
    <div className="extension-heading"><div><span className="eyebrow">让 Ailo 更懂你的工作</span><h1>扩展</h1><p>选择专业角色，复用熟悉的工作方法。</p></div></div>
    <div className="extension-tabs" role="tablist" aria-label="扩展分类">{([['expert','专家'],['skill','技能'],['connector','应用连接']] as const).map(([id,label]) => <button key={id} role="tab" disabled={importing} aria-selected={tab === id} onClick={() => { setTab(id); setDraft(null); setError(''); }}>{label}</button>)}</div>
    {tab === 'connector' ? <FeishuCliConnection onTry={onTryConnection}><details className="feishu-legacy"><summary>高级：使用自建应用凭证导入文档</summary><FeishuConnection busy={busy} onMaterial={onMaterial} onImporting={onImporting} /></details></FeishuCliConnection> : <>
      <div className="extension-toolbar"><input aria-label="搜索扩展" placeholder="搜索名称或用途…" value={query} onChange={e => setQuery(e.target.value)} /><button disabled={busy || importing} onClick={create}>＋ 新建{tab === 'expert' ? '专家' : '技能'}</button>{tab === 'skill' && <><button disabled={busy || importing} onClick={() => file.current?.click()}>{importing ? '正在导入…' : '导入技能'}</button><input ref={file} type="file" accept=".md,.zip" hidden onChange={e => { void importSkill(e.target.files?.[0]); e.target.value = ''; }} /></>}</div>
      {tab === 'skill' && <p className="extension-note">支持 SKILL.md、Markdown 和含 SKILL.md 的 ZIP 技能包。导入后可检查和编辑指令；选用技能时，按需读取包内引用文档、模板和脚本。</p>}
      {draft && <form className="extension-editor" onSubmit={async e => { e.preventDefault(); if (busy || importing) return; const next = items.some(i => i.id === draft.id) ? items.map(i => i.id === draft.id ? draft : i) : [...items,draft]; if (await onSave(next)) setDraft(null); }}>
        <h2>{items.some(i => i.id === draft.id) ? '编辑' : '新建'}{draft.kind === 'expert' ? '专家' : '技能'}</h2>
        {draft.package && <p className="extension-note">ZIP 技能包 · 已保留 {draft.package.files} 个文件（含 SKILL.md）</p>}
        <label>名称<input aria-label="扩展名称" required maxLength={60} value={draft.name} onChange={e => setDraft({...draft,name:e.target.value})} /></label>
        <label>用途说明<input aria-label="扩展用途" maxLength={300} value={draft.description} onChange={e => setDraft({...draft,description:e.target.value})} placeholder="一句话说明它能帮你完成什么" /></label>
        <label>工作指令<textarea aria-label="扩展指令" required maxLength={20000} rows={8} value={draft.instructions} onChange={e => setDraft({...draft,instructions:e.target.value})} placeholder="描述角色、工作步骤与输出要求…" /></label>
        <div className="extension-actions"><button className="primary" disabled={busy || importing || !draft.name.trim() || !draft.instructions.trim()}>保存扩展</button><button type="button" disabled={busy || importing} onClick={() => setDraft(null)}>取消</button></div>
      </form>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="extension-grid">{items.filter(i => i.kind === tab && (i.name + i.description).toLowerCase().includes(query.toLowerCase())).map(item => <article className={'extension-card ' + (!item.enabled ? 'extension-disabled' : '')} key={item.id}>
        <div className="extension-card-top"><span className="extension-symbol"><Icon name={item.kind === 'expert' ? 'user' : 'sparkles'}/></span><small>{item.enabled ? '已启用' : '已停用'}</small></div><h2>{item.name}</h2><p>{item.description || '自定义工作指令'}</p><div className="extension-actions"><button className="primary" disabled={busy || importing || !item.enabled} onClick={() => onUse(item)}>在对话中使用</button><button disabled={busy || importing} onClick={() => setDraft({...item})}>编辑</button><button disabled={busy || importing} onClick={() => void onSave(items.map(i => i.id === item.id ? {...i,enabled:!i.enabled} : i))}>{item.enabled ? '停用' : '启用'}</button></div>
      </article>)}</div>
      {!items.some(i => i.kind === tab && (i.name+i.description).toLowerCase().includes(query.toLowerCase())) && <p className="extension-empty">没有匹配的扩展，试试其他关键词或创建一个。</p>}
    </>}
  </div>;
}
export function ExtensionPicker({items, value, disabled, onChange, onManage, onDefault}: {items:Extension[]; value:string[]; disabled:boolean; onChange:(ids:string[])=>void; onManage:()=>void; onDefault?:()=>void}) {
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState('');
  const selected=items.filter(i=>value.includes(i.id));
  return <div className="extension-picker">
    <button type="button" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(!open)}>✧ 使用扩展{selected.length ? ` · ${selected.length}` : ''}</button>
    {selected.map(i=><button className="extension-chip" type="button" key={i.id} disabled={disabled} aria-label={`移除扩展 ${i.name}`} onClick={()=>onChange(value.filter(id=>id!==i.id))}>{i.name} ×</button>)}
    {open && <div className="extension-popover" role="dialog" aria-label="选择扩展"><div className="extension-card-top"><strong>本次对话的扩展</strong><button type="button" onClick={()=>setOpen(false)} aria-label="关闭扩展选择">×</button></div><input aria-label="搜索可用扩展" placeholder="搜索专家或技能…" value={query} onChange={e=>setQuery(e.target.value)}/><p className="extension-note">可选 1 位专家和最多 5 个技能</p><div className="extension-options">{(['expert','skill'] as const).map(kind=><section key={kind}><h4>{kind==='expert'?'专家':'技能'}</h4>{items.filter(i=>i.enabled && i.kind===kind && (i.name+i.description).includes(query)).map(i=><label key={i.id}><input type="checkbox" checked={value.includes(i.id)} disabled={disabled || (!value.includes(i.id) && kind==='skill' && selected.filter(i=>i.kind==='skill').length>=5)} onChange={()=>onChange(value.includes(i.id)?value.filter(id=>id!==i.id):[...value.filter(id=>kind!=='expert'||items.find(x=>x.id===id)?.kind!=='expert'),i.id])}/><span>{i.name}<small>{i.description}</small></span></label>)}</section>)}</div><div className="extension-actions"><button type="button" onClick={()=>{setOpen(false);onManage();}}>管理扩展</button>{onDefault && <button type="button" disabled={disabled} onClick={()=>{onDefault();setOpen(false);}}>设为项目默认</button>}</div></div>}
  </div>;
}

import { canSendMaterial } from "../attachments.mjs";
import React, { useRef, useState } from 'react';
import type { Clarification, ClarificationAnswer, Material } from './types';
import { Icon } from './icon';
export function ClarificationCard({ value, messageId, disabled, completed, active, onSubmit }: {
  value: Clarification; messageId: string; disabled: boolean; active: boolean;
  completed?: ClarificationAnswer[];
  onSubmit: (answers: ClarificationAnswer[], materials: Material[]) => Promise<void>;
}) {
  const [choices, setChoices] = useState<Record<string,string>>(() => Object.fromEntries(value.questions.map(q => [q.id, q.options?.find(o => o.recommended)?.id || ''])));
  const [custom, setCustom] = useState<Record<string,string>>({});
  const [files, setFiles] = useState<Record<string,Material[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const frozen = disabled || loading || !!completed || !active;
  const answerFor = (id: string) => {
    const q = value.questions.find(q => q.id === id)!;
    if (choices[id] === '__custom') return custom[id]?.trim() || '';
    if (q.kind === 'attachment') return choices[id] === '__later' ? '稍后提供' : choices[id] === '__files' && files[id]?.length ? `已添加材料：${files[id].map(f => f.name).join('、')}` : '';
    return q.options?.find(o => o.id === choices[id])?.label || '';
  };
  const ready = value.questions.every(q => answerFor(q.id));
  async function pick(id: string) {
    if (frozen || lock.current) return;
    lock.current = true;setLoading(true);setError('');
    try {
      const picked = await window.ailo.pick();
      if (picked.some(f => !canSendMaterial(f))) throw Error('有文件无法读取，请选择受支持的图片、文字文档或源文件。');
      if (picked.length) { setFiles(prev => ({...prev,[id]:[...(prev[id] || []),...picked]})); setChoices(prev => ({...prev,[id]:'__files'})); }
    } catch(e) {setError(String(e).replace(/^.*Error: /,''));}
    finally {lock.current=false;setLoading(false);}
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();if (frozen || !ready || lock.current) return;
    lock.current=true;setLoading(true);setError('');
    try {
      await onSubmit(value.questions.map(q => ({questionId:q.id,answer:answerFor(q.id)})), value.questions.flatMap(q => choices[q.id] === '__files' ? files[q.id] || [] : []));
    } catch(e) {setError(String(e).replace(/^.*Error: /,''));}
    finally {lock.current=false;setLoading(false);}
  }
  return <form className="clarification-card" aria-label={value.title} onSubmit={submit}>
    <div className="clarification-heading"><strong>{value.title}</strong><span>{completed ? '已提交' : active ? `${value.questions.length} 个问题` : '已继续对话'}</span></div>
    {!completed && active && <p className="clarification-hint">推荐项已预选，点击提交后才会确认。也可以填写自己的答案。</p>}
    {value.questions.map((q,index) => <fieldset key={q.id} disabled={frozen}>
      <legend><span className="question-number">{index+1}</span>{q.title}</legend>
      {q.description && <p className="question-description">{q.description}</p>}
      {completed ? <p className="clarification-confirmed">{completed.find(a=>a.questionId===q.id)?.answer}</p> : <>
        <div className="clarification-options">
          {q.options?.map(o => <label key={o.id} className={`clarification-option ${choices[q.id]===o.id?'chosen':''}`}>
            <input type="radio" name={`${messageId}-${q.id}`} value={o.id} checked={choices[q.id]===o.id} onChange={()=>setChoices(prev=>({...prev,[q.id]:o.id}))}/>
            <span><span className="option-title">{o.label}{o.recommended && <small>推荐</small>}</span>{o.description && <span className="option-description">{o.description}</span>}</span>
          </label>)}
          {q.kind==='attachment' && <>
            <button type="button" className={`clarification-upload ${choices[q.id]==='__files'?'chosen':''}`} onClick={()=>void pick(q.id)}><Icon name="paperclip"/>{files[q.id]?.length ? '继续添加材料' : '添加材料'}</button>
            <label className={`clarification-option ${choices[q.id]==='__later'?'chosen':''}`}><input type="radio" name={`${messageId}-${q.id}`} checked={choices[q.id]==='__later'} onChange={()=>setChoices(prev=>({...prev,[q.id]:'__later'}))}/><span>稍后提供</span></label>
          </>}
          <label className={`clarification-option ${choices[q.id]==='__custom'?'chosen':''}`}><input type="radio" name={`${messageId}-${q.id}`} checked={choices[q.id]==='__custom'} onChange={()=>setChoices(prev=>({...prev,[q.id]:'__custom'}))}/><span>自定义回答</span></label>
        </div>
        {choices[q.id]==='__custom' && <textarea aria-label={`${q.title} 自定义回答`} maxLength={2000} rows={2} placeholder="填写你的答案…" value={custom[q.id] || ''} onChange={e=>setCustom(prev=>({...prev,[q.id]:e.target.value}))}/>}
        {q.kind==='attachment' && !!files[q.id]?.length && <div className="clarification-files">
          {choices[q.id]!=='__files' && <button type="button" onClick={()=>setChoices(prev=>({...prev,[q.id]:'__files'}))}>使用已添加的材料</button>}
          {files[q.id].map((f,i)=><span key={i}>{f.name}<button type="button" aria-label={`移除材料 ${f.name}`} onClick={()=>setFiles(prev=>({...prev,[q.id]:prev[q.id].filter((_,j)=>j!==i)}))}>×</button></span>)}
          {choices[q.id]!=='__files' && <small>当前选择不会发送这些材料。</small>}
        </div>}
      </>}
    </fieldset>)}
    {!!value.defaults.length && <details className="clarification-defaults"><summary>拟采用的默认方案 · {value.defaults.length} 项</summary><ul>{value.defaults.map((d,i)=><li key={i}>{d}</li>)}</ul></details>}
    {error && <p role="alert" className="error">{error}</p>}
    {!completed && active && <div className="clarification-footer"><span>{loading?'正在处理…':ready?'提交后将作为一条消息继续对话':'请回答每个问题'}</span><button className="primary" disabled={frozen || !ready}>提交答案</button></div>}
  </form>;
}

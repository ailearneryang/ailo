import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { agentContextUsage } from '../context.mjs';
import type { AgentRun, ContextCheckpoint, Extension, Message, Model } from './types';
const format = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
export function ContextMeter({ messages, extensions, model, run, onConfigure }: {
  messages: Pick<Message, 'role' | 'content' | 'materials' | 'clarification'>[]; extensions: Extension[]; model: Model;
  checkpoint?: ContextCheckpoint; promptTokens?: number; onConfigure: () => void;
  run?: AgentRun;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({left: 0, bottom: 0});
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const baseline = agentContextUsage(messages, extensions, model, run);
  const request = run?.contextUsage;
  const info = request || baseline;
  const title = request ? '最近一次请求用量' : '基础输入估算';
  const provider = request?.providerUsage;
  const percent = (info.ratio * 100).toFixed(1);
  useEffect(() => {
    if (!open) return;
    function positionPanel() {
      const rect = button.current?.getBoundingClientRect();
      if (rect) setPosition({left: Math.max(12, Math.min(rect.right - 370, window.innerWidth - 382)), bottom: Math.max(12, window.innerHeight - rect.top + 12)});
    }
    positionPanel();
    function outside(e: PointerEvent) { if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); }
    function escape(e: KeyboardEvent) { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', positionPanel); window.removeEventListener('scroll', positionPanel, true); };
  }, [open]);
  const close = () => {setOpen(false); button.current?.focus();};
  return <>
    <button ref={button} type="button" className={`context-trigger ${info.ratio >= .8 ? 'context-warning' : ''}`}
      aria-label={`上下文用量 ${percent}%（${title}）`} aria-expanded={open} aria-haspopup="dialog"
      title={`${title}约 ${percent}% · 点击查看用量`} onClick={() => setOpen(!open)}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="#e4e5e1" strokeWidth="3" />
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${Math.min(1, info.ratio) * 56.55} 56.55`} transform="rotate(-90 12 12)" />
      </svg>
    </button>
    {open && createPortal(<div ref={panel} className="context-popover" role="dialog" aria-label="上下文用量" style={{...position, maxHeight: `calc(100vh - ${position.bottom + 12}px)`}}>
      <div className="context-heading"><strong>{title}</strong><button type="button" aria-label="关闭上下文用量" onClick={close}>×</button></div>
      <div className="context-total"><b>{percent}%</b><span>约 {format(info.used)} / {format(info.window)} tokens</span></div>
      <div className="context-bar" aria-hidden="true">{info.rows.map(row => <span key={row.label} style={{background: row.color, width: `${row.tokens / Math.max(info.window, info.used) * 100}%`}} />)}</div>
      <div className="context-rows">{info.rows.map(row => <div key={row.label}><i style={{background: row.color}} /><span>{row.label}</span><small>{format(row.tokens)}</small><span className="context-percent">{(row.tokens / info.window * 100).toFixed(1)}%</span></div>)}</div>
      <div className="context-footnote">
        {request ? <>
          <p>输入估算来自实际发送的完整请求，包含需求摘要、已读取材料片段、工具结果和工具定义；不是账单用量，未发送的草稿不计入。</p>
          <p>本次输出额度上限：{format(info.reserve)} tokens。输入估算加输出额度约占 {((info.used + info.reserve) / info.window * 100).toFixed(1)}%；输出额度不代表已生成数量。</p>
          <p>请求时间：{new Date(request.at).toLocaleTimeString()} · {request.modelName || '当前模型'} · {request.status === 'sending' ? '请求中' : request.status === 'completed' ? '已返回' : '请求未完成'}</p>
          {typeof provider?.inputTokens === 'number' || typeof provider?.outputTokens === 'number' ? <p>服务商返回：输入 {typeof provider.inputTokens === 'number' ? format(provider.inputTokens) : '未提供'}，输出 {typeof provider.outputTokens === 'number' ? format(provider.outputTokens) : '未提供'} tokens{typeof provider.reasoningTokens === 'number' ? `（其中推理 ${format(provider.reasoningTokens)}）` : ''}。</p> : <p>{request.status === 'sending' ? '服务商尚未返回本次 token 统计。' : '服务商未提供本次 token 统计，以上为本地估算。'}</p>}
          <p>{request.capacityConfigured ? '分母为该次请求使用的模型容量配置，尚未经接口验证。' : '该次请求未配置容量，按 32,768 tokens 估算。'}<button type="button" onClick={() => {close(); onConfigure();}}>设置容量</button></p>
        </> : <>
          <p>尚无实际请求统计。这里只估算基础输入与草稿，不包含执行时读取的材料片段和工具结果。</p>
          <p>当前会话材料正文约 {format(baseline.materialTokens)} tokens，保存在项目内，不会全部送入每次请求。</p>
          <p>{model.contextWindow ? '容量来自模型设置，尚未经接口验证。' : '容量未配置，暂按 32,768 tokens 估算。'}<button type="button" onClick={() => {close(); onConfigure();}}>设置容量</button></p>
        </>}

      </div>
    </div>, document.body)}
  </>;
}

import React, { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { Icon } from './icon';
import type { Extension, Material } from './types';
import './composer-input.css';

type Props = {
  value: string; onChange: (value: string) => void; placeholder: string;
  disabled: boolean; files: Material[]; materials: Material[];
  extensions: Extension[]; selectedIds: string[];
  onFile: (file: Material) => void;
  onExtensions: (ids: string[]) => void; onSubmit: (event: React.FormEvent) => void;
};
type Option = { id: string; name: string; detail: string; kind: 'file' | 'expert' | 'skill'; selected?: boolean; disabled?: boolean; choose: () => void };

export function ComposerInput(props: Props) {
  const { value, onChange, disabled, files, materials, extensions, selectedIds } = props;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const restoreCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (restoreCaret.current === null) return;
    const position = restoreCaret.current; restoreCaret.current = null;
    textarea.current?.focus(); textarea.current?.setSelectionRange(position, position); setCaret(position);
  }, [value]);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  // A boundary avoids opening shortcuts in email addresses, URLs and file paths.
  const match = value.slice(0, caret).match(/(^|[^\w@/.:])([@/])([^@/\n]*)$/u);
  const trigger = match?.[2];
  const query = (match?.[3] || '').trim().toLocaleLowerCase();
  const start = match ? caret - match[3].length - 1 : caret;
  const open = !!match && focused && !disabled && !composing && !dismissed;
  const sameFile = (a: Material, b: Material) => a.sourceId && b.sourceId ? a.sourceId === b.sourceId : a.name === b.name && a.text === b.text;
  const options: Option[] = trigger === '@' ? [
    ...files.filter((file, index) => files.findIndex(other => sameFile(file, other)) === index)
      .filter(file => file.name.toLocaleLowerCase().includes(query))
      .map((file, index): Option => ({ id: `file-${index}`, name: file.name, kind: 'file',
        detail: file.text === null ? '文件尚未解析' : '引用对话文件',
        selected: materials.some(other => sameFile(file, other)), disabled: file.text === null,
        choose: () => { if (!materials.some(other => sameFile(file, other))) props.onFile(file); } })),
  ] : extensions.filter(extension => extension.enabled && `${extension.name} ${extension.description}`.toLocaleLowerCase().includes(query))
    .map((extension): Option => {
      const selected = selectedIds.includes(extension.id);
      const full = extension.kind === 'skill' && !selected && extensions.filter(item => item.kind === 'skill' && selectedIds.includes(item.id)).length >= 5;
      return { id: extension.id, name: extension.name, kind: extension.kind, selected, disabled: full,
        detail: full ? '最多选择 5 个技能，请先移除一个' : extension.description || (extension.kind === 'expert' ? '使用这位专家' : '调用此技能'),
        choose: () => { if (!selected) props.onExtensions([...selectedIds.filter(id => extension.kind !== 'expert' || extensions.find(item => item.id === id)?.kind !== 'expert'), extension.id]); } };
    });
  const current = Math.min(active, Math.max(0, options.length - 1));
  useEffect(() => { setActive(0); }, [query, trigger]);
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [current, open]);
  function choose(option: Option) {
    if (option.disabled || disabled) return;
    restoreCaret.current = start;
    onChange(value.slice(0, start) + value.slice(caret));
    setDismissed(true);
    option.choose();
  }
  return <div className="composer-input">
    {open && <div className={`composer-shortcuts${trigger === '@' && !options.length ? ' composer-shortcuts-file-empty' : ''}`}>
      {(trigger !== '@' || options.length > 0) && <div className="composer-shortcuts-heading">{trigger === '@' ? '引用文件' : '调用专家和技能'}<span>↑↓ 选择 · Enter 确认 · Esc 关闭</span></div>}
      <div ref={list} id={listId} role="listbox" aria-label={trigger === '@' ? '文件快捷选择' : '专家和技能快捷选择'}>
        {options.map((option, index) => <button key={option.id} id={`${listId}-${index}`} type="button" role="option"
          aria-selected={current === index} aria-disabled={option.disabled || undefined} data-active={current === index}
          onMouseDown={event => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => choose(option)}>
          <span className="composer-shortcut-icon"><Icon name={option.kind === 'file' ? 'file' : option.kind === 'expert' ? 'user' : 'sparkles'}/></span>
          <span className="composer-shortcut-copy"><strong>{option.name}</strong><small>{option.detail}</small></span>
          <span className="composer-shortcut-kind">{option.selected ? '已添加' : option.kind === 'expert' ? '专家' : option.kind === 'skill' ? '技能' : '文件'}</span>
        </button>)}
        {!options.length && <p className="composer-shortcuts-empty">{trigger === '@' ? (files.length ? '当前对话中没有匹配的文件' : '当前对话中暂无文件') : query ? '没有匹配的专家或技能' : '暂无可用专家或技能，请先在「扩展」中添加或启用。'}</p>}
      </div>
      {trigger === '/' && <div className="composer-shortcuts-footer">可选 1 位专家和最多 5 个技能；选择其他专家会替换当前专家。</div>}
    </div>}
    <textarea ref={textarea} value={value} placeholder={props.placeholder} aria-label="任务需求"
      aria-autocomplete="list" aria-controls={open ? listId : undefined} aria-expanded={open}
      aria-activedescendant={open && options.length ? `${listId}-${current}` : undefined}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={event => { onChange(event.target.value); setCaret(event.target.selectionStart); setDismissed(false); }}
      onSelect={event => setCaret(event.currentTarget.selectionStart)}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={event => { setComposing(false); setCaret(event.currentTarget.selectionStart); }}
      onKeyDown={event => {
        if (composing || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (open) {
          if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); return; }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); if (options.length) setActive((current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length); return;
          }
          if ((event.key === 'Enter' && !event.shiftKey) || (event.key === 'Tab' && !event.shiftKey && options.length > 0)) {
            event.preventDefault(); if (options[current]) choose(options[current]); return;
          }
        }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); props.onSubmit(event); }
      }}/>
  </div>;
}

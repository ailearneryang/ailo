import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pet } from './pet';
import { Icon } from './icon';
import type { Task, Workspace } from './types';

type Group = 'attention' | 'running' | 'results';
export function MyAilo({ data, runningIds, onOpen, compact, onSchedules, onModels }: {
  data: Workspace; runningIds: string[]; onOpen: (id: string) => void;
  compact: boolean; onSchedules: () => void; onModels: () => void;
}) {
  const [group, setGroup] = useState<Group>('attention');
  const dialog = useRef<HTMLDialogElement>(null);
  const tasks = data.tasks.filter(t => t.id !== 'my-ailo-assistant' && (!t.scheduledTaskId || t.scheduledArchived));
  const running = tasks.filter(t => runningIds.includes(t.id));
  const attention = tasks.filter(t => !runningIds.includes(t.id) && (
    !!t.lastError || t.assistantPaused || ['blocked', 'waiting_permission', 'failed', 'paused', 'waiting_user'].includes(t.agentRun?.status || '') ||
    t.messages?.at(-1)?.clarification || t.messages?.at(-1)?.role === 'user'
  ));
  const results = tasks.filter(t => !runningIds.includes(t.id) && !attention.some(a => a.id === t.id) && (
    t.agentRun?.status === 'completed' || t.messages?.at(-1)?.role === 'assistant' || !!t.answer
  ));
  const groups = { attention, running, results };
  function description(task: Task) {
    if (group === 'running') return task.agentRun?.steps.find(s => s.status === 'running')?.title || '正在处理';
    if (group === 'attention') return task.assistantPaused ? '已暂停' : task.lastError ? '需要重试' : task.messages?.at(-1)?.clarification ? '需要补充信息' : '等待继续';
    return task.agentRun?.artifacts.length ? `${task.agentRun.artifacts.length} 项成果` : '已有回复';
  }
  function openWork() { setGroup(attention.length ? 'attention' : running.length ? 'running' : 'results'); dialog.current?.showModal(); }
  return <>
    <div className="assistant-work-entry">
      <button onClick={openWork} aria-label="查看任务" aria-haspopup="dialog"><Icon name="folder" /><span>任务</span>{attention.length > 0 && <small>{attention.length} 项待处理</small>}{running.length > 0 && <small>{running.length} 项执行中</small>}<span aria-hidden="true">›</span></button>
    </div>
    {!compact && <div className="assistant-greeting"><Pet interactive /><h1>我在，有什么想交给我？</h1>{!data.models.some(m => m.id !== 'demo') && <button onClick={onModels}>配置模型，开始协作 →</button>}</div>}
    {createPortal(<dialog className="assistant-work-dialog" ref={dialog} aria-labelledby="assistant-work-title" onClick={e=>{if(e.target===e.currentTarget){const box=e.currentTarget.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)e.currentTarget.close();}}}>
      <div className="assistant-work-heading"><h2 id="assistant-work-title">任务</h2><button onClick={()=>dialog.current?.close()} aria-label="关闭任务"><Icon name="close"/></button></div>
      <div className="my-ailo-tabs" role="tablist" aria-label="工作状态">
        {(['attention', 'running', 'results'] as Group[]).map(key => <button key={key} id={`ailo-tab-${key}`} role="tab" aria-selected={group === key} aria-controls="ailo-work-list" onClick={() => setGroup(key)} className={group === key ? 'selected' : ''}>{({attention: '待处理', running: '执行中', results: '已有结果'})[key]} <span>{groups[key].length}</span></button>)}
      </div>
      <div className="assistant-work-list" id="ailo-work-list" role="tabpanel" aria-labelledby={`ailo-tab-${group}`}>
        {!groups[group].length ? <div className="my-ailo-empty"><Icon name="check" /><strong>{({attention:'没有待处理的任务',running:'没有正在执行的任务',results:'还没有完成的工作'})[group]}</strong></div> : groups[group].map(t => <button className="my-ailo-task" key={t.id} onClick={() => {dialog.current?.close();onOpen(t.id);}}><span><strong>{t.title}</strong><small>{description(t)}{t.projectId ? ` · ${data.projects.find(p => p.id === t.projectId)?.name || '项目'}` : ''}</small></span><span aria-hidden="true">↗</span></button>)}
      </div>
      <div className="assistant-work-footer"><button onClick={()=>{dialog.current?.close();onSchedules();}}><Icon name="clock"/>定时任务 <span aria-hidden="true">↗</span></button></div>
    </dialog>,document.body)}
  </>;
}

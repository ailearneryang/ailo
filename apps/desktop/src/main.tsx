import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { AccountPage, ModelSettings } from "./settings";
import { AssistantText } from "./assistant-text";
import { ProjectOverview } from "./project-overview";
import { ProjectPicker } from "./project-picker";
import { ModelPicker } from "./model-picker";
import { ExtensionCenter } from "./extensions";
import { ComposerInput } from "./composer-input";
import { ComposerAdd } from "./composer-add";
import { ClarificationCard } from "./clarification-card";
import { formatAnswers, visibleReply } from "../clarification.mjs";
import type { ClarificationAnswer } from "./types";
import { Icon } from "./icon";
import { ContextMeter } from "./context-meter";
import { serializeMessage } from "../context.mjs";
import { ArtifactPanel } from "./artifact-panel";
import { TaskActivity } from "./task-activity";
import {progressAnchor} from "./progress-placement";
import { TaskProgress, ExecutionHistory } from "./task-progress";
import { Pet } from "./pet";
import {
  demoModel,
  emptyWorkspace,
  type Material,
  type Task,
  type Workspace,
  type User,
  type Message,
} from "./types";
function App() {
  const [data, setData] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState("chat");
  const [expandedProjects,setExpandedProjects]=useState<Record<string,boolean>>({});
  const [input, setInput] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rightPanel,setRightPanel] = useState<'artifacts'|'materials'|null>(null);
  const showPanel=rightPanel==='materials';
  const [user, setUser] = useState<User | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [projectMenuAnchor,setProjectMenuAnchor]=useState<HTMLButtonElement|null>(null);
  const [modelId, setModelId] = useState("demo");
  const [extensionTab,setExtensionTab]=useState<'expert'|'skill'|'connector'>('expert');
  const [searchChoices,setSearchChoices]=useState<Record<string,boolean>>({});
  const [connectionChoices,setConnectionChoices]=useState<Record<string,boolean>>({});
  const [extensionIds, setExtensionIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const availableExtensions = data.extensions || [];
  const selectedIds = extensionIds.filter(id => availableExtensions.some(e => e.id === id && e.enabled));
  function selectProject(id: string) {
    setProjectId(id);
    setExtensionIds(data.projects.find(p => p.id === id)?.extensionIds || []);
    setNotice("");
  }
  const models = data.models;
  const currentModel =
    models.find((m) => m.id === modelId) ||
    models.find((m) => m.id === data.defaultModelId) ||
    models[0] ||
    demoModel;
  type LiveSession={id:string;content:string;status:string;attached?:boolean};
  const requests=useRef<Record<string,LiveSession>>({});
  const [sessions,setSessions]=useState<Record<string,LiveSession>>({});
  const syncSessions=()=>setSessions({...requests.current});
  const streamText=active?sessions[active]?.content||'':'';
  const chatStatus=active?sessions[active]?.status||'':'';
  const drafts=useRef<Record<string,{input:string;materials:Material[]}>>({});
  const [steeringSending,setSteeringSending]=useState(false);
  const steeringRef=useRef(false);
  type QueuedInput={id:string;taskId:string;content:string};
  const [queued,setQueued]=useState<QueuedInput[]>(()=>{try{return JSON.parse(localStorage.getItem('ailo-message-queue')||'[]');}catch{return [];}});
  const [queueEditing,setQueueEditing]=useState<string>();
  const [queueDraft,setQueueDraft]=useState('');
  const [queueSending,setQueueSending]=useState<string>();
  const queueSendingRef=useRef(false);
  const queueAutoPaused=useRef(false);
  useEffect(()=>{localStorage.setItem('ailo-message-queue',JSON.stringify(queued));},[queued]);
  const pending=active && sessions[active]?active:null;
  const requestRef={current:active?requests.current[active]?.id||null:null};
  useEffect(() => window.ailo.onChatStatus(status => {
    if(status.finished){void window.ailo.read().then(setData);}
    const entry=Object.entries(requests.current).find(([,s])=>s.id===status.id);
    if(!entry)return;
    const [taskId,session]=entry;
    if(status.finished){delete requests.current[taskId];syncSessions();void window.ailo.read().then(setData);return;}
    if (status.run) setData(previous => ({...previous,tasks:previous.tasks.map(t => t.id === taskId ? {...t,agentRun:status.run} : t)}));
    requests.current[taskId]={...session,attached:true,...(status.message?{status:status.message}:{}),...(typeof status.content==='string'?{content:status.content,status:'正在生成回复…'}:{})};
    syncSessions();
  }), []);
  useEffect(()=>{
    let cancelled=false;
    async function reconcile(){
      try{
        const running=await window.ailo.sessions();if(cancelled)return;
        let ended=false;
        for(const [taskId,session] of Object.entries(requests.current))if(session.attached&&!running.some(s=>s.id===session.id)){delete requests.current[taskId];ended=true;}
        if(ended){const state=await window.ailo.read();if(!cancelled)setData(state);}
        for(const s of running)if(s.taskId)requests.current[s.taskId]={id:s.id,content:s.content,status:s.status,attached:true};
        syncSessions();
      }catch{/* IPC may be closing; retry on next tick. */}
    }
    void reconcile();const timer=setInterval(()=>void reconcile(),1000);
    return ()=>{cancelled=true;clearInterval(timer);};
  },[]);
  const cancelledRef = useRef<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const busy = saving || !!pending || importing;
  const messagesFor = (t: Task): Message[] =>
    t.messages || [
      {
        id: t.id + "-original",
        role: "user",
        content: t.request,
        materials: t.materials,
      },
    ];
  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [active, data.tasks, pending]);
  useEffect(() => {
    window.ailo
      .account()
      .then(setUser)
      .catch(() => setError("无法读取账号信息，请重启后重试。"))
      .finally(() => setAccountReady(true));
  }, []);
  useEffect(() => {
    if (!models.some((m) => m.id === modelId)) setModelId(data.defaultModelId);
  }, [data.models, data.defaultModelId, modelId]);
  async function addProject(name: string): Promise<string | null> {
    if (busy || !name.trim()) return "请输入项目名称。";
    if (
      data.projects.some(
        (p) => p.name.toLowerCase() === name.trim().toLowerCase(),
      )
    )
      return "这个项目名称已存在，请选择已有项目或换个名称。";
    const project = { id: crypto.randomUUID(), name: name.trim() };
    if (await commit({ ...data, projects: [...data.projects, project] })) {
      setProjectId(project.id);
      return null;
    }
    return "创建失败，请重试。";
  }

  useEffect(() => {
    window.ailo
      .read()
      .then((s) => {
        if (
          !s ||
          !Array.isArray(s.tasks) ||
          s.tasks.some(
            (t) => !t.id || !t.request || !Array.isArray(t.materials),
          )
        )
          throw Error("保存的数据格式不正确");
        const next = { ...emptyWorkspace, ...s };
        setData(next);
        setModelId(next.defaultModelId);
        setReady(true);
      })
      .catch((e) => setError("无法加载本地记录：" + String(e)));
  }, []);
  const task = data.tasks.find((t) => t.id === active);
  const connectionKey=task?.id || projectId || "new";
  const useSearch=searchChoices[connectionKey] ?? task?.searchEnabled ?? false;
  const useFeishu=connectionChoices[connectionKey] ?? task?.feishuEnabled ?? false;
  async function commit(next: Workspace) {
    setSaving(true);
    try {
      await window.ailo.save(next);
      const saved = await window.ailo.read();
      setData(saved);
      setError("");
      return true;
    } catch (e) {
      setError("保存失败，请重试：" + String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }
  function select(id: string | null) {
    drafts.current[active||'new']={input,materials};
    const draft=drafts.current[id||'new']||{input:'',materials:[]};
    setActive(id);
    setNotice("");
    setExtensionIds(id ? data.tasks.find(t => t.id === id)?.extensionIds || [] : data.projects.find(p => p.id === projectId)?.extensionIds || []);
    if (!id) {setProjectId("");setExtensionIds([]);setRightPanel(null);}
    if (id) {
      const selected = data.tasks.find((t) => t.id === id);
      setProjectId(selected?.projectId || "");
      setModelId(selected?.modelId || data.defaultModelId);
    }
    setError("");
    setInput(draft.input);
    setMaterials(draft.materials);
    setView("chat");
    if (id === null) {
      setModelId(data.defaultModelId);
    }
  }
  function modelReady() {
    if (currentModel.id !== "demo") return true;
    setError("请先在输入框右下角配置或选择模型，再发送消息。");
    return false;
  }
  async function respond(nextTask: Task, clearDraft: boolean) {
    if (requests.current[nextTask.id] || saving || importing || !modelReady()) return;
    const requestId = crypto.randomUUID();
    requests.current[nextTask.id]={id:requestId,content:'',status:'正在检查上下文…'};syncSessions();
    setActive(nextTask.id);
    setError("");
    const messages = messagesFor(nextTask);
    const updated = {
      ...nextTask,
      messages,
      modelId: currentModel.id,
      modelName: currentModel.name,
      extensionIds: selectedIds,
      feishuEnabled: useFeishu,
      searchEnabled: useSearch,
      lastError: undefined,
      partialReply: undefined,
    };
    try {
      const saved=await window.ailo.patchTask(updated.id,updated);
      setData(previous=>({...previous,tasks:previous.tasks.some(t=>t.id===saved.id)?previous.tasks.map(t=>t.id===saved.id?{...t,...saved}:t):[saved,...previous.tasks]}));
      if (clearDraft) {
        setInput("");
        setMaterials([]);
        delete drafts.current[nextTask.id];delete drafts.current.new;
      }
      if (cancelledRef.current === requestId)
        throw Error("已停止回复，可重新发送。");
      const result = await window.ailo.complete({
        id: requestId,
        modelId: currentModel.id,
        extensionIds: selectedIds,
      feishuEnabled: useFeishu,
      searchEnabled: useSearch,
        taskId: updated.id,
        contextCheckpoint: nextTask.contextCheckpoint,
        messages: messages.map(m => ({role:m.role,content:m.content})),
      });
      const assistant: Message = {
        id: requestId+'-assistant',
        role: "assistant",
        content: result.content,
        clarification: result.clarification,
        modelName: result.modelName,
      };
      const finished=await window.ailo.patchTask(updated.id,{contextCheckpoint:result.contextCheckpoint,promptTokens:result.promptTokens,lastError:undefined,partialReply:undefined},[assistant]);
      setData(previous=>({...previous,tasks:previous.tasks.map(t=>t.id===finished.id?{...t,...finished}:t)}));
    } catch (e) {
      const message = String(e).replace(/^.*Error: /, "");
      const running=await window.ailo.sessions().catch(()=>[]);
      const existing=running.find(s=>s.taskId===nextTask.id);
      if(existing){requests.current[nextTask.id]={...existing,attached:true};syncSessions();setNotice('已连接到正在执行的任务。');return;}
      try {
        const failed=await window.ailo.patchTask(updated.id,{lastError:message,partialReply:requests.current[updated.id]?.content||undefined});
        setData(previous=>({...previous,tasks:previous.tasks.map(t=>t.id===failed.id?{...t,...failed}:t)}));
      } catch {
        setError(message);
      }
    } finally {
      if(requests.current[nextTask.id]?.id===requestId)delete requests.current[nextTask.id];syncSessions();
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if(pending && task?.id===pending && requestRef.current) {
      if(!input.trim()||input.trim().length>20000)return;
      setQueued(previous=>[...previous,{id:crypto.randomUUID(),taskId:task.id,content:input.trim()}]);
      queueAutoPaused.current=false;setInput('');setNotice('已加入待发送队列；本轮结束后自动发送，也可立即执行。');
      return;
    }
    if (
      !input.trim() ||
      busy ||
      !ready ||
      !modelReady()
    )
      return;
    if (materials.some((m) => m.text === null)) {
      setError(
        "有材料尚未解析，请移除 PDF、图片或不支持的文件后重试；压缩包中已读取的文本可以发送。",
      );
      return;
    }
    const message: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      materials,
    };
    const next: Task = task
      ? {
          ...task,
          messages: [...messagesFor(task), message],
          materials: [...task.materials, ...materials],
        }
      : {
          id: crypto.randomUUID(),
          title: input.trim().slice(0, 26),
          request: input.trim(),
          materials,
          projectId,
          created: new Date().toISOString(),
          messages: [message],
        };
    await respond(next, true);
  }
  async function answerQuestions(source: Message, answers: ClarificationAnswer[], attached: Material[]) {
    if (!task || busy || requestRef.current || !source.clarification || messagesFor(task).at(-1)?.id !== source.id) return;
    if (!modelReady()) return;
    if (attached.some(f => f.text === null)) throw Error("材料尚未解析，请移除后重试。");
    const message: Message = {
      id: crypto.randomUUID(), role: "user", content: formatAnswers(source.clarification, answers),
      materials: attached, clarificationReplyTo: source.id, clarificationAnswers: answers,
    };
    await respond({ ...task, messages: [...messagesFor(task), message], materials: [...task.materials, ...attached] }, false);
  }
  async function executeQueued(item:QueuedInput) {
    if(queueSendingRef.current||steeringRef.current||saving||importing||!ready)return;
    if(pending && (pending!==item.taskId||!requestRef.current))return;
    if(queueEditing===item.id)return;
    queueSendingRef.current=true;setQueueSending(item.id);queueAutoPaused.current=false;
    try {
      if(pending && requestRef.current) {
        steeringRef.current=true;setSteeringSending(true);
        const message=await window.ailo.steer({id:requestRef.current,taskId:item.taskId,content:item.content});
        setData(previous=>({...previous,tasks:previous.tasks.map(t=>t.id===item.taskId?{...t,messages:messagesFor(t).some(m=>m.id===message.id)?messagesFor(t):[...messagesFor(t),message]}:t)}));
        setQueued(previous=>previous.filter(m=>m.id!==item.id));
        setNotice('补充指令已发送，将在下一次决策前处理。');
      } else {
        const latest=await window.ailo.read();
        const target=latest.tasks.find(t=>t.id===item.taskId);
        if(!target)throw Error('原任务不存在，待发送消息已保留。');
        if(!modelReady())return;
        // Stable message id makes recovery safe if the renderer was closed after saving.
        const messages=messagesFor(target);
        if(!messages.some(m=>m.id===item.id)) {
          await respond({...target,messages:[...messages,{id:item.id,role:'user',content:item.content}]},false);
        }
        const saved=await window.ailo.read();
        if(saved.tasks.find(t=>t.id===item.taskId)?.messages?.some(m=>m.id===item.id))setQueued(previous=>previous.filter(m=>m.id!==item.id));
        else queueAutoPaused.current=true;
      }
    }catch(e){queueAutoPaused.current=true;setError(String(e).replace(/^.*Error: /,''));}
    finally{steeringRef.current=false;setSteeringSending(false);queueSendingRef.current=false;setQueueSending(undefined);}
  }
  useEffect(()=>{
    if(!ready||busy||requestRef.current||queueSendingRef.current||queueAutoPaused.current||queueEditing||!task||task.lastError||task.agentRun?.status==='waiting_user'||task.agentRun?.status==='blocked')return;
    const next=queued.find(m=>m.taskId===task.id);
    if(next)void executeQueued(next);
  },[pending,saving,importing,ready,queued,active,queueSending,queueEditing]);
  async function stop() {
    queueAutoPaused.current=true;
    cancelledRef.current = requestRef.current;
    if (requestRef.current)
      try {
        await window.ailo.cancel(requestRef.current);
      } catch {
        setError("停止失败，请重试。");
      }
  }
  async function attach() {
    if (busy) return;
    setImporting(true);
    try {
      const m = await window.ailo.pick();
      setMaterials((s) => [...s, ...m]);
      setError("");
    } catch (e) {
      setError(String(e).replace(/^.*Error: /, ""));
    } finally {
      setImporting(false);
    }
  }
  const progressAt=progressAnchor(task?.agentRun,task?messagesFor(task):[]);
  const currentProgress=task && (task.agentRun && <TaskProgress task={task} onOpenArtifacts={()=>setRightPanel('artifacts')} busy={busy} showRecovery={messagesFor(task).at(-1)?.role !== 'user'} onContinue={() => {
                  if (messagesFor(task).at(-1)?.role === 'user') { void respond(task,false); return; }
                  const message: Message = {id:crypto.randomUUID(),role:"user",content:"请从已保存的任务状态继续，先检查已有成果，不重复执行已完成步骤。"};
                  void respond({...task,messages:[...messagesFor(task),message]},false);
                }} />);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Pet size="brand" thinking={!!pending} interactive />
          Ailo
        </div>
        <button
          className="new"
          disabled={!ready || saving || importing}
          onClick={() => select(null)}
        >
          <Icon name="compose" /><span>新的对话</span>
        </button>
        <nav>
          <button
            className={view === "chat" ? "selected" : ""}
            onClick={() => setView("chat")}
          >
            <Icon name="chat" /><span>对话</span>
          </button>
          <button
            className={view === "extensions" ? "selected" : ""}
            onClick={() => setView("extensions")}
          >
            <Icon name="grid" /><span>扩展</span>
          </button>
        </nav>
        <div className="label">
          项目 <span>{data.projects.length || ""}</span>
        </div>
        <div className="project-list">
          {data.projects.length === 0 ? (
            <p className="muted">在新对话中创建项目</p>
          ) : (
            data.projects.map((p) => (
              <div key={p.id}>
              <button
                aria-expanded={!!expandedProjects[p.id]}
                aria-controls={'project-threads-'+p.id}
                disabled={saving || importing}
                className={projectId === p.id ? "selected" : ""}
                onClick={() => {
                  select(null);
                  selectProject(p.id);
                  setView("project");
                  setExpandedProjects(v=>({...v,[p.id]:!v[p.id]}));
                }}
              >
                <span aria-hidden="true">{expandedProjects[p.id]?'⌄':'›'}</span><Icon name="folder" /><span className="sidebar-project-name">{p.name}</span>
                <small>
                  {data.tasks.filter((t) => t.projectId === p.id).length}
                </small>
              </button>
              {expandedProjects[p.id]&&<div id={'project-threads-'+p.id} className="sidebar-project-threads">{data.tasks.filter(t=>t.projectId===p.id).map(t=><button type="button" key={t.id} disabled={saving||importing} className={active===t.id&&view==='chat'?'selected':''} onClick={()=>select(t.id)} title={t.title}><span>{t.title}</span>{sessions[t.id]&&<small>执行中</small>}</button>)}<button type="button" disabled={saving||importing} onClick={()=>{select(null);selectProject(p.id);}}>＋ 新建对话</button></div>}
              </div>
            ))
          )}
        </div>
        <div className="label">最近的对话</div>
        <div className="history">
          {data.tasks.length === 0 ? (
            <p className="muted">从一件想完成的事开始</p>
          ) : (
            data.tasks.map((t) => (
              <button
                key={t.id}
                disabled={saving || importing}
                className={active === t.id ? "selected" : ""}
                onClick={() => select(t.id)}
              >
                <span>{t.title}</span>{sessions[t.id]&&<small className="session-status">{sessions[t.id].status.startsWith('等待执行')?'排队中':'执行中'}</small>}
              </button>
            ))
          )}
        </div>
        <button className="sidebar-about" onClick={() => setView("about")}><Icon name="info" /><span>关于 Ailo</span></button>
        <button
          className={"profile " + (view === "account" ? "selected" : "")}
          disabled={!accountReady}
          onClick={() => setView("account")}
          aria-label={user ? "查看用户信息" : "登录或注册"}
        >
          <span className="avatar">
            {user ? Array.from(user.name)[0]?.toUpperCase() : <Icon name="user" />}
          </span>
          <span className="profile-copy">
            {user ? user.name : "登录 / 注册"}
            <small>{user ? user.email : "登录你的 Ailo 账号"}</small>
          </span>
          <span className="profile-arrow"><Icon name="chevron" /></span>
        </button>
      </aside>
      <main>
        <header>
          <div>
            <strong>
              {view === "extensions" ? "扩展" : view === "about"
                ? "关于 Ailo"
                : view === "models"
                  ? "偏好设置"
                  : view === "account"
                    ? "我的账号"
                    : view === "project" ? data.projects.find(p=>p.id===projectId)?.name || "项目" : task?.title || "你的个人助手"}
            </strong>
            <small>
              <span className="dot" />
              {saving
                ? "正在保存…"
                : ready
                  ? "本地记录已就绪"
                  : "正在读取工作空间"}
            </small>
          </div>
          <div className="header-controls">
            {view === "chat" && task && (
              <span className="header-model">
                {task.modelName && task.modelId !== "demo"
                  ? task.modelName
                  : "尚未回复"}
              </span>
            )}
            {task && view === "chat" && (
              <button onClick={() => setRightPanel(showPanel?null:'materials')}>
                {showPanel ? "收起材料" : "查看材料"}
              </button>
            )}
            {task && view === "chat" && <button className="artifact-toggle" aria-label={rightPanel==='artifacts'?'收起产物':'查看产物'} aria-expanded={rightPanel==='artifacts'} aria-controls="artifact-panel" onClick={()=>setRightPanel(rightPanel==='artifacts'?null:'artifacts')}><Icon name="panel"/><span>产物{task.agentRun?.artifacts.length?` (${task.agentRun.artifacts.length})`:''}</span></button>}
          </div>
        </header>
        <div
          className={
            "workspace " + (task && view === "chat" && rightPanel ? "split" : "")
          }
        >
          <section className="conversation">
            {view === "project" && data.projects.some(p=>p.id===projectId) ? <ProjectOverview key={projectId} project={data.projects.find(p=>p.id===projectId)!} tasks={data.tasks.filter(t=>t.projectId===projectId)} onSelect={select} onNew={()=>{const id=projectId;select(null);selectProject(id);}}/> : view === "extensions" ? (
              <ExtensionCenter initialTab={extensionTab} items={availableExtensions} busy={busy || !ready}
                onTryConnection={text=>{setConnectionChoices(v=>({...v,[connectionKey]:true}));setView("chat");setInput(text);setError("");}}
                onImporting={setImporting}
                onMaterial={material=>{setMaterials(items=>[...items,material]);setView("chat");setError("");}}
                onSave={async items => { const ok = await commit({...data, extensions:items}); if (ok) setExtensionIds(ids => ids.filter(id => items.some(i => i.id === id && i.enabled))); return ok; }}
                onUse={item => {
                  const ids = item.kind === "expert" ? selectedIds.filter(id => availableExtensions.find(e => e.id === id)?.kind !== "expert") : selectedIds;
                  if (!ids.includes(item.id) && item.kind === "skill" && ids.filter(id => availableExtensions.find(e => e.id === id)?.kind === "skill").length >= 5) { setError("最多选择 5 个技能，请先在聊天框移除一个。"); return; }
                  setExtensionIds([...new Set([...ids,item.id])]); setView("chat"); setError("");
                }} />
            ) : view === "account" ? (
              <AccountPage
                user={user}
                onUser={setUser}
                onBack={() => setView("chat")}
              />
            ) : view === "models" ? (
              <>
                <button
                  className="back-link settings-back"
                  onClick={() => setView("chat")}
                >
                  ← 返回对话
                </button>
                <ModelSettings
                  data={data}
                  saving={busy}
                  commit={async (next) => {
                    const added = next.models.find(
                      (m) => !data.models.some((old) => old.id === m.id),
                    );
                    const ok = await commit(next);
                    if (ok && added) setModelId(added.id);
                    return ok;
                  }}
                />
              </>
            ) : view === "about" ? (
              <div className="about-page">
                <div className="about-intro">
                  <Pet interactive />
                  <div><h1>关于 Ailo</h1><p className="about-version">macOS 预览版 · {__AILO_VERSION__}</p></div>
                </div>
                <p className="about-description">你的个人 AI 助手。从一个问题、一份材料，开始推进手头的事。</p>
                <div className="about-sections">
                  <section>
                    <h2>对话，也能行动</h2>
                    <p>整理材料、分析需求、规划项目。按任务需要调用工具，查看执行进度与成果。</p>
                    <p>用「+」添加文件，输入 @ 引用对话文件，输入 / 选择专家和技能。</p>
                  </section>
                  <section>
                    <h2>选择适合你的模型</h2>
                    <p>支持 OpenAI 兼容接口，需配置自己的模型服务。飞书与联网搜索可在「扩展」中按需连接。</p>
                  </section>
                  <section>
                    <h2>数据与使用范围</h2>
                    <p>记录保存在本机；对话和相关材料会发送给你选择的模型服务商。当前不支持云端同步或自动更新。</p>
                    <p>支持文本、Markdown、DOCX 及压缩包中的可读文件。PDF 与图片内容暂不解析；开发任务可能需要额外工具链。</p>
                  </section>
                </div>
              </div>
            ) : !task ? (
              <div className="welcome home-welcome">
                <Pet interactive />
                <div className="eyebrow">YOUR EVERYDAY COMPANION</div>
                <h1>今天，有什么想交给我？</h1>
                <p>一个问题、一份材料，或一件想完成的事。</p>
                <div className="suggestions">
                  {[
                    "根据需求和界面稿，开发一个安卓应用",
                    "把这些资料整理成一份研究报告",
                    "帮我规划一个新项目",
                  ].map((s) => (
                    <button key={s} onClick={() => setInput(s)}>
                      {s}
                      <span>↗</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="thread">
                <div className="day">
                  {new Date(task.created).toLocaleDateString("zh-CN")} ·{" "}
                  {data.projects.find((p) => p.id === task.projectId)?.name ||
                    "未归类"}
                </div>
                {task.agentRun?.history?.filter(r=>!messagesFor(task).some(m=>m.id===r.afterMessageId)).map((r,i)=><ExecutionHistory key={r.executionId||i} task={task} run={r} onOpenArtifacts={()=>setRightPanel('artifacts')}/>)}
                {!progressAt && currentProgress && <details className="completed-execution"><summary>此前任务进度</summary>{currentProgress}</details>}
                {messagesFor(task).map((message) => (
                  <div
                    key={message.id}
                    className={message.role === "user" ? "user-turn" : "reply"}
                  >
                    {message.role === "assistant" && (
                      <div className="byline">
                        <Pet size="mini" />
                        Ailo
                        <small>{message.modelName}</small>
                      </div>
                    )}
                    <div
                      className={
                        message.role === "user" ? "bubble" : "assistant-text"
                      }
                    >
                      {message.role === "assistant" ? <AssistantText content={message.content}/> : message.content}
                    </div>
                    {message.role === "assistant" && message.clarification && <ClarificationCard
                      messageId={message.id} value={message.clarification} disabled={busy}
                      active={messagesFor(task).at(-1)?.id === message.id}
                      completed={messagesFor(task).find(m => m.clarificationReplyTo === message.id)?.clarificationAnswers}
                      onSubmit={(answers, attached) => answerQuestions(message, answers, attached)} />}
                    {!!message.materials?.length && (
                      <div className="attachments">
                        {message.materials.map((m, i) => (
                          <span key={i}>▤ {m.name}</span>
                        ))}
                      </div>
                    )}
                    {progressAt===message.id && currentProgress}
                    {task.agentRun?.history?.filter(r=>r.afterMessageId===message.id).map((r,i)=><ExecutionHistory key={r.executionId||i} task={task} run={r} onOpenArtifacts={()=>setRightPanel('artifacts')}/>)}
                  </div>
                ))}
                {pending === task.id ? (
                  <div className="reply" role="status">
                    <div className="byline">
                      <Pet size="mini" thinking />
                      Ailo
                    </div>
                    {visibleReply(streamText) && <div className="assistant-text">{visibleReply(streamText)}</div>}
                    <p className="muted">{chatStatus || `正在等待 ${currentModel.name} 回复…`}</p>
                  </div>
                ) : (
                  messagesFor(task).at(-1)?.role === "user" && (
                    <div className="chat-retry">
                      {task.partialReply && <details><summary>查看未完成的回复（不计入后续上下文）</summary><div className="assistant-text">{task.partialReply}</div></details>}
                      <p
                        className={task.lastError ? "error" : "muted"}
                        role={task.lastError ? "alert" : undefined}
                      >
                        {(task.lastError?.includes('有效动作 JSON') ? '模型暂时未能给出可执行的下一步，需求与材料已保留。请重试当前步骤；若持续失败，请更换支持工具调用的模型。' : task.lastError) ||
                          "这条消息还没有模型回复。选择模型后可以继续。"}
                      </p>
                      <button
                        className={task.agentRun ? 'primary' : undefined}
                        disabled={busy}
                        onClick={() => void respond(task, false)}
                      >
                        {task.agentRun ? "重试当前步骤" : task.lastError ? "重试回复" : "发送给模型"}
                      </button>
                      <button onClick={() => setView("models")}>
                        配置模型
                      </button>
                    </div>
                  )
                )}

                <div ref={threadEnd} />
              </div>
            )}
            {view === "chat" && (
              <div className={"compose-area " + (task ? "chat-compose" : "")}>
                {task && pending===task.id && <TaskActivity task={task} status={chatStatus}/>}
                {task && queued.some(m=>m.taskId===task.id) && <div className="message-queue" aria-label="待发送消息">
                  <p><Icon name="queue"/>待发送 · {queued.filter(m=>m.taskId===task.id).length}</p>
                  {queued.filter(m=>m.taskId===task.id).map(item=><div className="queued-message" key={item.id}>
                    {queueEditing===item.id?<><textarea aria-label="编辑待发送消息" value={queueDraft} maxLength={20000} onChange={e=>setQueueDraft(e.target.value)}/><button type="button" title="保存" aria-label="保存" disabled={!queueDraft.trim()} onClick={()=>{setQueued(previous=>previous.map(m=>m.id===item.id?{...m,content:queueDraft.trim()}:m));setQueueEditing(undefined);}}><Icon name="check"/></button><button type="button" title="取消" aria-label="取消" onClick={()=>setQueueEditing(undefined)}><Icon name="close"/></button></>:<><i className="queued-state" title={queueSending===item.id?'正在处理':'队列中'} aria-label={queueSending===item.id?'正在处理':'队列中'}><Icon name="clock"/></i><span title={item.content}>{item.content}</span><div className="queued-actions"><button type="button" title="立即执行" aria-label="立即执行" disabled={!!queueSending||steeringSending} onClick={()=>void executeQueued(item)}><Icon name="play"/></button><button type="button" title="编辑" aria-label="编辑" disabled={queueSending===item.id} onClick={()=>{setQueueEditing(item.id);setQueueDraft(item.content);}}><Icon name="edit"/></button><button type="button" title="删除" aria-label="删除" disabled={queueSending===item.id} onClick={()=>setQueued(previous=>previous.filter(m=>m.id!==item.id))}><Icon name="trash"/></button></div></>}
                  </div>)}
                </div>}
                <form className="composer" onSubmit={submit}>
                  {materials.length > 0 && (
                    <div className="attachments">
                      {materials.map((m, i) => (
                        <button
                          type="button"
                          title={m.summary || m.name}
                          key={i}
                          disabled={busy}
                          onClick={() =>
                            setMaterials((s) => s.filter((_, j) => j !== i))
                          }
                        >
                          {m.archive ? "▣ " : ""}
                          {m.name}
                          {m.summary && <small>{m.summary}</small>} ×
                        </button>
                      ))}
                    </div>
                  )}
                  <ComposerInput
                    key={connectionKey}
                    value={input} onChange={setInput}
                    placeholder={pending ? "补充指令…" : "告诉 Ailo 你想做什么… @ 引用对话文件，/ 调用专家和技能"}
                    disabled={!ready || busy}
                    files={[...(task?.materials || []), ...materials]}
                    materials={materials} extensions={availableExtensions} selectedIds={selectedIds}
                    onFile={file => setMaterials(previous => [...previous, file])}
                    onExtensions={ids => { setExtensionIds(ids); setNotice(""); }}
                    onSubmit={event => { void submit(event); }}
                  />
                  <div className="composerbar">
                  <ComposerAdd searchEnabled={useSearch} setSearchEnabled={enabled=>{setSearchChoices(v=>({...v,[connectionKey]:enabled}));if(task)void window.ailo.patchTask(task.id,{searchEnabled:enabled}).then(saved=>setData(d=>({...d,tasks:d.tasks.map(t=>t.id===saved.id?{...t,searchEnabled:enabled}:t)})));}} onProject={!task?setProjectMenuAnchor:undefined} feishu={useFeishu} setFeishu={enabled=>{setConnectionChoices(v=>({...v,[connectionKey]:enabled}));if(task)void window.ailo.patchTask(task.id,{feishuEnabled:enabled}).then(saved=>setData(d=>({...d,tasks:d.tasks.map(t=>t.id===saved.id?{...t,feishuEnabled:enabled}:t)})));}} key={task?.id || projectId || "new"} items={availableExtensions} value={selectedIds} disabled={!ready || busy} onChange={ids => { setExtensionIds(ids); setNotice(""); }} onManage={tab => {setExtensionTab(tab);setView("extensions");}} onAttach={attach} importing={importing}
                    onDefault={(task?.projectId || projectId) ? () => { const id = task?.projectId || projectId; void commit({...data, projects:data.projects.map(p => p.id === id ? {...p,extensionIds:selectedIds} : p)}).then(ok => { if(ok) setNotice("已保存为项目默认扩展，将用于该项目的新对话。"); }); } : undefined} />
                    <ContextMeter
                      messages={[...(task ? messagesFor(task) : []), ...(input || materials.length ? [{ role: "user" as const, content: input, materials }] : [])]}
                      extensions={availableExtensions.filter(e => selectedIds.includes(e.id))}
                      model={currentModel} checkpoint={task?.contextCheckpoint} promptTokens={task?.promptTokens}
                      run={task?.agentRun}
                      onConfigure={() => setView("models")} />
                    <ModelPicker
                      models={models}
                      value={currentModel.id}
                      defaultId={data.defaultModelId}
                      disabled={!ready || busy}
                      onSelect={setModelId}
                      onConfigure={() => setView("models")}
                    />
                    {pending && !input.trim() ? (
                      <button
                        type="button"
                        className="primary send stop-button"
                        title="停止回复"
                        aria-label="停止回复"
                        onClick={() => void stop()}
                      >
                        <span className="stop-icon" aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        className="primary send"
                        disabled={
                          !input.trim() ||
                                              !ready ||
                          saving || importing ||
                          (!!pending && input.trim().length > 20000)
                        }
                        type="submit"
                        title={pending ? "加入待发送队列" : "发送需求"}
                        aria-label={pending ? "加入待发送队列" : "发送需求"}
                      >
                        <Icon name="arrow-up" />
                      </button>
                    )}
                  </div>
                </form>
                <div className="composer-context">
                  {!task ? (
                    <ProjectPicker
                      menuAnchor={projectMenuAnchor}
                      onMenuClose={()=>setProjectMenuAnchor(null)}
                      hideEmptyTrigger
                      projects={data.projects}
                      value={projectId}
                      disabled={!ready || busy}
                      onSelect={selectProject}
                      onCreate={addProject}
                      onOpenLocal={async()=>{const project=await window.ailo.openLocalProject();if(project){setData(d=>({...d,projects:d.projects.some(p=>p.id===project.id)?d.projects:[...d.projects,project]}));setProjectId(project.id);setExtensionIds(project.extensionIds||[]);}}}
                    />
                  ) : task.projectId ? (
                    <span className="thread-project">
                      ▱{" "}
                      {data.projects.find((p) => p.id === task.projectId)
                        ?.name || "未归类"}
                    </span>
                  ) : null}
                  <span className="composer-status">
                    {currentModel.id === "demo"
                        ? "请先配置模型"
                        : "Enter 发送 · Shift + Enter 换行"}
                  </span>
                </div>
                {notice && <p className="extension-notice" role="status">{notice}</p>}
              </div>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
                {currentModel.id === "demo" && (
                  <button onClick={() => setView("models")}>
                    配置自定义模型
                  </button>
                )}
              </p>
            )}
          </section>
          {task && view === "chat" && rightPanel==='artifacts' && <ArtifactPanel key={task.id} task={task} onClose={()=>setRightPanel(null)}/>}
          {task && view === "chat" && showPanel && (
            <aside className="inspector">
              <h2>对话材料</h2>
              {!task.materials.length ? (
                <p className="muted">此对话没有附件。</p>
              ) : (
                task.materials.map((m, i) => (
                  <details key={i}>
                    <summary>{m.name}</summary>
                    <small>
                      {m.summary || (m.text !== null ? "文本材料" : "尚未解析")}
                    </small>
                    {m.text !== null && <pre>{m.text}</pre>}
                  </details>
                ))
              )}
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

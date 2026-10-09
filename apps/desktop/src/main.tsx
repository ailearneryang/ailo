import {supportsReasoning} from "../reasoning.cjs";
import {CompanionNavigation} from './companion-navigation';
import {PetSettings} from './pet-settings';
import {ProfileMenu} from './profile-menu';
import './appearance';
import './appearance.css';
import {AppearanceSettings} from './appearance-settings';
import { canSendMaterial, isImageMaterial } from "../attachments.mjs";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import {KnowledgeCenter,KnowledgePicker} from './knowledge';
import { Schedules } from "./schedules";
import { MyAilo } from "./my-ailo";
import { AccountPage, ModelSettings } from "./settings";
import { AssistantText } from "./assistant-text";
import { ConversationNavigation } from './conversation-navigation';
import { ProjectNavigation } from "./project-navigation";
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
import { workspacePetState, taskPetState, unreadAttentionTasks, petNotificationToken } from "./pet-state";
import {
  demoModel,
  emptyWorkspace,
  type Material,
  type Task,
  type Workspace,
  type User,
  type Message,
} from "./types";
const ASSISTANT_ID = "my-ailo-assistant";
function App() {
  const [data, setData] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<string | null>(ASSISTANT_ID);
  const [knowledgeMenuAnchor,setKnowledgeMenuAnchor]=useState<HTMLButtonElement|null>(null);
  const [newKnowledgeIds,setNewKnowledgeIds]=useState<string[]>([]);
  const [view, setView] = useState("assistant");
  const [expandedProjects,setExpandedProjects]=useState<Record<string,boolean>>({});
  const [messageEdit,setMessageEdit]=useState<{taskId:string;messageId:string;content:string}|null>(null);
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
  const [scheduleTarget,setScheduleTarget]=useState<string|null>(null);
  const [extensionTab,setExtensionTab]=useState<'expert'|'skill'|'connector'>('expert');
  const [reasoningChoices,setReasoningChoices]=useState<Record<string,'low'|'medium'|'high'>>({});
  const [searchChoices,setSearchChoices]=useState<Record<string,boolean>>({});
  const [mcpChoices,setMCPChoices]=useState<Record<string,string[]>>({});
  const [amapChoices,setAMapChoices]=useState<Record<string,boolean>>({});
  const [connectionChoices,setConnectionChoices]=useState<Record<string,boolean>>({});
  const [extensionIds, setExtensionIds] = useState<string[]>([]);
  const [turnExtensions, setTurnExtensions] = useState<Record<string,string[]>>({});
  const [notice, setNotice] = useState("");
  const availableExtensions = data.extensions || [];
  const selectedIds = extensionIds.filter(id => availableExtensions.some(e => e.id === id && e.enabled && e.kind === 'expert'));
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
  const recentTasks = data.tasks.filter(t=>t.id !== ASSISTANT_ID).sort((a,b)=>Date.parse(b.scheduledAt||b.created)-Date.parse(a.scheduledAt||a.created)).filter((t,index,items)=>!t.scheduledTaskId || t.scheduledArchived || items.findIndex(other=>other.scheduledTaskId===t.scheduledTaskId)===index);
  const isConversation = view === "chat" || view === "assistant";
  const task = data.tasks.find((t) => t.id === active);
  const attentionCount = unreadAttentionTasks(data.tasks, Object.keys(sessions)).length;
  const companionState = workspacePetState(data.tasks, sessions);
  const markingPetRead = useRef<string | null>(null);
  useEffect(() => {
    function markRead() {
      if (!isConversation || !task || pending || document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const token = petNotificationToken(task);
      const key = task.id + ':' + token;
      if (!token || token === task.petReadToken || markingPetRead.current === key) return;
      markingPetRead.current = key;
      void window.ailo.patchTask(task.id, { petReadToken: token }).then(() => {
        setData(previous => ({...previous, tasks: previous.tasks.map(item => item.id === task.id ? {...item, petReadToken: token} : item)}));
      }).catch(() => {}).finally(() => { if (markingPetRead.current === key) markingPetRead.current = null; });
    }
    markRead(); window.addEventListener('focus', markRead); document.addEventListener('visibilitychange', markRead);
    return () => { window.removeEventListener('focus', markRead); document.removeEventListener('visibilitychange', markRead); };
  }, [task, pending, isConversation]);
  const connectionKey=task?.id || projectId || "new";
  const turnIds=(turnExtensions[connectionKey] || []).filter(id=>availableExtensions.some(e=>e.id===id&&e.enabled));
  const turnHasExpert=turnIds.some(id=>availableExtensions.find(e=>e.id===id)?.kind==='expert');
  const effectiveIds=[...new Set([...selectedIds.filter(id=>!turnHasExpert||availableExtensions.find(e=>e.id===id)?.kind!=='expert'),...turnIds])];
  function changeConversationExtensions(ids:string[]) {
    setExtensionIds(ids);setNotice("");
    if(task)void window.ailo.patchTask(task.id,{extensionIds:ids}).then(saved=>setData(d=>({...d,tasks:d.tasks.map(t=>t.id===saved.id?{...t,extensionIds:ids}:t)}))).catch(e=>setError(String(e)));
  }
  function changeAddedExtensions(ids:string[]) {
    changeConversationExtensions(ids.filter(id=>availableExtensions.find(e=>e.id===id)?.kind==='expert'));
    setTurnExtensions(previous=>({...previous,[connectionKey]:[...turnIds.filter(id=>availableExtensions.find(e=>e.id===id)?.kind==='expert'),...ids.filter(id=>availableExtensions.find(e=>e.id===id)?.kind==='skill')]}));
  }
  const reasoningSupported=supportsReasoning(currentModel);
  const reasoningEffort=reasoningChoices[connectionKey] ?? task?.reasoningEffort ?? 'medium';
  const useSearch=searchChoices[connectionKey] ?? task?.searchEnabled ?? false;
  const mcpConnectionIds=mcpChoices[connectionKey] ?? task?.mcpConnectionIds ?? [];
  function changeMCPConnections(ids:string[]) {
    setMCPChoices(v=>({...v,[connectionKey]:ids}));
    if(task)void window.ailo.patchTask(task.id,{mcpConnectionIds:ids}).then(saved=>setData(d=>({...d,tasks:d.tasks.map(t=>t.id===saved.id?{...t,mcpConnectionIds:ids}:t)}))).catch(e=>setError(String(e)));
  }
  const useAMap=amapChoices[connectionKey] ?? task?.amapEnabled;
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
    setMessageEdit(null);
    drafts.current[active||'new']={input,materials};
    const draft=drafts.current[id||'new']||{input:'',materials:[]};
    setActive(id);
    setNotice("");
    setExtensionIds(id ? data.tasks.find(t => t.id === id)?.extensionIds || [] : data.projects.find(p => p.id === projectId)?.extensionIds || []);
    if (!id) {setNewKnowledgeIds([]);setProjectId("");setExtensionIds([]);setRightPanel(null);}
    if (id) {
      const selected = data.tasks.find((t) => t.id === id);
      setProjectId(selected?.projectId || "");
      setModelId(selected?.modelId || data.defaultModelId);
    }
    setError("");
    setInput(draft.input);
    setMaterials(draft.materials);
    setView(id === ASSISTANT_ID ? "assistant" : "chat");
    if (id === null) {
      setModelId(data.defaultModelId);
    }
  }
  function modelReady() {
    if (currentModel.id !== "demo") return true;
    setError("");
    setView("models");
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
      knowledgeIds:nextTask.knowledgeIds||(data.tasks.some(t=>t.id===nextTask.id)?[]:newKnowledgeIds),
      modelId: currentModel.id,
      modelName: currentModel.name,
      reasoningEffort,
      extensionIds: selectedIds,
      feishuEnabled: useFeishu,
      amapEnabled: useAMap,
      mcpConnectionIds,
      searchEnabled: useSearch,
      lastError: undefined,
      partialReply: undefined,
    };
    try {
      const saved=await window.ailo.patchTask(updated.id,updated);
      setData(previous=>({...previous,tasks:previous.tasks.some(t=>t.id===saved.id)?previous.tasks.map(t=>t.id===saved.id?{...t,...saved}:t):[saved,...previous.tasks]}));
      setTurnExtensions(previous=>({...previous,[connectionKey]:[]}));
      if (clearDraft) {
        setInput("");
        setMaterials([]);
        delete drafts.current[nextTask.id];delete drafts.current.new;
      }
      if (cancelledRef.current === requestId)
        throw Error("已停止回复，可重新发送。");
      const result = await window.ailo.complete({
        id: requestId,
        knowledgeIds:nextTask.knowledgeIds||(data.tasks.some(t=>t.id===nextTask.id)?[]:newKnowledgeIds),
      modelId: currentModel.id,
        extensionIds: effectiveIds,
        reasoningEffort:reasoningSupported?reasoningEffort:undefined,
      feishuEnabled: useFeishu,
      amapEnabled: useAMap,
      mcpConnectionIds,
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
  async function resendEditedMessage() {
    if(!task||busy||!messageEdit||messageEdit.taskId!==task.id||!messageEdit.content.trim()||!modelReady())return;
    setSaving(true);
    let edited:Task;
    try {
      edited=await window.ailo.editLastMessage(task.id,messageEdit.messageId,messageEdit.content);
      setData(previous=>({...previous,tasks:previous.tasks.map(t=>t.id===edited.id?edited:t)}));
      setMessageEdit(null);
    } catch(e) {setError(String(e));return;}
    finally {setSaving(false);}
    await respond(edited,false);
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
    if (materials.some((m) => !canSendMaterial(m))) {
      setError(
        "有材料无法读取，请重新添加或移除不支持的文件。支持 PPT/PPTX、DOCX、文字 PDF、XLSX 和文本；图片需使用支持图片的模型。",
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
          id: view === "assistant" ? ASSISTANT_ID : crypto.randomUUID(),
          title: view === "assistant" ? "我的 Ailo" : input.trim().slice(0, 26),
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
    if (attached.some(f => !canSendMaterial(f))) throw Error("材料尚未解析，请移除后重试。");
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
    if(!ready||busy||requestRef.current||queueSendingRef.current||queueAutoPaused.current||queueEditing||!task||task.lastError||task.agentRun?.status==='waiting_user'||['blocked','waiting_permission'].includes(task.agentRun?.status||''))return;
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
  async function pasteFiles(files: File[]) {
    if (busy || !ready) return;
    setImporting(true);
    try {
      if (files.length > 10) throw Error("一次最多添加 10 个材料文件。");
      if (files.some(file => file.size > 20 * 1024 * 1024)) throw Error("单个材料文件请小于 20 MB。");
      const entries = await Promise.all(files.map(async file => ({ name: file.name || '粘贴图片.png', bytes: new Uint8Array(await file.arrayBuffer()) })));
      const imported = await window.ailo.pasteFiles(entries);
      setMaterials(previous => [...previous, ...imported]);
      setError("");
    } catch (error) {
      setError(String(error).replace(/^.*Error: /, ""));
    } finally {
      setImporting(false);
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
        <button className="brand brand-home" type="button" aria-label="Ailo 首页" title="返回首页" disabled={!ready || saving || importing} onClick={() => select(null)}>
          Ailo
        </button>
        <button
          className="new"
          disabled={!ready || saving || importing}
          onClick={() => select(null)}
        >
          <Icon name="compose" /><span>新的对话</span>
        </button>
        <nav>
          <CompanionNavigation state={companionState} count={attentionCount} selected={view === "assistant"} onSelect={()=>select(ASSISTANT_ID)}/>
          <button className={view === "knowledge" ? "selected" : ""} onClick={()=>setView("knowledge")}><Icon name="book"/><span>知识库</span></button>
          <button className={view === "schedules" ? "selected" : ""} onClick={()=>{setScheduleTarget(null);setView("schedules");}}><Icon name="clock"/><span>定时任务</span></button>
          <button
            className={view === "extensions" ? "selected" : ""}
            onClick={() => setView("extensions")}
          >
            <Icon name="grid" /><span>扩展</span>
          </button>
        </nav>
        <div className="sidebar-scroll">
          <div className="label">
            项目 <span>{data.projects.length || ""}</span>
          </div>
          <div className="project-list">
            {data.projects.length === 0 ? (
              <p className="muted">在新对话中创建项目</p>
            ) : (
              [...data.projects].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)).map(p=><ProjectNavigation key={p.id} project={p} expanded={!!expandedProjects[p.id]} selected={projectId===p.id} tasks={data.tasks.filter(t=>t.projectId===p.id)} active={view==='chat'?active:null} runningIds={Object.keys(sessions)} extensions={availableExtensions} busy={saving||importing} onExpand={()=>setExpandedProjects(v=>({...v,[p.id]:!v[p.id]}))} onOpen={()=>{select(null);selectProject(p.id);setView('project');}} onNew={()=>{select(null);selectProject(p.id);}} onSelect={select} onSave={async project=>{
                if(data.projects.some(other=>other.id!==project.id&&other.name.toLowerCase()===project.name.toLowerCase())){setError('项目名称已存在，请换个名称。');return false;}
                return commit({...data,projects:data.projects.map(old=>old.id===project.id?project:old)});
              }} onDelete={async()=>{try{if(await window.ailo.removeProject(p.id)){const latest=await window.ailo.read();setData(latest);if(projectId===p.id){select(null);setProjectId('');}}}catch(e){setError((e as Error).message);}}} onError={setError}/>)
            )}
          </div>
          <div className="label">最近的对话</div>
          <div className="history">
            {recentTasks.length === 0 ? (
              <p className="muted">从一件想完成的事开始</p>
            ) : (
              recentTasks.map((t) => (
                <button
                  key={t.id}
                  disabled={saving || importing}
                  className={(active === t.id ? "selected" : "") + (t.scheduledTaskId ? " scheduled-recent" : "")}
                  onClick={() => select(t.id)}
                >
                  <span>{t.title}</span>{t.scheduledTaskId ? <small className="scheduled-recent-date">{new Date(t.scheduledAt||t.created).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} · {sessions[t.id] ? (sessions[t.id].status.startsWith('等待执行')?'排队中':'执行中') : t.lastError || ['failed','blocked','waiting_permission','paused','waiting_user'].includes(t.agentRun?.status||'') || t.messages?.at(-1)?.clarification ? '待处理' : t.messages?.at(-1)?.role==='assistant' || t.answer ? '已有结果' : '等待结果'}</small> : sessions[t.id]&&<small className="session-status">{sessions[t.id].status.startsWith('等待执行')?'排队中':'执行中'}</small>}
                </button>
              ))
            )}
          </div>
        </div>
        <ProfileMenu user={user} ready={accountReady} onSelect={setView}/>
      </aside>
      <main>
        <header>
          <div>
            <strong>
              {view === "pets" ? "宠物与陪伴" : view === "appearance" ? "外观设置" : view === "assistant" ? "我的 Ailo" : view === "knowledge" ? "知识库" : view === "schedules" ? "定时任务" : view === "extensions" ? "扩展" : view === "about"
                ? "关于 Ailo"
                : view === "models"
                  ? "偏好设置"
                  : view === "account"
                    ? "我的账号"
                    : view === "project" ? data.projects.find(p=>p.id===projectId)?.name || "项目" : task?.title || "你的个人助手"}
            </strong>
            {(view !== "assistant" || !ready || saving) && <small>
              <span className="dot" />
              {saving
                ? "正在保存…"
                : ready
                  ? "本地记录已就绪"
                  : "正在读取工作空间"}
            </small>}
          </div>
          <div className="header-controls">
            {view === "chat" && task?.scheduledTaskId && !task.scheduledArchived && <button onClick={()=>{setScheduleTarget(task.scheduledTaskId!);setView("schedules");}}><Icon name="clock"/><span>历史记录</span></button>}
            {view === "chat" && task && (
              <span className="header-model">
                {task.modelName && task.modelId !== "demo"
                  ? task.modelName
                  : "尚未回复"}
              </span>
            )}
            {task && isConversation && (view !== "assistant" || task.materials.length > 0) && (
              <button onClick={() => setRightPanel(showPanel?null:'materials')}>
                {showPanel ? "收起材料" : "查看材料"}
              </button>
            )}
            {task && isConversation && (view !== "assistant" || !!task.agentRun?.artifacts.length) && <button className="artifact-toggle" aria-label={rightPanel==='artifacts'?'收起产物':'查看产物'} aria-expanded={rightPanel==='artifacts'} aria-controls="artifact-panel" onClick={()=>setRightPanel(rightPanel==='artifacts'?null:'artifacts')}><Icon name="panel"/><span>产物{task.agentRun?.artifacts.length?` (${task.agentRun.artifacts.length})`:''}</span></button>}
          </div>
        </header>
        <div
          className={
            "workspace " + (task && isConversation && rightPanel ? "split" : "")
          }
        >
          <section className={"conversation" + (view === "assistant" ? " assistant-conversation" : "") + (isConversation && !task ? " conversation-home" : "")}>
            {view === "assistant" && <MyAilo compact={!!task} data={data} runningIds={Object.keys(sessions)} onOpen={select} onSchedules={()=>setView("schedules")} onPets={()=>setView("pets")} />}
            {view === "pets" ? <PetSettings/> : view === "appearance" ? <AppearanceSettings/> : view === "knowledge" ? <KnowledgeCenter onUse={id=>{select(null);setNewKnowledgeIds([id]);setView("chat");setNotice("已选择知识库，发送问题即可检索资料。");}}/> : view === "schedules" ? <Schedules key={scheduleTarget||"all"} initialId={scheduleTarget||undefined} focusHistory={!!scheduleTarget} onChanged={async()=>setData(await window.ailo.read())} tasks={data.tasks} models={models} defaultModelId={data.defaultModelId} onFeishu={()=>{setExtensionTab("connector");setView("extensions");}} onModels={()=>setView("models")} onOpen={async id=>{const latest=await window.ailo.read();if(!latest.tasks.some(t=>t.id===id))throw Error('对话已删除或尚未创建');setData(latest);select(id);const opened=latest.tasks.find(t=>t.id===id)!;setModelId(opened.modelId||latest.defaultModelId);setProjectId(opened.projectId||"");setExtensionIds(opened.extensionIds||[]);}}/> : view === "project" && data.projects.some(p=>p.id===projectId) ? <ProjectOverview key={projectId} project={data.projects.find(p=>p.id===projectId)!} tasks={data.tasks.filter(t=>t.projectId===projectId)} onSelect={select} onNew={()=>{const id=projectId;select(null);selectProject(id);}}/> : view === "extensions" ? (
              <ExtensionCenter initialTab={extensionTab} items={availableExtensions} busy={busy || !ready}
                onTryConnection={(text,connector)=>{if(typeof connector==='object')changeMCPConnections([...new Set([...mcpConnectionIds,connector.mcpId])]);else if(connector==='amap')setAMapChoices(v=>({...v,[connectionKey]:true}));else setConnectionChoices(v=>({...v,[connectionKey]:true}));setView(active === ASSISTANT_ID ? "assistant" : "chat");setInput(text);setError("");}}
                onImporting={setImporting}
                onMaterial={material=>{setMaterials(items=>[...items,material]);setView(active === ASSISTANT_ID ? "assistant" : "chat");setError("");}}
                onSave={async items => { const ok = await commit({...data, extensions:items}); if (ok) setExtensionIds(ids => ids.filter(id => items.some(i => i.id === id && i.enabled))); return ok; }}
                onUse={item => {
                  const ids = item.kind === "expert" ? selectedIds.filter(id => availableExtensions.find(e => e.id === id)?.kind !== "expert") : selectedIds;
                  if (!ids.includes(item.id) && item.kind === "skill" && ids.filter(id => availableExtensions.find(e => e.id === id)?.kind === "skill").length >= 5) { setError("最多选择 5 个技能，请先在聊天框移除一个。"); return; }
                  setExtensionIds([...new Set([...ids,item.id])]); setView(active === ASSISTANT_ID ? "assistant" : "chat"); setError("");
                }} />
            ) : view === "account" ? (
              <AccountPage
                user={user}
                onUser={setUser}
                onBack={() => setView(active === ASSISTANT_ID ? "assistant" : "chat")}
              />
            ) : view === "models" ? (
              <>
                <button
                  className="back-link settings-back"
                  onClick={() => setView(active === ASSISTANT_ID ? "assistant" : "chat")}
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
                    <p>支持文本、Markdown、DOCX、PPT/PPTX、文本型 PDF、Excel 及压缩包中的可读文件。扫描型 PDF 与图片内容识别仍需 OCR 或视觉模型；开发任务可能需要额外工具链。</p>
                  </section>
                </div>
              </div>
            ) : !task ? (view === "assistant" ? null :
              <div className="welcome home-welcome">
                <Pet interactive />
                <h1>今天，有什么想交给我？</h1>
                <p>开始一件独立的事；需要持续交流或安排任务，可以使用「我的 Ailo」。</p>
              </div>
            ) : (
              <div className="thread">
                <ConversationNavigation messages={messagesFor(task)} conversationId={task.id}/>
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
                    data-conversation-turn={message.role === 'user' ? message.id : undefined}
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
                      {messageEdit?.taskId===task.id && messageEdit.messageId===message.id ? <div className="message-editor">
                        <textarea autoFocus aria-label="编辑刚刚发送的消息" value={messageEdit.content} disabled={busy} onChange={e=>setMessageEdit({...messageEdit,content:e.target.value})}/>
                        <div><button className="primary" disabled={busy||!messageEdit.content.trim()} onClick={()=>void resendEditedMessage()}>发送</button><button disabled={busy} onClick={()=>setMessageEdit(null)}>取消</button></div>
                      </div> : message.role === "assistant" ? <AssistantText content={message.content}/> : message.content}
                      {!!message.materials?.length && <div className="message-files" aria-label="消息附件">
                        {message.materials.map((material,i)=><span className="message-file" key={i} title={material.name}><Icon name="file"/><span>{material.name}</span></span>)}
                      </div>}
                    </div>
                    {message.role==='user' && messagesFor(task).at(-1)?.id===message.id && !pending && messageEdit?.taskId!==task.id && (
                      <div className="message-actions">
                        <button type="button" title="编辑消息" aria-label="编辑消息" disabled={busy} onClick={()=>setMessageEdit({taskId:task.id,messageId:message.id,content:message.content})}><Icon name="edit"/></button>
                      </div>
                    )}
                    {message.role === "assistant" && message.clarification && <ClarificationCard
                      messageId={message.id} value={message.clarification} disabled={busy}
                      active={messagesFor(task).at(-1)?.id === message.id}
                      completed={messagesFor(task).find(m => m.clarificationReplyTo === message.id)?.clarificationAnswers}
                      onSubmit={(answers, attached) => answerQuestions(message, answers, attached)} />}
                    {view === "assistant" && data.tasks.filter(t=>(t.parentAssistantId === ASSISTANT_ID && t.parentMessageId === message.id) || task.assistantReferences?.[message.id]?.includes(t.id)).map(linked=><button key={linked.id} className="assistant-linked-task" onClick={()=>select(linked.id)}><Icon name="folder"/><span><strong>{linked.title}</strong><small>{sessions[linked.id] ? sessions[linked.id].status : linked.assistantPaused ? "已暂停" : linked.lastError ? "需要处理" : linked.agentRun?.status === "completed" ? "成果已准备好" : linked.messages?.at(-1)?.clarification ? "需要补充信息" : linked.messages?.at(-1)?.role === "assistant" ? "已有结果" : "查看任务进度"}{linked.agentRun?.artifacts.length ? ` · ${linked.agentRun.artifacts.length} 项成果` : ""}</small></span><span>查看任务 ↗</span></button>)}
                    {view === "assistant" && task.assistantScheduleLinks?.filter(link=>link.messageId===message.id).map(link=><button key={link.id} className="assistant-linked-task" onClick={()=>setView("schedules")}><Icon name="clock"/><span><strong>{link.title}</strong><small>已保存到定时任务</small></span><span>查看安排 ↗</span></button>)}
                    {progressAt===message.id && currentProgress}
                    {task.agentRun?.history?.filter(r=>r.afterMessageId===message.id).map((r,i)=><ExecutionHistory key={r.executionId||i} task={task} run={r} onOpenArtifacts={()=>setRightPanel('artifacts')}/>)}
                  </div>
                ))}
                {pending === task.id ? (visibleReply(streamText) && (
                  <div className="reply">
                    <div className="byline">
                      <Pet size="mini" state={taskPetState(task, chatStatus)} />
                      Ailo
                    </div>
                    <div className="assistant-text"><AssistantText content={visibleReply(streamText)}/></div>
                  </div>
                )) : (
                  messagesFor(task).at(-1)?.role === "user" &&
                  !/^已停止(?:回复|执行)(?:[。，]|$)/.test(task.lastError || "") && (
                    <div className="chat-retry">
                      {task.partialReply && <details><summary>查看未完成的回复（不计入后续上下文）</summary><div className="assistant-text"><AssistantText content={task.partialReply}/></div></details>}
                      <p
                        className={task.lastError ? "error" : "muted"}
                        role={task.lastError ? "alert" : undefined}
                      >
                        {(task.lastError?.includes('有效动作 JSON') ? '模型暂时未能给出可执行的下一步，需求与材料已保留。请重试当前步骤；若持续失败，请更换支持工具调用的模型。' : task.lastError) ||
                          "这条消息还没有模型回复。选择模型后可以继续。"}
                      </p>
                      <button
                        className={task.agentRun ? 'primary' : undefined}
                        disabled={busy||messageEdit?.taskId===task.id}
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
            {isConversation && (
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
                    placeholder={view === "assistant" ? "" : pending ? "补充指令…" : "告诉 Ailo 你想做什么… @ 引用对话文件，/ 调用专家和技能"}
                    disabled={!ready || busy}
                    files={[...(task?.materials || []), ...materials]}
                    materials={materials} extensions={availableExtensions} selectedIds={effectiveIds}
                    turnIds={turnIds} onRemoveExtension={id=>setTurnExtensions(previous=>({...previous,[connectionKey]:turnIds.filter(value=>value!==id)}))}
                    onPasteFiles={files => { void pasteFiles(files); }}
                    onFile={file => setMaterials(previous => [...previous, file])}
                    onExtensions={ids => { setTurnExtensions(previous=>({...previous,[connectionKey]:ids.filter(id=>!selectedIds.includes(id))})); setNotice(""); }}
                    onSubmit={event => { void submit(event); }}
                  />
                  <div className="composerbar">
                    <KnowledgePicker openFrom={knowledgeMenuAnchor} onClose={()=>setKnowledgeMenuAnchor(null)} key={'knowledge-'+(task?.id||view)} value={task?(task.knowledgeIds||[]):newKnowledgeIds} disabled={!ready||busy||!!pending} onManage={()=>setView('knowledge')} onChange={ids=>{if(task)void window.ailo.patchTask(task.id,{knowledgeIds:ids}).then(saved=>setData(d=>({...d,tasks:d.tasks.map(t=>t.id===saved.id?{...t,knowledgeIds:ids}:t)}))).catch(e=>setError(String(e)));else setNewKnowledgeIds(ids);}}/>
                  <ComposerAdd mcpConnectionIds={mcpConnectionIds} setMCPConnectionIds={changeMCPConnections} amap={useAMap===true} setAMap={enabled=>{setAMapChoices(v=>({...v,[connectionKey]:enabled}));if(task)void window.ailo.patchTask(task.id,{amapEnabled:enabled}).then(saved=>setData(d=>({...d,tasks:d.tasks.map(t=>t.id===saved.id?{...t,amapEnabled:enabled}:t)})));}} onKnowledge={setKnowledgeMenuAnchor} searchEnabled={useSearch} setSearchEnabled={enabled=>{setSearchChoices(v=>({...v,[connectionKey]:enabled}));if(task)void window.ailo.patchTask(task.id,{searchEnabled:enabled}).then(saved=>setData(d=>({...d,tasks:d.tasks.map(t=>t.id===saved.id?{...t,searchEnabled:enabled}:t)})));}} onProject={!task && view !== "assistant"?setProjectMenuAnchor:undefined} feishu={useFeishu} setFeishu={enabled=>{setConnectionChoices(v=>({...v,[connectionKey]:enabled}));if(task)void window.ailo.patchTask(task.id,{feishuEnabled:enabled}).then(saved=>setData(d=>({...d,tasks:d.tasks.map(t=>t.id===saved.id?{...t,feishuEnabled:enabled}:t)})));}} key={task?.id || projectId || "new"} items={availableExtensions} value={[...selectedIds,...turnIds.filter(id=>availableExtensions.find(e=>e.id===id)?.kind==='skill')]} disabled={!ready || busy} onChange={changeAddedExtensions} onManage={tab => {setExtensionTab(tab);setView("extensions");}} onAttach={attach} importing={importing}
                    onDefault={(task?.projectId || projectId) ? () => { const id = task?.projectId || projectId; void commit({...data, projects:data.projects.map(p => p.id === id ? {...p,extensionIds:selectedIds} : p)}).then(ok => { if(ok) setNotice("已保存为项目默认扩展，将用于该项目的新对话。"); }); } : undefined} />
                    {currentModel.id !== "demo" && <ContextMeter
                      messages={[...(task ? messagesFor(task) : []), ...(input || materials.length ? [{ role: "user" as const, content: input, materials }] : [])]}
                      extensions={availableExtensions.filter(e => effectiveIds.includes(e.id))}
                      model={currentModel} checkpoint={task?.contextCheckpoint} promptTokens={task?.promptTokens}
                      run={task?.agentRun}
                      onConfigure={() => setView("models")} />}
                    {currentModel.id === "demo" ? <button type="button" className="model-connect" disabled={!ready || busy} onClick={()=>{setError("");setView("models");}}>连接模型，开始使用 <span aria-hidden="true">→</span></button> : <ModelPicker
                      models={models}
                      value={currentModel.id}
                      defaultId={data.defaultModelId}
                      reasoningSupported={reasoningSupported} reasoningEffort={reasoningEffort}
                      onReasoningChange={effort=>{setReasoningChoices(previous=>({...previous,[connectionKey]:effort}));if(task)void window.ailo.patchTask(task.id,{reasoningEffort:effort}).then(saved=>setData(previous=>({...previous,tasks:previous.tasks.map(t=>t.id===saved.id?{...t,reasoningEffort:effort}:t)}))).catch(e=>setError(String(e)));}}
                      disabled={!ready || busy}
                      onSelect={setModelId}
                      onConfigure={() => setView("models")}
                    />}
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
                  {!task && view !== "assistant" ? (
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
                  ) : task?.projectId ? (
                    <span className="thread-project">
                      ▱{" "}
                      {data.projects.find((p) => p.id === task.projectId)
                        ?.name || "未归类"}
                    </span>
                  ) : null}
                  <span className="composer-status">
                    {currentModel.id === "demo"
                        ? "需求会保留，连接模型后即可发送"
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
          {task && isConversation && rightPanel==='artifacts' && <ArtifactPanel key={task.id} task={task} onRequest={text=>setInput(text)} onClose={()=>setRightPanel(null)}/>}
          {task && isConversation && showPanel && (
            <aside className="inspector">
              <h2>对话材料</h2>
              {!task.materials.length ? (
                <p className="muted">此对话没有附件。</p>
              ) : (
                task.materials.map((m, i) => (
                  <details key={i}>
                    <summary>{m.name}</summary>
                    <small>
                      {m.summary || (m.text !== null ? "文本材料" : isImageMaterial(m) ? "图片材料（由模型识别）" : "尚未解析")}
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

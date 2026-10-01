import React,{useEffect,useState,useRef} from 'react';
import {SearchConnection} from './search-connection';
import type {FeishuConnectionState} from './types';
const initial:FeishuConnectionState={installed:false,enabled:false,connected:false,phase:'loading',message:''};
export function FeishuCliConnection({onTry,children}:{onTry:(text:string)=>void;children?:React.ReactNode}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const awaitingSuccess=useRef(false);
 const [query,setQuery]=useState('');const [searchConnected,setSearchConnected]=useState(false);
 const tryChat=(text:string)=>{dialog.current?.close();onTry(text);};
 const [state,setState]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[scopes,setScopes]=useState('');
 useEffect(()=>{
  if(state.phase==='authorizing')awaitingSuccess.current=true;
  if(state.connected&&state.phase==='connected'&&awaitingSuccess.current){awaitingSuccess.current=false;if(!dialog.current?.open)dialog.current?.showModal();}
  if(state.phase==='error')awaitingSuccess.current=false;
 },[state.connected,state.phase]);
 useEffect(()=>{
  let disposed=false,timer:ReturnType<typeof setTimeout>;
  const refresh=async()=>{try{const s=await window.ailo.feishuCliStatus();if(!disposed)setState(s);}catch{if(!disposed)setError('连接状态读取失败，请重新检测。');}finally{if(!disposed)timer=setTimeout(refresh,3000);}};
  void refresh();return()=>{disposed=true;clearTimeout(timer);};
 },[]);
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError(String(e).replace(/^.*Error: /,''));}finally{setBusy(false);}}
 async function connectDirect(){
  if(busy||state.phase==='loading')return;
  await run(async()=>{
   if(!state.installed){await window.ailo.feishuCliInstallGuide();return;}
   if(state.phase==='authorizing'){if(state.url)await window.ailo.feishuCliAuthorize();return;}
   awaitingSuccess.current=true;setState(await window.ailo.feishuCliConnect());
  });
 }
 const label=state.phase==='authorizing'?'等待飞书授权':state.connected?'已连接':state.phase==='loading'?'检测中…':state.installed?'未连接':'未安装 CLI';
 return <>
  <div className="extension-toolbar connection-toolbar"><span>已连接 {(state.connected?1:0)+(searchConnected?1:0)} 个应用</span><input aria-label="搜索应用连接" placeholder="搜索应用名称或用途…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
  <div className="connection-grid">{('飞书 feishu lark 消息 文档 日程 表格 待办'.includes(query.trim().toLowerCase()))?<article className={'connection-tile '+(state.connected?'is-connected':'')}>
   <button className="connection-tile-main" disabled={busy||state.phase==='loading'} onClick={()=>state.connected||state.phase==='authorizing'||state.phase==='error'||error?dialog.current?.showModal():void connectDirect()} aria-label={state.connected||state.phase==='authorizing'||state.phase==='error'||error?"查看飞书连接详情":"连接飞书"}>
    <span className="connection-tile-heading"><img className="feishu-mark" src="./feishu.png" alt="" aria-hidden="true"/><strong>飞书</strong>{state.connected&&<span className="connection-dot" role="img" aria-label="已连接" title="已连接"/>}{(!state.connected&&(state.phase==='authorizing'||state.phase==='loading'||state.phase==='error'||error))&&<span className="connection-tile-status">{state.phase==='error'||error?'连接异常':label}</span>}</span>
    <span className="connection-tile-description">在对话中查询日程、查找和创建文档、整理待办，按你的要求操作飞书消息与表格。</span>
   </button>
   <button className="connection-tile-action" title={state.connected?'去对话':'添加飞书连接'} aria-label={state.connected?'去对话':'添加飞书连接'} onClick={()=>state.connected?tryChat('帮我查看飞书今天的日程，并整理需要准备的事项。'):void connectDirect()} disabled={busy||state.phase==='loading'}>{state.connected?<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 19l-4 3v-6a8 8 0 01-1-4V9a7 7 0 017-7h4a7 7 0 017 7v3a7 7 0 01-7 7z"/><path d="M8 10h8m-5-3l-3 3 3 3"/></svg>:'＋'}</button>
  </article>:null}<SearchConnection query={query} onState={setSearchConnected}/></div>
  <dialog ref={dialog} className="connection-dialog" aria-label="飞书连接管理" onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close();}}>
   <div className="connection-dialog-toolbar"><button type="button" className="connection-dialog-close" aria-label="关闭飞书连接详情" onClick={e=>{e.stopPropagation();dialog.current?.close();}}>×</button></div>
   <article className="feishu-cli-card">
  <div className="connection-marks" aria-hidden="true"><img src="./ailo.png" alt=""/><span>···</span><img className="feishu-mark" src="./feishu.png" alt="飞书"/></div>
  <h2>{state.connected?'飞书已连接':'连接飞书'}</h2><span className={'connection-badge '+(state.connected?'connected':'')}>{label}{state.name?' · '+state.name:''}</span>
  <p>在对话中查询日程、查找文档、整理待办，或按你的要求操作飞书消息、云文档、表格等。</p>
  <p className="extension-note">能力取决于飞书账号及应用授权。发送、修改和删除操作会展示具体内容供你确认。</p>
  <div className="extension-actions">
   {!state.installed?<button disabled={busy||state.phase==='loading'} onClick={()=>void run(async()=>{await window.ailo.feishuCliInstallGuide();})}>安装飞书 CLI</button>:!state.connected?<button className="primary" disabled={busy||state.phase==='authorizing'} onClick={()=>void connectDirect()}>连接并授权</button>:<button className="primary" onClick={()=>tryChat('帮我查看飞书今天的日程，并整理需要准备的事项。')}>去试试</button>}
   {state.url&&<button className="primary" disabled={busy} onClick={()=>void run(async()=>{await window.ailo.feishuCliAuthorize();})}>打开飞书授权页</button>}
   {(state.enabled||state.phase==='authorizing')&&<button disabled={busy} onClick={()=>void run(async()=>setState(await window.ailo.feishuCliDisconnect()))}>{state.phase==='authorizing'?'取消连接':'解绑'}</button>}
   <button disabled={busy} onClick={()=>void run(async()=>setState(await window.ailo.feishuCliStatus()))}>重新检测</button>
  </div>
  {state.message&&<p role="status">{state.message}</p>}{error&&<p className="error" role="alert">{error}</p>}
  <p className="extension-note">默认申请飞书 CLI 推荐的自动审批权限。应用权限开通与用户授权是两个步骤；实际可用范围以飞书授权结果为准。</p>
  {state.configured&&<div className="extension-actions"><button disabled={busy} onClick={()=>void run(async()=>{await window.ailo.feishuCliPermissions();})}>管理应用权限</button><button disabled={busy||state.phase==='authorizing'} onClick={()=>void run(async()=>{awaitingSuccess.current=true;setState(await window.ailo.feishuCliConnect());})}>授权推荐权限</button></div>}
  <div className="connection-examples"><h3>试试这样用</h3>{['查看飞书今天的日程，整理待办事项','在飞书里查找天气项目的需求文档','帮我起草一条产品周会通知，确认群和内容后再发送'].map(text=><button key={text} disabled={!state.connected} onClick={()=>tryChat(text)}>{text}<span aria-hidden="true"> ↗</span></button>)}</div>
  <details><summary>补充权限</summary><p>如执行时提示缺少权限，将提示中的 scope 填在这里，重新打开飞书授权页确认。</p><label>授权范围<input aria-label="飞书补充授权范围" value={scopes} onChange={e=>setScopes(e.target.value)} placeholder="例如 im:message.send_as_user" /></label><button disabled={busy||!state.installed||state.phase==='authorizing'||!scopes.trim()} onClick={()=>void run(async()=>setState(await window.ailo.feishuCliConnect({scopes})))}>补充授权</button></details>
  <details><summary>连接说明</summary><p>首次连接需在飞书页面完成应用配置和用户授权。Ailo 使用独立的 ailo-desktop 配置，不接管其他工具的登录；解绑清除该配置的本机用户登录。服务端权限可在飞书授权管理中撤销。</p><p>电脑需安装飞书官方 lark-cli。凭证由 CLI 管理，不进入模型上下文。此入口用于在 Ailo 中操作飞书，不是飞书机器人远程控制电脑。</p></details>
  {children}
 </article></dialog></>;
}

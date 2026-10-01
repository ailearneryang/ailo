import React,{useEffect,useState} from 'react';
import type {Material} from './types';
export function FeishuConnection({busy,onMaterial,onImporting}:{onImporting:(busy:boolean)=>void;busy:boolean;onMaterial:(m:Material)=>void}) {
  const [configured,setConfigured]=useState(false),[appId,setAppId]=useState(''),[secret,setSecret]=useState(''),[url,setUrl]=useState('');
  const [working,setWorking]=useState(true),[message,setMessage]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let active=true;window.ailo.feishuStatus().then(s=>{if(active){setConfigured(s.configured);setAppId(s.appId);}}).catch(()=>{if(active)setError('无法读取飞书连接配置。');}).finally(()=>{if(active)setWorking(false);});return()=>{active=false;};},[]);
  async function run(fn:()=>Promise<void>){setWorking(true);setMessage('');setError('');try{await fn();}catch(e){setError(String(e).replace(/^.*Error: /,''));}finally{setWorking(false);}}
  const disabled=busy||working;
  return <article className="extension-editor feishu-connection">
    <div className="extension-card-top"><h2>飞书</h2><small>{working?'正在处理…':configured?'已配置':'未连接'}</small></div>
    <p>把飞书文档加入对话，让 Ailo 根据文档内容分析需求、整理信息和完成任务。</p>
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{const s=await window.ailo.feishuSave({appId,secret});setConfigured(s.configured);setAppId(s.appId);setSecret('');setMessage('应用凭证验证成功。读取文档还需要文档授权。');});}}>
      <label>App ID<input aria-label="飞书 App ID" value={appId} disabled={disabled} onChange={e=>setAppId(e.target.value)} placeholder="cli_…" autoComplete="off" /></label>
      <label>App Secret<input aria-label="飞书 App Secret" type="password" value={secret} disabled={disabled} onChange={e=>setSecret(e.target.value)} placeholder={configured?'留空保留已保存的密钥':'输入应用密钥'} autoComplete="new-password" /></label>
      <p className="extension-note">密钥仅加密保存在本机，不会发送给模型。使用应用身份读取已授权文档。</p>
      <div className="extension-actions"><button className="primary" disabled={disabled||!appId.trim()||(!configured&&!secret)}>验证并保存</button><button type="button" disabled={disabled||!configured} onClick={()=>void run(async()=>{await window.ailo.feishuTest();setMessage('应用凭证有效。');})}>测试连接</button><button type="button" disabled={disabled||!configured} onClick={()=>void run(async()=>{await window.ailo.feishuDisconnect();setConfigured(false);setSecret('');setAppId('');setMessage('本机凭证已移除，已导入材料仍保留。');})}>断开连接</button></div>
    </form>
    <details><summary>如何配置飞书</summary><ol><li>在飞书开放平台创建企业自建应用，获取 App ID 和 App Secret。</li><li>申请“查看新版文档”权限（docx:document:readonly），发布应用并完成企业审批。</li><li>为应用授予目标文档访问权限，再填写凭证并测试连接。</li></ol><button disabled={working} onClick={()=>void run(async()=>{await window.ailo.feishuGuide();})}>打开飞书开放平台</button></details>
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{onImporting(true);try{const material=await window.ailo.feishuRead(url);onMaterial(material);}finally{onImporting(false);}});}}>
      <label>飞书文档链接<input aria-label="飞书文档链接" value={url} disabled={disabled} onChange={e=>setUrl(e.target.value)} placeholder="https://企业.feishu.cn/docx/…" /></label>
      <p className="extension-note">导入正文快照到当前对话草稿，发送后归属所选项目。暂不支持知识库链接、表格、图片、消息收发或自动同步。</p>
      <button className="primary" disabled={disabled||!configured||!url.trim()}>读取并加入对话</button>
    </form>
    {message&&<p role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </article>;
}

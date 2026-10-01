import React,{useEffect,useRef,useState} from 'react';
import type {SearchState} from './types';
export function SearchConnection({query='',onState}:{query?:string;onState:(connected:boolean)=>void}){
 const [state,setState]=useState<SearchState|null>(null),[provider,setProvider]=useState<'baidu'|'tavily'>('baidu'),[key,setKey]=useState(''),[limit,setLimit]=useState(100),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const dialog=useRef<HTMLDialogElement>(null);
 function update(s:SearchState){setState(s);onState(s.connected);}
 useEffect(()=>{let alive=true;window.ailo.searchStatus().then(s=>{if(alive){update(s);setProvider(s.provider);setLimit(s.limit);}}).catch(()=>{if(alive)setError('无法读取联网搜索配置');});return()=>{alive=false;};},[]);
 async function run(fn:()=>Promise<SearchState>,success:string){setBusy(true);setError('');setMessage('');try{update(await fn());setMessage(success);}catch(e){setError(String(e).replace(/^.*Error: /,''));try{update(await window.ailo.searchStatus());}catch{}}finally{setBusy(false);}}
 const visible='联网搜索 百度 baidu tavily 网页 新闻 天气'.includes(query.trim().toLowerCase());
 return <><article className={'connection-tile '+(state?.connected?'is-connected':'')} style={visible?undefined:{display:'none'}}>
 <button type="button" className="connection-tile-main" aria-label="配置联网搜索" onClick={()=>dialog.current?.showModal()}><span className="connection-tile-heading"><span aria-hidden="true" className="search-mark">◎</span><strong>联网搜索</strong>{state?.connected&&<span className="connection-dot" role="img" aria-label="联网搜索已连接" title="上次连接测试成功"/>}</span><span className="connection-tile-description">搜索网页、新闻和实时信息，回答附来源。支持百度搜索和 Tavily。</span></button>
 <button type="button" className="connection-tile-action" aria-label="管理联网搜索" title="管理联网搜索" onClick={()=>dialog.current?.showModal()}>{state?.configured?'⚙':'＋'}</button></article>
 <dialog ref={dialog} className="connection-dialog" aria-label="联网搜索连接管理" onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close();}}><div className="connection-dialog-toolbar"><button type="button" className="connection-dialog-close" aria-label="关闭联网搜索设置" onClick={()=>dialog.current?.close()}>×</button></div>
 <article className="search-settings"><h2>联网搜索</h2><p>连接后，在输入框 ＋ → 应用连接中开启。</p>
 <form onSubmit={e=>{e.preventDefault();void run(async()=>{update(await window.ailo.searchSave({provider,key,limit}));setKey('');return window.ailo.searchTest();},'连接测试成功');}}>
 <label>搜索服务<select aria-label="搜索服务" value={provider} disabled={busy} onChange={e=>{const p=e.target.value as 'baidu'|'tavily';setProvider(p);setKey('');setLimit(p==='baidu'?100:1000);setMessage('');}}><option value="baidu">百度搜索（优先）</option><option value="tavily">Tavily</option></select></label>
 <label>API Key<input type="password" aria-label="搜索 API Key" autoComplete="new-password" disabled={busy} value={key} onChange={e=>setKey(e.target.value)} placeholder={state?.configured&&state.provider===provider?'留空保留已保存密钥':'输入搜索服务 API Key'}/></label>
 <label>本机调用上限（{provider==='baidu'?'每天，北京时间':'每月，UTC'}）<input type="number" aria-label="搜索调用上限" min="1" max="10000" disabled={busy} value={limit} onChange={e=>setLimit(Number(e.target.value))}/></label>
 <p className="extension-note">{provider==='baidu'?'百度官方目前提供每日 100 次免费额度。':'Tavily 免费计划目前每月 1,000 credits，基础搜索每次 1 credit。'} 以服务商账号实际额度为准。测试、失败请求也计入本机次数；其他设备的用量不在此统计，模型回答另行计费。</p>
 <p className="extension-note">密钥加密保存在本机，不会提供给模型。仅发送必要的搜索关键词，不会自动上传对话或附件。</p>
 {state?.configured&&<p>已配置：{state.provider==='baidu'?'百度':'Tavily'} · 本期请求 {state.used} / {state.limit} · {state.connected?'上次测试成功':'待验证'}</p>}
 <div className="extension-actions"><button className="primary" disabled={busy||(!key&&(!state?.configured||state.provider!==provider))}>{busy?'正在处理…':'保存并测试'}</button><button type="button" disabled={busy||!state?.configured} onClick={()=>void run(()=>window.ailo.searchTest(),'连接测试成功')}>重新检测</button><button type="button" disabled={busy||!state?.configured} onClick={()=>void run(()=>window.ailo.searchDisconnect(),'已移除本机搜索密钥')}>断开连接</button></div>
 </form><p><a href={provider==='baidu'?'https://ai.baidu.com/ai-doc/AppBuilder/pmaxd1hvy':'https://www.tavily.com/pricing'} onClick={e=>{e.preventDefault();void window.ailo.openWeb(e.currentTarget.href).catch(()=>setError("无法打开浏览器，请稍后重试。"));}}>查看开通说明与免费额度 ↗</a></p>{message&&<p role="status">{message}</p>}{error&&<p role="alert" className="error">{error}</p>}</article></dialog></>;
}

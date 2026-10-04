import React,{useEffect,useRef,useState} from 'react';
import type {AMapState} from './types';
export function AMapConnection({query='',onState,onTry}:{query?:string;onState:(connected:boolean)=>void;onTry:(text:string)=>void}){
 const [state,setState]=useState<AMapState|null>(null),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');const dialog=useRef<HTMLDialogElement>(null);
 function update(s:AMapState){setState(s);onState(s.connected);}
 useEffect(()=>{let alive=true;window.ailo.amapStatus().then(s=>{if(alive)update(s);}).catch(()=>{if(alive)setError('无法读取高德连接状态');});return()=>{alive=false;};},[]);
 async function run(fn:()=>Promise<AMapState>,success:string){setBusy(true);setError('');setMessage('');try{update(await fn());setMessage(success);}catch(e){setError(String(e).replace(/^.*Error: /,''));try{update(await window.ailo.amapStatus());}catch{}}finally{setBusy(false);}}
 const visible='高德地图 amap mcp 地点 搜索 路线 出行 天气'.includes(query.trim().toLowerCase());
 return <><article className={'connection-tile '+(state?.connected?'is-connected':'')} style={visible?undefined:{display:'none'}}>
 <button type="button" className="connection-tile-main" aria-label="配置高德地图" onClick={()=>dialog.current?.showModal()}><span className="connection-tile-heading"><img className="connection-brand-mark" src="./amap.png" alt="" aria-hidden="true"/><strong>高德地图 AMap</strong>{state?.connected&&<span className="connection-dot" role="img" aria-label="高德地图已连接"/>}</span><span className="connection-tile-description">查询地点、天气和路线，规划出行。连接高德官方 MCP 服务。</span></button>
 <button type="button" className="connection-tile-action" aria-label="管理高德地图连接" onClick={()=>dialog.current?.showModal()}>{state?.configured?'⚙':'＋'}</button></article>
 <dialog ref={dialog} className="connection-dialog" aria-label="高德地图连接管理" onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close();}}><div className="connection-dialog-toolbar"><button type="button" className="connection-dialog-close" aria-label="关闭高德地图设置" onClick={()=>dialog.current?.close()}>×</button></div>
 <article className="search-settings"><h2>高德地图 AMap</h2><p>填写高德 Key，连接后可在对话中查询地点、天气和路线。</p>
 <form onSubmit={e=>{e.preventDefault();void run(async()=>{update(await window.ailo.amapSave({key}));setKey('');return window.ailo.amapTest();},'连接测试成功');}}>
 <label>高德 Key<input type="password" aria-label="高德 Key" autoComplete="new-password" disabled={busy} value={key} onChange={e=>setKey(e.target.value)} placeholder={state?.configured?'留空保留已保存的 Key':'输入高德开放平台 Key'}/></label>
 <p className="extension-note">密钥加密保存在本机，不提供给模型。查询时向高德发送所需地点与参数。服务权限与额度以高德账号为准。</p>
 <div className="extension-actions"><button className="primary" disabled={busy||(!key&&!state?.configured)}>{busy?'正在处理…':'保存并测试'}</button><button type="button" disabled={busy||!state?.configured} onClick={()=>void run(()=>window.ailo.amapTest(),'连接测试成功')}>重新检测</button><button type="button" disabled={busy||!state?.configured} onClick={()=>void run(()=>window.ailo.amapDisconnect(),'本机 Key 已移除')}>断开连接</button></div></form>
 {state?.configured&&<p role="status">{state.connected?'上次连接测试成功':'已保存，等待验证'} · {state.tools.length} 个工具</p>}
 {!!state?.tools.length&&<details><summary>可用工具</summary><ul>{state.tools.map(name=><li key={name}>{name}</li>)}</ul></details>}
 <div className="connection-examples"><h3>试试这样用</h3>{['用高德查询上海人民广场附近的咖啡馆','用高德规划北京南站到故宫的公共交通路线'].map(text=><button disabled={!state?.connected} key={text} onClick={()=>{dialog.current?.close();onTry(text);}}>{text} ↗</button>)}</div>
 <p><a href="https://lbs.amap.com/api/mcp-server/create-project-and-key" onClick={e=>{e.preventDefault();void window.ailo.openWeb(e.currentTarget.href).catch(()=>setError('无法打开浏览器'));}}>获取高德 Key ↗</a></p>
 {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="error">{error}</p>}</article></dialog></>;
}

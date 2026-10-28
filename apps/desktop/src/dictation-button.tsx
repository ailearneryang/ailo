import {useEffect,useRef,useState} from 'react';
import {Icon} from './icon';
export function DictationButton({disabled,onText,onError,conversationId}:{disabled:boolean;onText:(text:string)=>void;onError:(message:string)=>void;conversationId:string}){
 const [state,setState]=useState<'idle'|'starting'|'listening'|'finishing'>('idle'),[text,setText]=useState(''),[failure,setFailure]=useState('');
 const active=useRef(false),latest=useRef(''),apply=useRef(onText),error=useRef(onError);apply.current=onText;error.current=onError;
 function clear(){active.current=false;latest.current='';setText('');setState('idle');}
 async function cancel(){clear();try{await window.ailo.dictationCancel();}catch(e){error.current((e as Error).message);}}
 useEffect(()=>{const off=window.ailo.onDictation(event=>{
  if(!active.current)return;
  if(event.type==='ready')setState('listening');
  if(event.type==='text'){latest.current=event.text||'';setText(latest.current);}
  if(event.type==='end'||event.type==='error'){
   const result=latest.current.trim();clear();
   if(event.type==='error'){setFailure(event.text||'语音输入失败');error.current(event.text||'语音输入失败');}else if(result)apply.current(result);
  }
 });return()=>{off();if(active.current){active.current=false;latest.current='';void window.ailo.dictationCancel().catch(()=>{});}};},[conversationId]);
 async function toggle(){
  try{
   if(state==='starting'){await cancel();return;}
   if(state!=='idle'){setState('finishing');await window.ailo.dictationStop();return;}
   setFailure('');active.current=true;latest.current='';setState('starting');await window.ailo.dictationStart('zh-CN');
  }catch(e){clear();setFailure((e as Error).message);error.current((e as Error).message);}
 }
 const recording=state!=='idle',label=state==='idle'?'语音输入':state==='starting'?'取消启动语音输入':state==='finishing'?'正在完成转写':'停止录音并填入文字';
 return <div className={'dictation-control'+(recording?' is-recording':'')} onKeyDown={e=>{if(e.key==='Escape'&&recording){e.preventDefault();e.stopPropagation();void cancel();}}}>
  {recording&&<><span className={'dictation-wave '+state} aria-hidden="true">{Array.from({length:7},(_,i)=><i key={i} style={{animationDelay:`${i*-.13}s`}}/>)}</span><span className="sr-only" role="status">{state==='starting'?'正在启动本机听写':state==='finishing'?'正在完成转写':'正在录音，最长60秒；点击停止后填入文字，按 Escape 取消'}</span></>}
  <button type="button" className={'dictation-trigger '+state} disabled={disabled&&state==='idle'||state==='finishing'} aria-label={label} title={recording?label+' · Esc 取消':'语音输入 · 本机离线听写，转写后可修改，不会自动发送'} aria-pressed={recording} onClick={()=>void toggle()}><Icon name={recording?'stop':'mic'}/></button>
  {failure&&<div className="dictation-transcript dictation-error" role="alert"><p>{failure}</p><button type="button" onClick={()=>setFailure('')}>关闭</button></div>}
  {recording&&text&&<div className="dictation-transcript"><p>{text}</p><button type="button" onClick={()=>void cancel()}>取消转写</button></div>}

 </div>;
}

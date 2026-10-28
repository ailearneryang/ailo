import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import type {Model,Workspace} from './types';
import {validateRouting,visionCapable} from '../model-routing-config.cjs';
import {documentedTextModel} from '../agent/model-capabilities.cjs';

type AutoConfig=NonNullable<Workspace['autoModel']>;
type Field='primaryModelId'|'visionModelId'|'primaryFallbackId'|'visionFallbackId';
const configKey=(config:AutoConfig)=>JSON.stringify([config.primaryModelId,config.visionModelId||'',config.primaryFallbackId||'',config.visionFallbackId||'',config.failover]);
function capability(model:Model){
  if(documentedTextModel(model))return '仅文本（已知能力）';
  if(model.imageInput==='disabled')return '仅文本（当前配置）';
  if(visionCapable(model))return '用户声明支持图像';
  return model.imageInput==='enabled'?'仅文本（已知能力）':'图像能力未确认';
}
function availableConfig(config:AutoConfig,models:Model[]):AutoConfig{
  const exists=(id?:string,vision=false)=>models.some(m=>m.id===id&&(!vision||visionCapable(m)));
  const next={...config};
  if(!exists(next.primaryModelId))next.primaryModelId='';
  if(!exists(next.visionModelId,true))next.visionModelId=undefined;
  if(!exists(next.primaryFallbackId)||next.primaryFallbackId===next.primaryModelId)next.primaryFallbackId=undefined;
  if(!next.visionModelId||!exists(next.visionFallbackId,true)||next.visionFallbackId===next.visionModelId)next.visionFallbackId=undefined;
  return next;
}
export function AutoModelSettings({data,saving,commit,onConfigureModel,onCancel}:{data:Workspace;saving:boolean;commit:(data:Workspace)=>Promise<boolean>;onConfigureModel:(id:string)=>void;onCancel?:()=>void}){
  const initial:AutoConfig=data.autoModel||{primaryModelId:data.models.find(m=>m.id===data.defaultModelId)?.id||data.models[0]?.id||'',visionModelId:data.models.find(visionCapable)?.id,failover:false};
  const [draft,setDraft]=useState(initial);
  const initialDefault=!data.autoModel||data.defaultModelId==='auto';
  const [asDefault,setAsDefault]=useState(initialDefault);
  const [submitting,setSubmitting]=useState(false);
  const [message,setMessage]=useState('');
  const saved=useRef({config:initial,asDefault:initialDefault});
  const id=useId();
  const form=useRef<HTMLFormElement>(null);
  useEffect(()=>{form.current?.scrollIntoView({block:'nearest'});form.current?.querySelector<HTMLSelectElement>('select')?.focus({preventScroll:true});},[]);
  // Editing image capability must not discard other unsaved Auto choices.
  // External saves are reflected when the corresponding local value is clean.
  useEffect(()=>{
    const previous=saved.current;
    setDraft(current=>availableConfig(configKey(current)===configKey(previous.config)?initial:current,data.models));
    setAsDefault(current=>current===previous.asDefault?initialDefault:current);
    saved.current={config:initial,asDefault:initialDefault};
  },[data.autoModel,data.defaultModelId,data.models]);
  const dirty=!data.autoModel||configKey(draft)!==configKey(data.autoModel)||asDefault!==(data.defaultModelId==='auto');
  const busy=saving||submitting;
  let invalid='';
  try{validateRouting(draft,data.models);}catch(error){invalid=(error as Error).message;}
  function update(field:Field,value:string){
    setDraft(current=>availableConfig({...current,[field]:value||undefined},data.models));
    setMessage('');
  }
  function selector(field:Field,label:string,vision=false){
    const primary=field==='primaryModelId',backup=field.includes('Fallback');
    const options=data.models.filter(m=>(!vision||visionCapable(m))&&(!backup||m.id!==draft[vision?'visionModelId':'primaryModelId']));
    const selected=data.models.find(m=>m.id===draft[field]);
    const disabled=busy||backup&&vision&&!draft.visionModelId||vision&&!options.length;
    return <div className="auto-model-field" key={field}>
      <div className="auto-model-field-heading"><label htmlFor={id+field}>{label}</label>
        {field==='visionModelId'&&selected&&<button type="button" className="auto-model-link" disabled={busy} onClick={()=>onConfigureModel(selected.id)}>配置图像能力</button>}
      </div>
      <select id={id+field} data-auto-field={field} disabled={disabled} required={primary} value={draft[field]||''} onChange={e=>update(field,e.target.value)}>
        <option value="">{primary?'选择主模型':backup?'不使用备用模型':!options.length?'暂无已声明支持图像的模型':'暂不使用视觉模型'}</option>
        {options.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      {selected&&<p className="auto-model-meta"><span title={'模型 ID：'+selected.model}>{selected.model}</span><span>{capability(selected)}</span></p>}
      {field==='visionModelId'&&!selected&&<div className="auto-model-capability">
        <p className="auto-model-hint">{options.length?'需要看图时，请先选择视觉模型。':'将支持图片的模型标记为“已确认支持图像”后，即可选择。'}</p>
        <details><summary>配置图像能力</summary><div className="auto-model-capability-options"><p>选择要配置的模型</p>{data.models.map(m=><button type="button" disabled={busy} key={m.id} onClick={()=>onConfigureModel(m.id)}><span>{m.name}</span><small>{m.model}</small></button>)}</div></details>
      </div>}
    </div>;
  }
  async function save(event:FormEvent){
    event.preventDefault();if(busy||!dirty||invalid)return;
    setSubmitting(true);setMessage('');
    try{
      const ok=await commit({...data,autoModel:draft,defaultModelId:asDefault?'auto':data.defaultModelId==='auto'?draft.primaryModelId:data.defaultModelId});
      if(!ok)setMessage('保存未成功，请重试。');
    }catch{setMessage('保存未成功，请重试。');}
    finally{setSubmitting(false);}
  }
  return <form ref={form} id="auto-model-settings" className="settings-form auto-model-settings" onSubmit={save}>
    <div className="auto-model-heading"><h2>编辑 Auto</h2><p>主模型处理日常任务，需要看图时调用视觉模型。</p></div>
    <div className="form-grid auto-model-primary">{selector('primaryModelId','主模型')}{selector('visionModelId','视觉模型',true)}</div>
    <details className="auto-model-advanced"><summary>备用模型与切换设置</summary><section className="auto-model-failover">
      <label className="auto-model-check"><input type="checkbox" disabled={busy} checked={draft.failover} onChange={e=>{setDraft({...draft,failover:e.target.checked});setMessage('');}}/>服务不可用时自动切换</label>
      {draft.failover&&<div className="auto-model-backups">
        <div className="form-grid">{selector('primaryFallbackId','主模型备用')}{selector('visionFallbackId','视觉模型备用',true)}</div>
        {(!draft.primaryFallbackId||draft.visionModelId&&!draft.visionFallbackId)&&<p className="auto-model-hint">{[!draft.primaryFallbackId?'未配置主模型备用':null,draft.visionModelId&&!draft.visionFallbackId?'未配置视觉备用':null].filter(Boolean).join('；')}。对应服务不可用时，将保留进度，等待恢复。</p>}
      </div>}
    </section></details>
    <div className="auto-model-default"><label className="auto-model-check"><input type="checkbox" disabled={busy} checked={asDefault} onChange={e=>{setAsDefault(e.target.checked);setMessage('');}}/>新对话默认使用 Auto</label><p className="auto-model-hint">已有对话保持原模型选择。</p></div>
    <details className="auto-model-rules"><summary>切换规则与数据使用</summary><p>服务超时、限流或暂时不可用时，先有限重试，再使用指定备用模型。每类最多使用一个备用模型；任务暂停、动作格式错误、验收失败或已开始显示的回复不触发切换。</p><p>仅向你选择的服务商发送对应请求。视觉模型接收相关图片和必要的任务背景，观察结果交回主模型继续处理。</p></details>
    {message&&<p className="error" role="alert">{message}</p>}
    <div className="auto-model-footer"><span className={'auto-model-save-state'+(dirty?' is-dirty':'')} role="status">{submitting?'正在保存…':invalid||(!data.autoModel?'尚未保存 Auto 配置':dirty?'有未保存更改':'已保存')}</span><div className="auto-model-buttons"><button type="button" disabled={busy} onClick={onCancel}>取消</button><button className="primary" disabled={busy||!dirty||!!invalid}>{submitting?'正在保存…':'保存'}</button></div></div>
  </form>;
}

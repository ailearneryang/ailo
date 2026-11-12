import {useEffect,useRef,useState} from 'react';
import {setPetPreferences,usePetPreferences} from './pet-preferences';
import {Icon} from './icon';
export function companionLabel(name:string){return name==='Ailo'?'我的 Ailo':name;}
export function CompanionRename(){
 const preferences=usePetPreferences(),[open,setOpen]=useState(false),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
 function close(){if(!busy){setOpen(false);setError('');}}
 return <><button ref={trigger} type="button" className="companion-rename" title="重命名我的 Ailo" aria-label="重命名我的 Ailo" onClick={()=>{setName(preferences.name);setError('');setOpen(true);}}><Icon name="edit"/></button>
 {open&&<dialog ref={dialog} className="companion-name-dialog" onCancel={event=>{event.preventDefault();close();}}><form onSubmit={async event=>{event.preventDefault();if(busy)return;const value=name.trim();if(!value||value.length>20){setError('请输入 1–20 个字符的名称。');return;}setBusy(true);const ok=await setPetPreferences({...preferences,name:value});setBusy(false);if(ok)setOpen(false);else setError('名称保存失败，请稍后重试。');}}><h2>给你的 Ailo 起个名字</h2><label>名称<input autoFocus aria-label="Ailo 名称" maxLength={20} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label><p className="muted">侧边栏、对话标题和陪伴名称将同步更新，重启后保留。</p>{error&&<p role="alert" className="error">{error}</p>}<div className="extension-actions"><button type="button" disabled={busy} onClick={close}>取消</button><button type="submit" className="primary" disabled={busy||!name.trim()}>{busy?'保存中…':'保存'}</button></div></form></dialog>}</>;
}

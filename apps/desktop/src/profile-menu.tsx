import {useEffect,useRef,useState} from 'react';
import {Icon} from './icon';
import {profileInitials} from './profile-identity';
import {setPetPreferences,usePetPreferences} from './pet-preferences';
import type {ProfileData,User} from './types';

export function ProfileMenu({user,ready,onSelect,onLogout}:{user:User|null;ready:boolean;onSelect:(view:string)=>void;onLogout:()=>Promise<void>}){
  const [open,setOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[profile,setProfile]=useState<ProfileData>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null),settings=useRef<HTMLButtonElement>(null);
  const pet=usePetPreferences();
  useEffect(()=>{
    if(!ready)return;let cancelled=false;
    const refresh=()=>{window.ailo.profile().then(value=>{if(!cancelled)setProfile(value);}).catch(()=>{if(!cancelled)setProfile(undefined);});};
    refresh();window.addEventListener('ailo-profile-change',refresh);
    return()=>{cancelled=true;window.removeEventListener('ailo-profile-change',refresh);};
  },[ready,user,open]);
  useEffect(()=>{
    if(!open){setSettingsOpen(false);setError('');return;}
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  function select(view:string){setOpen(false);onSelect(view);trigger.current?.focus();}
  async function logout(){if(busy)return;setBusy(true);setError('');try{await onLogout();setOpen(false);trigger.current?.focus();}catch{setError('退出失败，请重试。');}finally{setBusy(false);}}
  const name=profile?.settings.name||user?.name||'Ailo 用户';
  const avatar=<span className="avatar profile-user-avatar" style={{background:profile?.settings.color||'#b29154'}}>{profile?.settings.avatar?<img src={profile.settings.avatar} alt=""/>:profileInitials(name)}</span>;
  const tokens=profile&&(profile.stats.totalTokens>0||profile.stats.reportedRequests>0)?new Intl.NumberFormat('zh-CN',{notation:profile.stats.totalTokens>=10000?'compact':'standard',maximumFractionDigits:1}).format(profile.stats.totalTokens)+' Token':'查看统计';
  return <div className="profile-menu-root" ref={root} onBlur={e=>{if(e.relatedTarget&&!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
    {open&&<div id="profile-options" className="profile-menu" role="menu" aria-label="用户菜单" ref={menu} onKeyDown={e=>{
      const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
      if(e.key==='ArrowLeft'&&settingsOpen){e.preventDefault();setSettingsOpen(false);settings.current?.focus();}
    }}>
      <button role="menuitem" className="profile-menu-identity" aria-label={'查看个人资料 '+name} onClick={()=>select('profile')}>
        {avatar}<span className="profile-menu-name"><strong>{name}</strong><small>{user?'本机账号':'本机资料'}</small></span><Icon name="chevron-right"/>
      </button>
      <div className="profile-menu-divider" role="separator"/>
      <button role="menuitem" onClick={()=>select('profile')}><Icon name="gauge"/><span>使用情况</span><small className="profile-menu-detail">{tokens}</small></button>
      <button role="menuitemcheckbox" aria-checked={pet.visible} onClick={async()=>{setError(await setPetPreferences({...pet,visible:!pet.visible})?'':'宠物设置未能保存，请重试。');}}><Icon name="pet"/><span>显示宠物</span><span className="profile-menu-detail profile-menu-check">{pet.visible&&<Icon name="check"/>}</span></button>
      <button ref={settings} role="menuitem" aria-expanded={settingsOpen} aria-controls="profile-settings-options" onClick={()=>setSettingsOpen(v=>!v)} onKeyDown={e=>{if(e.key==='ArrowRight'){e.preventDefault();setSettingsOpen(true);}}}><Icon name="settings"/><span>设置</span><Icon name="chevron-right"/></button>
      {settingsOpen&&<div id="profile-settings-options" className="profile-menu-settings" role="group" aria-label="设置选项">
        <button role="menuitem" onClick={()=>select('account')}><Icon name="user"/><span>{user?'我的账号':'登录 / 注册'}</span></button>
        <button role="menuitem" onClick={()=>select('models')}><Icon name="sliders"/><span>模型设置</span></button>
        <button role="menuitem" onClick={()=>select('permissions')}><Icon name="lock"/><span>操作权限</span></button>
        <button role="menuitem" onClick={()=>select('memory')}><Icon name="memory"/><span>个人记忆</span></button>
        <button role="menuitem" onClick={()=>select('appearance')}><Icon name="palette"/><span>外观设置</span></button>
        <button role="menuitem" onClick={()=>select('pets')}><Icon name="pet"/><span>陪伴与成长</span></button>
      </div>}
      <div className="profile-menu-divider" role="separator"/>
      <button role="menuitem" onClick={()=>select('about')}><Icon name="help"/><span>帮助与关于</span><Icon name="chevron-right"/></button>
      <button role="menuitem" disabled={busy} onClick={()=>user?void logout():select('account')}><Icon name={user?'logout':'user'}/><span>{busy?'正在退出…':user?'退出登录':'登录 / 注册'}</span></button>
      {error&&<p className="profile-menu-error" role="alert">{error}</p>}
    </div>}
    <button ref={trigger} className={'profile'+(open?' selected':'')} disabled={!ready} onClick={()=>setOpen(v=>!v)} aria-label="查看用户菜单" aria-haspopup="menu" aria-expanded={open} aria-controls="profile-options" onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();setOpen(true);}}}>
      {avatar}<span className="profile-copy">{name}<small>{user?user.email:'本机资料与设置'}</small></span><span className="profile-arrow"><Icon name="chevron"/></span>
    </button>
  </div>;
}

import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './icon';
import type {User} from './types';
export function ProfileMenu({user,ready,onSelect}:{user:User|null;ready:boolean;onSelect:(view:string)=>void}){
 const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;menu.current?.querySelector<HTMLButtonElement>('button')?.focus();const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[open]);
 function select(view:string){setOpen(false);onSelect(view);trigger.current?.focus();}
 return <div className="profile-menu-root" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
 {open&&<div id="profile-options" className="profile-menu" role="menu" aria-label="用户菜单" ref={menu} onKeyDown={e=>{const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}}>
 <button role="menuitem" onClick={()=>select('account')}><Icon name="user"/><span>{user?'我的账号':'登录 / 注册'}</span></button>
 <button role="menuitem" onClick={()=>select('appearance')} aria-label="外观设置"><Icon name="settings"/><span>外观设置</span></button>
 <button role="menuitem" onClick={()=>select('pets')}><Icon name="sparkles"/><span>宠物与陪伴</span></button>
 <button role="menuitem" onClick={()=>select('about')}><Icon name="info"/><span>关于 Ailo</span></button>
 </div>}
 <button ref={trigger} className={'profile'+(open?' selected':'')} disabled={!ready} onClick={()=>setOpen(v=>!v)} aria-label={user?'查看用户信息':'登录或注册'} aria-haspopup="menu" aria-expanded={open} aria-controls="profile-options" onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();setOpen(true);}}}>
 <span className="avatar">{user?Array.from(user.name)[0]?.toUpperCase():<Icon name="user"/>}</span><span className="profile-copy">{user?user.name:'登录 / 注册'}<small>{user?user.email:'登录你的 Ailo 账号'}</small></span><span className="profile-arrow"><Icon name="chevron"/></span>
 </button></div>;
}

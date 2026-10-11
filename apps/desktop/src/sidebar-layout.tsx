import {useEffect,useRef,useState} from 'react';
import type {CSSProperties,ReactNode} from 'react';
import {Icon} from './icon';

export function SidebarLayout({children,onHome,disabled}:{children:ReactNode;onHome:()=>void;disabled:boolean}) {
  const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('ailo-sidebar-collapsed')==='true';}catch{return false;}});
  const [width,setWidth]=useState<number|undefined>(()=>{try{const value=Number(localStorage.getItem('ailo-sidebar-width'));return value>=220&&value<=360?value:undefined;}catch{return undefined;}});
  const root=useRef<HTMLElement>(null);
  const [measuredWidth,setMeasuredWidth]=useState(280);
  const drag=useRef<{x:number;width:number}|null>(null);
  useEffect(()=>{const observer=new ResizeObserver(entries=>setMeasuredWidth(Math.round(entries[0].borderBoxSize[0]?.inlineSize||root.current!.getBoundingClientRect().width)));observer.observe(root.current!);return()=>observer.disconnect();},[]);
  useEffect(()=>{try{localStorage.setItem('ailo-sidebar-collapsed',String(collapsed));}catch{}},[collapsed]);
  useEffect(()=>{try{if(width!==undefined)localStorage.setItem('ailo-sidebar-width',String(width));}catch{}},[width]);
  return <aside ref={root} className={'sidebar'+(collapsed?' sidebar-collapsed':'')} style={width?{'--sidebar-width':`${width}px`} as CSSProperties:undefined}>
    <div className="sidebar-top">
      <button className="brand brand-home" type="button" aria-label="Ailo 首页" title="返回首页" disabled={disabled} onClick={onHome}>Ailo</button>
      <button className="sidebar-toggle" type="button" aria-label={collapsed?'展开侧栏':'收起侧栏'} title={collapsed?'展开侧栏':'收起侧栏'} aria-expanded={!collapsed} aria-controls="sidebar-navigation" onClick={()=>setCollapsed(value=>!value)}><Icon name="panel"/></button>
    </div>
    <div id="sidebar-navigation" className="sidebar-navigation">{children}</div>
    {!collapsed&&<div className="sidebar-resize" role="separator" tabIndex={0} aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={360} aria-valuenow={measuredWidth}
      onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();drag.current={x:event.clientX,width:root.current!.getBoundingClientRect().width};event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{if(drag.current)setWidth(Math.round(Math.max(220,Math.min(360,drag.current.width+event.clientX-drag.current.x))));}}
      onPointerUp={event=>{drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
      onLostPointerCapture={()=>{drag.current=null;}}
      onPointerCancel={()=>{drag.current=null;}}
      onDoubleClick={()=>{setWidth(undefined);try{localStorage.removeItem('ailo-sidebar-width');}catch{}}}
      onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();setWidth(event.key==='Home'?220:event.key==='End'?360:Math.max(220,Math.min(360,(root.current?.getBoundingClientRect().width||280)+(event.key==='ArrowLeft'?-10:10))));}}}/>}
  </aside>;
}

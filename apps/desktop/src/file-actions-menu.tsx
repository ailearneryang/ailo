import React,{useEffect,useRef} from 'react';

export const dismissedFileMenus=new WeakSet<Event>();

export function FileActionsMenu({children,className,label='更多'}:{children:React.ReactNode;className?:string;label?:string}){
 const root=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(root.current?.open&&event.target instanceof Node&&!root.current.contains(event.target)){dismissedFileMenus.add(event);root.current.open=false;}};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&root.current?.open){event.preventDefault();event.stopImmediatePropagation();root.current.open=false;root.current.querySelector('summary')?.focus();}};
  const blur=()=>{if(root.current)root.current.open=false;};
  document.addEventListener('pointerdown',outside,true);
  document.addEventListener('keydown',escape,true);
  window.addEventListener('blur',blur);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('blur',blur);};
 },[]);
 return <details ref={root} className={className} onBlur={e=>{if(e.relatedTarget instanceof Node&&!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false;}} onClick={e=>{if(e.target instanceof Element&&e.target.closest('button'))e.currentTarget.open=false;}}><summary aria-label={label}>更多</summary>{children}</details>;
}

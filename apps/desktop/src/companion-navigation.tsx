import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pet } from './pet';
import { petStateLabels, type PetState } from './pet-state';
import {ActivityIndicator} from './activity-indicator';
export function CompanionNavigation({name='我的 Ailo',state,count,selected,onSelect,running=false,status='正在执行'}:{name?:string;state:PetState;count:number;selected:boolean;onSelect:()=>void;running?:boolean;status?:string}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [position,setPosition] = useState<{left:number;top:number;width:number}|null>(null);
  function show() { const rect=trigger.current?.getBoundingClientRect();if(rect)setPosition({left:rect.left,top:rect.bottom+6,width:rect.width}); }
  return <><button ref={trigger} aria-label={name} aria-describedby={position?'companion-hint':undefined} className={selected?'selected':''} onMouseEnter={show} onMouseLeave={()=>setPosition(null)} onFocus={show} onBlur={()=>setPosition(null)} onKeyDown={event=>{if(event.key==='Escape')setPosition(null);}} onClick={()=>{setPosition(null);onSelect();}}><Pet size="mini" state={state}/><span>{name}</span>{running&&<span className="companion-running" role="img" aria-label={`${name}：${status}`} title={status}><ActivityIndicator/></span>}</button>
    {position&&createPortal(<div id="companion-hint" role="tooltip" className="companion-hint" style={{position:'fixed',...position}}><strong>{count?`有 ${count} 项任务需要你处理`:petStateLabels[state]}</strong>{count>0&&<span>点击「{name}」，再打开「任务」查看原因。</span>}</div>,document.body)}
  </>;
}

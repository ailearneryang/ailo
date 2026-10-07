import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pet } from './pet';
import { petStateLabels, type PetState } from './pet-state';
export function CompanionNavigation({state,count,selected,onSelect}:{state:PetState;count:number;selected:boolean;onSelect:()=>void}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [position,setPosition] = useState<{left:number;top:number;width:number}|null>(null);
  function show() { const rect=trigger.current?.getBoundingClientRect();if(rect)setPosition({left:rect.left,top:rect.bottom+6,width:rect.width}); }
  return <><button ref={trigger} aria-label="我的 Ailo" aria-describedby={position?'companion-hint':undefined} className={selected?'selected':''} onMouseEnter={show} onMouseLeave={()=>setPosition(null)} onFocus={show} onBlur={()=>setPosition(null)} onKeyDown={event=>{if(event.key==='Escape')setPosition(null);}} onClick={()=>{setPosition(null);onSelect();}}><Pet size="mini" state={state}/><span>我的 Ailo</span></button>
    {position&&createPortal(<div id="companion-hint" role="tooltip" className="companion-hint" style={{position:'fixed',...position}}><strong>{count?`有 ${count} 项任务需要你处理`:petStateLabels[state]}</strong>{count>0&&<span>点击「我的 Ailo」，再打开「任务」查看原因。</span>}</div>,document.body)}
  </>;
}

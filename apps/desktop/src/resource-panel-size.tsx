import {useEffect,useRef,useState} from 'react';
import type {CSSProperties,RefObject} from 'react';

const defaults={overview:320,preview:520};
type Mode=keyof typeof defaults;
function readWidth(mode:Mode){
  try{const value=Number(localStorage.getItem('ailo-resource-width-'+mode));return Number.isFinite(value)&&value>=280&&value<=2400?value:undefined;}catch{return undefined;}
}

export function useResourcePanelSize(panel:RefObject<HTMLElement|null>,previewing:boolean,expanded:boolean,onRestore:()=>void){
  const mode:Mode=previewing?'preview':'overview';
  const [widths,setWidths]=useState(()=>({overview:readWidth('overview'),preview:readWidth('preview')}));
  const [available,setAvailable]=useState(0),[resizing,setResizing]=useState(false);
  const drag=useRef<{x:number;width:number;mode:Mode}|null>(null);
  useEffect(()=>{
    const parent=panel.current?.parentElement;if(!parent)return;
    const observer=new ResizeObserver(()=>setAvailable(parent.clientWidth));observer.observe(parent);setAvailable(parent.clientWidth);
    return()=>observer.disconnect();
  },[panel]);
  useEffect(()=>{
    try{for(const mode of ['overview','preview'] as const){const value=widths[mode];if(value===undefined)localStorage.removeItem('ailo-resource-width-'+mode);else localStorage.setItem('ailo-resource-width-'+mode,String(value));}}catch{}
  },[widths]);
  const maximum=available?Math.max(0,available-16):defaults[mode];
  const minimum=Math.min(280,maximum);
  const clamp=(value:number)=>Math.round(Math.max(minimum,Math.min(maximum,value)));
  const preferred=widths[mode]??(previewing&&available?Math.min(defaults.preview,available*.6):defaults[mode]);
  const width=expanded?maximum:clamp(preferred);
  function update(value:number,target:Mode=mode){onRestore();setWidths(previous=>({...previous,[target]:clamp(value)}));}
  function finish(){drag.current=null;setResizing(false);}
  function reset(){onRestore();setWidths(previous=>({...previous,[mode]:undefined}));}
  return {
    style:{'--resource-panel-width':`${width}px`} as CSSProperties,
    resizing,
    resizeHandle:<div className="resource-panel-resize" role="separator" tabIndex={0} aria-label={previewing?'调整预览宽度':'调整任务侧栏宽度'} aria-controls="artifact-panel" aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width} title="拖动调整宽度，双击恢复默认宽度"
      onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();drag.current={x:event.clientX,width:panel.current!.getBoundingClientRect().width,mode};setResizing(true);event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{if(drag.current)update(drag.current.width+drag.current.x-event.clientX,drag.current.mode);}}
      onPointerUp={event=>{finish();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
      onLostPointerCapture={finish} onPointerCancel={finish} onDoubleClick={reset}
      onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();update(event.key==='Home'?minimum:event.key==='End'?maximum:width+(event.key==='ArrowLeft'?10:-10));}}}/>,
  };
}

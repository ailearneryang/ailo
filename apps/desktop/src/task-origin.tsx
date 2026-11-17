import type {Task} from './types';
export function TaskOrigin({task}:{task:Task}){
 const latest=task.messages?.slice().reverse().find(m=>m.role==='user');
 const mobile=latest?latest.id?.startsWith('mobile-input-')===true:task.id.startsWith('mobile-');
 const label=mobile?'最近交互来自手机':'最近交互来自电脑';
 return <svg className="task-origin" style={{width:12,height:12,display:'inline-block',flexShrink:0}} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}><title>{label}</title>{mobile?<><rect x="4.5" y="1.5" width="7" height="13" rx="1.8"/><path d="M7 12h2"/></>:<path d="M3 2.8h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H6l-3.5 2.2v-2.2H3a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z"/>}</svg>;
}

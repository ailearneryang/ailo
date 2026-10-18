import type {Task} from './types';
export type SearchHit={taskId:string;title:string;snippet:string;messageId?:string;created:string;projectId?:string;score:number};
export function searchConversations(tasks:Task[],query:string):SearchHit[]{
 const words=query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
 return tasks.flatMap(task=>{
  const messages=task.messages?.length?task.messages:[{id:task.id+'-original',content:task.request||''},{id:undefined,content:task.answer||''}];
  const fields=[{id:undefined,content:task.title},...messages];
  if(words.length&&!words.every(word=>fields.some(f=>f.content.toLocaleLowerCase().includes(word))))return [];
  const titleMatch=words.length&&words.every(w=>task.title.toLocaleLowerCase().includes(w));
  const match=messages.find(m=>words.some(w=>m.content.toLocaleLowerCase().includes(w)));
  const text=(match?.content||messages[0]?.content||'').replace(/\s+/gu,' ');
  const offset=words.length?Math.max(0,Math.min(...words.map(w=>text.toLocaleLowerCase().indexOf(w)).filter(i=>i>=0))-45):0;
  const start=Number.isFinite(offset)?offset:0;
  return [{taskId:task.id,title:task.title||'未命名对话',snippet:(start?'…':'')+text.slice(start,start+180)+(text.length>start+180?'…':''),messageId:match?.id,created:task.created,projectId:task.projectId,score:titleMatch?2:match?1:0}];
 }).sort((a,b)=>b.score-a.score||b.created.localeCompare(a.created));
}

import type {Message,AgentRun} from './types';
// No anchor is safer than attaching legacy progress to an unrelated latest reply.
export function progressAnchor(run:AgentRun|undefined,messages:Message[]):string|undefined {
  const index=messages.findIndex(m=>m.id===run?.progressInputId);
  if(index<0)return undefined;
  let anchor=messages[index].id;
  for(const message of messages.slice(index+1)) {
    if(message.role==='user')break;
    anchor=message.id;
  }
  return anchor;
}
export function visiblePlanItems(items:unknown):string[] {
  return Array.isArray(items)?items.filter((v):v is string=>typeof v==='string' && !!v.replace(/[\s*•·—–-]/g,'').trim()).map(v=>v.trim()):[];
}

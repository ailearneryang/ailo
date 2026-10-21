import type {AgentRun,Message,Task} from './types';
export function deliveryForMessage(task:Task,messages:Message[],messageId:string):AgentRun|undefined {
 const run=task.agentRun,index=messages.findIndex(m=>m.id===messageId);
 if(!run||index<0||messages[index].role!=='assistant')return;
 const historical=run.history?.find(r=>r.afterMessageId===messageId&&r.status==='completed'&&r.artifacts.length);
 if(historical)return historical;
 if(run.status!=='completed'||!run.artifacts.length)return;
 const trigger=run.currentInputId||run.progressInputId;
 if(trigger){
  const userIndex=messages.findIndex(m=>m.id===trigger&&m.role==='user');
  if(userIndex<0||index<=userIndex)return;
  // Bind to the final reply for this input; later questions must not inherit it.
  const nextUser=messages.findIndex((m,i)=>i>userIndex&&m.role==='user');
  const end=nextUser<0?messages.length:nextUser;
  return messages.slice(userIndex+1,end).reverse().find(m=>m.role==='assistant')?.id===messageId?run:undefined;
 }
 // Older records without input IDs can only attach to the final saved reply.
 return index===messages.length-1?run:undefined;
}

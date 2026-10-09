const {randomUUID,createHash}=require('node:crypto');
function inputKey(message) {
  return message?.id || createHash('sha256').update(JSON.stringify(message||{})).digest('hex');
}
// A pause/retry continues the same execution. Only a new input after a terminal
// execution starts another one; project files and material ownership never move.
function beginRound(run,task,snapshot) {
  const messages=task.messages||[{role:'user',content:task.request}];
  const index=messages.findLastIndex(m=>m.role==='user');
  const trigger=inputKey(messages[index]);
  const terminal=['completed','idle'].includes(run.status);
  const newInput=run.inputKey ? run.inputKey!==trigger : messages.at(-1)?.role==='user';
  run.history ||= [];
  if(newInput && (terminal || task.editedInputId===trigger)) {
    if(run.mode==='task') {
      const anchor=messages.slice(0,index).findLast(m=>m.role==='assistant');
      run.history.push({...snapshot(run),history:undefined,afterMessageId:anchor?.id});
    }
    Object.assign(run,{progressInputId:undefined,executionId:randomUUID(),status:'understanding',mode:'chat',goal:'',steps:[],decisions:[],acceptance:[],events:[],observations:[],actionsSincePlan:0,inFlight:undefined,contextUsage:undefined,question:undefined});
  }
  run.executionId ||= randomUUID();
  run.inputKey=trigger;
  run.currentRequest=messages[index]?.content||task.request||'';
}
module.exports={beginRound,inputKey};

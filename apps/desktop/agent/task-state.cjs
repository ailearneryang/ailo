const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
const control=/^(?:请)?(?:继续(?:执行|任务|工作|原任务)?|恢复(?:任务|执行)?|重试|继续并完成|continue|resume)[。.!！\s]*$/i;
function sync(run,task){
 const messages=(task.messages||[{role:'user',content:task.request}]).slice(run.executionInputStart||0);
 const inputs=messages.filter(m=>m.role==='user'&&typeof m.content==='string'&&m.content.trim()&&!control.test(m.content.trim())).map(m=>({
  id:m.id||'input_'+hash(m.content).slice(0,24),text:m.content,sha256:hash(m.content)
 }));
 const byId=new Map(inputs.map(row=>[row.id,row]));
 // This ledger is reconstructed from original user messages, never a model
 // summary. It cannot silently turn a correction into an optional suggestion.
 run.taskState={version:1,executionId:run.executionId,userInputs:[...byId.values()],
  requirements:(run.requirements||[]).map(({id,text,type,scope,scopes})=>({id,text,type,scope,scopes})),
  decisions:[...(run.decisions||[])],updatedAt:new Date().toISOString()};
 run.taskState.inputFingerprint=hash(JSON.stringify(run.taskState.userInputs.map(({id,sha256})=>[id,sha256])));
 return run.taskState;
}
function context(run,task){
 const state=sync(run,task),max=24000;let used=0;
 const retained=[];
 // Recent corrections have priority, but omitted older messages remain in the
 // ledger and are explicitly discoverable through the existing history tool.
 for(const row of [...state.userInputs].reverse()){
  const remaining=max-used;if(remaining<=0)break;
  const text=row.text.slice(0,Math.min(6000,remaining));used+=text.length;
  retained.push({...row,text,...(text.length<row.text.length?{truncated:true,totalChars:row.text.length}:{})});
 }
 retained.reverse();const ids=new Set(retained.map(row=>row.id));
 return {version:1,inputFingerprint:state.inputFingerprint,userInstructions:retained,
  omittedInputs:state.userInputs.filter(row=>!ids.has(row.id)).map(({id,sha256,text})=>({id,sha256,chars:text.length})),
  notice:'用户原始要求与更正，独立于工作摘要持久保留；摘要不能撤销这些要求。存在截断或遗漏时用read_history回查，不能当作要求不存在。'};
}
module.exports={sync,context};

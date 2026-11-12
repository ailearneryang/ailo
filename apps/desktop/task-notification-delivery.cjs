const {notificationIntent}=require('./task-notifications.cjs');
function notifyingCompletion({complete,storage,notifications,markTemporary=()=>{}}){
 return async input=>{
  if(storage.isTemporary(input.taskId))markTemporary(input.id);
  const caller=(await storage.account())?.id||'local',seen=new Set();let pending=Promise.resolve();
  async function publish(result,stage){
   if(caller!==((await storage.account())?.id||'local'))return;
   const task=(await storage.readWorkspace()).tasks.find(t=>t.id===input.taskId);
   const message=input.messages?.findLast(m=>m.role==='user');
   if(task)await notifications.publish(task,result,input.id,{stage,ownerId:caller,requestText:message?.content||message?.materials?.map(m=>m.name).join('、')});
  }
  const onRun=run=>{
   const value=input.onRun?.(run),key=run.currentInputId||input.id;
   if(!seen.has(key)&&notificationIntent({id:input.taskId},{agentRun:run},'progress')){seen.add(key);pending=pending.then(()=>publish({agentRun:run},'progress')).catch(()=>{});}
   return value;
  };
  try{
   const result=await complete({...input,onRun});await pending;
   const task=caller===((await storage.account())?.id||'local')?(await storage.readWorkspace()).tasks.find(t=>t.id===input.taskId):undefined;
   if(task?.responseOnly)await storage.mutateWorkspace(state=>{const saved=state.tasks.find(t=>t.id===task.id);if(saved)saved.responseOnly=false;});
   await publish(result,'final').catch(()=>{});return result;
  }catch(error){await pending;if(!['MODEL_CANCELLED','ABORT_ERR'].includes(error.code)&&!/^已停止|^已取消/.test(error.message||''))await publish({error:true,agentRun:error.agentRun},'final').catch(()=>{});throw error;}
 };
}
function createNotificationPresenter({getWin,createWindow,Notification,account,icon}){
 const active=new Map();
 const sameOwner=async owner=>((await account())?.id||'local')===owner;
 function ready(win){return win&&!win.isDestroyed();}
 async function openTask(taskId,owner){
  if(!await sameOwner(owner))return;let target=getWin();
  const navigate=()=>{void (async()=>{if(!await sameOwner(owner)||!ready(target))return;if(target.isMinimized())target.restore();target.show();target.focus();target.webContents.send('navigation:task',taskId);})().catch(()=>{});};
  if(!ready(target)){createWindow();target=getWin();if(ready(target))target.webContents.once('did-finish-load',navigate);}else navigate();
 }
 return {
  openTask,
  async foreground(item,owner){if(!await sameOwner(owner))return;const win=getWin();if(ready(win)&&win.isFocused())win.webContents.send('notifications:toast',item);},
  async native(item,owner,{force=false}={}){
   if(!await sameOwner(owner))return {requested:false};const win=getWin();if(!force&&ready(win)&&win.isFocused()||!Notification.isSupported())return {requested:false};
   const notice=new Notification({id:item.id,groupId:'ailo-'+item.taskId,title:'Ailo · '+({attention:'需要处理',output:'有新成果',ended:'本轮已结束',completed:'回复已完成'}[item.kind]||'任务提醒'),subtitle:item.message||'',body:item.title,silent:true,...(icon?{icon}:{})});
   active.set(item.id,notice);if(active.size>20){const [id,old]=active.entries().next().value;old.close?.();active.delete(id);}
   const remove=()=>active.delete(item.id);notice.on('close',remove);notice.on('failed',remove);
   notice.on('click',()=>{void openTask(item.taskId,owner).catch(()=>{});});notice.show();return {requested:true};
  }
 };
}
module.exports={notifyingCompletion,createNotificationPresenter};

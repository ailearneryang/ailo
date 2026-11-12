// Recover credentials before model/tool execution, never restart an Agent run.
function createExecutionCredentials(storage,{signal,scheduled=false,onStatus}={}){
 const presence=storage.executionPresence;
 return async function credentials(id){
  signal.throwIfAborted();
  if(!scheduled)return storage.modelCredentials(id);
  try{const cached=await storage.modelCredentials(id,{background:true});signal.throwIfAborted();return cached;}
  catch(error){if(error.code!=='KEYCHAIN_USER_ACTION_REQUIRED')throw error;}
  // Without a presence observer, do not prompt the keychain from a background
  // schedule or guess that its encrypted secret has become corrupt.
  if(!presence)throw Object.assign(Error('定时任务等待设备解锁并允许访问模型凭据；原任务已保留。'),{code:'KEYCHAIN_USER_ACTION_REQUIRED'});
  let after=-1;
  for(let attempt=0;attempt<2;attempt++){
   onStatus?.(attempt?'模型凭据暂时无法访问，等待下次解锁或正常唤醒后继续原任务…':'等待设备解锁后读取模型凭据，原任务已保留…');
   await presence.wait(signal,{after});signal.throwIfAborted();
   const observed=presence.generation;
   try{
    const result=await storage.modelCredentials(id);signal.throwIfAborted();
    onStatus?.('模型凭据已可用，正在继续原任务…');return result;
   }catch(error){
    if(signal.aborted)throw signal.reason||error;
    if(error.code!=='MODEL_CREDENTIALS_UNAVAILABLE')throw error;
    after=observed;
   }
  }
  throw Object.assign(Error('正常唤醒后仍无法访问模型凭据，已停止自动尝试。请解锁登录钥匙串并检查 Ailo 的访问授权，再在原对话重试；未判定密钥损坏，无需据此更换密钥。'),{code:'MODEL_CREDENTIALS_UNAVAILABLE'});
 };
}
module.exports={createExecutionCredentials};

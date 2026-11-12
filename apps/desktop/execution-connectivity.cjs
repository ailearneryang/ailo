// Observe host connectivity without issuing probes to user services. Waiting is
// bounded per model request and excludes explicit OS suspension.
function createConnectivityWait({isOnline,awake,timeout=60000,interval=1000}={}){
 const now=awake?awake.now:Date.now;
 const set=awake?awake.setTimeout:setTimeout,clear=awake?awake.clearTimeout:clearTimeout;
 return function requestWait(){
  let deadline;
  return async function wait(signal,onStatus){
   signal.throwIfAborted();await awake?.wait(signal);
   if(isOnline()!==false)return true;
   deadline??=now()+timeout;
   onStatus?.('网络已断开，等待恢复后继续当前步骤…');
   while(isOnline()===false){
    const remaining=deadline-now();if(remaining<=0)return false;
    await new Promise((resolve,reject)=>{
     const done=()=>{signal.removeEventListener('abort',abort);resolve();};
     const timer=set(done,Math.min(interval,remaining));
     const abort=()=>{clear(timer);signal.removeEventListener('abort',abort);reject(signal.reason||Error('已停止执行'));};
     signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    });
    await awake?.wait(signal);
   }
   signal.throwIfAborted();onStatus?.('网络已恢复，正在继续当前步骤…');return true;
  };
 };
}
module.exports={createConnectivityWait};

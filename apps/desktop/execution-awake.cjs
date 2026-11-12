// Execution time excludes OS suspension. Never reissue a tool on resume.
function createExecutionAwake({now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let asleep=false,since=0,excluded=0;
 const timers=new Set(),waiters=new Set(),listeners=new Set();
 const clock=()=> (asleep?since:now())-excluded;
 function arm(t){if(!asleep)t.handle=setTimer(()=>{if(asleep)return;timers.delete(t);t.fn();},Math.max(0,t.due-clock()));}
 function suspend(){if(asleep)return;since=now();asleep=true;for(const t of timers)clearTimer(t.handle);for(const fn of listeners)try{fn(true);}catch{}}
 function resume(){if(!asleep)return;excluded+=Math.max(0,now()-since);asleep=false;for(const t of timers)arm(t);for(const resolve of [...waiters])resolve();for(const fn of listeners)try{fn(false);}catch{}}
 return {now:clock,suspend,resume,get suspended(){return asleep;},
 setTimeout(fn,ms){const t={fn,due:clock()+Math.max(0,ms)};timers.add(t);arm(t);return t;},
 clearTimeout(t){if(!t)return;timers.delete(t);clearTimer(t.handle);},
 subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
 async wait(signal){signal?.throwIfAborted();if(!asleep)return;await new Promise((resolve,reject)=>{const done=()=>{waiters.delete(done);signal?.removeEventListener('abort',abort);resolve();};const abort=()=>{waiters.delete(done);signal?.removeEventListener('abort',abort);reject(signal.reason||Error('已停止执行'));};waiters.add(done);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});}
 };
}
module.exports={createExecutionAwake};

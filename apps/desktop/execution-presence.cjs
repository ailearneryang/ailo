// OS presence is distinct from CPU wake: DarkWake may leave the screen locked.
function createExecutionPresence({isUnlocked=()=>true,awake}={}){
 let locked=isUnlocked()!==true,generation=0,wakePending=!!awake?.suspended;
 awake?.subscribe(sleeping=>{if(sleeping)wakePending=true;});
 const waiters=new Set();
 const ready=()=>!locked&&!awake?.suspended&&isUnlocked()===true;
 function changed(){if(ready())generation++;for(const check of [...waiters])check();}
 return {
  get generation(){return generation;},
  lock(){locked=true;},unlock(){const wasLocked=locked;locked=false;if(wasLocked)changed();},resume(){if(wakePending){wakePending=false;changed();}},
  async wait(signal,{after=-1}={}){
   signal.throwIfAborted();
   if(ready()&&generation>after)return;
   await new Promise((resolve,reject)=>{
    const cleanup=()=>{waiters.delete(check);signal.removeEventListener('abort',abort);};
    const check=()=>{if(ready()&&generation>after){cleanup();resolve();}};
    const abort=()=>{cleanup();reject(signal.reason||Error('已停止执行'));};
    waiters.add(check);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();else check();
   });
  },
  get pending(){return waiters.size;},
 };
}
module.exports={createExecutionPresence};

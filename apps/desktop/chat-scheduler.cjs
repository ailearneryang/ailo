function createScheduler(limit=3) {
 const running=new Set(),waiting=[];
 function pump(){
  for(let i=0;i<waiting.length&&running.size<limit;){
   const job=waiting[i];
   if([...running].some(r=>r.group===job.group)){i++;continue;}
   waiting.splice(i,1);job.signal.removeEventListener('abort',job.abort);running.add(job);
   job.resolve(()=>{running.delete(job);pump();});
  }
  waiting.forEach((j,i)=>j.onStatus?.(`等待执行 · 队列第 ${i+1} 位（最多 ${limit} 个会话并发，同项目串行）`));
 }
 return {acquire(group,signal,onStatus){return new Promise((resolve,reject)=>{
  const job={group,signal,onStatus,resolve,abort(){const i=waiting.indexOf(job);if(i>=0)waiting.splice(i,1);reject(Error('已取消排队'));pump();}};
  if(signal.aborted){reject(Error('已取消排队'));return;}
  waiting.push(job);signal.addEventListener('abort',job.abort,{once:true});pump();
 });}};
}
module.exports={createScheduler};

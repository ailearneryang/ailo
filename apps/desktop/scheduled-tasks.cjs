const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {createScheduler}=require('./chat-scheduler.cjs');
const {json,writeJson} = require('./agent/workspace.cjs');
function nextTime(task, after) {
  if(task.frequency==='once')return null;
  const [hour,minute]=task.time.split(':').map(Number);
  const date=new Date(after);date.setHours(hour,minute,0,0);
  for(let day=0;day<9;day++){
    if(date.getTime()>after && (task.frequency==='daily'||date.getDay()===task.weekday))return date.toISOString();
    date.setDate(date.getDate()+1);date.setHours(hour,minute,0,0);
  }
  throw Error('无法计算下次执行时间');
}
function validate(input, now) {
  if(!input||typeof input.title!=='string'||!input.title.trim()||input.title.length>80||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>20000||typeof input.modelId!=='string'||!input.modelId||!['once','daily','weekly'].includes(input.frequency))throw Error('请填写任务名称、指令、模型和执行周期。');
  const value={title:input.title.trim(),prompt:input.prompt.trim(),modelId:input.modelId,frequency:input.frequency,searchEnabled:input.searchEnabled===true,feishuEnabled:input.feishuEnabled===true};
  if(input.frequency==='once'){
    const date=new Date(input.at);if(!Number.isFinite(date.getTime())||date.getTime()<=now)throw Error('请选择未来的执行时间。');value.at=date.toISOString();value.nextAt=value.at;
  }else{
    if(typeof input.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)||input.frequency==='weekly'&&(!Number.isInteger(input.weekday)||input.weekday<0||input.weekday>6))throw Error('执行时间或星期无效。');
    value.time=input.time;value.weekday=input.weekday;value.nextAt=nextTime(value,now);
  }
  return value;
}
function createScheduledTasks({directory,execute,cancel=()=>{},notify=()=>{},now=Date.now,concurrency=3}) {
  const file=path.join(directory,'scheduled-tasks.json');
  if(!Number.isInteger(concurrency)||concurrency<1)throw Error('并发数量必须为正整数');
  const scheduler=createScheduler(concurrency),active=new Map();
  let chain=Promise.resolve(),timer,stopped=false;
  const queue=fn=>{const result=chain.then(fn);chain=result.catch(()=>{});return result;};
  const read=()=>json(file,[]);
  async function mutate(fn){return queue(async()=>{const tasks=await read();const result=await fn(tasks);await writeJson(file,tasks);return result;});}
  async function dispatch(id,manual=false){
    let claimed;
    const job=await mutate(tasks=>{
      if(stopped||active.has(id))return null;
      const task=tasks.find(t=>t.id===id);
      if(!task||(!manual&&(!task.enabled||!task.nextAt||Date.parse(task.nextAt)>now())))return null;
      const run={id:randomUUID(),at:new Date(now()).toISOString(),status:'queued',taskId:randomUUID()};
      task.runs=[run,...task.runs].slice(0,20);
      if(!manual){task.nextAt=nextTime(task,now());if(task.frequency==='once')task.enabled=false;}
      claimed={id:task.id,runId:run.id,controller:new AbortController()};active.set(id,claimed);return {task:{...task},run};
    }).catch(error=>{if(claimed&&active.get(id)===claimed)active.delete(id);throw error;});
    if(!job)return false;
    void (async()=>{
      let outcome,release;
      try{
        release=await scheduler.acquire(id,claimed.controller.signal);
        if(stopped||claimed.controller.signal.aborted)throw Error('Ailo 已退出，执行中断。可手动重试。');
        await mutate(tasks=>{const run=tasks.find(t=>t.id===id)?.runs.find(r=>r.id===job.run.id);if(run){run.status='running';run.startedAt=new Date(now()).toISOString();}});
        job.run.status='running';job.run.startedAt=new Date(now()).toISOString();
        await execute(job.task,job.run);outcome={status:'completed'};
      }
      catch(error){outcome={status:'failed',error:String(error.message||'执行失败').slice(0,1000)};}
      try{
        await mutate(tasks=>{const task=tasks.find(t=>t.id===id);const run=task?.runs.find(r=>r.id===job.run.id);if(run)Object.assign(run,outcome,{finishedAt:new Date(now()).toISOString()});});
        notify(job.task,outcome);
      }finally{if(active.get(id)===claimed)active.delete(id);release?.();}
    })().catch(error=>console.error('Scheduled task persistence failed:',error.message));
    return true;
  }
  return {
    list:()=>queue(read),
    async save(input){const value=validate(input,now());return mutate(tasks=>{
      if(input.id){const task=tasks.find(t=>t.id===input.id);if(!task)throw Error('任务不存在');if(active.has(task.id))throw Error('请等待当前执行结束后编辑');Object.assign(task,value);return task;}
      if(tasks.length>=100)throw Error('最多创建 100 个定时任务');
      const task={...value,id:randomUUID(),enabled:true,runs:[]};tasks.unshift(task);return task;
    });},
    toggle:({id,enabled})=>mutate(tasks=>{const task=tasks.find(t=>t.id===id);if(!task)throw Error('任务不存在');if(typeof enabled!=='boolean')throw Error('状态无效');if(enabled&&task.frequency==='once'&&Date.parse(task.at)<=now())throw Error('请先编辑为未来的执行时间。');task.enabled=enabled;if(enabled)task.nextAt=task.frequency==='once'?task.at:nextTime(task,now());}),
    remove:id=>mutate(tasks=>{if(active.has(id))throw Error('请等待当前执行结束后删除');const index=tasks.findIndex(t=>t.id===id);if(index>=0)tasks.splice(index,1);}),
    async run(id){if(!await dispatch(id,true))throw Error(stopped?'定时任务服务已停止。':'这个任务正在执行或排队，请等待本轮结束。');},
    async tick(){if(stopped)return;const tasks=await queue(read);const due=tasks.filter(t=>t.enabled&&t.nextAt&&Date.parse(t.nextAt)<=now()).sort((a,b)=>Date.parse(a.nextAt)-Date.parse(b.nextAt));for(const task of due)await dispatch(task.id);},
    async start(){stopped=false;await mutate(tasks=>{for(const task of tasks)for(const run of task.runs)if(['running','queued'].includes(run.status))Object.assign(run,{status:'failed',error:'Ailo 已退出，执行中断。可手动重试。'});});timer=setInterval(()=>this.tick().catch(error=>console.error('Scheduled task check failed:',error.message)),15000);timer.unref?.();await this.tick();},
    stop(){stopped=true;clearInterval(timer);for(const job of active.values()){job.controller.abort();cancel(job.runId);}},
  };
}
module.exports={createScheduledTasks,nextTime,validate};

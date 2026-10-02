const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createScheduledTasks,nextTime,validate}=require('../apps/desktop/scheduled-tasks.cjs');
const input={title:'每天计划',prompt:'制定计划',modelId:'test',frequency:'daily',time:'09:00'};
async function setup(t,execute=async()=>{}){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-schedules-'));let time=new Date(2026,9,1,8).getTime();const service=createScheduledTasks({directory,execute,now:()=>time});t.after(async()=>{service.stop();await fs.rm(directory,{recursive:true,force:true});});return {service,directory,setTime:value=>time=value};}
async function finished(service){for(let i=0;i<100;i++){const rows=await service.list();if(!rows.some(t=>t.runs.some(r=>['running','queued'].includes(r.status))))return rows;await new Promise(r=>setTimeout(r,5));}assert.fail('execution did not finish');}
test('next run respects local calendar boundaries and weekly day',()=>{const now=new Date(2026,9,1,9).getTime();assert.equal(new Date(nextTime(input,now)).getDate(),2);const next=new Date(nextTime({...input,frequency:'weekly',weekday:1},now));assert.equal(next.getDay(),1);assert.equal(next.getHours(),9);assert.equal(nextTime({frequency:'once'},now),null);assert.throws(()=>validate({...input,time:'29:99'},now));assert.throws(()=>validate({...input,frequency:'once',at:new Date(now-1).toISOString()},now));});
test('overdue recurring task runs once, concurrent ticks cannot duplicate it',async t=>{let count=0,release;const pending=new Promise(r=>release=r);const {service,setTime}=await setup(t,async()=>{count++;await pending;});await service.save(input);setTime(new Date(2026,9,8,12).getTime());await Promise.all([service.tick(),service.tick(),service.tick()]);for(let i=0;i<100&&count===0;i++)await new Promise(r=>setTimeout(r,2));assert.equal(count,1);await service.tick();assert.equal(count,1);assert.equal(new Date((await service.list())[0].nextAt).getDate(),9);release();await finished(service);await service.tick();assert.equal(count,1);});
test('one-time task disables after execution, manual runs preserve its schedule',async t=>{let count=0;const {service,setTime}=await setup(t,async()=>count++);const at=new Date(2026,9,1,10).toISOString();const task=await service.save({...input,frequency:'once',at});await service.run(task.id);await finished(service);assert.equal((await service.list())[0].nextAt,at);setTime(Date.parse(at)+1);await service.tick();const [done]=await finished(service);assert.equal(count,2);assert.equal(done.enabled,false);assert.equal(done.nextAt,null);await service.tick();assert.equal(count,2);});
test('pause, resume, deletion and failures are persisted',async t=>{const {service,directory,setTime}=await setup(t,async()=>{throw Error('模型不可用');});const task=await service.save(input);await service.toggle({id:task.id,enabled:false});setTime(new Date(2026,9,1,12).getTime());await service.tick();assert.equal((await service.list())[0].runs.length,0);await service.toggle({id:task.id,enabled:true});assert.equal(new Date((await service.list())[0].nextAt).getDate(),2);await service.run(task.id);const [failed]=await finished(service);assert.equal(failed.runs[0].error,'模型不可用');const reopened=createScheduledTasks({directory,execute:async()=>{}});assert.equal((await reopened.list())[0].runs[0].status,'failed');await service.remove(task.id);assert.equal((await service.list()).length,0);});
test('restart marks in-flight work interrupted without replaying claimed occurrence',async t=>{const {service,directory}=await setup(t);const task=await service.save(input);task.runs=[{id:'run',taskId:'conversation',status:'running',at:new Date().toISOString()}];task.nextAt=new Date(Date.now()+86400000).toISOString();await fs.writeFile(path.join(directory,'scheduled-tasks.json'),JSON.stringify([task]));await service.start();const [restored]=await service.list();assert.equal(restored.runs[0].status,'failed');assert.match(restored.runs[0].error,/中断/);});
test('Feishu opt-in persists and reaches execution, while existing tasks default to disabled',async t=>{
 const observed=[];const {service,directory}=await setup(t,async task=>observed.push(task.feishuEnabled));
 const legacy=await service.save(input);assert.equal(legacy.feishuEnabled,false);
 const task=await service.save({...input,feishuEnabled:true});
 assert.equal(JSON.parse(await fs.readFile(path.join(directory,'scheduled-tasks.json'),'utf8'))[0].feishuEnabled,true);
 await service.run(task.id);await finished(service);assert.deepEqual(observed,[true]);
 await service.save({...task,feishuEnabled:false});await service.run(task.id);await finished(service);assert.deepEqual(observed,[true,false]);
});
test('different schedules run three at once, overflow queues, and duplicate clicks cannot add a run',async t=>{
 let running=0,peak=0;const started=[],release=[];
 const {service}=await setup(t,task=>new Promise(resolve=>{running++;peak=Math.max(peak,running);started.push(task.id);release.push(()=>{running--;resolve();});}));
 const tasks=[];for(let i=0;i<5;i++)tasks.push(await service.save({...input,title:'任务'+i}));
 await Promise.all(tasks.map(task=>service.run(task.id)));
 for(let i=0;i<100&&started.length<3;i++)await new Promise(r=>setTimeout(r,2));
 assert.equal(started.length,3);assert.equal(peak,3);
 let rows=await service.list();assert.equal(rows.filter(t=>t.runs[0].status==='queued').length,2);
 await assert.rejects(service.run(tasks[0].id),/这个任务正在执行或排队/);
 assert.equal((await service.list()).find(t=>t.id===tasks[0].id).runs.length,1);
 release.shift()();
 for(let i=0;i<100&&started.length<4;i++)await new Promise(r=>setTimeout(r,2));assert.equal(started.length,4);
 while(started.length<5){for(const done of release.splice(0))done();await new Promise(r=>setTimeout(r,5));}
 for(const done of release.splice(0))done();rows=await finished(service);
 assert.equal(rows.filter(t=>t.runs[0].status==='completed').length,5);assert.equal(peak,3);
});
test('stopping cancels all active jobs and queued work does not start',async t=>{
 const cancelled=[],started=[],releases=[];const {directory}=await setup(t);
 const service=createScheduledTasks({directory,concurrency:1,cancel:id=>cancelled.push(id),execute:async task=>{started.push(task.id);await new Promise(r=>releases.push(r));}});
 const a=await service.save(input),b=await service.save({...input,title:'第二个任务'});
 await service.run(a.id);await service.run(b.id);for(let i=0;i<100&&!started.length;i++)await new Promise(r=>setTimeout(r,2));
 service.stop();releases.forEach(r=>r());await finished(service);assert.equal(started.length,1);assert.equal(cancelled.length,2);
 assert.equal((await service.list()).find(t=>t.id===b.id).runs[0].status,'failed');
});

const fs = require('node:fs/promises');
const path = require('node:path');
const defaults = {visible:true,animated:true,name:'Ailo',style:'warm',greetings:true,celebrations:true,reminders:true,accessory:'none'};
const stages = [[0,'初识'],[7,'熟悉'],[30,'默契'],[90,'搭档'],[180,'老朋友'],[365,'周年伙伴']];
const day = (date=new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const ordinal = value => Date.parse(value+'T00:00:00Z')/86400000;
const text = (value,max=120) => typeof value==='string'?value.trim().slice(0,max):'';
const dateValid = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(ordinal(value)) && new Date(ordinal(value)*86400000).toISOString().slice(0,10)===value;
const unique = values => [...new Set(values)];
function empty(now=new Date()){return {version:1,firstMet:day(now),preferences:{...defaults},activeDates:[],seen:[],adopted:[],projects:[],memories:[],interactions:{pat:[],feed:[],play:[]},visits:[]};}
function memory(record,id,kind,title,now,source={}){if(!record.memories.some(m=>m.id===id))record.memories.push({id,kind,title,createdAt:now.toISOString(),hidden:false,...source});}
function tick(record,now=new Date()){
  const days=Math.max(1,ordinal(day(now))-ordinal(record.firstMet)+1);
  for(const n of [7,30,90,180,...Array.from({length:Math.min(100,Math.floor(days/365))},(_,i)=>(i+1)*365)])if(days>=n)memory(record,`anniversary:${n}`,'anniversary',`相识 ${n} 天`,now);
  for(const [n,label] of stages)if(n && record.activeDates.length>=n)memory(record,`stage:${n}`,'growth',`成为${label}`,now);
  return record;
}
function unlocks(record){return ['none',...(record.activeDates.length>=7||record.adopted.length>=3?['scarf']:[]),...(record.activeDates.length>=30||record.adopted.length>=10?['star']:[]),...(record.activeDates.length>=180||record.adopted.length>=30?['crown']:[])];}
function preferences(input,record){
  if(!input||typeof input!=='object')throw Error('陪伴设置无效');
  const p={...record.preferences};
  for(const k of ['visible','animated','greetings','celebrations','reminders'])if(Object.hasOwn(input,k)){if(typeof input[k]!=='boolean')throw Error('陪伴设置无效');p[k]=input[k];}
  if(Object.hasOwn(input,'name')){if(typeof input.name!=='string'||!input.name.trim()||input.name.length>20)throw Error('宠物名字应为 1–20 个字');p.name=input.name.trim();}
  if(Object.hasOwn(input,'style')){if(!['quiet','warm','work'].includes(input.style))throw Error('陪伴风格无效');p.style=input.style;}
  if(Object.hasOwn(input,'accessory')){if(!unlocks(record).includes(input.accessory))throw Error('这件装扮还未解锁');p.accessory=input.accessory;}
  return p;
}
function activity(record,task,messages,now=new Date()){
  if(task.scheduledTaskId)return record;
  for(const message of messages){
    if(message.role!=='user')continue;
    const id=`${task.id}:${message.id}`;
    if(record.seen.includes(id))continue;
    record.seen.push(id);if(!record.activeDates.includes(day(now)))record.activeDates.push(day(now));
  }
  return tick(record,now);
}
function adopt(record,task,artifactPath,now=new Date()){
  if(!task || task.lastError || ['failed','blocked','running','understanding','paused','waiting_permission','waiting_user','cancelled'].includes(task.agentRun?.status))throw Error('请在任务完成后采纳成果');
  const last=task.messages?.at(-1);
  if(!last||last.role!=='assistant'||last.clarification||!last.content.trim())throw Error('请在收到完整答复后采纳成果');
  if(artifactPath&&!task.agentRun?.artifacts?.some(a=>a.path===artifactPath))throw Error('成果文件不存在');
  if(record.adopted.includes(task.id))return record;
  record.adopted.push(task.id);
  memory(record,`result:${task.id}`,'result',text(task.title)||'一次共同完成的任务',now,{taskId:task.id,...(task.projectId?{projectId:task.projectId}:{}),...(artifactPath?{path:artifactPath}:{})});
  return record;
}
function project(record,item,tasks,now=new Date()){
  if(!item||!tasks.some(t=>t.projectId===item.id&&record.adopted.includes(t.id)))throw Error('先采纳这个项目中的一项成果，再记录完成里程碑');
  if(!record.projects.includes(item.id)){record.projects.push(item.id);memory(record,`project:${item.id}`,'project',`完成项目：${text(item.name)}`,now,{projectId:item.id});}
  return record;
}
function editMemory(record,input){
  const m=record.memories.find(m=>m.id===input.id);if(!m||m.deleted)throw Error('回忆不存在');
  if(input.action==='delete'){for(const k of Object.keys(m))if(!['id','kind','createdAt'].includes(k))delete m[k];m.deleted=true;}
  else if(input.action==='hide')m.hidden=!!input.hidden;
  else if(input.action==='edit'){if(!text(input.title)||typeof input.title!=='string'||input.title.length>120||typeof input.note!=='string'||input.note.length>500)throw Error('回忆标题或备注过长');m.title=text(input.title);m.note=text(input.note,500);}
  else throw Error('回忆操作无效');
  return record;
}
function summary(record,now=new Date()){
  const stage=stages.filter(([n])=>record.activeDates.length>=n).at(-1),next=stages.find(([n])=>n>record.activeDates.length);
  return {calendarDays:Math.max(1,ordinal(day(now))-ordinal(record.firstMet)+1),activeDays:record.activeDates.length,stage:stage[1],next:next?{days:next[0],label:next[1]}:null,results:record.adopted.length,projectCount:record.projects.length,unlocks:unlocks(record),visitDays:record.visits.length,interactionDays:unique(Object.values(record.interactions).flat()).length};
}
function backup(record,now=new Date()){return {format:'ailo-companion',version:1,exportedAt:now.toISOString(),record};}
function validateBackup(value,now=new Date()){
  if(!value||value.format!=='ailo-companion'||value.version!==1||JSON.stringify(value).length>5*1024*1024)throw Error('请选择有效的 Ailo 陪伴备份（最大 5 MB）');
  const r=value.record;if(!r||r.version!==1||!dateValid(r.firstMet)||ordinal(r.firstMet)>ordinal(day(now))+1)throw Error('备份中的相识日期无效');
  const clean=empty(now);clean.firstMet=r.firstMet;
  for(const k of ['activeDates','visits']){if(!Array.isArray(r[k])||r[k].length>40000||r[k].some(d=>!dateValid(d)||d<r.firstMet||ordinal(d)>ordinal(day(now))+1))throw Error('备份中的活动日期无效');clean[k]=unique(r[k]);}
  for(const k of ['seen','adopted','projects']){if(!Array.isArray(r[k])||r[k].length>50000||r[k].some(s=>typeof s!=='string'||!s||s.length>200))throw Error('备份中的记录无效');clean[k]=unique(r[k]);}
  for(const k of ['pat','feed','play']){const dates=r.interactions?.[k];if(!Array.isArray(dates)||dates.length>40000||dates.some(d=>!dateValid(d)||d<r.firstMet||ordinal(d)>ordinal(day(now))+1))throw Error('备份中的互动记录无效');clean.interactions[k]=unique(dates);}
  if(!Array.isArray(r.memories)||r.memories.length>10000)throw Error('备份中的回忆无效');
  const ids=new Set();
  for(const m of r.memories){
    if(!m||typeof m.id!=='string'||!m.id||m.id.length>220||ids.has(m.id)||!['growth','anniversary','result','project'].includes(m.kind)||!Number.isFinite(Date.parse(m.createdAt))||Date.parse(m.createdAt)>now.getTime()||ordinal(day(new Date(m.createdAt)))<ordinal(r.firstMet)-1)throw Error('备份中的回忆无效');ids.add(m.id);
    if(m.deleted===true){clean.memories.push({id:m.id,kind:m.kind,createdAt:m.createdAt,deleted:true});continue;}
    if(typeof m.title!=='string'||!text(m.title)||m.title.length>120||(m.note!==undefined&&(typeof m.note!=='string'||m.note.length>500)))throw Error('备份中的回忆内容无效');
    const out={id:m.id,kind:m.kind,createdAt:m.createdAt,title:m.title,hidden:m.hidden===true};if(m.note)out.note=m.note;
    for(const k of ['taskId','projectId'])if(m[k]!==undefined){if(typeof m[k]!=='string'||m[k].length>200)throw Error('备份中的引用无效');out[k]=m[k];}
    if(m.path!==undefined){if(typeof m.path!=='string'||m.path.length>1024||m.path.includes('\\')||m.path.includes('\0')||m.path.startsWith('/')||/^[a-z]+:/i.test(m.path)||m.path.split('/').includes('..'))throw Error('备份中的文件路径无效');out.path=m.path;}
    clean.memories.push(out);
  }
  if(clean.memories.some(m=>m.kind==='result'&&!m.deleted&&(!m.taskId||m.id!==`result:${m.taskId}`||!clean.adopted.includes(m.taskId)))||clean.memories.some(m=>m.kind==='project'&&!m.deleted&&(!m.projectId||m.id!==`project:${m.projectId}`||!clean.projects.includes(m.projectId))))throw Error('备份中的成果关联无效');
  clean.preferences=preferences(r.preferences,clean);return clean;
}
function merge(current,incoming,applyPreferences=false){
  const result=structuredClone(current);result.firstMet=[current.firstMet,incoming.firstMet].sort()[0];
  for(const k of ['activeDates','seen','adopted','projects','visits'])result[k]=unique([...current[k],...incoming[k]]);
  for(const k of ['pat','feed','play'])result.interactions[k]=unique([...current.interactions[k],...incoming.interactions[k]]);
  for(const m of incoming.memories){const existing=result.memories.find(x=>x.id===m.id);if(!existing)result.memories.push(m);else if(m.deleted&&!existing.deleted)result.memories[result.memories.indexOf(existing)]=m;}
  if(applyPreferences)result.preferences=preferences(incoming.preferences,result);
  return result;
}
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function album(record,period){
  if(!/^\d{4}(-\d{2}|-Q[1-4])?$/.test(period))throw Error('请选择有效的相册周期');
  const [y,p]=period.split('-');if(p&&!p.startsWith('Q')&&(Number(p)<1||Number(p)>12))throw Error('相册月份无效');
  const includes=date=>date.startsWith(y)&&(p?.startsWith('Q')?Math.ceil(Number(date.slice(5,7))/3)===Number(p.slice(1)):!p||date.startsWith(period));
  return {period,activeDays:record.activeDates.filter(includes).length,memories:record.memories.filter(m=>!m.deleted&&!m.hidden&&includes(day(new Date(m.createdAt)))).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))};
}
function albumHtml(record,period){const a=album(record,period);return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(period)} 陪伴相册</title><style>body{font:16px/1.8 system-ui;max-width:800px;margin:60px auto;padding:0 24px;color:#263d36}article{border-bottom:1px solid #e1e8e4;padding:20px 0}small{color:#687970}</style><h1>${escape(record.preferences.name)} · ${escape(period)} 陪伴相册</h1><p>有效陪伴 ${a.activeDays} 天 · ${a.memories.length} 个保留回忆</p>${a.memories.map(m=>`<article><small>${escape(day(new Date(m.createdAt)))}</small><h2>${escape(m.title)}</h2><p>${escape(m.note)}</p>${m.path?`<small>成果引用：${escape(m.path)}</small>`:''}</article>`).join('')}<p><small>本相册记录成长与成果引用，不包含原始任务文件。</small></p></html>`;}
function createCompanion(directory,account,onChanged=()=>{}){
  let queue=Promise.resolve();const file=path.join(directory,'companion.json');
  function run(owner,action){const result=queue.catch(()=>{}).then(async()=>{
    const key=(await account())?.id||'local';if(owner&&owner!==key)throw Error('账号已切换，请重新打开陪伴页面');
    let all;try{all=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;all={};}
    const before=JSON.stringify(all[key]);const record=tick(all[key]||empty());const output=await action(record,key);all[key]=output?.record||record;
    if(before!==JSON.stringify(all[key])){await fs.mkdir(directory,{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(all),{mode:0o600});await fs.rename(file+'.tmp',file);onChanged(key);}
    return {owner:key,record:all[key],summary:summary(all[key]),...(output?.extra||{})};
  });queue=result;return result;}
  return {read:owner=>run(owner,()=>{}),update:(owner,input,state)=>run(owner,r=>{
    if(input.action==='preferences')r.preferences=preferences(input.value,r);
    else if(input.action==='adopt')adopt(r,state.tasks.find(t=>t.id===input.taskId),input.path);
    else if(input.action==='project')project(r,state.projects.find(p=>p.id===input.projectId),state.tasks);
    else if(input.action==='memory')editMemory(r,{...input,action:input.actionType});
    else if(input.action==='visit'){if(!r.visits.includes(day()))r.visits.push(day());}
    else if(input.action==='interaction'){if(!['pat','feed','play'].includes(input.kind))throw Error('互动无效');if(!r.interactions[input.kind].includes(day()))r.interactions[input.kind].push(day());}
    else if(input.action==='restore')return {record:merge(r,validateBackup(input.backup),input.applyPreferences===true)};
    else throw Error('陪伴操作无效');
  }),activity:(task,messages,owner)=>run(owner,r=>activity(r,task,messages)),featured:(tasks,featured,owner)=>run(owner,r=>{for(const f of featured){const task=tasks.find(t=>t.id===f.taskId);try{adopt(r,task,f.path);}catch{}}})};
}
// Only renderer-authored user messages earn activity, never internal delegations.
async function patchUserTask(storage,store,id,patch,append=[]){
 const owner=(await storage.account())?.id||'local';
 const previous=(await storage.readWorkspace()).tasks.find(t=>t.id===id);
 const task=await storage.patchTask(id,patch,append);
 const incoming=[...(patch.messages||[]),...append];
 const added=(task.messages||[]).filter(m=>m.role==='user'&&incoming.some(n=>n.id===m.id)&&!previous?.messages?.some(old=>old.id===m.id));
 if(added.length)await store.activity(task,added,owner).catch(error=>console.error('陪伴记录保存失败',error.message));
 return task;
}
module.exports={defaults,stages,day,empty,tick,activity,adopt,project,editMemory,summary,preferences,backup,validateBackup,merge,album,albumHtml,createCompanion,patchUserTask};

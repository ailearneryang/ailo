const colors=['#b29154','#558578','#557da8','#8870a6','#ad7076'];
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:undefined;
function dayKey(value){const d=new Date(value);return Number.isFinite(d.getTime())?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:undefined;}
function emptyUsage(){return {startedAt:new Date().toISOString(),days:{},executionCount:0,longestExecutionMs:0,reasoning:{},skills:{},connections:{},requestIds:[],executionIds:[]};}
function recordRequest(usage,record){
 const day=dayKey(record.startedAt);if(!day||typeof record.id!=='string'||usage.requestIds.includes(record.id))return false;
 const inputTokens=integer(record.providerUsage?.inputTokens),outputTokens=integer(record.providerUsage?.outputTokens);
 const row=usage.days[day]||{inputTokens:0,outputTokens:0,requests:0,reportedRequests:0};
 row.requests++;if(inputTokens!==undefined&&outputTokens!==undefined)row.reportedRequests++;
 row.inputTokens+=inputTokens||0;row.outputTokens+=outputTokens||0;usage.days[day]=row;
 usage.requestIds=[...usage.requestIds.slice(-999),record.id];return true;
}
function recordExecution(usage,record){
 if(typeof record.id!=='string'||usage.executionIds.includes(record.id)||integer(record.durationMs)===undefined)return false;
 usage.executionCount++;usage.longestExecutionMs=Math.max(usage.longestExecutionMs,record.durationMs);
 const effort=['low','medium','high'].includes(record.reasoningEffort)?record.reasoningEffort:'standard';usage.reasoning[effort]=(usage.reasoning[effort]||0)+1;
 for(const field of ['skills','connections'])for(const id of new Set(record[field]||[]))if(typeof id==='string'&&id.length<=128)usage[field][id]=(usage[field][id]||0)+1;
 usage.executionIds=[...usage.executionIds.slice(-999),record.id];return true;
}
function summarize(usage,tasks,now=new Date()){
 const active=new Set(Object.keys(usage.days).filter(day=>usage.days[day].requests>0));
 for(const task of tasks)for(const [index,message] of (task.messages||[{role:'user',createdAt:task.created}]).entries())if(message.role==='user'){const key=dayKey(message.createdAt||(index===0?task.created:undefined));if(key)active.add(key);}
 const today=dayKey(now),yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
 const dates=[...active].filter(day=>day<=today).sort();let longestStreak=0,streak=0,previous;
 for(const day of dates){const d=new Date(day+'T12:00:00');d.setDate(d.getDate()-1);streak=previous===dayKey(d)?streak+1:1;longestStreak=Math.max(longestStreak,streak);previous=day;}
 let currentStreak=0,cursor=active.has(today)?new Date(now):yesterday;while(active.has(dayKey(cursor))){currentStreak++;cursor.setDate(cursor.getDate()-1);}
 const rows=Object.values(usage.days),inputTokens=rows.reduce((n,d)=>n+d.inputTokens,0),outputTokens=rows.reduce((n,d)=>n+d.outputTokens,0);
 return {startedAt:usage.startedAt,days:usage.days,activeDates:dates,inputTokens,outputTokens,totalTokens:inputTokens+outputTokens,peakDayTokens:Math.max(0,...rows.map(d=>d.inputTokens+d.outputTokens)),requests:rows.reduce((n,d)=>n+d.requests,0),reportedRequests:rows.reduce((n,d)=>n+d.reportedRequests,0),longestExecutionMs:usage.longestExecutionMs,longestStreak,currentStreak,executionCount:usage.executionCount,reasoning:usage.reasoning,skills:usage.skills,connections:usage.connections};
}
function validateProfile(input,state){
 if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>40||typeof input.bio!=='string'||input.bio.length>160||!colors.includes(input.color)||!Array.isArray(input.featured)||input.featured.length>6)throw Error('资料无效：昵称 1–40 字、简介最多 160 字，最多选择 6 个成果。');
 const seen=new Set();for(const item of input.featured){if(!item||typeof item.taskId!=='string'||typeof item.path!=='string'||!state.tasks?.find(t=>t.id===item.taskId)?.agentRun?.artifacts?.some(a=>a.path===item.path))throw Error('精选成果已不存在，请刷新后重新选择。');const id=JSON.stringify([item.taskId,item.path]);if(seen.has(id))throw Error('精选成果不能重复。');seen.add(id);}
 const avatar=validateAvatar(input.avatar);
 return {name:input.name.trim(),bio:input.bio.trim(),color:input.color,featured:input.featured.map(({taskId,path})=>({taskId,path})),...(avatar?{avatar}:{})};
}
function validateAvatar(value){
 if(value===undefined)return;
 if(typeof value!=='string'||value.length>700000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('头像图片无效，请重新选择。');
 const encoded=value.slice('data:image/png;base64,'.length),bytes=Buffer.from(encoded,'base64');
 if(bytes.length<24||bytes.length>512*1024||bytes.toString('base64')!==encoded||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||bytes.toString('ascii',12,16)!=='IHDR'||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)||bytes.readUInt32BE(16)>512||bytes.readUInt32BE(20)>512)throw Error('头像图片无效，请重新选择。');
 return value;
}
module.exports={colors,dayKey,emptyUsage,recordRequest,recordExecution,summarize,validateProfile};

const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const cities={北京:[39.9,116.4],上海:[31.23,121.47],杭州:[30.27,120.15],广州:[23.13,113.26],深圳:[22.54,114.06],成都:[30.57,104.07]};
const feeds=[{name:'IT之家',url:'https://www.ithome.com/rss/'},{name:'Solidot',url:'https://www.solidot.org/index.rss'}];
const day=date=>date.toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&u.href.length<3000?u.href:undefined;}catch{}}
function parseFeed(xml,source,now){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('无效订阅');
 const {DOMParser}=require('@xmldom/xmldom');const doc=new DOMParser({onError:()=>{throw Error('订阅格式异常');}}).parseFromString(xml,'application/xml');
 const out=[];for(const node of Array.from(doc.getElementsByTagName('item')).slice(0,100)){
  const text=tag=>node.getElementsByTagName(tag)[0]?.textContent?.trim()||'';
  const title=text('title').replace(/<[^>]*>/g,'').slice(0,200),url=safeUrl(text('link')),date=new Date(text('pubDate'));
  if(!title||!url||!Number.isFinite(+date)||+date>+now+3600000||+now-date>72*3600000)continue;
  out.push({title,url,source,at:date.toISOString(),kind:/\bAI\b|人工智能|大模型|OpenAI|Anthropic|DeepSeek|ChatGPT|Claude|Gemini|机器学习|智能体/i.test(title)?'AI热点':'科技新闻'});
 }return out;
}
function weatherName(code){return code===0?'晴':code<=3?'多云':code<=48?'有雾':code<=57?'小雨':code<=67?'雨':code<=77?'雪':code<=82?'阵雨':code<=86?'阵雪':'雷雨';}
function parseWeather(data,today){const d=data?.daily,i=d?.time?.indexOf(today);if(!(i>=0)||![d.temperature_2m_min?.[i],d.temperature_2m_max?.[i],d.weather_code?.[i]].every(Number.isFinite))throw Error('天气数据不完整');return {date:today,min:Math.round(d.temperature_2m_min[i]),max:Math.round(d.temperature_2m_max[i]),text:weatherName(d.weather_code[i]),url:'https://open-meteo.com/'};}
async function fetchText(url,fetchImpl){const res=await fetchImpl(url,{signal:AbortSignal.timeout(15000),redirect:'error',headers:{Accept:'application/xml, application/json, text/xml, */*'}});if(!res.ok){await res.body?.cancel();throw Error('信息源暂不可用');}const reader=res.body?.getReader();if(!reader)throw Error('信息源为空');let size=0;const chunks=[];try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>1024*1024)throw Error('信息源过大');chunks.push(Buffer.from(r.value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}return Buffer.concat(chunks).toString('utf8');}
const MINUTE=60000;
function refreshDue(attempt,attemptAt,error,today,time,force,hourly=false){
 const last=Date.parse(attemptAt),elapsed=time-last;
 // Legacy day-only caches get one refresh; persist timestamps before network I/O.
 if(!Number.isFinite(last))return true;
 if(elapsed>=0&&elapsed<MINUTE)return false;
 return force||attempt!==today||elapsed<0||elapsed>=(error?15*MINUTE:hourly?60*MINUTE:Infinity);
}
function createDailyBrief({directory,account=async()=>null,fetchImpl=fetch,now=()=>new Date()}){
 let queue=Promise.resolve();const serial=fn=>{const next=queue.catch(()=>{}).then(fn);queue=next;return next;};
 async function load(owner){const file=path.join(directory,'daily-brief',createHash('sha256').update(owner).digest('hex')+'.json');let data;try{data=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('每日信息缓存无法读取');}return {file,data:data||{city:'北京',weather:{},news:[]}};}
 async function save(file,data){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(data),{mode:0o600});await fs.rename(temp,file);}
 return {read:input=>serial(async()=>{
  const owner=String((await account())?.id||'local'),{file,data}=await load(owner);if(input?.city!==undefined){if(!Object.hasOwn(cities,input.city))throw Error('城市无效');data.city=input.city;}
  const time=now(),today=day(time),stamp=time.toISOString(),force=input?.refresh===true,city=data.city,w=data.weather[city]||{};let changed=input?.city!==undefined;
  // Persist attempts before I/O so failures, restarts and concurrent reads respect cooldowns.
  const jobs=[];
  if(refreshDue(w.attempt,w.attemptAt,w.error,today,+time,force)){w.attempt=today;w.attemptAt=stamp;w.error=true;data.weather[city]=w;changed=true;jobs.push((async()=>{try{const [lat,lon]=cities[city],url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai&forecast_days=1`;w.value=parseWeather(JSON.parse(await fetchText(url,fetchImpl)),today);w.error=false;w.updatedAt=stamp;}catch{w.error=true;}})());}
  if(refreshDue(data.newsAttempt,data.newsAttemptAt,data.newsError,today,+time,force,true)){data.newsAttempt=today;data.newsAttemptAt=stamp;data.newsError=true;changed=true;jobs.push((async()=>{const results=await Promise.allSettled(feeds.map(async f=>parseFeed(await fetchText(f.url,fetchImpl),f.name,now())));const entries=results.flatMap(r=>r.status==='fulfilled'?r.value:[]),seen=new Set();const unique=entries.filter(e=>!seen.has(e.url)&&seen.add(e.url)).sort((a,b)=>b.at.localeCompare(a.at));if(unique.length){const ai=unique.filter(e=>e.kind==='AI热点').slice(0,8),other=unique.filter(e=>e.kind!=='AI热点').slice(0,8);data.news=Array.from({length:Math.max(ai.length,other.length)},(_,i)=>[ai[i],other[i]].filter(Boolean)).flat();data.newsDate=today;data.newsUpdatedAt=stamp;}data.newsError=results.some(r=>r.status==='rejected')||!unique.length;})());}
  if(changed)await save(file,data);await Promise.all(jobs);if(changed)await save(file,data);
  if(String((await account())?.id||'local')!==owner)throw Error('账号已切换');
  return {city,cities:Object.keys(cities),weatherAttemptAt:w.attemptAt,weatherUpdatedAt:w.updatedAt,newsAttemptAt:data.newsAttemptAt,newsUpdatedAt:data.newsUpdatedAt,weather:w.value,weatherError:!!w.error,weatherStale:w.value?.date!==today,news:data.news||[],newsDate:data.newsDate,newsError:!!data.newsError,newsStale:data.newsDate!==today};
 })};
}
module.exports={createDailyBrief,parseFeed,parseWeather,day};

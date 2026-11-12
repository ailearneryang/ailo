const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createDailyBrief,parseFeed,parseWeather,day}=require('../apps/desktop/daily-brief.cjs');
const rss=(date='2026-11-10T01:00:00Z')=>`<rss><channel><item><title>AI 新模型发布</title><link>https://example.com/ai</link><pubDate>${date}</pubDate></item><item><title>科技产业新动态</title><link>https://example.com/news</link><pubDate>${date}</pubDate></item><item><title>不可点击的标题</title><link>javascript:alert(1)</link><pubDate>${date}</pubDate></item></channel></rss>`;
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-brief-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let at=new Date('2026-11-10T02:00:00Z'),owner='one',fail=false;const calls=[];const options={directory,now:()=>at,account:async()=>({id:owner}),fetchImpl:async url=>{calls.push(url);if(fail)throw Error('offline');return new Response(url.includes('open-meteo')?JSON.stringify({daily:{time:[day(at)],weather_code:[3],temperature_2m_min:[1],temperature_2m_max:[13]}}):rss(at.toISOString()));}};return {options,calls,setDay:d=>at=new Date(d),setOwner:o=>owner=o,setFail:v=>fail=v};}
test('daily weather and AI/news fetch once across concurrent mounts, restart and city changes; accounts isolated',async t=>{
 const f=await fixture(t),api=createDailyBrief(f.options);const [a,b]=await Promise.all([api.read(),api.read()]);assert.equal(f.calls.length,3);assert.deepEqual(a,b);assert.equal(a.city,'北京');assert.equal(a.weather.min,1);assert.deepEqual(a.news.map(n=>n.kind),['AI热点','科技新闻']);
 await createDailyBrief(f.options).read();assert.equal(f.calls.length,3);
 const changed=await api.read({city:'上海'});assert.equal(changed.city,'上海');assert.equal(f.calls.length,4);await api.read({city:'北京'});assert.equal(f.calls.length,4);
 f.setDay('2026-11-11T01:00:00Z');await api.read();assert.equal(f.calls.length,7);
 f.setOwner('two');const other=await api.read();assert.equal(other.city,'北京');assert.equal(f.calls.length,10);await assert.rejects(api.read({city:'../../private'}),/城市无效/);
});
test('outage retains dated prior content, marks stale and cannot cause request storms or fake fresh timestamps',async t=>{
 const f=await fixture(t),api=createDailyBrief(f.options);const old=await api.read();f.setDay('2026-11-11T01:00:00Z');f.setFail(true);const stale=await api.read();assert.deepEqual(stale.news,old.news);assert.equal(stale.newsDate,'2026-11-10');assert.equal(stale.newsStale,true);assert.equal(stale.weatherStale,true);assert.equal(stale.newsError,true);const count=f.calls.length;await api.read();await createDailyBrief(f.options).read();assert.equal(f.calls.length,count);
});
test('RSS rejects entities, unsafe links, invalid dates and old/future news; forecasts validate dates and numbers',()=>{
 const now=new Date('2026-11-10T02:00:00Z');assert.equal(parseFeed(rss(),'fixture',now).length,2);assert.equal(parseFeed(rss('2020-01-01'),'fixture',now).length,0);assert.equal(parseFeed(rss('2030-01-01'),'fixture',now).length,0);assert.throws(()=>parseFeed('<!DOCTYPE rss><rss/>','fixture',now));assert.throws(()=>parseWeather({daily:{time:['2026-11-09']}},'2026-11-10'));assert.equal(day(new Date('2026-11-09T17:00:00Z')),'2026-11-10');
});
test('failed midnight refresh retries after 15 minutes across restart and preserves successful weather/news timestamps',async t=>{
 const f=await fixture(t),api=createDailyBrief(f.options);const old=await api.read();
 f.setDay('2026-11-11T00:00:00Z');f.setFail(true);const failed=await api.read();assert.equal(failed.newsUpdatedAt,old.newsUpdatedAt);assert.equal(failed.weatherUpdatedAt,old.weatherUpdatedAt);
 f.setFail(false);f.setDay('2026-11-11T00:14:59Z');await createDailyBrief(f.options).read();assert.equal(f.calls.length,6);
 f.setDay('2026-11-11T00:15:00Z');const fresh=await createDailyBrief(f.options).read();assert.equal(f.calls.length,9);assert.equal(fresh.weather.date,'2026-11-11');assert.equal(fresh.newsError,false);assert.equal(fresh.weatherError,false);
 f.setDay('2026-11-11T01:15:00Z');const hourly=await api.read();assert.equal(f.calls.length,11);assert.equal(hourly.weatherUpdatedAt,fresh.weatherUpdatedAt);assert.notEqual(hourly.newsUpdatedAt,fresh.newsUpdatedAt);
});
test('manual refresh is throttled durably and legacy failed day-only caches can recover immediately',async t=>{
 const f=await fixture(t),api=createDailyBrief(f.options);await api.read();await api.read({refresh:true});assert.equal(f.calls.length,3);
 f.setDay('2026-11-10T02:01:00Z');await Promise.all([api.read({refresh:true}),api.read({refresh:true})]);assert.equal(f.calls.length,6);
 await createDailyBrief(f.options).read({refresh:true});assert.equal(f.calls.length,6);
 const file=path.join(f.options.directory,'daily-brief',(await fs.readdir(path.join(f.options.directory,'daily-brief')))[0]),cache=JSON.parse(await fs.readFile(file));
 delete cache.weather['北京'].attemptAt;delete cache.newsAttemptAt;cache.weather['北京'].error=true;cache.newsError=true;await fs.writeFile(file,JSON.stringify(cache));
 const fresh=await createDailyBrief(f.options).read();assert.equal(f.calls.length,9);assert.equal(fresh.weatherError,false);assert.equal(fresh.newsError,false);
});
test('partial feed failure retries within the day without refreshing successful weather or losing publication dates',async t=>{
 const f=await fixture(t),fetch=f.options.fetchImpl;let fail=true;
 f.options.fetchImpl=async url=>{if(url.includes('solidot')&&fail){f.calls.push(url);throw Error('offline');}return fetch(url);};
 const api=createDailyBrief(f.options),first=await api.read();assert.equal(first.newsError,true);assert.ok(first.news.length);
 fail=false;f.setDay('2026-11-10T02:15:00Z');const next=await api.read();assert.equal(f.calls.length,5);assert.equal(next.newsError,false);assert.equal(next.weatherUpdatedAt,first.weatherUpdatedAt);assert.equal(next.news[0].at,'2026-11-10T02:15:00.000Z');
});

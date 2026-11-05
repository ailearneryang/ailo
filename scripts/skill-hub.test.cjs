const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const JSZip=require('../apps/desktop/node_modules/jszip');
const {createSkillHub}=require('../apps/desktop/skill-hub.cjs');
const {createSkillPackages}=require('../apps/desktop/skill-packages.cjs');
const {validateExtensions}=require('../apps/desktop/extensions.cjs');
const json=data=>new Response(JSON.stringify(data));
test('SkillHub search uses documented envelope, pagination and escaped keyword',async()=>{
 let url;const hub=createSkillHub({fetch:async u=>{url=new URL(u);return json({code:0,data:{total:21,skills:[{slug:'sample',name:'示例',description_zh:'中文用途',version:'1.0.0'}]}});}});
 const result=await hub.search({keyword:'文档 & PPT',page:2});assert.equal(result.skills[0].description,'中文用途');assert.equal(url.searchParams.get('keyword'),'文档 & PPT');assert.equal(url.searchParams.get('page'),'2');
 await assert.rejects(hub.search({keyword:'x',page:0}),/参数/);
});
test('SkillHub pinned ZIP install retains resources, provenance and stable identity through persistence',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-hub-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const zip=new JSZip();zip.file('SKILL.md','---\nname: demo\n---\nRead references/guide.md.');zip.file('references/guide.md','reference');const buffer=await zip.generateAsync({type:'nodebuffer'});
 const packages=createSkillPackages(root);let downloads=0;
 const hub=createSkillHub({packages,fetch:async u=>{const url=new URL(u);if(url.pathname.includes('download')){assert.equal(url.searchParams.get('version'),'1.2.3');downloads++;return new Response(null,{status:302,headers:{location:'https://bucket.cos.ap-guangzhou.myqcloud.com/skill.zip'}});}return new Response(buffer);}});
 const first=await hub.install({slug:'demo',version:'1.2.3'}),second=await hub.install({slug:'demo',version:'1.2.3'});
 assert.equal(first.id,second.id);assert.equal(downloads,2);assert.equal(first.package.files,2);assert.match(first.source.sha256,/^[a-f0-9]{64}$/);
 const saved=validateExtensions([first]);assert.deepEqual(saved[0].source,first.source);await packages.validate(saved);assert.equal(await fs.readFile(path.join(root,first.package.id,'files/references/guide.md'),'utf8'),'reference');
});
test('SkillHub rejects corrupt packages, unsafe redirects, oversized streams and service failures',async()=>{
 for(const location of ['http://api.skillhub.cn/x','https://localhost/x','https://api.skillhub.cn@127.0.0.1/x']){
 let calls=0;const hub=createSkillHub({fetch:async()=>{calls++;return new Response(null,{status:302,headers:{location}});}});await assert.rejects(hub.install({slug:'demo',version:'1.0.0'}),/地址/);assert.equal(calls,1);
 }
 const limited=createSkillHub({fetch:async()=>new Response(new Uint8Array(2*1024*1024+1))});await assert.rejects(limited.search({keyword:'',page:1}),/过大/);
 for(const [status,message] of [[429,/频繁/],[401,/授权/],[404,/不存在/],[503,/不可用/]]){const hub=createSkillHub({fetch:async()=>new Response(null,{status})});await assert.rejects(hub.detail('demo'),message);}
 const wrong=createSkillHub({fetch:async()=>json({skill:{slug:'other'},latestVersion:{version:'1.0.0'}})});await assert.rejects(wrong.detail('demo'),/不一致/);
 const malformed=createSkillHub({packages:{importSkill:createSkillPackages('/unused').importSkill},fetch:async()=>new Response('not a zip')});await assert.rejects(malformed.install({slug:'demo',version:'1.0.0'}),/ZIP/);
});
test('SkillHub categories, sort and popularity retain upstream meaning',async()=>{
 const calls=[];const hub=createSkillHub({fetch:async u=>{const url=new URL(u);calls.push(url);return url.pathname.endsWith('categories')?json({items:[{key:'dev-programming',name:'开发编程',active:true,level:1,sortOrder:20},{key:'old',name:'停用',active:false,level:1},{key:'office',name:'办公',active:true,level:1,sortOrder:10}]}):json({code:0,data:{total:1,skills:[{slug:'demo',downloads:1196000,stars:72,category:'dev-programming',iconUrl:'https://cloudcache.tencent-cloud.com/icon.png'}]}});}});
 assert.deepEqual(await hub.categories(),[{key:'office',name:'办公'},{key:'dev-programming',name:'开发编程'}]);
 const result=await hub.search({keyword:'demo',page:1,category:'dev-programming',sortBy:'score'});assert.equal(calls[1].searchParams.get('category'),'dev-programming');assert.equal(calls[1].searchParams.get('sortBy'),'score');assert.equal(result.skills[0].downloads,1196000);assert.equal(result.skills[0].stars,72);assert.match(result.skills[0].iconUrl,/icon.png$/);
 await assert.rejects(hub.search({keyword:'',page:1,sortBy:'invented-rating'}),/筛选/);
});
test('SkillHub icons use bounded image data, cache and safe fallback without renderer network',async()=>{
 let calls=0;const png=Buffer.from([137,80,78,71,13,10,26,10]);const hub=createSkillHub({fetch:async()=>{calls++;return new Response(png);}});
 const url='https://cloudcache.tencent-cloud.com/icon.png';assert.match(await hub.icon(url),/^data:image\/png;base64,/);assert.equal(await hub.icon(url),await hub.icon(url));assert.equal(calls,1);
 assert.equal(await hub.icon('https://localhost/icon.png'),'');assert.equal(await hub.icon('http://cloudcache.tencent-cloud.com/icon.png'),'');assert.equal(calls,1);
 const invalid=createSkillHub({fetch:async()=>new Response('<svg></svg>')});assert.equal(await invalid.icon(url),'');
 const oversized=createSkillHub({fetch:async()=>new Response(new Uint8Array(2*1024*1024+1))});assert.equal(await oversized.icon(url),'');
});

test('SkillHub accepts provider 1024px icons larger than 512KB and uses thumbnail encoder',async()=>{const png=Buffer.alloc(1200000);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);let encoded=0;const hub=createSkillHub({fetch:async()=>new Response(png),imageData:bytes=>{encoded=bytes.length;return 'data:image/png;base64,thumbnail';}});assert.equal(await hub.icon('https://cloudcache.tencent-cloud.com/large.png'),'data:image/png;base64,thumbnail');assert.equal(encoded,1200000);});

test('duplicate upstream slugs retain every row with distinct render identities across category changes',async()=>{
 const hub=createSkillHub({fetch:async u=>{const category=new URL(u).searchParams.get('category');return json({code:0,data:category==='office-efficiency'?{total:1,skills:[{slug:'office-only',category}]}:{total:3,skills:[{slug:'dev-expert',name:'版本一'},{slug:'dev-expert',name:'版本二'},{slug:'other'}]}});}});
 const all=await hub.search({keyword:'',page:1});assert.equal(all.skills.length,3);assert.equal(new Set(all.skills.map(s=>s.rowKey)).size,3);assert.deepEqual(all.skills.map(s=>s.slug),['dev-expert','dev-expert','other']);
 const office=await hub.search({keyword:'',page:1,category:'office-efficiency'});assert.equal(office.skills.length,1);assert.equal(office.skills[0].slug,'office-only');assert.ok(!all.skills.some(s=>s.rowKey===office.skills[0].rowKey));
});
test('all sort choices reach API while preserving category, keyword and first-page reset',async()=>{
 const seen=[];const hub=createSkillHub({fetch:async u=>{const q=new URL(u).searchParams;seen.push(Object.fromEntries(q));const sort=q.get('sortBy');return json({code:0,data:{total:1,skills:[{slug:'skill-'+sort,name:sort}]}});}});
 const names=[];for(const sortBy of ['downloads','stars','score','updated_at']){const result=await hub.search({keyword:'文档',category:'office-efficiency',page:1,sortBy});names.push(result.skills[0].name);}
 assert.deepEqual(names,['downloads','stars','score','updated_at']);assert.equal(seen.length,4);for(const q of seen){assert.equal(q.category,'office-efficiency');assert.equal(q.keyword,'文档');assert.equal(q.page,'1');assert.equal(q.order,'desc');}
});

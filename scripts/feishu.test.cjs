const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createFeishu}=require('../apps/desktop/feishu.cjs');
const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('encrypted:'+s),decryptString:b=>b.toString().replace(/^encrypted:/,'')};
async function setup(t,fetchImpl,crypto=safeStorage){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-feishu-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,api:createFeishu({directory,safeStorage:crypto,fetchImpl})};}
const good=()=>new Response(JSON.stringify({code:0,tenant_access_token:'test-token'}));
test('saved credentials never returned, persist and disconnect without sending messages',async t=>{
 const calls=[];const {api,directory}=await setup(t,async(url,opts)=>{calls.push({url,opts});return good();});
 assert.deepEqual(await api.status(),{configured:false,appId:''});
 const state=await api.save({appId:'cli_testing',secret:'secret123'});assert.deepEqual(state,{configured:true,appId:'cli_testing'});
 assert.ok(JSON.parse(await fs.readFile(path.join(directory,'feishu.json'))).secret);
 await api.save({appId:'cli_testing',secret:''});await api.test();
 assert.ok(calls.every(c=>c.url==='https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'&&c.opts.redirect==='error'));
 await api.disconnect();assert.equal((await api.status()).configured,false);
});
test('invalid credentials do not overwrite saved configuration and errors exclude provider secrets',async t=>{
 let fail=false;const {api}=await setup(t,async()=>fail?new Response(JSON.stringify({code:999,msg:'secret123'})):good());
 await api.save({appId:'cli_testing',secret:'secret123'});fail=true;
 await assert.rejects(api.save({appId:'cli_otherapp',secret:'secret456'}),e=>e.message.includes('999')&&!e.message.includes('secret'));
 assert.equal((await api.status()).appId,'cli_testing');
});
test('reads only fixed Feishu endpoints, rejects arbitrary and wiki links, returns plain material',async t=>{
 const calls=[];const {api}=await setup(t,async(url,opts)=>{calls.push(url);if(url.includes('/auth/'))return good();assert.equal(opts.headers.Authorization,'Bearer test-token');return new Response(JSON.stringify({code:0,data:url.endsWith('raw_content')?{content:'需求正文'}:{document:{title:'天气需求'}}}));});
 await api.save({appId:'cli_testing',secret:'secret123'});
 for(const url of ['https://evil.test/docx/a','https://demo.feishu.cn.evil.test/docx/a','https://demo.feishu.cn/wiki/a','http://demo.feishu.cn/docx/a','https://user@demo.feishu.cn/docx/a'])await assert.rejects(api.readDocument(url));
 assert.equal(calls.length,1);
 const m=await api.readDocument('https://demo.feishu.cn/docx/abc123');assert.equal(m.text,'需求正文');assert.equal(m.name,'天气需求.txt');assert.ok(calls.every(u=>u.startsWith('https://open.feishu.cn/open-apis/')));
});
test('encryption unavailable fails closed and oversized API responses fail safely',async t=>{
 const {api}=await setup(t,()=>assert.fail('must not request'),{...safeStorage,isEncryptionAvailable:()=>false});
 await assert.rejects(api.save({appId:'cli_testing',secret:'secret123'}),/加密/);
 const second=await setup(t,async()=>new Response('x'.repeat(4000001)));await assert.rejects(second.api.save({appId:'cli_testing',secret:'secret123'}),/飞书请求失败/);
});

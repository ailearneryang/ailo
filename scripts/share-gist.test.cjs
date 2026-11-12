const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createGistShare,shareContent}=require('../apps/desktop/share-gist.cjs');
const {giteeMarkdown}=require('../apps/desktop/gitee-markdown.cjs');
function setup(fetchImpl){
 const workspace={tasks:[{id:'task',title:'今日结果',messages:[{id:'user',role:'user',content:'私密问题',materials:[{name:'private.txt',text:'附件内容'}]},{id:'answer',role:'assistant',content:'可分享的结论'}]}]};
 const storage={readWorkspace:async()=>structuredClone(workspace),mutateWorkspace:async fn=>fn(workspace)};
 return {workspace,share:createGistShare({storage,fetchImpl})};
}
test('Gitee is the default, creates a public snippet containing only the selected answer, and reuses its link',async()=>{
 const requests=[];const {workspace,share}=setup(async(url,init)=>{requests.push({url,init});return init.method==='GET'?new Response('[]',{status:200}):new Response(JSON.stringify({html_url:'https://gitee.com/tester/codes/abc123'}),{status:201});});
 assert.deepEqual(await share.status({taskId:'task',messageId:'answer'}),{connected:false,url:''});
 const first=await share.publish({taskId:'task',messageId:'answer',token:'gitee-token'});
 assert.equal(first.url,'https://gitee.com/tester/codes/abc123');
 assert.match(requests[0].url,/https:\/\/gitee\.com\/api\/v5\/gists\?/);
 assert.equal(requests[0].init.method,'GET');
 assert.equal(requests[1].url,'https://gitee.com/api/v5/gists');
 const body=JSON.parse(requests[1].init.body);
 assert.equal(body.public,true);assert.ok(body.description.length<=30);
 assert.match(body.files['Ailo-answer.md'].content,/可分享的结论/);
 assert.doesNotMatch(body.files['Ailo-answer.md'].content,/私密问题|附件内容|private.txt/);
 assert.equal(body.access_token,'gitee-token');
 assert.equal(requests[1].init.headers.Authorization,undefined);
 assert.deepEqual(await share.status({taskId:'task',messageId:'answer'}),{connected:true,url:first.url});
 assert.equal((await share.publish({taskId:'task',messageId:'answer'})).reused,true);
 assert.equal(requests.length,2);assert.equal(JSON.stringify(workspace).includes('gitee-token'),false);
 share.clear();assert.equal((await share.status({taskId:'task',messageId:'answer'})).connected,false);
});
test('GitHub remains separately selectable and cannot reuse the Gitee token or link',async()=>{
 const requests=[];const {share}=setup(async(url,init)=>{requests.push({url,init});return init.method==='GET'?new Response('[]',{status:200}):new Response(JSON.stringify({html_url:url.includes('gitee.com')?'https://gitee.com/tester/codes/abc123':'https://gist.github.com/tester/abc123'}),{status:201});});
 await share.publish({taskId:'task',messageId:'answer',provider:'gitee',token:'gitee-token'});
 assert.deepEqual(await share.status({taskId:'task',messageId:'answer',provider:'github'}),{connected:false,url:''});
 await assert.rejects(share.publish({taskId:'task',messageId:'answer',provider:'github'}),/GitHub Token/);
 const result=await share.publish({taskId:'task',messageId:'answer',provider:'github',token:'github-token'});
 assert.equal(result.url,'https://gist.github.com/tester/abc123');
 assert.equal(requests.at(-1).url,'https://api.github.com/gists');
 assert.equal(JSON.parse(requests.at(-1).init.body).public,false);
 assert.equal(requests.at(-1).init.headers.Authorization,'Bearer github-token');
});
test('Gist publishing rejects invalid messages, failed authentication and unexpected links without persisting a link',async()=>{
 const {workspace,share}=setup(async(url,init)=>init.method==='GET'?new Response('[]',{status:200}):new Response('{}',{status:401}));
 await assert.rejects(share.publish({taskId:'task',messageId:'answer'}),/Gitee Token/);
 await assert.rejects(share.publish({taskId:'task',messageId:'user',token:'token'}),/没有可分享/);
 await assert.rejects(share.publish({taskId:'task',messageId:'answer',token:'bad'}),/无效或已过期/);
 assert.equal(workspace.tasks[0].messages[1].shares,undefined);
 assert.throws(()=>shareContent({title:'大文本'},{role:'assistant',content:'x'.repeat(100001)}),/10 万字符/);
 const wrong=setup(async(url,init)=>init.method==='GET'?new Response('[]',{status:200}):new Response(JSON.stringify({html_url:'https://evil.example/abc'}),{status:201}));
 await assert.rejects(wrong.share.publish({taskId:'task',messageId:'answer',token:'token'}),/有效的分享链接/);
});
test('Gitee 500 performs read-only reconciliation and never retries the POST',async()=>{
 let posts=0,gets=0;const {workspace,share}=setup(async(url,init)=>{if(init.method==='GET'){gets++;return new Response('[]',{status:200});}posts++;return new Response('{"message":"internal error test-token"}',{status:500,headers:{'x-request-id':'abc123'}});});
 await assert.rejects(share.publish({taskId:'task',messageId:'answer',token:'test-token'}),error=>/公开发布结果无法确认.*请勿立即重复发布.*abc123/.test(error.message)&&!error.message.includes('test-token'));
 assert.equal(posts,1);assert.equal(gets,2);assert.equal(workspace.tasks[0].messages[1].shares,undefined);
});
test('Gitee finds an existing matching snippet before another publish',async()=>{
 let posts=0;const {workspace,share}=setup(async(url,init)=>{if(init.method==='POST'){posts++;return new Response('{}',{status:500});}if(url.includes('/gists/abc123?'))return new Response(JSON.stringify({files:{'Ailo-answer.md':{content:'# 今日结果\n\n可分享的结论\n'}}}),{status:200});return new Response(JSON.stringify([{id:'abc123',description:'Ailo 分享 · 今日结果',html_url:'https://gitee.com/tester/codes/abc123'}]),{status:200});});
 const result=await share.publish({taskId:'task',messageId:'answer',token:'test-token'});
 assert.equal(result.url,'https://gitee.com/tester/codes/abc123');assert.equal(result.reused,true);assert.equal(posts,0);
 assert.ok(workspace.tasks[0].messages[1].shares.gitee);
});
test('Gitee accepts the documented array-shaped creation response',async()=>{
 const {share}=setup(async(url,init)=>init.method==='GET'?new Response('[]',{status:200}):new Response(JSON.stringify([{html_url:'https://gitee.com/tester/codes/abc123'}]),{status:201}));
 assert.equal((await share.publish({taskId:'task',messageId:'answer',token:'test-token'})).url,'https://gitee.com/tester/codes/abc123');
});
test('Gitee list permission failure stops before any public write',async()=>{
 let posts=0;const {share}=setup(async(url,init)=>{if(init.method==='POST')posts++;return new Response('{}',{status:403});});
 await assert.rejects(share.publish({taskId:'task',messageId:'answer',token:'test-token'}),/代码片段列表（HTTP 403）.*未发起发布/);
 assert.equal(posts,0);
});
test('Gitee car-buying checklist with emoji is encoded before POST and original answer stays intact',async()=>{
 const source='## 买新能源车：重点关注 + 可谈优惠清单\n\n#### 🔋 电池与续航\n| 关注点 | 说明 |\n|---|---|\n| 🎁 优惠 | 现金优惠、赠品 |\n\n👨‍👩‍👧 家庭使用';
 let posted;const {workspace,share}=setup(async(url,init)=>{if(init.method==='GET')return new Response('[]',{status:200});posted=JSON.parse(init.body);if(/[\u{10000}-\u{10ffff}]/u.test(posted.files['Ailo-answer.md'].content))return new Response('{}',{status:500});return new Response(JSON.stringify({html_url:'https://gitee.com/tester/codes/car123'}),{status:201});});
 workspace.tasks[0].messages[1].content=source;
 assert.equal((await share.publish({taskId:'task',messageId:'answer',token:'test-token'})).url,'https://gitee.com/tester/codes/car123');
 assert.match(posted.files['Ailo-answer.md'].content,/&#x1f50b;/);
 assert.match(posted.files['Ailo-answer.md'].content,/&#x1f468;‍&#x1f469;‍&#x1f467;/);
 assert.equal(workspace.tasks[0].messages[1].content,source);
 assert.equal(workspace.tasks[0].messages[1].shares.gitee.hash,shareContent(workspace.tasks[0],workspace.tasks[0].messages[1]).hash);
});
test('Gitee numeric references preserve emoji in Markdown preview',async()=>{
 const {createRequire}=require('node:module'),desktopRequire=createRequire(require('node:path').resolve(__dirname,'../apps/desktop/package.json'));
 const React=desktopRequire('react'),{renderToStaticMarkup}=desktopRequire('react-dom/server');
 const {default:Markdown}=await import(require('node:url').pathToFileURL(desktopRequire.resolve('react-markdown')).href);
 const rendered=renderToStaticMarkup(React.createElement(Markdown,null,giteeMarkdown('### 🔋 电池\n\n🎁 优惠')));
 assert.match(rendered,/<h3>🔋 电池<\/h3>/);assert.match(rendered,/<p>🎁 优惠<\/p>/);
});
test('Gitee code containing emoji remains copyable code rather than literal numeric references',()=>{
 const inline=giteeMarkdown('执行 `echo "🔋"`，保留 `x < y`。');
 assert.equal(inline,'执行 <code>echo &quot;&#x1f50b;&quot;</code>，保留 `x < y`。');
 const fenced=giteeMarkdown('标题 🔋\n\n```js\nconst label = "🎁"; // x < y && a > b\n```\n\n正文。');
 assert.match(fenced,/<pre><code>const label = &quot;&#x1f381;&quot;; \/\/ x &lt; y &amp;&amp; a &gt; b\n<\/code><\/pre>/);
 assert.doesNotMatch(fenced,/[\u{10000}-\u{10ffff}]/u);
 assert.equal(giteeMarkdown('```js\nconst label = "电池";\n```'), '```js\nconst label = "电池";\n```');
});
test('GitHub keeps the exact emoji Markdown and Gitee does not reuse private snippets',async()=>{
 let posted;const {workspace,share}=setup(async(url,init)=>{
  if(init.method==='GET')return new Response(JSON.stringify([{id:'private',public:false,description:'Ailo 分享 · 今日结果',html_url:'https://gitee.com/tester/codes/private'}]),{status:200});
  posted=JSON.parse(init.body);return new Response(JSON.stringify({html_url:url.includes('gitee')?'https://gitee.com/tester/codes/new123':'https://gist.github.com/tester/abc123'}),{status:201});
 });
 assert.equal((await share.publish({taskId:'task',messageId:'answer',token:'test-token'})).url,'https://gitee.com/tester/codes/new123');
 workspace.tasks[0].messages[1].content='🔋 电池';
 await share.publish({taskId:'task',messageId:'answer',provider:'github',token:'github-token'});
 assert.match(posted.files['Ailo-回答.md'].content,/🔋 电池/);
});
async function persistentSetup(t){
 const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
 const directory=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'ailo-share-auth-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const key=crypto.randomBytes(32),calls={encrypt:0,decrypt:0,availability:0};
 const safeStorage={isEncryptionAvailable(){calls.availability++;return true;},encryptString(text){calls.encrypt++;const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]);},decryptString(bytes){calls.decrypt++;const cipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}};
 const makeCredentials=()=>require('../apps/desktop/share-credentials.cjs').createShareCredentials({directory,safeStorage});
 const {workspace}=setup();let owner=null,posts=0;const requests=[];
 const storage={account:async()=>owner,readWorkspace:async()=>structuredClone(workspace),mutateWorkspace:async fn=>fn(workspace)};
 const fetchImpl=async(url,init)=>{requests.push({url,init});if(init.method==='GET')return new Response('[]',{status:200});posts++;return new Response(JSON.stringify({html_url:url.includes('gitee')?'https://gitee.com/tester/codes/auth123':'https://gist.github.com/tester/abc123'}),{status:201});};
 return {directory,fs,path,calls,safeStorage,makeCredentials,workspace,storage,fetchImpl,requests,setOwner:value=>{owner=value;},posts:()=>posts};
}
test('Connect once, restart, then share without a token; status never unlocks credentials',async t=>{
 const f=await persistentSetup(t);let share=createGistShare({storage:f.storage,credentials:f.makeCredentials(),fetchImpl:f.fetchImpl});
 assert.deepEqual(await share.connect({provider:'gitee',token:'persistent-gitee-token'}),{connected:true});assert.equal(f.posts(),0);
 const files=await f.fs.readdir(f.path.join(f.directory,'share-credentials'));assert.equal(files.length,1);
 const secretFile=f.path.join(f.directory,'share-credentials',files[0]);assert.ok(!(await f.fs.readFile(secretFile,'utf8')).includes('persistent-gitee-token'));assert.equal((await f.fs.stat(secretFile)).mode&0o077,0);
 share.clear();share=createGistShare({storage:f.storage,credentials:f.makeCredentials(),fetchImpl:f.fetchImpl});
 const before={...f.calls};assert.deepEqual(await share.status({taskId:'task',messageId:'answer',provider:'gitee'}),{connected:true,url:''});assert.deepEqual(f.calls,before);
 await share.publish({taskId:'task',messageId:'answer',provider:'gitee'});
 assert.equal(JSON.parse(f.requests.at(-1).init.body).access_token,'persistent-gitee-token');assert.equal(f.calls.decrypt,1);
 f.workspace.tasks[0].messages[1].content+='第二次分享';await share.publish({taskId:'task',messageId:'answer',provider:'gitee'});assert.equal(f.calls.decrypt,1);
 assert.ok(!JSON.stringify(f.workspace).includes('persistent-gitee-token'));
});
test('Saved authorizations are isolated by account and provider; disconnect survives restart',async t=>{
 const f=await persistentSetup(t);const create=()=>createGistShare({storage:f.storage,credentials:f.makeCredentials(),fetchImpl:f.fetchImpl});let share=create();
 await share.connect({provider:'gitee',token:'local-gitee'});assert.equal((await share.status({provider:'github'})).connected,false);
 f.setOwner({id:'another-user'});assert.equal((await share.status({provider:'gitee'})).connected,false);await assert.rejects(share.publish({taskId:'task',messageId:'answer'}),/Gitee Token/);
 f.setOwner(null);await share.disconnect({provider:'gitee'});share=create();assert.equal((await share.status({provider:'gitee'})).connected,false);assert.equal(f.calls.decrypt,0);
});
test('Failed authorization or unavailable OS encryption never saves a token or publishes',async t=>{
 const f=await persistentSetup(t);let share=createGistShare({storage:f.storage,credentials:f.makeCredentials(),fetchImpl:async()=>new Response('{}',{status:401})});
 await assert.rejects(share.connect({provider:'gitee',token:'bad-token'}),/无效或已过期/);assert.equal((await share.status({provider:'gitee'})).connected,false);assert.equal(f.calls.encrypt,0);
 f.safeStorage.isEncryptionAvailable=()=>false;share=createGistShare({storage:f.storage,credentials:f.makeCredentials(),fetchImpl:f.fetchImpl});
 await assert.rejects(share.connect({provider:'gitee',token:'valid-token'}),/加密不可用/);assert.equal((await share.status({provider:'gitee'})).connected,false);assert.equal(f.posts(),0);
});
test('Disconnecting during read-only preflight prevents the pending public POST',async t=>{
 const f=await persistentSetup(t);let entered,release;const enteredPromise=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{release=resolve;});let posts=0;
 const share=createGistShare({storage:f.storage,credentials:f.makeCredentials(),fetchImpl:async(url,init)=>{if(init.method==='GET'){entered();await wait;return new Response('[]',{status:200});}posts++;return new Response('{}',{status:500});}});
 const result=share.publish({taskId:'task',messageId:'answer',token:'test-token'});await enteredPromise;await share.disconnect({provider:'gitee'});release();await assert.rejects(result,/已变更.*未发布/);assert.equal(posts,0);
});
test('A successful publication remains a success if saving authorization fails',async()=>{
 const {workspace}=setup();const share=createGistShare({storage:{readWorkspace:async()=>workspace,mutateWorkspace:async fn=>fn(workspace)},credentials:{save:async()=>{throw Error('disk full');}},fetchImpl:async(url,init)=>init.method==='GET'?new Response('[]',{status:200}):new Response(JSON.stringify({html_url:'https://gitee.com/tester/codes/auth123'}),{status:201})});
 const result=await share.publish({taskId:'task',messageId:'answer',token:'test-token'});assert.equal(result.url,'https://gitee.com/tester/codes/auth123');assert.equal(result.authorizationSaved,false);
});

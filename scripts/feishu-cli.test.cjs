const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createFeishuCli,apiArgs,authURL,clean,findBinary,command}=require('../apps/desktop/feishu-cli.cjs');
const connected={code:0,data:{identities:{user:{status:'ready',userName:'Tester'}}}};
async function setup(t,extra={}){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-feishu-cli-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,cli:createFeishuCli({directory,locate:async()=>'/fake/lark-cli',run:async()=>connected,...extra})};}
async function connect(cli){await cli.begin();for(let i=0;i<50;i++){const s=await cli.status();if(s.connected)return;await new Promise(r=>setTimeout(r,2));}assert.fail('not connected');}
const action={operation:'api',method:'POST',path:'/open-apis/im/v1/messages',params:{receive_id_type:'chat_id'},data:{receive_id:'oc_test',msg_type:'text',content:'{"text":"test"}'},purpose:'发送测试'};
test('business bridge rejects shell, credential endpoints, absolute URLs and file directives',()=>{
 for(const p of ['https://evil.test','/open-apis/auth/v3/token','/open-apis/im/v1/messages/../token','/open-apis/im/v1/messages?x=y'])assert.throws(()=>apiArgs({...action,path:p}));
 assert.throws(()=>apiArgs({...action,data:'@/etc/passwd'}));assert.throws(()=>apiArgs({operation:'schema',query:'im; rm -rf /'}));
 const args=apiArgs({...action,data:{text:'$(echo injected)'}});assert.ok(args.includes('{"text":"$(echo injected)"}'));assert.ok(!args.includes('--file'));
 assert.equal(authURL('https://accounts.feishu.cn/oauth/verify?x=1'),true);assert.equal(authURL('https://accounts.feishu.cn.evil.test/'),false);
 assert.deepEqual(clean({access_token:'secret',nested:{appSecret:'secret',content:'ok'}}),{nested:{content:'ok'}});
});
test('requires explicit connection, write approval and uses dedicated profile without shell',async t=>{
 const calls=[];let approval=false;
 const {cli}=await setup(t,{confirmWrite:async()=>approval,run:async(bin,args)=>{calls.push(args);return args.includes('api')?{code:0,data:{ok:true,data:{message_id:'om_test'}}}:connected;}});
 await assert.rejects(cli.execute(action),/先.*连接/);await connect(cli);
 await assert.rejects(cli.execute(action),/未确认/);assert.ok(!calls.some(a=>a.includes('api')));
 approval=true;await cli.execute(action);await cli.execute(action);
 assert.equal(calls.filter(a=>a.includes('api')).length,1);assert.ok(calls.every(a=>a[0]==='--profile'&&a[1]==='ailo-desktop'));
 await cli.disconnect();await assert.rejects(cli.execute(action),/先.*连接/);
});
test('unknown write outcome is not replayed after restart and records are scoped to execution',async t=>{
 const calls=[];const run=async(bin,args)=>{if(args.includes('api')){calls.push(args);throw Error('timeout');}return connected;};
 const {cli,directory}=await setup(t,{run,confirmWrite:async()=>true});await connect(cli);
 await assert.rejects(cli.execute(action,undefined,'task1'),/timeout/);
 const resumed=createFeishuCli({directory,run,locate:async()=>'/fake',confirmWrite:async()=>true});
 const result=await resumed.execute(action,undefined,'task1');assert.match(result.output,/未重复执行/);assert.equal(calls.length,1);
 await assert.rejects(resumed.execute(action,undefined,'task2'));assert.equal(calls.length,2);
});
test('schema and read requests use CLI JSON envelope without requesting write approval',async t=>{
 const {cli}=await setup(t,{confirmWrite:()=>assert.fail('read approval'),run:async(b,args)=>args.includes('api')?{code:0,data:{ok:true,data:{items:[{id:'a'}]}}}:connected});await connect(cli);
 const r=await cli.execute({operation:'api',method:'GET',path:'/open-apis/calendar/v4/calendars'});assert.equal(r.exitCode,0);assert.equal(JSON.parse(r.output).ok,true);
});
test('authorization URL is only exposed from CLI and opening requires active flow',async t=>{
 let resolveLogin,opened;
 const {cli}=await setup(t,{openExternal:async u=>{opened=u;},run:async(b,args,o)=>{
  if(args.includes('login')){o.onChunk(JSON.stringify({event:'device_authorization',verification_uri:'https://accounts.feishu.cn/oauth/verify',verification_uri_complete:'https://accounts.feishu.cn/oauth/verify?code=abc'})+'\n');return new Promise(resolve=>{resolveLogin=()=>resolve(connected);o.signal.addEventListener('abort',()=>resolve({code:1}));});}return connected;
 }});
 await assert.rejects(cli.openAuthorization());await cli.begin();for(let i=0;i<20&&!resolveLogin;i++)await new Promise(r=>setTimeout(r,2));
 assert.equal((await cli.status()).url,'https://accounts.feishu.cn/oauth/verify?code=abc');await cli.openAuthorization();assert.equal(opened,'https://accounts.feishu.cn/oauth/verify?code=abc');
 resolveLogin();await cli.dispose();
});
test('curated shortcuts discover commands and reject file expansion and identity overrides',async t=>{
 assert.deepEqual(apiArgs({operation:'help',query:'docs +fetch'}),['docs','+fetch','--help']);
 for(const params of [{markdown:'@/etc/passwd'},{markdown:'-'},{as:'bot'},{file:'secret'}])assert.throws(()=>apiArgs({operation:'shortcut',query:'docs +create',params}));
 assert.throws(()=>apiArgs({operation:'shortcut',query:'auth logout',params:{}}));
 let approvals=0;const calls=[];
 const {cli}=await setup(t,{confirmWrite:async()=>{approvals++;return true;},run:async(bin,args)=>{calls.push(args);return args.includes('--help')?{code:0,stdout:'Usage: docs +fetch'}:args.includes('+messages-send')?{code:0,data:{ok:true,message_id:'om_1'}}:connected;}});
 await connect(cli);assert.match((await cli.execute({operation:'help',query:'docs +fetch'})).output,/Usage/);
 const send={operation:'shortcut',query:'im +messages-send',params:{'chat-id':'oc_1',text:'hello'}};
 await cli.execute(send);await cli.execute(send);
 assert.equal(approvals,1);assert.equal(calls.filter(a=>a.includes('+messages-send')).length,1);
 assert.ok(calls.find(a=>a.includes('+messages-send')).includes('--text=hello'));
});
test('authorization opens browser automatically once per complete trusted URL',async t=>{
 const opened=[];let emit;
 const {cli}=await setup(t,{openExternal:async url=>opened.push(url),run:async(b,args,o)=>{
  if(!args.includes('login'))return connected;
  emit=o.onChunk;return new Promise(resolve=>o.signal.addEventListener('abort',()=>resolve({code:1})));
 }});
 await cli.begin();for(let i=0;i<30&&!emit;i++)await new Promise(r=>setTimeout(r,2));
 const payload=JSON.stringify({event:'device_authorization',verification_uri:'https://accounts.feishu.cn/oauth/verify',verification_uri_complete:'https://accounts.feishu.cn/oauth/verify?code=abc&scope=im',agent_hint:'https://open.feishu.cn/docs'});
 emit(payload.slice(0,100));await new Promise(r=>setImmediate(r));assert.equal(opened.length,0);
 emit(payload.slice(100)+'\n');await new Promise(r=>setImmediate(r));assert.deepEqual(opened,['https://accounts.feishu.cn/oauth/verify?code=abc&scope=im']);
 emit(payload+'\n');await new Promise(r=>setImmediate(r));assert.equal(opened.length,1);
 await cli.dispose();
});
test('CLI login event followed by final JSON is parsed without losing completion',async()=>{
 const r=await command('/usr/bin/printf',['%s\n',JSON.stringify({event:'device_authorization'}),JSON.stringify({ok:true,data:{authorized:true}})],{cwd:'/private/tmp'});
 assert.equal(r.code,0);assert.deepEqual(r.data,{ok:true,data:{authorized:true}});
});
test('application permissions open only the dedicated profile app on official host',async t=>{
 const opened=[];let appId='cli_test123';
 const {cli}=await setup(t,{openExternal:async url=>opened.push(url),run:async()=>({code:0,data:{appId,brand:'feishu',identities:{user:{status:'missing'}}}})});
 await cli.openPermissions();assert.deepEqual(opened,['https://open.feishu.cn/app/cli_test123/auth']);
 appId='../other';await assert.rejects(cli.openPermissions());assert.equal(opened.length,1);
});
test('existing dedicated user login repairs stale disabled state after restart',async t=>{
 const {cli,directory}=await setup(t);
 const state=await cli.status();assert.equal(state.connected,true);assert.equal(state.phase,'connected');
 const saved=JSON.parse(await fs.readFile(path.join(directory,'feishu-cli/connection.json'),'utf8'));assert.equal(saved.enabled,true);
 await cli.disconnect();assert.equal((await cli.status()).connected,false);
 const restarted=createFeishuCli({directory,locate:async()=>'/fake',run:async()=>connected});assert.equal((await restarted.status()).connected,false);
});
test('nonzero login result with a saved valid user credential still connects',async t=>{
 let loggedIn=false;
 const {cli}=await setup(t,{run:async(b,args)=>{
  if(args.includes('login')){loggedIn=true;return {code:1,data:{ok:false,error:{code:'MISSING_SCOPE'}}};}
  return loggedIn?connected:{code:0,data:{identities:{bot:{available:true},user:{available:false,status:'missing'}}}};
 }});
 await connect(cli);assert.equal((await cli.status()).connected,true);
});
test('calendar permission error retains scopes and is marked non-retryable',async t=>{
 const {cli}=await setup(t,{run:async(b,args)=>args.includes('api')?{code:1,data:{ok:false,error:{type:'permission',code:99991679,detail:{permission_violations:[{subject:'calendar:calendar:readonly'}]}}}}:connected});await connect(cli);
 await assert.rejects(cli.execute({operation:'api',method:'GET',path:'/open-apis/calendar/v4/calendars'}),e=>e.code==='FEISHU_PERMISSION'&&e.message.includes('calendar:calendar:readonly'));
 assert.deepEqual(apiArgs({operation:'shortcut',query:'calendar +agenda',params:{start:'2026-09-29T00:00:00+08:00'}}),['calendar','+agenda','--start=2026-09-29T00:00:00+08:00','--as','user']);
});
test('structured schema validation exposes available names rather than connection error',async t=>{
 const {cli}=await setup(t,{run:async(b,args)=>args.includes('schema')?{code:2,data:{ok:false,error:{type:'validation',message:'Unknown method: calendar.events.list',hint:'Available: get, instance_view, search_event'}}}:connected});await connect(cli);
 await assert.rejects(cli.execute({operation:'schema',query:'calendar.events.list'}),e=>e.message.includes('Unknown method: calendar.events.list')&&e.message.includes('Available: get, instance_view, search_event')&&!e.message.includes('请检查连接'));
});
test('shortcut help and fixed JSON/user parameters agree across supported commands',async t=>{
 for(const query of ['calendar +agenda','docs +search','docs +fetch','docs +create','im +messages-send']){
  const params=query==='im +messages-send'?{'chat-id':'oc_test',text:'hello'}:{};
  assert.deepEqual(apiArgs({operation:'shortcut',query,params:{...params,format:'json',as:'user'}}),apiArgs({operation:'shortcut',query,params}));
  assert.throws(()=>apiArgs({operation:'shortcut',query,params:{...params,format:'csv'}}),/仅支持 format=json/);
 }
 const {cli}=await setup(t,{run:async(b,args)=>args.includes('--help')?{code:0,stdout:'Usage: calendar +agenda\n --start string Start time\n --profile string profile\n -q, --jq string expression\n --format string json | csv'}:connected});await connect(cli);
 const r=await cli.execute({operation:'help',query:'calendar +agenda'});assert.match(r.output,/format 仅可为 json/);assert.ok(!r.output.includes('--profile'));assert.ok(!r.output.includes('--jq'));
});
test('CLI shortcut missing_scope type identifies exact scope and stops retrying',async t=>{
 const {cli}=await setup(t,{run:async(b,args)=>args.includes('+agenda')?{code:3,data:{ok:false,error:{type:'missing_scope',message:'missing required scope(s): calendar:calendar.event:read'}}}:connected});await connect(cli);
 await assert.rejects(cli.execute({operation:'shortcut',query:'calendar +agenda',params:{format:'json'}}),e=>e.code==='FEISHU_PERMISSION'&&e.message.includes('calendar:calendar.event:read'));
});
test('schema version aliases normalize without altering API paths or business calls',async t=>{
 assert.deepEqual(apiArgs({operation:'schema',query:'im.v1.messages'}),['schema','im.messages']);
 assert.deepEqual(apiArgs({operation:'schema',query:'calendar.v4.events.get'}),['schema','calendar.events.get']);
 assert.deepEqual(apiArgs({operation:'schema',query:'im.messages'}),['schema','im.messages']);
 assert.ok(apiArgs({operation:'api',method:'GET',path:'/open-apis/im/v1/messages'}).includes('/open-apis/im/v1/messages'));
 const calls=[];const {cli}=await setup(t,{run:async(b,args)=>{calls.push(args);return args.includes('schema')?{code:0,data:{methods:{delete:{}}}}:connected;}});await connect(cli);
 await cli.execute({operation:'schema',query:'im.v1.messages'});assert.ok(calls.some(a=>a.includes('im.messages')));assert.ok(!calls.some(a=>a.includes('im.v1.messages')));
});
test('message search workflow supports bounded pagination, boolean filters and read-only execution',async t=>{
 const args=apiArgs({operation:'shortcut',query:'im +messages-search',params:{'page-size':50,'is-at-me':true,'page-token':'next',format:'json'}});
 assert.ok(args.includes('--page-size=50'));assert.ok(args.includes('--is-at-me=true'));assert.ok(args.includes('--page-token=next'));
 assert.throws(()=>apiArgs({operation:'shortcut',query:'im +messages-search',params:{'page-size':51}}));
 assert.throws(()=>apiArgs({operation:'shortcut',query:'im +messages-search',params:{'page-all':true}}));
 assert.throws(()=>apiArgs({operation:'shortcut',query:'im +chat-messages-list',params:{}}));
 const calls=[];const {cli}=await setup(t,{confirmWrite:()=>assert.fail('read must not request write approval'),run:async(b,args)=>{calls.push(args);return args.includes('+messages-search')?{code:0,data:{ok:true,data:{items:[{message_id:'om_one'}],has_more:true,page_token:'next'}}}:connected;}});await connect(cli);
 const r=await cli.execute({operation:'shortcut',query:'im +messages-search',params:{'page-size':20}});assert.equal(JSON.parse(r.output).data.page_token,'next');assert.ok(calls.some(a=>a.includes('+messages-search')));
});

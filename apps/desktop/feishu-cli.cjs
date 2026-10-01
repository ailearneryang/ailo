const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const domains=['calendar','im','docs','docx','drive','sheets','base','bitable','task','tasks','wiki','contact','mail','minutes','vc','approval','attendance','okr','slides','whiteboard'];
function authURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['accounts.feishu.cn','open.feishu.cn','accounts.larksuite.com','open.larksuite.com','open.larkoffice.com'].includes(u.hostname);}catch{return false;}}
function clean(value){
 if(Array.isArray(value))return value.map(clean);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(access.?token|refresh.?token|app.?secret|device.?code|authorization|_notice)/i.test(k)).map(([k,v])=>[k,clean(v)]));
 return value;
}
const shortcuts={
 'im +messages-search':{flags:['query','chat-id','chat-type','sender','sender-type','exclude-sender-type','at-chatter-ids','include-attachment-type','is-at-me','start','end','page-size','page-token'],write:false},
 'im +chat-search':{flags:['query','member-ids','search-types','sort-by','page-size','page-token','exclude-muted','is-manager','disable-search-by-user'],write:false},
 'im +chat-messages-list':{flags:['chat-id','user-id','start','end','sort','page-size','page-token'],write:false},
 'im +messages-mget':{flags:['message-ids'],write:false},
 'calendar +agenda':{flags:['calendar-id','start','end'],write:false},
 'docs +search':{flags:['query','page-size','page-token','filter'],write:false},
 'docs +fetch':{flags:['doc','limit','offset'],write:false},
 'docs +create':{flags:['title','markdown','folder-token','wiki-node','wiki-space'],write:true},
 'im +messages-send':{flags:['chat-id','user-id','text','idempotency-key'],write:true},
};
function apiArgs(action){
 if(action.operation==='help'||action.operation==='shortcut'){
  const spec=shortcuts[action.query];
  if(!spec)throw Error('可用飞书快捷功能：'+Object.keys(shortcuts).join('、'));
  const args=action.query.split(' ');
  if(action.operation==='help')return [...args,'--help'];
  const params=action.params||{};
  if(typeof params!=='object'||Array.isArray(params)||JSON.stringify(params).length>20000)throw Error('飞书快捷参数无效或过长');
  for(const [key,inputValue] of Object.entries(params)){
   let value=inputValue;
   if(key==='page-size'&&typeof value==='number'&&Number.isInteger(value))value=String(value);
   if(['is-at-me','exclude-muted','is-manager','disable-search-by-user'].includes(key)&&typeof value==='boolean')value=String(value);
   // JSON output and user identity are bridge invariants, not model overrides.
   if(key==='format'){if(value!=='json')throw Error('Ailo 飞书工具仅支持 format=json，请移除其他输出格式');continue;}
   if(key==='as'){if(value!=='user')throw Error('Ailo 飞书工具仅支持 as=user');continue;}
   if(!spec.flags.includes(key)||typeof value!=='string'||value.trim().startsWith('@')||value.trim()==='-'||value.includes('\0'))throw Error('飞书快捷参数不受支持：'+key);
   if(key==='page-size'&&(!/^\d+$/.test(value)||Number(value)<1||Number(value)>(action.query==='im +chat-search'?100:action.query==='docs +search'?20:50)))throw Error('page-size 超出范围，请使用 1–'+(action.query==='im +chat-search'?100:action.query==='docs +search'?20:50));
   if(['is-at-me','exclude-muted','is-manager','disable-search-by-user'].includes(key)&&!['true','false'].includes(value))throw Error(key+' 必须为 true 或 false');
   args.push('--'+key+'='+value);
  }
  if(action.query==='im +messages-send'&&(!params.text||Boolean(params['chat-id'])===Boolean(params['user-id'])))throw Error('发送消息需要正文和唯一的群或用户 ID');
  if(action.query==='im +chat-messages-list'&&Boolean(params['chat-id'])===Boolean(params['user-id']))throw Error('读取聊天记录需要唯一的 chat-id 或 user-id');
  if(action.query==='im +messages-mget'&&(typeof params['message-ids']!=='string'||!/^om_[a-zA-Z0-9]+(,om_[a-zA-Z0-9]+){0,49}$/.test(params['message-ids'])))throw Error('message-ids 需要 1–50 个真实消息 ID，以逗号分隔');
  return [...args,'--as','user'];
 }
 if(action.operation==='schema'){
  if(typeof action.query!=='string'||!new RegExp('^('+domains.join('|')+')(\\.[a-zA-Z0-9_]+){0,3}$').test(action.query))throw Error('请提供业务域或 schema 名称，例如 calendar 或 calendar.events.get');
  // API versions belong in REST paths, not the CLI schema namespace.
  const query=action.query.replace(/^([a-z]+)\.v[0-9]+(?=\.)/,'$1');
  return ['schema',query];
 }
 if(action.operation!=='api'||!['GET','POST','PUT','PATCH','DELETE'].includes(action.method))throw Error('飞书操作无效');
 if(typeof action.path!=='string'||!new RegExp('^/open-apis/('+domains.join('|')+')/v[0-9]+(/[A-Za-z0-9_-]+)+$').test(action.path))throw Error('仅允许飞书业务 API 路径，不支持认证接口、外部地址或文件路径');
 const object=v=>v===undefined||v!==null&&typeof v==='object'&&!Array.isArray(v);
 if(!object(action.params)||!object(action.data)||JSON.stringify([action.params,action.data]).length>20000)throw Error('飞书参数必须为 JSON 对象且总长不超过20000字符');
 if(action.method==='GET'&&action.data!==undefined)throw Error('GET 请求不能包含请求体');
 const args=['api',action.method,action.path,'--as','user','--format','json'];
 if(action.params)args.push('--params',JSON.stringify(action.params));
 if(action.data)args.push('--data',JSON.stringify(action.data));
 return args;
}
async function findBinary(){
 const candidates=[path.join(os.homedir(),'.npm-global/lib/node_modules/@larksuite/cli/bin/lark-cli'),'/opt/homebrew/lib/node_modules/@larksuite/cli/bin/lark-cli','/usr/local/lib/node_modules/@larksuite/cli/bin/lark-cli'];
 for(const dir of (process.env.PATH||'').split(path.delimiter))if(dir)candidates.push(path.join(dir,'lark-cli'));
 for(const candidate of candidates){try{let file=await fs.realpath(candidate);if(file.endsWith('/scripts/run.js'))file=path.resolve(file,'../../bin/lark-cli');await fs.access(file,fs.constants.X_OK);return file;}catch{}}
 throw Error('未找到飞书 CLI。请按安装指引安装后重新检测。');
}
function command(binary,args,{cwd,signal,timeout=30000,onChunk}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('已停止飞书操作'));
  // No inherited API keys, shell, arbitrary cwd, or CLI auth overrides.
  const env={HOME:os.homedir(),PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'};
  if(process.env.TMPDIR)env.TMPDIR=process.env.TMPDIR;
  const child=spawn(binary,args,{cwd,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',size=0,ended=false,stopError;
  const stop=message=>{stopError=Error(message);child.kill('SIGKILL');};
  const cancel=()=>stop('已停止飞书操作');signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>stop('飞书操作超时，写操作请先核对飞书结果，勿直接重复提交'),timeout);
  const finish=(error,value)=>{if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
  for(const [stream,kind] of [[child.stdout,'out'],[child.stderr,'err']])stream.setEncoding('utf8').on('data',b=>{size+=Buffer.byteLength(b);if(size>2*1024*1024){stop('飞书结果过大，请缩小查询范围');return;}const text=b.toString('utf8');if(kind==='out')stdout+=text;else stderr+=text;onChunk?.(text);});
  child.on('error',()=>finish(Error('无法启动飞书 CLI，请检查安装')));
  child.on('close',code=>{if(stopError)return finish(stopError);let data;try{data=JSON.parse(stdout||stderr);}catch{for(const line of (stdout||stderr).trim().split(/\r?\n/).reverse()){try{data=JSON.parse(line);break;}catch{}}}finish(null,{code,data,stdout,stderr});});
 });
}
function createFeishuCli({directory,confirmWrite,openExternal,run=command,locate=findBinary}){
 const cwd=path.join(directory,'feishu-cli'),file=path.join(cwd,'connection.json');
 const profile='ailo-desktop';let enabled=false,desired=null,auth=null,queue=Promise.resolve(),saving=Promise.resolve();const active=new Set();const writes=new Map();
 const ready=fs.mkdir(cwd,{recursive:true,mode:0o700}).then(async()=>{try{const saved=JSON.parse(await fs.readFile(file,'utf8'));enabled=saved.enabled===true;desired=typeof saved.desired==='boolean'?saved.desired:enabled?true:null;}catch(e){if(e.code!=='ENOENT')throw e;}});
 const save=()=>{const value=JSON.stringify({enabled,desired});saving=saving.catch(()=>{}).then(async()=>{await fs.writeFile(file+'.tmp',value,{mode:0o600});await fs.rename(file+'.tmp',file);});return saving;};
 const serial=fn=>{const p=queue.catch(()=>{}).then(fn);queue=p;return p;};
 async function invoke(args,options={}){await ready;return run(await locate(),args[0]==='config'?args:['--profile',profile,...args],{cwd,...options});}
 const ok=result=>result.code===0&&result.data?.ok!==false;
 function failure(result){
  const e=result.data?.error||{};
  const scopes=[...(e.type==='missing_scope'&&typeof e.message==='string'?(e.message.match(/[a-z][a-z0-9_]*:[a-z0-9_.:]+/g)||[]):[]),...(Array.isArray(e.missing_scopes)?e.missing_scopes:[]),...(Array.isArray(e.detail?.permission_violations)?e.detail.permission_violations.map(x=>x.subject):[])].filter(x=>typeof x==='string'&&/^[a-z][a-z0-9_]*:[a-z0-9_.:]+$/.test(x));
  const code=typeof e.code==='number'||typeof e.code==='string'&&/^[a-zA-Z0-9_:-]{1,80}$/.test(e.code)?String(e.code):'';
  if(e.type==='permission'||e.type==='missing_scope'||e.subtype==='missing_scope'||code==='99991679')return '飞书权限不足'+(code?'（'+code+'）':'')+'。账号已连接，但当前操作需要补充授权。'+(scopes.length?'接口列出的权限要求：'+[...new Set(scopes)].join('、')+'。':'')+'请到应用连接 → 飞书 → 管理应用权限检查开通情况，再在补充权限中授权所需 scope；无需反复重试。';
  if(e.type==='validation'){
   const match=typeof e.message==='string'?e.message.match(/^Unknown (method|service|resource): ([a-zA-Z0-9_.+ -]{1,160})$/):null;
   const options=typeof e.hint==='string'&&/^Available: [a-zA-Z0-9_,. +\-]{1,1200}$/.test(e.hint)?e.hint:'';
   return '飞书命令参数或接口名称无效。'+(match?match[0]+'。':'')+(options?options+'。':'')+'请先查询顶层业务域 schema，再使用返回的 resources/methods 名称；schema 名称不含 v1/v4 等 API 版本号。发送文字消息使用 help/shortcut，query 为 im +messages-send。不要重复提交同一无效名称。';
  }
  if(!result.data&&/unknown (command|flag)|Unknown (service|resource|method)/i.test(result.stderr||result.stdout||''))return '飞书 CLI 不支持当前命令或接口名称，请先使用 schema 查询业务域，或使用 help 查询受支持的快捷命令。';
  return '飞书操作失败'+(code?'（'+code+'）':'')+'。请检查连接、资源权限及参数。';
 }
 function executionError(result){const error=Error(failure(result));const e=result.data?.error||{};if(e.type==='permission'||e.type==='missing_scope'||e.subtype==='missing_scope'||String(e.code)==='99991679')error.code='FEISHU_PERMISSION';return error;}

 async function inspect(){
  const r=await invoke(['auth','status']);const d=r.data?.data||r.data,user=d?.identities?.user;
  const missing=!ok(r)&&/profile .+ not found/.test(r.data?.error?.message||'');
  return {appId:typeof d?.appId==='string'?d.appId:undefined,brand:d?.brand,configured:ok(r),missing,error:!ok(r)&&!missing?'飞书配置或密钥链不可用，请检查 CLI 状态。':undefined,connected:ok(r)&&d?.verified!==false&&(user?.available===true||user?.status==='ready'||user?.tokenStatus==='valid'||d?.loggedIn===true),name:typeof user?.userName==='string'?user.userName:undefined};
 }
 async function status(){
  await ready;try{await locate();}catch{return {installed:false,enabled:false,connected:false,phase:'idle',message:'未找到可用的飞书 CLI，请安装后重新检测。'};}
  try{const s=await inspect();
   if(s.connected&&desired!==false&&!enabled){enabled=true;desired=true;await save();}
   const connected=enabled&&s.connected;
   const updating=auth?.running===true;
   return {installed:true,enabled,connected,name:s.name,phase:connected&&!updating?'connected':auth?.phase||'idle',url:auth?.url,message:connected&&!updating?'已连接，可以在对话中使用飞书。':auth?.message||s.error||'',configured:s.configured};}
  catch{return {installed:true,enabled,connected:false,phase:auth?.phase||'error',message:'飞书状态检查失败，请重试或检查 CLI。'};}
 }
 async function begin(input={}){
  const scopes=typeof input?.scopes==='string'?input.scopes.trim():'';
  if(scopes.length>2000||(scopes&&!scopes.split(/[ ,]+/).every(s=>/^[a-z][a-z0-9_]*:[a-z0-9_.:]+$/.test(s))))throw Error('授权范围格式无效，请填写飞书 scope 名称，以空格或逗号分隔');
  await ready;if(auth?.running)return status();desired=true;await save();
  const controller=new AbortController();auth={running:true,phase:'authorizing',message:'准备连接飞书…',controller};const current=auth;
  // Capture only approved HTTPS URLs; raw auth output stays in the main process.
  const opened=new Set();
  let buffer='';const onChunk=chunk=>{
   buffer=(buffer+chunk).slice(-16000);
   // Wait for a delimiter: a stream chunk may end halfway through an auth URL.
   for(const match of buffer.matchAll(/https:\/\/[^\s"<>\\]+(?=[\s"<>\\])/g)){
    const value=match[0];if(!authURL(value))continue;
    current.url=value;current.message='请在浏览器中完成飞书授权';
    if(opened.has(value)||controller.signal.aborted)continue;
    opened.add(value);
    Promise.resolve().then(()=>{if(current.running&&!controller.signal.aborted)return openExternal(value);}).catch(()=>{
     if(current.running&&!controller.signal.aborted)current.message='未能自动打开浏览器，请点击重新打开授权页';
    });
   }
  };
  let loginBuffer='';
  const onLoginChunk=chunk=>{
   loginBuffer+=chunk;
   const lines=loginBuffer.split(/\r?\n/);loginBuffer=lines.pop();
   for(const line of lines){let event;try{event=JSON.parse(line);}catch{continue;}
    const value=event.verification_uri_complete||event.verification_url;
    if(authURL(value))onChunk(value+'\n');
   }
  };
  current.promise=(async()=>{
   try{
    const s=await inspect();
    if(s.error)throw Error(s.error);
    if(!s.configured){current.message='请在浏览器中创建或绑定飞书应用';const r=await invoke(['config','init','--new','--name',profile,'--brand','feishu','--lang','zh'],{signal:controller.signal,timeout:300000,onChunk});if(!ok(r))throw Error(failure(r));}
    current.url=undefined;buffer='';current.message='应用配置已完成，正在获取用户授权链接…';
    const r=await invoke(['auth','login','--recommend','--json',...(scopes?['--scope',scopes]:[])],{signal:controller.signal,timeout:300000,onChunk:onLoginChunk});if(!ok(r))throw Error(failure(r));
    const verified=await inspect();if(!verified.connected)throw Error('授权尚未完成，请刷新状态或重新连接。');
    if(controller.signal.aborted)return;enabled=true;await save();current.phase='connected';current.message='已连接，可以在对话中使用飞书。';
   }catch(e){
    // CLI can store a valid login then fail while checking requested scopes.
    // Reconcile the actual user credential instead of leaving a stale error flag.
    const actual=!controller.signal.aborted?await inspect().catch(()=>null):null;
    if(actual?.connected&&desired!==false){enabled=true;await save();current.phase='connected';current.message='已连接；部分权限可能需要补充授权。';}
    else{current.phase='error';current.message=e.message;}
   }finally{current.running=false;current.url=undefined;}
  })();return status();
 }
 async function disconnect(){await ready;desired=false;enabled=false;await save();auth?.controller.abort();for(const c of active)c.abort();await auth?.promise;await queue.catch(()=>{});await save();const state=await inspect();if(state.missing){auth=null;return status();}const r=await invoke(['auth','logout']);auth=null;if(!ok(r))throw Error('Ailo 已停用飞书，但 CLI 注销失败，请重新解绑或在飞书授权管理中撤销。');return status();}
 async function execute(action,signal,taskKey='default'){return serial(async()=>{
  await ready;if(!enabled)throw Error('请先在扩展 → 应用连接中连接飞书。');
  const args=apiArgs(action);const write=action.operation==='api'&&action.method!=='GET'||action.operation==='shortcut'&&shortcuts[action.query]?.write===true;
  const key=createHash('sha256').update(JSON.stringify([taskKey,args])).digest('hex');
  if(write&&!writes.has(key)){try{writes.set(key,JSON.parse(await fs.readFile(path.join(cwd,'write-'+key+'.json'),'utf8')));}catch(e){if(e.code!=='ENOENT')throw Error('飞书操作记录不可读，请先核对远端结果。');}}
  if(write&&writes.has(key))return {output:JSON.stringify({previousResult:writes.get(key),notice:'相同写操作已提交或结果待核对，本次未重复执行。请先查询飞书结果。'})};
  if(write&&(!confirmWrite||!await confirmWrite(action,signal)))throw Object.assign(Error('用户未确认本次飞书写操作，未执行。'),{code:'FEISHU_DECLINED'});
  if(signal?.aborted||!enabled)throw Error('已停止飞书操作');
  const controller=new AbortController(),abort=()=>controller.abort();active.add(controller);signal?.addEventListener('abort',abort,{once:true});
  try{
   if(write){const pending={status:'unknown',notice:'请求已开始，请先核对远端结果，避免重复提交'};writes.set(key,pending);await fs.writeFile(path.join(cwd,'write-'+key+'.json'),JSON.stringify(pending),{mode:0o600});}
   const r=await invoke(args,{signal:controller.signal,timeout:60000});
   if(!ok(r))throw executionError(r);
   if(action.operation==='help'){
    const spec=shortcuts[action.query];
    const allowed=new Set(spec.flags);
    const help=(r.stdout||'').split('\n').filter(line=>{
     const flag=line.match(/--([a-z-]+)/);return !flag||allowed.has(flag[1]);
    }).join('\n').replace(/\(supports @file, - for stdin\)/g,'（仅允许内联正文）');
    return {output:'Ailo 快捷调用：operation=shortcut，query='+action.query+'；params 仅允许 '+spec.flags.join('、')+'。format 仅可为 json（默认），as 仅可为 user（默认）；无需传入。禁止文件引用、profile、jq 等其他 CLI 参数。参数值使用字符串。\n'+help,exitCode:0};
   }
   if(!r.data)throw Error('飞书未返回结构化结果，请核对远端执行情况。');
   const result=clean(r.data);if(write){writes.set(key,result);await fs.writeFile(path.join(cwd,'write-'+key+'.json'),JSON.stringify(result),{mode:0o600});}
   return {output:JSON.stringify(result),exitCode:0};
  }finally{active.delete(controller);signal?.removeEventListener('abort',abort);}
 });}
 return {status,begin,disconnect,execute,async openPermissions(){
  const state=await inspect();
  if(!state.configured||!/^cli_[a-zA-Z0-9]+$/.test(state.appId||''))throw Error('请先完成飞书应用配置，再管理应用权限。');
  const host=state.brand==='lark'?'https://open.larksuite.com':'https://open.feishu.cn';
  await openExternal(host+'/app/'+state.appId+'/auth');
 },async openAuthorization(){if(!auth?.running||!authURL(auth.url))throw Error('当前没有有效授权链接');await openExternal(auth.url);},async dispose(){auth?.controller.abort();for(const c of active)c.abort();await auth?.promise;await queue.catch(()=>{});}};
}
module.exports={createFeishuCli,apiArgs,authURL,clean,command,findBinary};

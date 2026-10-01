const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {resolveFile,normalizeProjectPath}=require('./workspace.cjs');
async function listFiles(root, relative='') {
  relative=normalizeProjectPath(relative,true);
  const directory=relative?await resolveFile(root,relative):root;
  const entries=await fs.readdir(directory,{withFileTypes:true});
  return entries.filter(e=>!e.isSymbolicLink()&&e.name!=='.runtime').slice(0,200).map(e=>({name:relative?relative+'/'+e.name:e.name,directory:e.isDirectory()}));
}
// Seatbelt localhost selectors also admit wildcard listeners on current macOS.
// Build mode is separately authorized; do not claim loopback-only enforcement.
function sandboxProfile(root, sdk, build=false, javaHome) {
  const q=s=>JSON.stringify(s);
  const read=['/System','/usr','/bin','/sbin','/opt/homebrew','/Library/Java','/Library/Developer','/Library/Apple','/Applications/Android Studio.app','/private/etc','/private/var/db/dyld','/dev',sdk,javaHome].filter(Boolean);
  const readable=read.map(p=>`(subpath ${q(p)})`).join(' ')+` (subpath ${q(root)})`;
  return `(version 1)(deny default)(allow process*)(allow sysctl-read)(allow mach-lookup (global-name "com.apple.system.logger") (global-name "com.apple.logd") (global-name "com.apple.system.notification_center") (global-name "com.apple.mDNSResponder"))(allow file-read-metadata)${build?'(allow network-bind (local ip "localhost:*"))(allow network-inbound (local ip "localhost:*"))':''}(allow network-outbound)(allow file-read* (literal "/") ${readable})(allow file-map-executable ${readable})(allow file-write* (subpath ${q(root)}) (literal "/dev/null") (literal "/dev/tty"))`;
}
async function runCommand(root,command,signal,timeout=120000,options={}) {
  if(typeof command!=='string'||!command.trim()||command.length>8000)throw Error('命令无效');
  if(process.platform!=='darwin')throw Error('此版本命令隔离仅支持 macOS，未启动命令');
  await fs.access('/usr/bin/sandbox-exec');
  root=await fs.realpath(root);
  const runtime=path.join(root,'.runtime');
  for(const dir of ['home','tmp','gradle'])await fs.mkdir(await resolveFile(root,'.runtime/'+dir,true),{recursive:true});
  const {sdk,javaHome}=await require('./android-environment.cjs').androidEnvironment({required:!!options.build});
  const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin',HOME:path.join(runtime,'home'),TMPDIR:path.join(runtime,'tmp'),GRADLE_USER_HOME:path.join(runtime,'gradle'),...(sdk?{ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk}:{}),...(javaHome?{JAVA_HOME:javaHome}:{}),LANG:'en_US.UTF-8'};
  // No inherited API keys or unrestricted fallback when sandbox setup fails.
  return new Promise((resolve,reject)=>{
    if(signal.aborted)return reject(Error('已停止执行'));
    const child=spawn('/usr/bin/sandbox-exec',['-p',sandboxProfile(root,sdk,!!options.build,javaHome),'/bin/sh','-c',command],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});
    let output='',truncated=false,timedOut=false;
    const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
    const timer=setTimeout(()=>{timedOut=true;kill();},timeout);
    let lastUpdate=0;
    const collect=b=>{output+=b.toString();if(output.length>24000){output=output.slice(-24000);truncated=true;}if(Date.now()-lastUpdate>1000){lastUpdate=Date.now();options.onOutput?.(output.slice(-800));}};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    signal.addEventListener('abort',kill,{once:true});
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',kill);};
    child.on('error',e=>{cleanup();reject(e);});
    child.on('close',(exitCode,terminationSignal)=>{cleanup();kill();if(signal.aborted)return reject(Error('已停止执行'));resolve({exitCode,terminationSignal,output,truncated,timedOut});});
  });
}
async function execute(workspace,action,signal,options={}) {
  const {files}=workspace;
  switch(action.action) {
    case 'list_files':return listFiles(files,action.path === undefined ? '' : action.path);
    case 'read_file': {
      const file=await resolveFile(files,action.path);const stat=await fs.stat(file);
      if(!stat.isFile()||stat.size>2000000)throw Error('仅支持读取 2 MB 以内文本文件');
      const text=await fs.readFile(file,'utf8');const offset=action.offset||0;
      if(!Number.isInteger(offset)||offset<0)throw Error('读取位置无效');
      return {path:action.path,total:text.length,offset,text:text.slice(offset,offset+10000)};
    }
    case 'write_file': {
      if(typeof action.content!=='string'||action.content.length>200000)throw Error('文件内容超过限制');
      if(action.path?.split('/').includes('.runtime'))throw Error('运行目录不允许写入');
      const file=await resolveFile(files,action.path,true);
      await fs.writeFile(file,action.content,{mode:0o600,flag:require('node:fs').constants.O_WRONLY|require('node:fs').constants.O_CREAT|require('node:fs').constants.O_TRUNC|require('node:fs').constants.O_NOFOLLOW});
      return {path:action.path,bytes:Buffer.byteLength(action.content)};
    }
    case 'run_command': return runCommand(files,action.command,signal);
    case 'web_search': if(!options.webSearch)throw Object.assign(Error('当前对话未开启联网搜索，请在 ＋ → 应用连接中开启。'),{code:'SEARCH_UNAVAILABLE'});return options.webSearch.execute(action,signal);
    case 'feishu': if(!options.feishuCli)throw Error('当前未启用飞书应用连接');return options.feishuCli.execute(action,signal,workspace.run.executionId||workspace.run.taskId);
    case 'build_android': return require('./android-build.cjs').buildAndroid(files,action,signal,options);
    case 'android_device': {
      if(!options.android)throw Error('当前执行环境没有启用 Android 设备管理服务');
      return options.android.execute(files,action,signal,options.onStatus);
    }
    case 'read_material':return workspace.material(action.id,action.offset||0,action.limit||6000);
    case 'read_source':return workspace.source(action.id,action.entry,action.offset||0);
    case 'read_execution':return workspace.execution(action.offset||0);
    case 'inspect_source':return workspace.inspect(action.id,action.entry,action.pointer,action.offset||0,action.query);
    case 'search_materials':return workspace.search(action.query);
    default:throw Error('未知工具');
  }
}
module.exports={execute,runCommand,listFiles,sandboxProfile};

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
function sandboxProfile(root, sdk, build=false, javaHome, readDirectories=[]) {
  const q=s=>JSON.stringify(s);
  const read=['/System','/usr','/bin','/sbin','/opt/homebrew','/Library/Java','/Library/Developer','/Library/Apple','/Applications/Android Studio.app','/private/etc','/private/var/db/dyld','/dev',sdk,javaHome,...readDirectories].filter(Boolean);
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
    const child=spawn('/usr/bin/sandbox-exec',['-p',sandboxProfile(root,sdk,!!options.build,javaHome,options.readDirectories),'/bin/sh','-c',command],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});
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
      if(!stat.isFile()||stat.size>(/\.(pdf|xlsx|pptx|ppt)$/i.test(action.path)?20*1024*1024:2000000))throw Error('仅支持读取 2 MB 以内文本文件');
      const parsed=/\.(pdf|xlsx|pptx|ppt)$/i.test(action.path)?await require('../document-parser.cjs').parseDocument(file,action.path):null;
      const text=parsed?parsed.text:await fs.readFile(file,'utf8');const offset=action.offset||0;
      if(!Number.isInteger(offset)||offset<0)throw Error('读取位置无效');
      return {path:action.path,sha256:require('node:crypto').createHash('sha256').update(await fs.readFile(file)).digest('hex'),total:text.length,offset,text:text.slice(offset,offset+10000)};
    }
    case 'edit_spreadsheet': {
      if(!/\.xlsx$/i.test(action.path)||!action.data||typeof action.data.version!=='string')throw Error('需要 XLSX 路径和当前 SHA-256 版本');
      const result=await require('../artifact-edit.cjs').editFile(files,require('node:path').join(workspace.project,'backups'),action.path,{version:action.data.version,sheet:action.data.sheet,cells:action.data.cells});
      return {path:action.path,sha256:result.version,updatedCells:action.data.cells,notice:'单元格已修改并保留上一版本；未重算公式。请核对业务要求并登记成果。'};
    }
    case 'write_file': {
      if(typeof action.content!=='string'||action.content.length>200000)throw Error('文件内容超过限制');
      if(action.path?.split('/').includes('.runtime'))throw Error('运行目录不允许写入');
      const file=await resolveFile(files,action.path,true);
      try{const before=await fs.readFile(file);if(before.length<=10*1024*1024){const backupDir=require('node:path').join(workspace.project,'backups');await fs.mkdir(backupDir,{recursive:true,mode:0o700});await fs.writeFile(require('node:path').join(backupDir,require('node:crypto').createHash('sha256').update(normalizeProjectPath(action.path)).digest('hex')+'.backup'),before,{mode:0o600});}}catch(e){if(e.code!=='ENOENT')throw e;}
      await fs.writeFile(file,action.content,{mode:0o600,flag:require('node:fs').constants.O_WRONLY|require('node:fs').constants.O_CREAT|require('node:fs').constants.O_TRUNC|require('node:fs').constants.O_NOFOLLOW});
      return {path:action.path,bytes:Buffer.byteLength(action.content)};
    }
    case 'request_directory': {
      if(!options.directoryAccess)throw Object.assign(Error('当前环境未提供目录授权入口，任务已保留。'),{code:'DIRECTORY_UNAVAILABLE'});
      return options.directoryAccess.request(workspace.run.taskId,action,signal);
    }
    case 'run_command': {
      const result=await runCommand(files,action.command,signal,120000,{readDirectories:options.directoryAccess?.directories(workspace.run.taskId)});
      if(/Operation not permitted|Permission denied/i.test(result.output))result.notice='访问被拒绝，尚不能判断是否为系统隐私限制。若需要工作区外目录，请使用 request_directory 获取只读授权；已授权仍失败时说明具体路径，并引导用户检查系统文件与文件夹权限或管理员策略，不要重复探测或直接断言 TCC。';
      return result;
    }
    case 'web_search': if(!options.webSearch)throw Object.assign(Error('当前对话未开启联网搜索，请在 ＋ → 应用连接中开启。'),{code:'SEARCH_UNAVAILABLE'});return options.webSearch.execute(action,signal);
    case 'knowledge': if(!options.knowledge)throw Error('当前对话未选择知识库');return options.knowledge.execute(action,signal);
    case 'mcp': if(!options.mcp)throw Object.assign(Error('当前对话未选择自定义应用连接。'),{code:'MCP_UNAVAILABLE'});return options.mcp.execute(action,signal);
    case 'amap': if(!options.amap)throw Object.assign(Error('当前环境未启用高德地图，请在应用连接中配置。'),{code:'AMAP_UNAVAILABLE'});return options.amap.execute(action,signal);
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

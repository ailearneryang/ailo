// Read-only command checks through the SELECTED runtime's isolated executor.
// No API credential, model, dependency installation, network, or device call.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const COMMANDS=Object.freeze(['node --version','npm --version']);
function classify(result,error){
 const text=String(error?.message||result?.stderr||result?.output||'');
 if(error?.code==='EPERM'||error?.code==='EACCES'||/sandbox(?:_|\s|-)apply.*(?:not permitted|denied)|operation not permitted|sandbox-exec.*(?:denied|not permitted)/i.test(text))return {code:'EVAL_ENVIRONMENT_DENIED',reason:'外层运行环境拒绝启动隔离命令；此项未通过，不能据此判断Node/npm已可用。'};
 if(error)return {code:'EVAL_COMMAND_CHECK_FAILED',reason:'隔离命令无法完成：'+String(error.code||'execution_error')};
 if(result?.timedOut)return {code:'EVAL_COMMAND_CHECK_TIMEOUT',reason:'隔离版本检查超时，环境尚未验证可用。'};
 if(result?.exitCode!==0)return {code:'EVAL_COMMAND_RUNTIME_MISSING',reason:'所选运行版本的隔离命令未成功退出；Node/npm可能缺失或不在该版本允许的命令环境中。'};
 return {code:'EVAL_COMMAND_VERSION_INVALID',reason:'命令返回的内容不是可识别的版本号，不能按成功统计。'};
}
async function weatherEnvironment({source,execute,loadModule=require,tempDirectory=os.tmpdir(),timeoutMs=10000}={}){
 if(typeof source!=='string'||!path.isAbsolute(source))throw Error('Environment preflight requires an explicit absolute source root');
 const started=Date.now(),result={kind:'weather_environment_preflight',passed:false,status:'environment_failed',modelRequests:0,checks:[],capability:{mode:'legacy_tools_only',discovery:false,notice:'所选源码没有命令运行时发现模块；仅依据该版本tools的实际隔离执行结果判断，不替换为当前工作区实现。'}};
 let project;
 try{
  const toolsFile=path.join(source,'apps/desktop/agent/tools.cjs'),runtimeFile=path.join(source,'apps/desktop/agent/command-runtime.cjs');
  const runCommand=execute||loadModule(toolsFile).runCommand;if(typeof runCommand!=='function')throw Object.assign(Error('Selected runtime does not expose runCommand'),{code:'EVAL_EXECUTOR_UNAVAILABLE'});
  let discovery;
  try{await fs.access(runtimeFile);result.capability={mode:'selected_command_runtime_unverified',discovery:false,notice:'所选源码提供命令运行时模块；模块发现与实际执行尚未完成。'};const runtime=loadModule(runtimeFile);if(typeof runtime.resolve!=='function'||typeof runtime.environment!=='function')throw Object.assign(Error('Selected command-runtime contract is unsupported'),{code:'EVAL_RUNTIME_CONTRACT_UNSUPPORTED'});discovery=await runtime.resolve();result.capability={mode:'selected_command_runtime',discovery:true,nodeDiscovered:discovery.node?.available===true,npmDiscovered:discovery.npm?.available===true,notice:'发现结果只表示候选文件存在；通过仍须由下列实际隔离版本检查证明。'};}catch(error){if(error.code!=='ENOENT')throw error;}
  project=await fs.mkdtemp(path.join(tempDirectory,'ailo-eval-environment-'));
  for(const command of COMMANDS){
   let output,error;try{output=await runCommand(project,command,new AbortController().signal,timeoutMs,{networkOutbound:false,build:false,...(discovery?{commandRuntime:discovery}:{})});}catch(cause){error=cause;}
   const version=String(output?.stdout??output?.output??'').trim(),valid=!error&&output?.exitCode===0&&!output?.timedOut&&/^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version);
   result.checks.push({command,passed:valid,version:valid?version:null,exitCode:Number.isInteger(output?.exitCode)?output.exitCode:null,...(!valid?classify(output,error):{})});
  }
  result.passed=result.checks.length===COMMANDS.length&&result.checks.every(c=>c.passed);result.status=result.passed?'passed':'environment_failed';
 }catch(error){result.error={code:error.code||'EVAL_ENVIRONMENT_SETUP_FAILED',reason:'所选运行版本的环境预检无法完成；未调用模型，也未将环境故障记为通过。'};}
 finally{if(project)await fs.rm(project,{recursive:true,force:true});result.elapsedMs=Date.now()-started;}
 return result;
}
async function persist(directory,record){
 // A preflight must not append files to a frozen or previously failed trial.
 // Keep diagnostics next to an existing experiment in a fresh sibling folder.
 let target=directory;
 try{if((await fs.readdir(directory)).length)target=path.join(path.dirname(directory),'preflight-'+path.basename(directory)+'-'+Date.now()+'-'+require('node:crypto').randomUUID().slice(0,8));}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.mkdir(target,{recursive:true,mode:0o700});const file=path.join(target,'preflight-'+Date.now()+'.json');await fs.writeFile(file,JSON.stringify(record,null,2),{mode:0o600,flag:'wx'});return file;
}
module.exports={weatherEnvironment,COMMANDS,classify,persist};

const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
async function checkDesktopStartup(output,version){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-startup-check-'));
 const launchLogs=require('./start-desktop.cjs').createLaunchLogs({writeStdout:()=>{},writeStderr:()=>{}});
 try{
  const data=path.join(directory,'data'),log=launchLogs.logFile;await fs.mkdir(data);
  const bundle=path.join(output,'Ailo.app');
  const command=require('./start-desktop.cjs').launchCommand({executable:path.join(bundle,'Contents/MacOS/Ailo')},['--ailo-startup-check'],'darwin',log);
  command.args.splice(command.args.indexOf('-a'),0,'--env','AILO_DATA_DIR='+data);
  execFileSync(command.command,command.args,{timeout:30000,stdio:'pipe'});
  const lines=(await fs.readFile(log,'utf8')).trim().split('\n');let result;
  for(const line of lines)try{const row=JSON.parse(line);if(row.type==='ailo-startup-check')result=row;}catch{}
  if(!result||result.version!==version||result.appPath!==path.join(bundle,'Contents/Resources/app.asar')||result.dataPath!==data)throw Error('最终 Ailo 包启动自检未确认正确版本、应用路径或隔离数据目录：'+JSON.stringify({result,stdout:lines.join('\n').slice(-1200),stderr:(await fs.readFile(log+'.stderr','utf8')).slice(-1200)}));
  return result;
 }finally{launchLogs.close();await fs.rm(launchLogs.directory,{recursive:true,force:true});await fs.rm(directory,{recursive:true,force:true});}
}
module.exports={checkDesktopStartup};

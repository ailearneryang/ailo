const fs=require('node:fs/promises');
const path=require('node:path');
function createDirectoryAccess({select}) {
  const grants=new Map();
  return {
    directories(taskId){return [...(grants.get(taskId)||[])];},
    async request(taskId,action,signal){
      if(typeof action.path!=='string'||!path.isAbsolute(action.path)||/[\x00-\x1f]/.test(action.path)||action.path.length>1000)throw Error('请提供需要访问的绝对目录路径');
      if(typeof action.purpose!=='string'||!action.purpose.trim()||action.purpose.length>1000)throw Error('请说明目录读取用途');
      const selected=signal.aborted?null:await select(action,signal);
      if(!selected||signal.aborted)throw Object.assign(Error('目录授权已取消，任务进度已保留。点击继续任务可重新选择目录并授权。'),{code:'DIRECTORY_DECLINED'});
      let directory;
      try {
        directory=await fs.realpath(selected);
        if(!(await fs.stat(directory)).isDirectory())throw Error('选择的路径不是文件夹');
        // Validate actual access in the host before extending the command sandbox.
        const handle=await fs.opendir(directory);await handle.close();
      } catch(error) {
        if(!['EACCES','EPERM'].includes(error.code))throw error;
        throw Object.assign(Error('系统仍拒绝读取所选目录，任务已保留。请检查 macOS 隐私与安全性中的文件与文件夹权限及管理员策略，然后点击继续任务。'),{code:'DIRECTORY_SYSTEM_PERMISSION'});
      }
      if(signal.aborted)throw Object.assign(Error('授权已停止，任务已保留。'),{code:'DIRECTORY_DECLINED'});
      const paths=grants.get(taskId)||new Set();paths.add(directory);grants.set(taskId,paths);
      return {path:directory,access:'read-only',scope:'current-task-app-session',verified:true};
    },
  };
}
module.exports={createDirectoryAccess};

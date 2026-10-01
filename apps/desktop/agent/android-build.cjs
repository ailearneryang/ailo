const path=require('node:path');
const {resolveFile}=require('./workspace.cjs');
const active=new Set();
function tasksFor(action){
 const tasks=action.tasks||[':app:assembleDebug',':app:testDebugUnitTest',':app:lintDebug'];
 if(!Array.isArray(tasks)||!tasks.length||tasks.length>8||tasks.some(t=>typeof t!=='string'||!/^:?(?:[A-Za-z0-9_-]+:)*[A-Za-z][A-Za-z0-9_]*$/.test(t)))throw Error('构建 tasks 必须是 1–8 个 Gradle 任务名称，不能包含选项或 shell 命令');
 return tasks;
}
async function buildAndroid(root,action,signal,{onStatus,authorizeBuild}={}) {
 const tasks=tasksFor(action),fs=require('node:fs/promises');
 root=await fs.realpath(root);
 if(!authorizeBuild||!await authorizeBuild(root,signal))throw Object.assign(Error('尚未授权当前项目使用标准 Android 构建环境，任务已保留。'),{code:'ANDROID_PERMISSION'});
 if(signal.aborted)throw Error('已停止执行');
 if(active.has(root))throw Error('当前项目已有构建正在运行，请等待或停止该任务后重试');
 await fs.access(await resolveFile(root,'gradlew'));
 if(action.path&&action.path!=='.')throw Error('Android 构建只支持当前项目根目录');
 active.add(root);
 try {
  onStatus?.('正在使用标准 Gradle 构建与验证（最长 20 分钟，可停止）…');
  const result=await require('./tools.cjs').runCommand(root,'/bin/sh ./gradlew --no-daemon --no-watch-fs --console=plain '+tasks.join(' '),signal,20*60*1000,{build:true,onOutput:output=>onStatus?.('Gradle：'+output.split(/\r?\n/).filter(Boolean).at(-1)?.slice(0,240))});
  return {...result,tasks,verification:'gradle',notice:result.exitCode===0?'所列 Gradle 任务已成功；不代表已完成安装或运行验证。':'标准构建未通过。根据日志修复或说明环境阻塞，不要改用手工拼装 APK 冒充完整构建。'};
 }finally{active.delete(root);}
}
module.exports={buildAndroid,tasksFor};

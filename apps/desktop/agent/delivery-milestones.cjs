const fs=require('node:fs/promises');
const {resolveFile}=require('./workspace.cjs'),proof=require('./evidence.cjs');
async function registerBuild(workspace,event){
 const run=workspace.run,result=event?.detail?.result;
 if(event?.type!=='build_android'||result?.exitCode!==0||result.timedOut||result.buildInputsChanged||result.buildEnvironmentChanged)return [];
 const registered=[];
 for(const item of result.buildArtifacts||[]){
  try{
  if(typeof item.path!=='string'||!item.path.endsWith('.apk')||item.path.split('/').includes('.runtime'))continue;
  const file=await resolveFile(workspace.files,item.path),stat=await fs.stat(file);
  if(!stat.isFile()||stat.size<=0||stat.size>150*1024*1024||await proof.hashFile(file)!==item.sha256)continue;
  const prior=run.artifacts?.find(a=>a.path===item.path);if(prior?.sha256===item.sha256)continue;
  const artifact={path:item.path,label:'Android 安装包（阶段成果，待验收）',size:stat.size,sha256:item.sha256,origin:'standard_build',buildEventId:event.id,quality:'unverified'};
  run.artifacts=(run.artifacts||[]).filter(a=>a.path!==item.path).concat(artifact);
  run.pendingArtifactUpdates=(run.pendingArtifactUpdates||[]).filter(p=>p!==item.path);registered.push(artifact);
  }catch(error){
   if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;
   run.artifactMilestoneWarnings=[...(run.artifactMilestoneWarnings||[]),{buildEventId:event.id,path:typeof item?.path==='string'?item.path.slice(0,500):undefined,code:error.code||'INVALID_BUILD_ARTIFACT',message:'构建完成，但阶段文件登记未成功；需检查实际产物，不能当作已验收。'}].slice(-4);
  }
 }
 return registered;
}
module.exports={registerBuild};

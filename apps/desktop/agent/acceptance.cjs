const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {resolveFile}=require('./workspace.cjs');
const criterionId=text=>'a_'+createHash('sha256').update(text).digest('hex').slice(0,16);
function criteria(run){return (run.acceptance||[]).map(text=>({id:criterionId(text),text,check:run.acceptanceResults?.[criterionId(text)]}));}
async function verify(workspace,action){
 const run=workspace.run;
 if(!Array.isArray(action.checks)||!action.checks.length||action.checks.length>12)throw Error('verify.checks 必须包含 1–12 条验收检查');
 const results=[],seen=new Set();
 for(const check of action.checks){
  if(!check||!criteria(run).some(c=>c.id===check.criterionId)||seen.has(check.criterionId))throw Error('验收项 id 无效或重复，请使用 acceptanceCriteria 中的 id');
  seen.add(check.criterionId);
  if(typeof check.reason!=='string'||!check.reason.trim()||check.reason.length>800)throw Error('请说明检查如何覆盖这条验收要求');
  let sha256,evidence;
  if(check.kind==='command'){
   const event=run.events.find(e=>e.id===check.evidenceId&&['run_command','build_android'].includes(e.type));
   if(!event||event.detail.revision!==run.revision||event.detail.result?.exitCode!==0||event.detail.result?.timedOut)throw Error('验收命令证据无效或已过期');
   evidence=event.id;
  }else if(['file_exists','text_contains','json_valid'].includes(check.kind)){
   const file=await resolveFile(workspace.files,check.path),stat=await fs.stat(file);
   if(!stat.isFile()||stat.size===0||stat.size>2*1024*1024)throw Error('验收检查需要非空且不超过 2 MB 的文件');
   const data=await fs.readFile(file);sha256=createHash('sha256').update(data).digest('hex');
   if(check.kind==='text_contains'){
    if(!Array.isArray(check.contains)||!check.contains.length||check.contains.length>24||check.contains.some(s=>typeof s!=='string'||!s||s.length>800))throw Error('contains 必须为 1–24 个非空检查文本');
    const missing=check.contains.filter(s=>!data.toString('utf8').includes(s));if(missing.length)throw Error('验收未通过，缺少内容：'+missing.join('、'));
   }
   if(check.kind==='json_valid')JSON.parse(data.toString('utf8'));
  }else throw Error('验收检查类型无效');
  results.push({...check,sha256,evidenceId:evidence,revision:run.revision,status:'passed'});
 }
 // Publish only after the complete batch passes. A failed batch never grants partial approval.
 run.acceptanceResults ||= {};
 for(const result of results)run.acceptanceResults[result.criterionId]=result;
 await workspace.event('acceptance_verified',{results});await workspace.save();return {results};
}
async function assertAccepted(workspace){
 for(const criterion of criteria(workspace.run)){
  const check=criterion.check;
  if(!check||check.status!=='passed'||check.revision!==workspace.run.revision)throw Error('尚未核验验收项：'+criterion.text+'；请先 verify，每项绑定真实检查或当前版本的命令证据');
  if(check.sha256){const data=await fs.readFile(await resolveFile(workspace.files,check.path));if(createHash('sha256').update(data).digest('hex')!==check.sha256)throw Error('验收文件已变化，请重新 verify：'+check.path);}
 }
}
module.exports={criteria,verify,assertAccepted,criterionId};

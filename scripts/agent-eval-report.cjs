const fs=require('node:fs/promises'),path=require('node:path');
const {cases}=require('./agent-eval-cases.cjs');
const {serviceFailure}=require('./agent-eval-service.cjs');
const directory=path.resolve(process.argv[2]||'.local/evals/iteration-20261020');
async function summarize(){
 const trials=[];
 for(const version of ['baseline','candidate'])for(const c of cases)for(let repeat=1;repeat<=3;repeat++){
  const dir=path.join(directory,version,c.id+'-'+repeat);let d;
  try{d=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  let progress=d.result?.agentRun;
  if(!progress)try{progress=JSON.parse(await fs.readFile(path.join(dir,'progress.json'),'utf8'));}catch{}
  let requests=[];try{requests=JSON.parse(await fs.readFile(path.join(dir,'requests.json'),'utf8'));}catch{}
  const logged=progress?.performance||{},p=requests.length?{...logged,modelRequests:requests.length,inputTokens:requests.reduce((n,r)=>n+(r.providerUsage?.inputTokens||0),0),outputTokens:requests.reduce((n,r)=>n+(r.providerUsage?.outputTokens||0),0)}:logged,human=d.humanAcceptance,automatic=d.externalChecks===undefined?null:[...d.checks,...d.externalChecks].every(c=>c.passed),declared=progress?.status==='completed'&&!d.error&&!d.timedOut;
  trials.push({serviceBlocked:serviceFailure(requests,d.error),version,case:c.id,category:c.category,repeat,status:progress?.status||'error',declared,automatic,human,humanVerifiedSuccess:declared&&automatic&&human==='passed',falseCompletion:declared&&([...d.checks,...(d.externalChecks||[])].some(c=>!c.passed)||human==='failed'),elapsedMs:d.elapsedMs,requests:p.modelRequests,inputTokens:p.inputTokens,outputTokens:p.outputTokens,noActionMs:p.noActionMs,noActionRequests:p.noActionRequests,usageReported:requests.filter(r=>Number.isFinite(r.providerUsage?.inputTokens)&&Number.isFinite(r.providerUsage?.outputTokens)).length,executionInterventions:0,resumeOutcome:'not_measured',error:d.error,reviewPath:path.relative(directory,dir)});
 }
 const median=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return !a.length?null:a.length%2?a[Math.floor(a.length/2)]:(a[a.length/2-1]+a[a.length/2])/2;};
 const versions=Object.fromEntries(['baseline','candidate'].map(version=>{const list=trials.filter(t=>t.version===version),eligible=list.filter(t=>!t.serviceBlocked),verified=list.filter(t=>t.humanVerifiedSuccess);return [version,{expected:30,attempted:list.length,finished:eligible.length,serviceBlocked:list.length-eligible.length,declaredComplete:list.filter(t=>t.declared).length,automaticChecksPassed:eligible.filter(t=>t.automatic).length,verifiedSuccess:verified.length,humanPending:eligible.filter(t=>t.human==='pending').length,knownFalseCompletion:eligible.filter(t=>t.falseCompletion).length,medianVerifiedSuccessMs:median(verified.map(t=>t.elapsedMs)),medianDeclaredCompletionMs:median(list.filter(t=>t.declared).map(t=>t.elapsedMs)),eligibleRequests:eligible.reduce((n,t)=>n+(t.requests||0),0),eligibleInputTokens:eligible.reduce((n,t)=>n+(t.inputTokens||0),0),eligibleOutputTokens:eligible.reduce((n,t)=>n+(t.outputTokens||0),0),usageReported:list.reduce((n,t)=>n+t.usageReported,0),totalRequests:list.reduce((n,t)=>n+(t.requests||0),0),inputTokens:list.reduce((n,t)=>n+(t.inputTokens||0),0),outputTokens:list.reduce((n,t)=>n+(t.outputTokens||0),0),noActionMs:list.reduce((n,t)=>n+(t.noActionMs||0),0)}];}));
 const diagnostics=[];for(const name of ['candidate-attempt1','candidate-attempt2','candidate-attempt3']){const root=path.join(directory,name);let entries=[];try{entries=await fs.readdir(root);}catch{}let requests=0,inputTokens=0,outputTokens=0,completed=0,serviceBlocked=0;for(const entry of entries)try{const rs=JSON.parse(await fs.readFile(path.join(root,entry,'requests.json'),'utf8'));requests+=rs.length;try{const d=JSON.parse(await fs.readFile(path.join(root,entry,'result.json'),'utf8'));if(d.result?.agentRun?.status==='completed'&&!d.error)completed++;if(serviceFailure(rs,d.error))serviceBlocked++;}catch{}inputTokens+=rs.reduce((n,r)=>n+(r.providerUsage?.inputTokens||0),0);outputTokens+=rs.reduce((n,r)=>n+(r.providerUsage?.outputTokens||0),0);}catch{}diagnostics.push({name,requests,inputTokens,outputTokens,completed,serviceBlocked,notice:'研发诊断开销，不计入冻结版本的30次样本；中断未上报用量不估算'});}
 let health;try{health=JSON.parse(await fs.readFile(path.join(directory,'service-health.json'),'utf8'));}catch{}
 const report={health,diagnostics,generatedAt:new Date().toISOString(),notice:'主模型、端点、输入和界面思考设置固定；框架的阶段推理策略属于本次改动。供应商负载未控制；明确的服务端额度/鉴权/故障响应单独列为受阻样本，不用于框架成功率或提速对比；无动作暂停仍算有效失败。机器检查不等于人工质量验收；未完成、超时、暂停不计成功。费用只报告tokens，不推算价格。',versions,trials};
 await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
 const lines=['# Ailo 跨任务对照结果','',report.notice,'','|版本|完成试验/计划|服务受阻|Agent声明完成|自动检查通过|人工待验收|已确认正确交付|已发现错误完成|','|---|---:|---:|---:|---:|---:|---:|---:|'];
 for(const [name,v]of Object.entries(versions))lines.push(`|${name}|${v.finished}/${v.expected}|${v.serviceBlocked}|${v.declaredComplete}|${v.automaticChecksPassed}|${v.humanPending}|${v.verifiedSuccess}|${v.knownFalseCompletion}|`);
 lines.push('','人工未验收的任务不能用于发布“正确完成率、无需人工干预完成率或正确交付提速百分比”。每个试验目录的 result.json 包含固定 rubric；人工审阅成果后可将 humanAcceptance 改为 passed/failed 并记录理由，再重新汇总。','');
 lines.push('','研发诊断开销（不混入正式样本，仍保留实际记录）：'+diagnostics.map(d=>`${d.name}：完成${d.completed}次、服务受阻${d.serviceBlocked}次、${d.requests}次请求，已报告输入${d.inputTokens}/输出${d.outputTokens} tokens`).join('；'),'','当前矩阵没有单独测量自动暂停后继续的成功率；代码/格式修复任务和离线恢复测试不能替代这一指标。','');
 if(health)lines.push(`最后一次服务健康检查：${health.at}，HTTP ${health.httpStatus}，错误码 ${health.providerCode||'未知'}。`,'');
 lines.push('诊断候选的成功记录不归入最后修正后冻结版本的正式样本。最后补充的重复裁剪坐标修复已离线验证；完整模型对照需额度恢复后重新完成最终候选30次。','');
 for(const t of trials)lines.push(`- ${t.version}/${t.case}-${t.repeat}：${t.serviceBlocked?'服务受阻':t.status}；${Math.round(t.elapsedMs/1000)}秒；${t.requests??'?'}次请求；自动检查${t.automatic===null?'待独立检查':t.automatic?'通过':'失败'}；人工${t.human}。`);
 await fs.writeFile(path.join(directory,'report.md'),lines.join('\n')+'\n');console.log(JSON.stringify(versions,null,2));
}
summarize().catch(e=>{console.error(e.message);process.exitCode=1;});

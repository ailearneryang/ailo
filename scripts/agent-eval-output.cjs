const path=require('node:path');
const short=value=>String(value??'未知').replace(/[\r\n]+/g,' ').slice(0,100);
function preflightSummary(record,file){
 const lines=[record.passed?'Node/npm 隔离版本预检通过；未调用模型。':'Node/npm 隔离版本预检未通过；未调用模型。'];
 if(record.capability?.mode==='legacy_tools_only')lines.push('检测方式：所选旧版tools兼容检查（无command-runtime发现模块）。');
 for(const check of record.checks||[])lines.push(`${check.command}：${check.passed?short(check.version):'失败，'+short(check.reason)}`);
 if(record.error)lines.push(short(record.error.reason));if(file)lines.push('预检记录：'+file);return lines.join('\n');
}
function reportSummary(report,directory){
 const lines=['试验结束≠交付完成。'];
 if(report.evaluationPurpose==='bounded_diagnostic')lines.push('这是有界短路径诊断，不计完整任务、冷启动或无辅助完成率；仅验证指定执行路径。');
 for(const [name,value]of Object.entries(report.versions||{}))if(value.attempted){
  const statuses={};for(const trial of report.trials||[])if(trial.version===name){const status=trial.serviceBlocked?'服务受阻':trial.status;statuses[status]=(statuses[status]||0)+1;}
  lines.push(`${name}：已记录试验 ${value.attempted}/${value.expected}；${Object.entries(statuses).map(([status,n])=>short(status)+' '+n).join('、')}；已确认正确交付 ${value.verifiedSuccess}，质量待判定 ${value.qualityPending}。`);
  if(value.totalRequests!==undefined)lines.push(`模型请求 ${value.totalRequests} 次${Number.isFinite(value.medianAllTrialMs)?'；耗时中位数 '+(value.medianAllTrialMs/60000).toFixed(1)+' 分钟':''}。`);
  for(const trial of report.trials||[])if(trial.version===name&&trial.assistedResume){const a=trial.resumeAccounting;lines.push(`受辅助续跑：原试验 ${(a.priorElapsedMs/60000).toFixed(1)} 分钟/${a.priorModelRequests} 次请求，加本段 ${(a.segmentElapsedMs/60000).toFixed(1)} 分钟/${a.segmentModelRequests} 次；累计 ${(a.cumulativeElapsedMs/60000).toFixed(1)} 分钟/${a.cumulativeModelRequests} 次。单列续跑，不计首次冷启动或无辅助一次完成。`);}
 }
 if(!report.versions?.baseline?.attempted)lines.push('无baseline不构成对照；本结果仅为单版本诊断。');
 else if(!report.versions?.candidate?.attempted)lines.push('尚无候选版本试验，不构成对照。');
 else lines.push('对照结论仍须满足相同模型、输入、环境与独立验收口径。');
 lines.push('完整记录：'+path.join(directory,'report.json'));return lines.join('\n');
}
module.exports={preflightSummary,reportSummary};

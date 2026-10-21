const contract={maxOutputTokens:8192,noActionTimeoutMs:90000,maxWriteChars:8000,maxCommandChars:2000,maxBatchItems:3};
function stepId(run){return run.steps.find(s=>s.status==='running')?.id||run.steps.find(s=>s.status!=='done')?.id||null;}
function active(run){const state=run.decisionRecovery;if(!state)return false;if(state.inputKey!==run.inputKey||state.stepId!==stepId(run)){delete run.decisionRecovery;return false;}return true;}
function begin(run,code,attempt=1){const previous=active(run)?run.decisionRecovery:undefined;attempt=Math.max(attempt,previous?.attempt||1);run.decisionRecovery={...contract,attempt,stage:attempt>=3?'direct_action':attempt>=2?'refocus':'small_action',inputKey:run.inputKey,stepId:stepId(run),cause:code,progressKeys:previous?.progressKeys||[],focus:run.executionState?.blocker||run.executionState?.gaps?.[0]||run.executionState?.expectedResult||run.steps.find(s=>s.id===stepId(run))?.title};return run.decisionRecovery;}
function progress(run,action,result){
 if(!active(run)||result?.timedOut||result?.exitCode!==undefined&&result.exitCode!==0)return;
 if(!['write_file','edit_file','edit_spreadsheet','read_file','batch_read','browser','view_image','run_command','feishu','mcp','amap','web_search','knowledge','assistant','memory'].includes(action.action))return;
 if(action.action==='batch_read'&&!result.results?.some(r=>!r.error&&!r.result?.notExecuted))return;
 const key=require('node:crypto').createHash('sha256').update(JSON.stringify([action.action,action.operation,action.id,action.query,action.params,action.data,action.path,action.offset,action.command,action.content,result.sha256,result.fileChanges,result.text,result.scope])).digest('hex');
 const state=run.decisionRecovery;state.progressKeys||=[];
 if(!state.progressKeys.includes(key))state.progressKeys.push(key);
 // Leave low-budget recovery after two distinct successful observations/effects,
 // even when a long-running plan step has not finished. Bookkeeping never counts.
 if(state.progressKeys.length>=2)delete run.decisionRecovery;
}
function compact(snapshot,preview){
 const state=snapshot.decisionRecovery||{},stage=state.stage||'small_action';
 const compacted={...snapshot,previousExecutions:snapshot.previousExecutions?.map(r=>({goal:r.goal,status:r.status})),
  toolResults:snapshot.toolResults?.slice(-2).map(result=>({...preview(result,1600),observationId:result.observationId})),
  knownFileContents:snapshot.knownFileContents?.slice(-2).map(file=>preview(file,3000)),readCoverage:snapshot.readCoverage?.slice(-8),
  externalMemory:{...snapshot.externalMemory,recent:snapshot.externalMemory?.recent?.slice(-6)},
  decisionRecovery:{...contract,...state,stage,focus:state.focus||snapshot.executionState?.blocker||snapshot.executionState?.gaps?.[0]||snapshot.executionState?.expectedResult||snapshot.steps?.find(s=>s.status==='running')?.title,nextAction:snapshot.executionState?.nextAction,expectedResult:snapshot.executionState?.expectedResult,instruction:'保留用户要求、权限与已有成果，只围绕当前缺口选择一个最小下一步。应用任务仍可调用已授权应用工具；不要重做整体规划。完整材料可通过 read_execution 回查。禁止通过 pause 或 blocked 逃避仍可执行的工作。'}};
 if(stage!=='small_action'){
  // Retain authoritative requirements/permissions/catalogues. Drop duplicated
  // history and large previews, never restart or replay an executed tool.
  for(const key of ['previousExecutions','conversation','knownFileContents','readCoverage'])delete compacted[key];
  compacted.toolResults=snapshot.toolResults?.slice(-1).map(result=>({...preview(result,1200),observationId:result.observationId}));
  compacted.recentEvents=snapshot.recentEvents?.slice(-3);
  if(snapshot.projectMemory)compacted.projectMemory={...snapshot.projectMemory,records:[]};
  compacted.decisionRecovery.instruction+=' 当前为恢复决策，只提交一个动作，不解释整个方案；分页读取逐项处理，不使用 batch_read。';
 }
 return compacted;
}

function validate(action){
 if(action.action==='write_file'&&typeof action.content==='string'&&action.content.length>contract.maxWriteChars)throw Error('小动作恢复：单次写入最多8000字符；请拆成模块或分步写入，不提交整份大文件');
 if(action.action==='run_command'&&typeof action.command==='string'&&action.command.length>contract.maxCommandChars)throw Error('小动作恢复：命令最多2000字符；不要嵌入整份工程');
 if(action.action==='batch_read'&&action.items?.length>contract.maxBatchItems)throw Error('小动作恢复：一次最多读取3项');
}
module.exports={contract,stepId,active,begin,compact,validate,progress};

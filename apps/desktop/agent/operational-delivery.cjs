// Operations and queries can deliver verified results in the reply. A file is
// required when the user's output contract or a requirement actually needs one.
function fileRequired(run){
 const request=[run.currentRequest,run.goal].filter(Boolean).join('\n');
 return ['application','design'].includes(run.requestContract?.kind)||/(?:保存|导出|下载|写入|生成|交付|提供).{0,20}(?:文件|安装包|源代码|源码|PDF|DOCX|XLSX|PPTX)|\.(?:md|html?|json|csv|pdf|docx|xlsx|pptx|apk)\b/i.test(request)||require('./acceptance.cjs').criteria(run).some(c=>c.type==='presence'||c.type==='visual'||c.scope||c.scopes?.length);
}
async function assertReplyDelivery(workspace,text){
 const run=workspace.run;
 if(fileRequired(run))throw Object.assign(Error('用户要求的文件或应用仍需实际成果，不能用正文代替。'),{code:'DELIVERY_OUTPUT_REQUIRED'});
 if(typeof text!=='string'||text.trim().length<12||/^(?:已完成|完成了|已执行|操作成功|任务完成)[。！!\s]*$/.test(text.trim()))throw Object.assign(Error('请在finish.text中给出可使用的实际结论或查询表格，不能只说已完成。'),{code:'DELIVERY_RESULT_REQUIRED'});
 const acceptance=require('./acceptance.cjs'),proof=require('./evidence.cjs'),criteria=acceptance.criteria(run).filter(c=>!require('./quality-contract.cjs').optional(c));
 if(!criteria.length)throw Error('操作型交付仍须有原要求及实际核验证据');
 await acceptance.assertAccepted(workspace);
 const ids=new Set();
 for(const criterion of criteria)for(const part of criterion.check?.parts||[criterion.check]){
  if(!part||!['command','operation'].includes(part.kind)||!part.evidenceId)throw Error('正文交付须逐项关联真实操作回执，不能仅凭模型自评');
  await proof.assertFresh(workspace,part);if(part.kind==='command'){const event=await proof.event(workspace,part.evidenceId);if(event.type!=='run_command'||!String(event.detail.result.stdout||event.detail.result.output||'').trim())throw Error('查询或操作结果须来自有实际输出的成功命令回执');}
  ids.add(part.evidenceId);
 }
 return {kind:'verified_reply',evidenceIds:[...ids],requirementIds:criteria.map(c=>c.id)};
}
function readyForFinish(run){if(run.mode!=='task'||run.acceptanceInputKey!==run.inputKey||require('./input-coverage.cjs').pending(run).length||require('./material-input.cjs').pending(run)||require('./action-journal.cjs').unknown(run)||!run.steps?.length||require('./completion-policy.cjs').pendingMandatorySteps(run).length)return false;const must=require('./acceptance.cjs').criteria(run).filter(c=>!require('./quality-contract.cjs').optional(c));return must.length>0&&must.every(c=>c.check?.status==='passed'&&run.freshAcceptanceIds?.includes(c.id));}
function context(run){return {mode:'complete_goal',readyForFinish:readyForFinish(run),instruction:'持续执行至原目标及验收完成。工具失败先检查实际错误并改用已授权兼容路径：CLI参数/认证不兼容可核对帮助与服务端版本，再尝试等价API或已连接工具；须保持用户明确的工具、权限及验收约束，不重复相同失败。网络查询使用非交互命令，并设置小于宿主时限的连接与总超时，检查HTTP状态；401/403先核对认证方式，禁止重复同一失败请求。已有可用资料与授权时不要让用户点击继续。只有确需用户授权、选择或关键资料时clarify；内部错误和工具失败不能用pause/blocked交还用户。查询、安装、配置任务有完整真实核验时可finish直接交付正文结论/表格，不必为完成而新建无用文件；文件与应用任务仍按原成果和验收交付。',inlineResultAllowed:!fileRequired(run)};}
function userRequestedPause(run){return /^(?:(?:请|帮我|先|现在|暂时)\s*)*(?:暂停|停止|停下|不要继续|先别执行)/.test(String(run.currentRequest||'').trim());}
function assertUserQuestion(run,clarification){if(readyForFinish(run))throw Object.assign(Error('当前目标已完成核验，请用finish交付真实结果。可选的后续建议放在正文中，不能将已完成任务变成等待选择。'),{code:'DELIVERY_RESULT_REQUIRED'});const text=[clarification?.title,...(clarification?.questions||[]).map(q=>q.title)].join(' ');if(/是否继续|要不要继续|需要(?:我)?继续|是否重试|继续(?:执行|下一步).{0,3}[吗？?]/.test(text)&&!/授权|权限|身份|认证|凭据/.test(text)&&!run.steps?.some(s=>s.status==='running'&&s.requiresConfirmation))throw Object.assign(Error('继续执行已获用户授权，不能仅为继续或重试而等待输入；请继续处理实际任务。'),{code:'AGENT_PROPOSED_STOP'});}
module.exports={readyForFinish,userRequestedPause,assertUserQuestion,fileRequired,assertReplyDelivery,context};

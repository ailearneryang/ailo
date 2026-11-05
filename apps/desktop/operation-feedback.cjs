// Fixed, content-free labels derived from receipts. Never evidence of acceptance,
// and never copy raw output (which may contain credentials) into a live summary.
function operationFeedback(detail={}){
 const r=detail.result||detail,output=String(r.output||[r.stdout,r.stderr].filter(Boolean).join('\n')).slice(0,24000);
 const signals=[];
 if(r.timedOut||detail.timedOut)signals.push('操作超时，结果待确认');
 if(/(?:fatal:|remote:).*Authentication failed|fatal: could not read Username|terminal prompts disabled|HTTP\/\S+\s+401\b/i.test(output))signals.push('输出提示需要认证或认证失败');
 if(/HTTP\/\S+\s+403\b|fatal:.*(?:403|access denied)|Permission denied \(publickey\)/i.test(output))signals.push('输出提示访问被拒绝');
 if(/HTTP\/\S+\s+404\b|fatal:.*repository .*not found/i.test(output))signals.push('输出提示地址不存在或不可见');
 if(/Could not resolve host|Failed to connect|Connection refused|Connection timed out|Could not resolve hostname/i.test(output))signals.push('输出提示网络连接失败');
 if(/not a git repository/i.test(output))signals.push('当前目录不是 Git 仓库');
 const codes=[...new Set([...output.matchAll(/^HTTP\/\S+\s+(\d{3})\b/gm)].map(m=>m[1]))].slice(0,4);
 if(codes.length)signals.push('HTTP '+codes.join(' / '));
 if(!signals.length&&Number.isInteger(r.exitCode))signals.push(r.exitCode===0?'命令已结束（退出码 0）':`命令失败（退出码 ${r.exitCode}）`);
 return signals.slice(0,4);
}
function repositoryContext(state){
 if(!/(?:克隆|clone)/i.test(state.currentRequest||''))return;
 const match=String(state.currentRequest).match(/https?:\/\/[^\s<>"，。]+/);let pageLike=false;
 if(match)try{const url=new URL(match[0]);pageLike=/\/(?:admin\/repos|[+-]\/|projects\/[^/]+\/repos\/[^/]+\/browse)(?:\/|$)/i.test(url.pathname);}catch{}
 const receipts=(state.toolResults||[]).filter(r=>r.action==='run_command').slice(-3).map(r=>({observationId:r.observationId,signals:operationFeedback(r.result||{})})).filter(r=>r.signals.length);
 return {pageLike,receipts,instruction:'近期回执只对其原命令与地址有效，先按 observationId 核对对象，不能推定当前地址状态。先确认用户提供的是克隆地址还是管理/浏览页面；根据该服务器实际返回的克隆链接或明确协议读取真实地址，不假定 Gitea/GitLab/Gerrit，不枚举猜测 URL、账号或凭据。优先只读检查已有目标目录、访问状态和实际认证要求；复用已有回执，不重复克隆以诊断。认证提示可能由错误地址引起，先区分地址与认证；确认缺少可用授权后用 clarify 询问克隆地址或安全认证方式，不要求把密码/Token贴入聊天。命令退出0可能只是脚本最后一步成功，输出中的失败仍须处理；unknown操作先核对，不重放。'};
}
module.exports={operationFeedback,repositoryContext};

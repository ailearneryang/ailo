// Expose only allowlisted error codes, never URLs, headers or provider bodies.
const reasons={ENOTFOUND:'模型服务域名无法解析',EAI_AGAIN:'模型服务域名解析暂时失败',ECONNREFUSED:'模型服务拒绝连接',ECONNRESET:'模型连接被中断',ETIMEDOUT:'模型连接超时',UND_ERR_CONNECT_TIMEOUT:'连接模型服务超时',UND_ERR_HEADERS_TIMEOUT:'等待模型响应头超时',UND_ERR_BODY_TIMEOUT:'接收模型响应超时',UND_ERR_SOCKET:'模型连接在传输过程中断开',CERT_HAS_EXPIRED:'模型服务证书已过期',DEPTH_ZERO_SELF_SIGNED_CERT:'模型服务证书不受信任',UNABLE_TO_VERIFY_LEAF_SIGNATURE:'无法验证模型服务证书',ERR_TLS_CERT_ALTNAME_INVALID:'模型服务证书与域名不匹配'};
function networkError(error,fetchBoundary=false){
 const queue=[error],seen=new Set();let code;
 while(queue.length&&seen.size<16){const item=queue.shift();if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);if(Object.hasOwn(reasons,item.code)){code=item.code;break;}queue.push(item.cause,...(Array.isArray(item.errors)?item.errors:[]));}
 if(!code && !(error instanceof TypeError && (fetchBoundary||['fetch failed','terminated'].includes(error.message))))return error;
 return Object.assign(Error(code?`${reasons[code]}（${code}）。请检查网络、代理或模型 API 配置；任务进度已保留，可重试。`:'无法连接模型服务，底层未提供明确原因。请检查网络、代理和 API 地址；任务进度已保留，可重试。'),{code:'MODEL_NETWORK',networkCode:code});
}
module.exports={networkError};

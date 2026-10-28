// Provider payloads are untrusted. Preserve a useful category, never echo raw
// messages, URLs or credentials. A rejected decision has executed no tool.
function providerError(value){
 const code=String(value?.code||value?.type||'').toLowerCase();
 const status=Number(value?.status||value?.status_code||value?.http_status);
 let category='unknown';
 if([401,403].includes(status)||/^(invalid_api_key|authentication_error|unauthorized|accessdenied|forbidden)$/.test(code))category='authentication';
 else if(/^(insufficient_quota|quota_exceeded|account_arrearage|arrearage)$/.test(code))category='quota';
 else if([400,404,422].includes(status)||/^(invalid_request_error|invalid_parameter|model_not_found|unsupported_model)$/.test(code))category='configuration';
 else if(status===429||status>=500&&status<=599||/^(internal_error|internalerror|server_error|service_unavailable|serviceunavailable|overloaded_error|rate_limit_exceeded|timeout)$/.test(code))category='transient';
 const permanent=['authentication','quota','configuration'].includes(category);
 return Object.assign(Error(permanent?'模型服务拒绝了当前请求，请检查授权、用量或模型配置；当前决策未执行。':'模型服务在生成过程中返回错误；当前决策未执行，将在原请求预算内尝试恢复。'),{code:permanent?'MODEL_PROVIDER_REJECTED':'MODEL_PROVIDER_ERROR',providerCategory:category});
}
module.exports={providerError};

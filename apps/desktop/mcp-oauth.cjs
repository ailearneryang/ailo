const {randomBytes,createHash}=require('node:crypto');
const http=require('node:http');
const {readJson,serverUrl,fail}=require('./mcp-http.cjs');
async function jsonRequest(fetchImpl,url,options,signal){const res=await fetchImpl(serverUrl(url,{query:true}),{...options,redirect:'error',signal});if(!res.ok){await res.body?.cancel();throw fail('OAuth 服务请求失败（HTTP '+res.status+'），请检查授权配置。','MCP_AUTH_REQUIRED');}return readJson(res,signal,{limit:100000});}
async function discover({url,challenge,fetchImpl,signal}) {
 const endpoint=new URL(url), match=challenge?.match(/resource_metadata="([^"]+)"/i);
 const candidates=match?[match[1]]:[endpoint.origin+'/.well-known/oauth-protected-resource'+(endpoint.pathname==='/'?'':endpoint.pathname),endpoint.origin+'/.well-known/oauth-protected-resource'];
 let resource;
 for(const candidate of candidates){try{resource=await jsonRequest(fetchImpl,candidate,{},signal);break;}catch(e){signal.throwIfAborted();}}
 if(!resource||typeof resource.resource!=='string'||serverUrl(resource.resource,{query:true})!==serverUrl(url,{query:true})||!Array.isArray(resource.authorization_servers)||!resource.authorization_servers.length)throw fail('未找到匹配此服务的 OAuth 授权信息。请检查 MCP 地址或使用 Token 认证。','MCP_AUTH_REQUIRED');
 const issuer=new URL(serverUrl(resource.authorization_servers[0])),base=issuer.origin,pathname=issuer.pathname.replace(/\/$/,'');
 let metadata;
 for(const candidate of [base+'/.well-known/oauth-authorization-server'+pathname,base+'/.well-known/openid-configuration'+pathname,issuer.href.replace(/\/$/,'')+'/.well-known/openid-configuration']){try{metadata=await jsonRequest(fetchImpl,candidate,{},signal);break;}catch(e){signal.throwIfAborted();}}
 if(!metadata||serverUrl(metadata.issuer)!==issuer.href||!metadata.code_challenge_methods_supported?.includes('S256'))throw fail('OAuth 服务缺少有效的发现信息或 PKCE S256 支持。','MCP_AUTH_REQUIRED');
 serverUrl(metadata.authorization_endpoint,{query:true});serverUrl(metadata.token_endpoint,{query:true});
 if(metadata.scopes_supported?.includes('offline_access')&&!resource.scopes_supported?.includes('offline_access'))resource.scopes_supported=[...(resource.scopes_supported||[]),'offline_access'];
 return {metadata,resource:resource.resource,scope:(resource.scopes_supported||[]).filter(s=>typeof s==='string'&&s.length<200).slice(0,30).join(' ')};
}
async function callback({openExternal,signal,state,onReady}) {
 let settle;const result=new Promise((resolve,reject)=>{settle={resolve,reject};});
 // A cancelled promise can settle while browser startup is still in progress.
 void result.catch(()=>{});
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');
  let parsed;try{parsed=new URL(req.url,'http://127.0.0.1');}catch{res.writeHead(400);res.end('无效请求');return;}
  if(req.method!=='GET'||parsed.pathname!=='/callback'){res.writeHead(404);res.end();return;}
  if(parsed.searchParams.get('state')!==state){res.writeHead(400);res.end('授权状态不匹配，请返回 Ailo 重试。');return;}
  if(parsed.searchParams.has('error')){res.end('授权未完成，请返回 Ailo。');settle.reject(fail('授权已取消或被服务拒绝。','MCP_AUTH_REQUIRED'));return;}
  const code=parsed.searchParams.get('code');if(!code||code.length>4096){res.writeHead(400);res.end('缺少授权码');return;}
  res.end('授权已收到，请返回 Ailo 完成连接测试。');settle.resolve(code);
 });
 const abort=()=>settle.reject(fail('授权已取消或超时，请重新连接。','MCP_AUTH_REQUIRED'));
 try{
  signal.throwIfAborted();signal.addEventListener('abort',abort,{once:true});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  signal.throwIfAborted();const redirectUri='http://127.0.0.1:'+server.address().port+'/callback';
  const authorizationUrl=await onReady(redirectUri);signal.throwIfAborted();await openExternal(authorizationUrl);
  return {code:await result,redirectUri};
 }finally{signal.removeEventListener('abort',abort);server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));}
}
function tokenValue(value,previous={}) {
 if(!value||typeof value.access_token!=='string'||!value.access_token||value.access_token.length>16000||/[\r\n]/.test(value.access_token)||String(value.token_type).toLowerCase()!=='bearer')throw fail('OAuth 返回无效令牌。','MCP_AUTH_REQUIRED');
 if(value.refresh_token!==undefined&&(typeof value.refresh_token!=='string'||value.refresh_token.length>16000))throw fail('OAuth 刷新令牌无效。','MCP_AUTH_REQUIRED');
 return {...previous,accessToken:value.access_token,refreshToken:value.refresh_token||previous.refreshToken,expiresAt:Number.isFinite(value.expires_in)&&value.expires_in>0?Date.now()+value.expires_in*1000:undefined};
}
async function authorize({url,challenge,clientId,fetchImpl=fetch,openExternal,signal,receiveCallback=callback}) {
 const {metadata,resource,scope}=await discover({url,challenge,fetchImpl,signal});
 const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url');let registeredId=clientId;
 const {code,redirectUri}=await receiveCallback({openExternal,signal,state,onReady:async redirectUri=>{
  if(!registeredId){if(!metadata.registration_endpoint)throw fail('服务不支持自动注册，请填写服务提供的 OAuth Client ID。','MCP_AUTH_REQUIRED');const registration=await jsonRequest(fetchImpl,metadata.registration_endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Ailo',redirect_uris:[redirectUri],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})},signal);if(typeof registration.client_id!=='string'||!registration.client_id||registration.client_id.length>1000||registration.client_secret||registration.token_endpoint_auth_method&&registration.token_endpoint_auth_method!=='none')throw fail('此版本支持公共 OAuth 客户端；请使用支持 PKCE 的 Client ID。','MCP_AUTH_REQUIRED');registeredId=registration.client_id;}
  const auth=new URL(metadata.authorization_endpoint);for(const [k,v]of Object.entries({response_type:'code',client_id:registeredId,redirect_uri:redirectUri,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource,...(scope?{scope}:{})}))auth.searchParams.set(k,v);return serverUrl(auth.href,{query:true});
 }});
 const body=new URLSearchParams({grant_type:'authorization_code',client_id:registeredId,code,redirect_uri:redirectUri,code_verifier:verifier,resource});
 return tokenValue(await jsonRequest(fetchImpl,metadata.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()},signal),{clientId:registeredId,tokenEndpoint:metadata.token_endpoint,resource});
}
async function refresh({credentials,fetchImpl=fetch,signal}) {
 if(!credentials.refreshToken)throw fail('OAuth 授权已过期，请重新授权。','MCP_AUTH_REQUIRED');
 const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:credentials.refreshToken,client_id:credentials.clientId,resource:credentials.resource});
 return tokenValue(await jsonRequest(fetchImpl,credentials.tokenEndpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()},signal),credentials);
}
module.exports={authorize,refresh,discover,callback};

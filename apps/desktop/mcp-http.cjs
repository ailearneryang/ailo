const fail=(message,code='MCP_UNAVAILABLE')=>Object.assign(Error(message),{code});
function serverUrl(value,{query=false}={}) {
 let url;try{url=new URL(value);}catch{throw fail('请填写有效的 MCP 服务地址。');}
 if(url.username||url.password||url.hash||(!query&&url.search)||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw fail('服务地址须为 HTTPS（本机可使用 HTTP），凭据请填入认证字段。');
 return url.href;
}
async function readJson(response,signal,{id,limit=1000000}={}) {
 const reader=response.body?.getReader();if(!reader)throw fail('服务返回空响应。');
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 const decoder=new TextDecoder();let buffer='',size=0;
 const streaming=/text\/event-stream/i.test(response.headers.get('content-type')||'');
 function accept(value){if(id===undefined)return value;if(value?.jsonrpc!=='2.0')throw fail('MCP 响应格式无效。');if(value.id!==id)return;if(value.error)throw fail('MCP 服务拒绝请求，请检查工具参数与权限。');if(!Object.hasOwn(value,'result'))throw fail('MCP 响应缺少结果。');return {result:value.result};}
 try {
  signal.throwIfAborted();
  for(;;){const {value,done}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.byteLength;if(size>limit)throw fail('服务响应过大，请缩小查询范围。');buffer+=decoder.decode(value,{stream:true});
   if(streaming){let match;while((match=/\r?\n\r?\n/.exec(buffer))){const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;const result=accept(JSON.parse(data));if(result)return result.result;}}
  }
  if(streaming)throw fail('MCP 流中断，未收到完整结果；操作可能已到达服务，请先核对，勿重复提交。','MCP_RESULT_UNKNOWN');
  const result=accept(JSON.parse(buffer+decoder.decode()));if(id!==undefined&&!result)throw fail('MCP 返回不匹配的请求标识。');return id===undefined?result:result.result;
 }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function createHttpClient({url,token,headerName='Authorization',fetchImpl=fetch,signal}) {
 let id=0,session,version='2025-03-26';
 async function rpc(method,params,notification=false) {
  signal.throwIfAborted();const requestId=notification?undefined:++id;
  const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'Mcp-Session-Id':session}:{}),'MCP-Protocol-Version':version};
  if(token)headers[headerName]=headerName.toLowerCase()==='authorization'?'Bearer '+token:token;
  const res=await fetchImpl(url,{method:'POST',redirect:'error',headers,body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:requestId}),method,...(params===undefined?{}:{params})}),signal});
  if(!res.ok){const challenge=res.headers.get('www-authenticate');await res.body?.cancel();throw Object.assign(fail([401,403].includes(res.status)?'连接需要授权或凭据已失效，请在应用连接中重新授权。':res.status===429?'MCP 请求限流，请稍后重试。':'MCP 请求失败（HTTP '+res.status+'）。',[401,403].includes(res.status)?'MCP_AUTH_REQUIRED':'MCP_UNAVAILABLE'),{challenge});}
  const sid=res.headers.get('mcp-session-id');if(sid){if(!/^[\x21-\x7e]{1,1024}$/.test(sid))throw fail('MCP 会话标识无效。');session=sid;}
  if(notification){await res.body?.cancel();return;}
  return readJson(res,signal,{id:requestId});
 }
 return {rpc,async initialize(){const init=await rpc('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'ailo',version:require('./package.json').version}});if(!['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(init?.protocolVersion))throw fail('此 MCP 协议版本暂不支持。');version=init.protocolVersion;await rpc('notifications/initialized',undefined,true);},async tools(){const tools=[],names=new Set();let cursor;const cursors=new Set();for(let page=0;page<10;page++){const result=await rpc('tools/list',cursor?{cursor}:{});if(!Array.isArray(result?.tools))throw fail('MCP 工具列表无效。');for(const t of result.tools){if(typeof t.name!=='string'||!/^[\w.-]{1,100}$/.test(t.name)||names.has(t.name)||!t.inputSchema||t.inputSchema.type!=='object'||JSON.stringify(t.inputSchema).length>30000)throw fail('MCP 工具定义无效或重复。');names.add(t.name);tools.push({name:t.name,description:String(t.description||'').slice(0,2000),inputSchema:t.inputSchema,readOnly:t.annotations?.readOnlyHint===true});if(tools.length>200)throw fail('工具超过 200 个，请使用范围更小的服务。');}cursor=result.nextCursor;if(!cursor)return tools;if(typeof cursor!=='string'||cursor.length>2000||cursors.has(cursor))throw fail('MCP 工具分页无效。');cursors.add(cursor);}throw fail('MCP 工具分页过多。');}};
}
module.exports={createHttpClient,readJson,serverUrl,fail};

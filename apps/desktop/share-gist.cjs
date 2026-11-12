const {createHash}=require('node:crypto');
const {giteeMarkdown}=require('./gitee-markdown.cjs');
const PROVIDERS=new Set(['gitee','github']);
const LINK={gitee:/^https:\/\/gitee\.com\/[A-Za-z0-9_-]+\/codes\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/i,github:/^https:\/\/gist\.github\.com\/(?:[A-Za-z0-9_-]+\/)?[0-9a-f]+$/i};
function provider(value){if(!PROVIDERS.has(value))throw Error('分享平台无效');return value;}
function shareContent(task,message){
 if(!task||!message||message.role!=='assistant'||typeof message.content!=='string'||!message.content.trim())throw Error('这条回答没有可分享的正文');
 const title=String(task.title||'Ailo 回答').trim().slice(0,120).replace(/[\r\n]+/g,' ');
 const content=`# ${title}\n\n${message.content.trim()}\n`;
 if(content.length>100000)throw Error('回答超过 10 万字符，请先复制需要分享的部分');
 return {title,content,hash:createHash('sha256').update(content).digest('hex')};
}
function savedShare(message,platform,hash){const value=message?.shares?.[platform]||(platform==='github'?message?.share:null);return value?.hash===hash&&LINK[platform].test(value.url)?value.url:'';}
async function findGiteeShare(fetchImpl,token,content,hash,title){
 const url=new URL('https://gitee.com/api/v5/gists');url.searchParams.set('access_token',token);url.searchParams.set('per_page','100');
 let response;try{response=await fetchImpl(url.toString(),{method:'GET',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});}catch{return {url:'',checked:false,reason:'网络连接失败'};}
 if(!response.ok)return {url:'',checked:false,reason:`HTTP ${response.status}`};
 let list;try{list=await response.json();}catch{return {url:'',checked:false,reason:'返回内容无法解析'};}
 if(!Array.isArray(list))return {url:'',checked:false,reason:'返回内容不是代码片段列表'};
 const marker=`Ailo-${hash.slice(0,16)}`,legacy=(`Ailo 分享 · ${title}`).slice(0,30);
 for(const entry of list.filter(item=>item?.description===marker||item?.description===legacy).slice(0,10)){
  if(entry.public===false||!LINK.gitee.test(entry?.html_url||''))continue;
  const id=entry.id;if(!/^[A-Za-z0-9_-]+$/.test(String(id||'')))continue;
  const detailUrl=new URL(`https://gitee.com/api/v5/gists/${id}`);detailUrl.searchParams.set('access_token',token);
  try{const detailResponse=await fetchImpl(detailUrl.toString(),{method:'GET',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});if(!detailResponse.ok)continue;const detail=await detailResponse.json();const files=detail?.files;if(Object.values(files||{}).some(file=>file?.content===content))return {url:entry.html_url,checked:true};}catch{}
 }
 return {url:'',checked:true};
}
function createGistShare({storage,fetchImpl=fetch,credentials}){
 const sessionTokens=new Map();let generation=0;
 const owner=async()=>(await storage.account?.())?.id||'local';
 const cacheKey=(account,platform)=>JSON.stringify([account,platform]);
 return {
  async status(input){const platform=provider(input?.provider||'gitee'),account=await owner(),state=await storage.readWorkspace(),task=state.tasks?.find(t=>t.id===input?.taskId),message=task?.messages?.find(m=>m.id===input?.messageId);let url='';if(task&&message){try{url=savedShare(message,platform,shareContent(task,message).hash);}catch{}}return {connected:sessionTokens.has(cacheKey(account,platform))||!!await credentials?.configured(account,platform),url};},
  clear:()=>{generation++;sessionTokens.clear();},
  async disconnect(input){const platform=provider(input?.provider||'gitee'),account=await owner();generation++;sessionTokens.delete(cacheKey(account,platform));await credentials?.remove(account,platform);return {connected:false};},
  async connect(input){
   const platform=provider(input?.provider||'gitee'),account=await owner(),epoch=generation;
   const token=typeof input?.token==='string'?input.token.trim():'',label=platform==='gitee'?'Gitee':'GitHub';
   if(!token||token.length>500||/[\r\n]/.test(token))throw Error(`请填写有效的 ${label} 授权 Token`);
   const url=new URL(platform==='gitee'?'https://gitee.com/api/v5/gists':'https://api.github.com/gists');url.searchParams.set('per_page','1');
   const headers={Accept:'application/json'};if(platform==='gitee')url.searchParams.set('access_token',token);else headers.Authorization=`Bearer ${token}`;
   let response;try{response=await fetchImpl(url.href,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error(`无法连接 ${label}，授权未保存，请稍后重试。`);}
   if(!response.ok)throw Error(response.status===401?`${label} Token 无效或已过期`:response.status===403?`${label} 授权被拒绝，请确认代码片段权限`:`${label} 授权验证失败（HTTP ${response.status}），未保存。`);
   let list;try{list=await response.json();}catch{throw Error(`${label} 授权验证返回无效内容，未保存。`);}if(!Array.isArray(list))throw Error(`${label} 授权验证返回无效内容，未保存。`);
   const scopes=response.headers.get('x-oauth-scopes');if(platform==='github'&&scopes&&!scopes.split(/[, ]+/).includes('gist'))throw Error('GitHub 授权缺少 gist 权限，请更新授权。');
   if(epoch!==generation||account!==await owner())throw Error('分享账号已变更，请重新连接。');
   if(credentials)await credentials.save(account,platform,token);
   if(epoch!==generation||account!==await owner())return {connected:false};
   sessionTokens.set(cacheKey(account,platform),token);return {connected:true};
  },
  async publish(input){
   const platform=provider(input?.provider||'gitee'),account=await owner(),epoch=generation,key=cacheKey(account,platform);
   const state=await storage.readWorkspace(),task=state.tasks?.find(t=>t.id===input?.taskId),message=task?.messages?.find(m=>m.id===input?.messageId);
   const {title,content:originalContent,hash}=shareContent(task,message),existing=savedShare(message,platform,hash);
   const content=platform==='gitee'?giteeMarkdown(originalContent):originalContent;
   if(existing)return {url:existing,reused:true};
   const explicitToken=typeof input?.token==='string'&&input.token.trim()?input.token.trim():'';
   const token=explicitToken||sessionTokens.get(key)||await credentials?.get(account,platform);
   const label=platform==='gitee'?'Gitee':'GitHub';
   if(!token||token.length>500||/[\r\n]/.test(token))throw Error(`请提供具备代码片段写入权限的 ${label} Token`);
   const record=async url=>{
    let recorded=true,authorizationSaved;
    if(epoch!==generation||account!==await owner())return {url,recorded:false};
    sessionTokens.set(key,token);
    if(credentials){try{authorizationSaved=!explicitToken&&!!await credentials.configured?.(account,platform);if(!authorizationSaved){await credentials.save(account,platform,token);authorizationSaved=true;}}catch{authorizationSaved=false;}}
    try{await storage.mutateWorkspace(work=>{const currentTask=work.tasks?.find(t=>t.id===task.id),current=currentTask?.messages?.find(m=>m.id===message.id);if(current&&shareContent(currentTask,current).hash===hash){current.shares={...current.shares,[platform]:{url,hash,at:new Date().toISOString()}};}});}catch{recorded=false;}
    return {url,recorded,...(credentials?{authorizationSaved}:{})};
   };
   if(platform==='gitee'){const found=await findGiteeShare(fetchImpl,token,content,hash,title);if(found.url)return {...await record(found.url),reused:true};if(!found.checked)throw Error(`无法核对 Gitee 代码片段列表（${found.reason}）。本次未发起发布，请确认 Token 包含 gists 权限或稍后重试。`);}
   const options=platform==='gitee'?{url:'https://gitee.com/api/v5/gists',headers:{Accept:'application/json','Content-Type':'application/json'},body:{access_token:token,description:`Ailo-${hash.slice(0,16)}`,public:true,files:{'Ailo-answer.md':{content}}}}:{url:'https://api.github.com/gists',headers:{Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28',Authorization:`Bearer ${token}`},body:{description:`Ailo 分享 · ${title}`,public:false,files:{'Ailo-回答.md':{content}}}};
   if(epoch!==generation||account!==await owner())throw Error('分享授权或账号已变更，本次未发布，请重新操作。');
   let response;
   try{response=await fetchImpl(options.url,{method:'POST',redirect:'error',headers:options.headers,body:JSON.stringify(options.body),signal:AbortSignal.timeout(30000)});}catch{throw Error(`连接 ${label} 失败，请检查网络后重试`);}
   if(!response.ok){const status=response.status;if(status>=500){let detail='';try{const body=await response.json();if(typeof body?.message==='string')detail=body.message.replaceAll(token,'[已隐藏]').replace(/[\r\n\t]/g,' ').slice(0,120);}catch{}const requestId=response.headers?.get?.('x-request-id');const trace=typeof requestId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(requestId)?` 请求编号：${requestId}。`:'';let checked='';if(platform==='gitee'){const found=await findGiteeShare(fetchImpl,token,content,hash,title);if(found.url)return {...await record(found.url),reused:true};checked=found.checked?'列表中未找到匹配片段':'列表回查失败（'+found.reason+'）';}throw Error(`${label} 服务端返回 HTTP ${status}${detail?`（${detail}）`:''}，公开发布结果无法确认。${checked?`${checked}；`:''}请勿立即重复发布，可改用 GitHub 分享或在 Gitee 网页手动发布。${trace}`);}throw Error(status===401?`${label} Token 无效或已过期`:status===403?`${label} 拒绝发布，请确认 Token 具有代码片段写入权限`:`${label} 代码片段发布失败（HTTP ${status}）`);}
   const payload=await response.json(),gist=Array.isArray(payload)?payload[0]:payload;
   if(typeof gist?.html_url!=='string'||!LINK[platform].test(gist.html_url))throw Error(`${label} 未返回有效的分享链接`);
   return {...await record(gist.html_url),reused:false};
  }
 };
}
module.exports={createGistShare,shareContent};

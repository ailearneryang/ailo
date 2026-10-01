const fs=require('node:fs/promises');
const path=require('node:path');
function createFeishu({directory,safeStorage,fetchImpl=fetch}) {
  const file=path.join(directory,'feishu.json');let queue=Promise.resolve();
  const serialize=fn=>{const result=queue.catch(()=>{}).then(fn);queue=result;return result;};
  async function load(){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw Error('飞书配置无法读取，请重新配置。');}}
  async function api(route,options={}) {
    try {
      const response=await fetchImpl('https://open.feishu.cn/open-apis/'+route,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('HTTP '+response.status);
      if(Number(response.headers.get('content-length'))>4000000)throw Error('response too large');
      const reader=response.body?.getReader();if(!reader)throw Error('empty response');
      let bytes=0;const chunks=[];
      try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4000000)throw Error('response too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(data.code!==0)throw Error('API '+(Number.isInteger(data.code)?data.code:'error'));
      return data;
    }catch(e){const code=/^(HTTP|API) [0-9]+$/.test(e.message)?`（${e.message}）`:'';throw Error('飞书请求失败'+code+'，请检查网络、应用凭证、已发布权限及文档访问授权。');}
  }
  function validate(appId,secret){if(typeof appId!=='string'||!/^cli_[a-zA-Z0-9]{5,100}$/.test(appId)||typeof secret!=='string'||secret.length<8||secret.length>500)throw Error('请填写有效的飞书 App ID 和 App Secret。');}
  async function token(config){
    if(!config)throw Error('请先配置飞书应用连接。');
    let secret;try{secret=safeStorage.decryptString(Buffer.from(config.secret,'base64'));}catch{throw Error('无法解密飞书凭证，请重新配置。');}
    const data=await api('auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:config.appId,app_secret:secret})});
    if(typeof data.tenant_access_token!=='string'||!data.tenant_access_token)throw Error('飞书未返回有效的访问凭证。');
    return data.tenant_access_token;
  }
  return {
    status:()=>serialize(async()=>{const c=await load();return {configured:!!c,appId:c?.appId||''};}),
    save:input=>serialize(async()=>{
      if(!safeStorage.isEncryptionAvailable())throw Error('系统加密存储不可用，未保存凭证。');
      const old=await load(),appId=input?.appId?.trim();let secret=input?.secret;
      if(secret===''&&old?.appId===appId){try{secret=safeStorage.decryptString(Buffer.from(old.secret,'base64'));}catch{throw Error('请重新填写 App Secret。');}}
      validate(appId,secret);
      const config={appId,secret:safeStorage.encryptString(secret).toString('base64')};
      await token(config);
      await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.writeFile(file+'.tmp',JSON.stringify(config),{mode:0o600});await fs.rename(file+'.tmp',file);
      return {configured:true,appId};
    }),
    test:()=>serialize(async()=>{await token(await load());return {ok:true};}),
    disconnect:()=>serialize(async()=>{await fs.rm(file,{force:true});return {configured:false,appId:''};}),
    readDocument:url=>serialize(async()=>{
      let parsed;try{parsed=new URL(url);}catch{throw Error('请输入飞书新版文档链接。');}
      const match=parsed.pathname.match(/^\/docx\/([a-zA-Z0-9]+)\/?$/);
      if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.feishu.cn')||parsed.username||parsed.password||parsed.port||!match)throw Error('目前支持 https://企业.feishu.cn/docx/… 新版文档链接。');
      const access=await token(await load()),headers={Authorization:'Bearer '+access},id=match[1];
      const info=await api('docx/v1/documents/'+id,{headers});
      const result=await api('docx/v1/documents/'+id+'/raw_content',{headers});
      const text=result.data?.content;
      if(typeof text!=='string'||!text.trim())throw Error('文档没有可读取的正文。');
      if(text.length>500000)throw Error('文档过长，请拆分文档后导入。');
      return {name:String(info.data?.document?.title||'飞书文档').replace(/[\\/\x00-\x1f]/g,'_').slice(0,100)+'.txt',text,size:Buffer.byteLength(text),summary:'来自飞书文档的正文快照；不包含图片，后续修改不会自动同步。'};
    })
  };
}
module.exports={createFeishu};

const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const providers=new Set(['gitee','github']);
// Only explicit sharing reads/decrypts secrets. Status and app startup never
// call OS encryption, so checking whether sharing is connected cannot prompt.
function createShareCredentials({directory,safeStorage}){
 const root=path.join(directory,'share-credentials');let queue=Promise.resolve();
 const serial=action=>{const result=queue.catch(()=>{}).then(action);queue=result;return result;};
 function file(owner,provider){if(typeof owner!=='string'||!owner||!providers.has(provider))throw Error('分享账号无效');return path.join(root,createHash('sha256').update(owner).digest('hex')+'-'+provider+'.json');}
 async function read(owner,provider){try{const value=JSON.parse(await fs.readFile(file(owner,provider),'utf8'));if(value.version!==1||typeof value.secret!=='string'||!value.secret)throw Error();return value;}catch(error){if(error.code==='ENOENT')return null;throw Error('分享授权记录无法读取，请重新连接账号。');}}
 return {
  configured:(owner,provider)=>serial(async()=>!!await read(owner,provider)),
  get:(owner,provider)=>serial(async()=>{const value=await read(owner,provider);if(!value)return '';try{return safeStorage.decryptString(Buffer.from(value.secret,'base64'));}catch{throw Error('分享授权无法解锁，请重新连接账号。');}}),
  save:(owner,provider,token)=>serial(async()=>{
   if(typeof token!=='string'||!token.trim()||token.length>500||/[\r\n]/.test(token))throw Error('分享授权无效');
   if(!safeStorage.isEncryptionAvailable())throw Error('系统加密不可用，分享授权未保存。');
   const destination=file(owner,provider),temporary=destination+'.'+randomUUID()+'.tmp';
   const secret=safeStorage.encryptString(token).toString('base64');
   await fs.mkdir(root,{recursive:true,mode:0o700});
   try{await fs.writeFile(temporary,JSON.stringify({version:1,secret}),{mode:0o600,flag:'wx'});await fs.rename(temporary,destination);}finally{await fs.rm(temporary,{force:true});}
  }),
  remove:(owner,provider)=>serial(async()=>{const value=await read(owner,provider).catch(()=>null);await fs.rm(file(owner,provider),{force:true});if(value)safeStorage.forgetCiphertext?.(Buffer.from(value.secret,'base64'));}),
 };
}
module.exports={createShareCredentials};

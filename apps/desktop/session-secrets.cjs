// Main-process, process-lifetime cache around OS encryption. Nothing here is
// written to disk or exposed to IPC. Constructing it never loads the keychain.
const {createHash}=require('node:crypto');
function createSessionSecrets(provider,{limit=256}={}){
 if(!Number.isSafeInteger(limit)||limit<1)throw Error('凭据缓存上限无效');
 const decrypted=new Map(),encrypted=new Map();let available;
 const native=()=>typeof provider==='function'?provider():provider;
 const digest=value=>createHash('sha256').update(value).digest('hex');
 function remember(map,key,value){map.delete(key);map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);return value;}
 function cached(map,key){if(!map.has(key))return;const value=map.get(key);remember(map,key,value);return value;}
 return {
  isEncryptionAvailable(){if(available===true)return true;const result=native().isEncryptionAvailable();if(result===true)available=true;return result;},
  decryptString(bytes){
   if(!Buffer.isBuffer(bytes))throw TypeError('加密凭据须为 Buffer');
   const key=digest(bytes);if(decrypted.has(key))return cached(decrypted,key);
   const text=native().decryptString(bytes);if(typeof text!=='string')throw TypeError('系统解密未返回字符串');
   remember(decrypted,key,text);return text;
  },
  encryptString(text){
   if(typeof text!=='string')throw TypeError('待加密凭据须为字符串');
   const key=digest(text);if(encrypted.has(key))return Buffer.from(cached(encrypted,key));
   const bytes=native().encryptString(text);if(!Buffer.isBuffer(bytes))throw TypeError('系统加密未返回 Buffer');
   remember(encrypted,key,Buffer.from(bytes));remember(decrypted,digest(bytes),text);return Buffer.from(bytes);
  },
  forgetCiphertext(bytes){const key=digest(bytes);if(decrypted.has(key))encrypted.delete(digest(decrypted.get(key)));decrypted.delete(key);},
  clearSession(){decrypted.clear();encrypted.clear();available=undefined;},
 };
}
module.exports={createSessionSecrets};

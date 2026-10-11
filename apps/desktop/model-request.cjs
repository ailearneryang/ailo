const {setTimeout:delay}=require('node:timers/promises');
// Racing also releases the caller when a transport fails to observe abort.
// A response arriving after cancellation is explicitly discarded, never parsed.
function abortable(promise,signal,onLate){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const abort=()=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);reject(signal.reason||Object.assign(Error('已停止请求'),{name:'AbortError'}));};
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{if(settled){void Promise.resolve(onLate?.(value)).catch(()=>{});return;}settled=true;signal.removeEventListener('abort',abort);resolve(value);},error=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);reject(error);});
 });
}
const retryable=error=>['MODEL_CONNECT_TIMEOUT','MODEL_FIRST_CONTENT_TIMEOUT','MODEL_DECISION_IDLE_TIMEOUT','MODEL_STREAM_INTERRUPTED'].includes(error.code)||error.code==='MODEL_HTTP_TRANSIENT'||error.code==='MODEL_NETWORK'&&['EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','ERR_CONNECTION_RESET','ERR_CONNECTION_CLOSED','ERR_CONNECTION_TIMED_OUT','ERR_TIMED_OUT','ERR_NETWORK_CHANGED','ERR_INCOMPLETE_CHUNKED_ENCODING','ERR_CONTENT_LENGTH_MISMATCH'].includes(error.networkCode);
async function recoverRequest(run,{signal,retries=2,retryDelay=500,onRetry}={}){
 for(let attempt=0;;attempt++){
  signal.throwIfAborted();
  try{return await run(attempt);}catch(error){
   if(signal.aborted)throw error;
   if(!retryable(error)||error.hasVisibleOutput)throw error;
   if(attempt>=retries){error.retryCount=attempt;error.message+=` 已自动重试 ${attempt} 次仍未恢复，任务进度和材料已保留。`;throw error;}
   onRetry?.(attempt+1,retries,error);
   await delay(Math.min(4000,retryDelay*2**attempt),undefined,{signal});
  }
 }
}
function requestId(headers){const value=headers.get('x-request-id')||headers.get('request-id')||headers.get('x-ms-request-id');return typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(value)?value:undefined;}
async function cancelBody(body){
 if(!body)return;
 let timer;
 try{await Promise.race([Promise.resolve().then(()=>body.cancel()).catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);}
 finally{clearTimeout(timer);}
}
module.exports={abortable,recoverRequest,requestId,cancelBody};

// Only proven external conditions may interrupt the user. Model-written
// explanations and unknown internal exception names do not establish one.
function classify(error,run,{signal}={}){
 const code=String(error?.code||'');
 if(signal?.aborted||['MODEL_CANCELLED','MCP_CANCELLED','ABORT_ERR'].includes(code))return 'cancelled';
 if(code==='ACTION_RESULT_UNKNOWN'||code==='MCP_RESULT_UNKNOWN'||(run.actionJournal||[]).some(e=>['unknown','running'].includes(e.status)||e.status==='interrupted'&&!e.readOnly))return 'unknown_result';
 if(/^PERMISSION_/.test(code)||['DIRECTORY_DECLINED','DIRECTORY_UNAVAILABLE','DIRECTORY_SYSTEM_PERMISSION','ANDROID_PERMISSION','FEISHU_DECLINED','FEISHU_PERMISSION','AMAP_DECLINED','MCP_DECLINED','MCP_AUTH_REQUIRED'].includes(code))return 'permission';
 if(/^MODEL_(?:NETWORK|PROVIDER_|HTTP_|RATE_LIMIT|CONNECT_TIMEOUT|FIRST_CONTENT_TIMEOUT|OUTPUT_TIMEOUT|STREAM_IDLE_TIMEOUT|DECISION_IDLE_TIMEOUT|STREAM_INTERRUPTED|VISION_UNAVAILABLE|IMAGE_UNSUPPORTED|CONTENT_FILTER)/.test(code))return 'service';
 if(code.startsWith('MCP_')&&code!=='MCP_UNAVAILABLE'&&error.notExecuted!==true)return 'unknown_result';
 // A preflight failure is safe to feed back, never a reason to replay a sent call.
 if(['SEARCH_UNAVAILABLE','AMAP_UNAVAILABLE','MCP_UNAVAILABLE'].includes(code)||code.startsWith('MCP_')&&error.notExecuted===true)return 'component';
 return 'internal';
}
module.exports={classify};

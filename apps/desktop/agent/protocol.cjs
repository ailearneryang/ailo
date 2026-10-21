const {fields:planFields}=require('./plan.cjs');
const names=['request_network','memory','assistant','knowledge','web_search','mcp','amap','feishu','route','checkpoint','reply','clarify','plan','list_files','read_file','batch_read','view_image','browser','write_file','edit_file','edit_spreadsheet','read_material','read_source','inspect_source','search_materials','read_history','read_execution','request_directory','request_network','run_command','build_android','android_device','artifact','verify','finish','blocked','pause'];
const text={type:'string'};
const strings={type:'array',items:text};
const tool={type:'function',function:{name:'ailo_action',description:'提交一个 Ailo 动作。遵循系统中的阶段、工具参数和项目权限要求，每次只调用一次。',parameters:{type:'object',additionalProperties:false,required:['action'],properties:{
 action:{type:'string',enum:names},conversationTitle:{type:'string',minLength:1,maxLength:40,description:'概括当前对话任务的简短标题，动作加具体对象，不截取输入开头'},kind:{type:'string',enum:['chat','task']},text,progress:require('./attached-progress.cjs').schema,items:{type:'array',minItems:1,maxItems:6,items:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:require('./batch-read.cjs').actions},itemId:text,path:text,id:text,entry:text,pointer:text,query:text,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:4000}}}},review:require('./completion-review.cjs').schema,...planFields,
 clarification:{type:'object',required:['title','questions'],properties:{title:text,defaults:strings,questions:{type:'array',items:{type:'object',required:['id','kind','title'],properties:{id:text,kind:{type:'string',enum:['choice','attachment']},title:text,description:text,options:{type:'array',items:{type:'object',required:['id','label'],properties:{id:text,label:text,description:text,recommended:{type:'boolean'}}}}}}}}},
 operation:{type:'string',enum:['open','inspect','click','fill','scroll','close','status','start','install','launch','logs','screenshot','stop','search','call','schema','api','help','shortcut','list','read','delegate','continue','update','pause','schedule','schedule_toggle','save','forget']},tasks:{type:'array',minItems:1,maxItems:8,items:text},
 method:{type:'string',enum:['GET','POST','PUT','PATCH','DELETE']},params:{type:'object',additionalProperties:true},data:{type:'object',additionalProperties:true},
 selector:text,width:{type:'integer',minimum:320,maximum:2560},height:{type:'integer',minimum:240,maximum:1600},x:{type:'integer'},y:{type:'integer'},crop:{type:'object',additionalProperties:false,required:['x','y','width','height'],properties:{x:{type:'integer',minimum:0},y:{type:'integer',minimum:0},width:{type:'integer',minimum:1},height:{type:'integer',minimum:1}}},scope:require('./evidence.cjs').scopeSchema,version:{type:'string',pattern:'^[a-f0-9]{64}$'},edits:require('./edit-file.cjs').schema,outcome:{type:'string',enum:['complete','limited']},path:text,content:{type:'string',maxLength:200000},id:text,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:12000},entry:text,pointer:text,query:text,command:{type:'string',maxLength:8000},purpose:text,label:text,evidence:strings,stepId:text,checks:{type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,required:['criterionId','kind','reason'],properties:{criterionId:text,kind:{type:'string',enum:['command','file_exists','text_contains','json_valid','visual','observation']},reason:text,path:text,contains:strings,evidenceId:text,scope:require('./evidence.cjs').scopeSchema}}},
}}}};
// Named tools remove the redundant action discriminator for providers that omit it.
// The decoder still passes every action through normal phase and permission checks.
function actionTools(state) {
 return allowedActions(state).map(name=>{
  const schema=structuredClone(tool.function.parameters);
  const fields={route:['kind'],plan:['goal','decisions','acceptance','acceptanceTypes','requirements','steps'],run_command:['command','purpose','scope'],request_network:['purpose'],request_directory:['path','purpose'],write_file:['path','content'],edit_file:['path','version','edits','purpose'],edit_spreadsheet:['path','data','purpose'],view_image:['path','crop','purpose'],browser:['operation','path','selector','crop','text','width','height','x','y','purpose'],batch_read:['items'],read_file:['path','offset','limit'],list_files:['path'],reply:['text'],pause:['text'],blocked:['text'],checkpoint:['text'],finish:['text','evidence','review','outcome'],clarify:['text','clarification'],artifact:['path','label'],verify:['checks'],web_search:['query'],read_material:['id','offset','limit'],read_source:['id','entry','offset'],inspect_source:['id','entry','pointer','offset','query'],search_materials:['query'],read_history:['offset','limit'],read_execution:['id','offset','limit'],build_android:['tasks','purpose'],android_device:['operation','path','purpose'],knowledge:['operation','query','id','entry','offset'],mcp:['operation','id','query','params','purpose'],amap:['operation','query','params','purpose'],feishu:['operation','query','method','path','params','data','purpose'],memory:['operation','id','data','query','purpose'],assistant:['operation','id','data','purpose']};
  schema.properties=Object.fromEntries((fields[name]||[]).map(field=>[field,schema.properties[field]]));
  if(['route','plan','reply','clarify','finish'].includes(name))schema.properties.conversationTitle=tool.function.parameters.properties.conversationTitle;
  if(!['route','plan','reply','finish','pause','blocked','clarify','checkpoint'].includes(name))schema.properties.stepId=tool.function.parameters.properties.stepId;
  if(name!=='route')schema.properties.progress=tool.function.parameters.properties.progress;
  schema.required=({route:['kind'],plan:['goal','decisions','steps'],run_command:['command','purpose'],request_network:['purpose'],request_directory:['path','purpose'],write_file:['path','content'],edit_file:['path','version','edits'],edit_spreadsheet:['path','data','purpose'],view_image:['path'],browser:['operation'],batch_read:['items'],read_file:['path'],reply:['text'],pause:['text'],blocked:['text'],checkpoint:['text'],finish:['text','review'],clarify:['text','clarification'],verify:['checks']})[name]||[];
  if(state.decisionRecovery){if(schema.properties.content)schema.properties.content.maxLength=8000;if(schema.properties.command)schema.properties.command.maxLength=2000;if(schema.properties.items)schema.properties.items.maxItems=3;}
  return {type:'function',function:{name,description:`提交 ${name} 动作。遵循 Ailo 阶段和权限要求，每次只调用一次。`,parameters:schema}};
 });
}
function protocolError(reason='invalid_action',diagnostics={}){return Object.assign(Error('模型暂时未能给出可执行的下一步，任务和材料已保留。请重试；若持续失败，请更换支持工具调用的模型。'),{code:'AGENT_PROTOCOL',reason,diagnostics});}
const identifier=v=>typeof v==='string'&&/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(v)?v:'<非标准标识>';
const paginatedActions=new Set(['read_file','read_material','read_source','inspect_source','read_history','read_execution','knowledge']);
function parameterHint(diagnostics={}){
 if(diagnostics.field==='items')return 'items 必须是 1–6 个本地只读操作组成的数组；每项包含 action，分页 limit 为 1–4000。不能把飞书等应用调用放入 batch_read，请逐个调用对应应用工具。'+(diagnostics.hint?' 具体原因：'+diagnostics.hint:'');
 return `${diagnostics.field||'参数'} 必须是有效整数；offset 不小于 0，limit 为 1–12000，请使用结果中的 next 继续分页。`;
}
function pagination(value,action) {
 const result={...value,action};
 if(!paginatedActions.has(action))return result;
 for(const field of ['read_material','read_file','read_execution','read_history'].includes(action)?['offset','limit']:['offset']) {
  if(!Object.hasOwn(result,field))continue;
  const original=result[field];
  // Some providers serialize integer arguments as decimal strings. Normalize
  // only pagination fields, before execution and repeat detection; never coerce
  // booleans, null, fractions, expressions, or arbitrary connector parameters.
  const n=typeof original==='string'&&/^\d+$/.test(original.trim())?Number(original.trim()):original;
  const min=field==='limit'?1:0,max=field==='limit'?12000:Number.MAX_SAFE_INTEGER;
  if(!Number.isSafeInteger(n)||n<min||n>max)throw protocolError('invalid_parameter',{field,expected:field==='limit'?'integer_1_12000':'nonnegative_safe_integer'});
  result[field]=n;
 }
 return result;
}
function parse(text) {
 if(typeof text!=='string')throw protocolError('missing_text');
 const cleaned=text.trim().replace(/^```(?:json)?\s*\r?\n/i,'').replace(/\r?\n```\s*$/,'');
 try{return JSON.parse(cleaned);}catch(error){throw protocolError('invalid_json',{responseChars:text.length,responseShape:cleaned.startsWith('{')?'object_like':cleaned.startsWith('[')?'array_like':cleaned.startsWith('```')?'fenced':'prose',jsonIssue:(/end of JSON|unterminated/i.test(error.message)||Number(error.message.match(/position (\d+)/)?.[1])===cleaned.length)?'incomplete':'syntax'});}
}
function normalize(value,depth=0) {
 const diagnostics={shape:Array.isArray(value)?'array':value===null?'null':typeof value,keys:value&&typeof value==='object'?Object.keys(value).slice(0,12).map(identifier):[]};
 if(!value||Array.isArray(value)||typeof value!=='object'||depth>2)throw protocolError('invalid_action',diagnostics);
 // Only unambiguous wrappers are accepted. Never extract executable JSON from prose.
 if(Object.keys(value).length===1&&value.action&&typeof value.action==='object')return normalize(value.action,depth+1);
 if(Object.keys(value).every(k=>['name','arguments'].includes(k))&&value.name==='ailo_action'&&value.arguments!==undefined)return normalize(typeof value.arguments==='string'?parse(value.arguments):value.arguments,depth+1);
 const action=typeof value.action==='string'?value.action.trim():value.action;
 if(!names.includes(action))throw protocolError('invalid_action',{...diagnostics,receivedAction:identifier(action),issue:action===undefined?'missing_action':'unknown_action'});
 const wrapper=['parameters','arguments'].find(k=>Object.hasOwn(value,k));
 if(wrapper&&Object.keys(value).every(k=>k==='action'||k===wrapper)) {
  const args=typeof value[wrapper]==='string'?parse(value[wrapper]):value[wrapper];
  if(!args||Array.isArray(args)||typeof args!=='object'||(args.action!==undefined&&args.action!==action))throw protocolError('conflicting_action',diagnostics);
  return normalize({...args,action},depth+1);
 }
 if(action==='batch_read'){
  try{
   const items=Array.isArray(value.items)?value.items.map(item=>{const normalized=pagination(item,item?.action);if(Number.isSafeInteger(normalized.limit))normalized.limit=Math.min(normalized.limit,4000);return normalized;}):value.items;
   return {...pagination(value,action),items:require('./batch-read.cjs').validate(items)};
  }catch(error){throw protocolError('invalid_parameter',{field:'items',expected:'1_6_local_read_actions',hint:error.message});}
 }
 return pagination(value,action);
}
function object(text){return normalize(parse(text));}
function decodeAction(result) {
 try{return decodeResponse(result);}catch(error){
  if(error.code==='AGENT_PROTOCOL')error.diagnostics={...error.diagnostics,responseChannel:result.toolCalls?.length?'tool_arguments':'content',...(result.finishReason?{finishReason:result.finishReason}:{})};
  throw error;
 }
}
function decodeResponse(result) {
 if(result.toolCalls?.length){
  if(result.toolCalls.length!==1){
   const items=result.toolCalls.map(call=>decodeResponse({toolCalls:[call]}));
   try{return {action:'batch_read',items:require('./batch-read.cjs').validate(items)};}catch{throw protocolError('multiple_tools',{count:result.toolCalls.length});}
  }
  const call=result.toolCalls[0].function;
  const name=call.name==='functions.ailo_action'?'ailo_action':call.name;
  if(name==='ailo_action')return object(call.arguments);
  // A known action used as the tool name has the same semantics; normal runtime
  // phase checks, path validation and permissions still apply.
  if(names.includes(name)) {
   const args=parse(call.arguments);
   if(!args||Array.isArray(args)||typeof args!=='object'||(args.action!==undefined&&args.action!==name))throw protocolError('conflicting_action');
   return normalize({...args,action:name});
  }
  throw protocolError('wrong_tool',{receivedTool:identifier(name)});
 }
 return object(result.content);
}
function allowedActions(state) {
 const available=names.filter(name=>(name!=='request_network'||!!state.permissions)&&(name!=='memory'||state.memoryAvailable===true)&&name!=='route'&&(name!=='assistant'||state.personalAssistant===true)&&(name!=='mcp'||!!state.mcpConnections?.length)&&(state.phase!=='chat'||!['plan','browser','write_file','edit_file','edit_spreadsheet','request_directory','request_network','run_command','build_android','android_device','artifact','verify','finish'].includes(name)));
 if(state.phase==='route')return ['route'];
 if(state.phase==='task'&&state.pendingArtifactUpdates?.length&&state.requiredAction!=='checkpoint')return ['artifact','view_image','browser','read_file','batch_read','read_execution','read_history','plan','checkpoint','clarify','blocked','pause'];
 // Recovery changes request size and format, never the task's authorized tools.
 if(state.decisionRecovery)return available.filter(name=>name!=='batch_read'||state.decisionRecovery.stage==='small_action');
 if(state.requiredAction==='checkpoint'||state.requiredAction==='plan_update')return available;
 if(state.requiredAction==='plan_or_clarify')return ['plan','clarify','blocked','pause','checkpoint'];
 return available;
}

module.exports={parameterHint,tool,decodeAction,protocolError,parseAction:object,allowedActions,actionTools};

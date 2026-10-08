const {fields:planFields}=require('./plan.cjs');
const names=['assistant','knowledge','web_search','mcp','amap','feishu','route','checkpoint','reply','clarify','plan','list_files','read_file','write_file','edit_spreadsheet','read_material','read_source','inspect_source','search_materials','read_history','read_execution','request_directory','run_command','build_android','android_device','artifact','finish','blocked','pause'];
const text={type:'string'};
const strings={type:'array',items:text};
const tool={type:'function',function:{name:'ailo_action',description:'提交一个 Ailo 动作。遵循系统中的阶段、工具参数和项目权限要求，每次只调用一次。',parameters:{type:'object',additionalProperties:false,required:['action'],properties:{
 action:{type:'string',enum:names},kind:{type:'string',enum:['chat','task']},text,...planFields,
 clarification:{type:'object',required:['title','questions'],properties:{title:text,defaults:strings,questions:{type:'array',items:{type:'object',required:['id','kind','title'],properties:{id:text,kind:{type:'string',enum:['choice','attachment']},title:text,description:text,options:{type:'array',items:{type:'object',required:['id','label'],properties:{id:text,label:text,description:text,recommended:{type:'boolean'}}}}}}}}},
 operation:{type:'string',enum:['status','start','install','launch','logs','screenshot','stop','search','call','schema','api','help','shortcut','list','read','delegate','continue','update','pause','schedule','schedule_toggle']},tasks:{type:'array',minItems:1,maxItems:8,items:text},
 method:{type:'string',enum:['GET','POST','PUT','PATCH','DELETE']},params:{type:'object',additionalProperties:true},data:{type:'object',additionalProperties:true},
 path:text,content:{type:'string',maxLength:200000},id:text,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:12000},entry:text,pointer:text,query:text,command:{type:'string',maxLength:8000},purpose:text,label:text,evidence:strings,
}}}};
// Named tools remove the redundant action discriminator for providers that omit it.
// The decoder still passes every action through normal phase and permission checks.
function actionTools(state) {
 return allowedActions(state).map(name=>{
  const schema=structuredClone(tool.function.parameters);
  const fields={route:['kind'],plan:['goal','decisions','acceptance','steps'],run_command:['command','purpose'],request_directory:['path','purpose'],write_file:['path','content'],edit_spreadsheet:['path','data','purpose'],read_file:['path','offset'],list_files:['path'],reply:['text'],pause:['text'],blocked:['text'],checkpoint:['text'],finish:['text','evidence'],clarify:['text','clarification'],artifact:['path','label'],web_search:['query'],read_material:['id','offset','limit'],read_source:['id','entry','offset'],inspect_source:['id','entry','pointer','offset','query'],search_materials:['query'],read_history:['offset'],read_execution:['offset'],build_android:['tasks','purpose'],android_device:['operation','path','purpose'],knowledge:['operation','query','id','entry','offset'],mcp:['operation','id','query','params','purpose'],amap:['operation','query','params','purpose'],feishu:['operation','query','method','path','params','data','purpose'],assistant:['operation','id','data','purpose']};
  schema.properties=Object.fromEntries((fields[name]||[]).map(field=>[field,schema.properties[field]]));
  schema.required=({route:['kind'],plan:['goal','decisions','acceptance','steps'],run_command:['command','purpose'],request_directory:['path','purpose'],write_file:['path','content'],edit_spreadsheet:['path','data','purpose'],read_file:['path'],reply:['text'],pause:['text'],blocked:['text'],checkpoint:['text'],finish:['text','evidence'],clarify:['text','clarification']})[name]||[];
  return {type:'function',function:{name,description:`提交 ${name} 动作。遵循 Ailo 阶段和权限要求，每次只调用一次。`,parameters:schema}};
 });
}
function protocolError(reason='invalid_action',diagnostics={}){return Object.assign(Error('模型暂时未能给出可执行的下一步，任务和材料已保留。请重试；若持续失败，请更换支持工具调用的模型。'),{code:'AGENT_PROTOCOL',reason,diagnostics});}
const identifier=v=>typeof v==='string'&&/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(v)?v:'<非标准标识>';
function parse(text) {
 if(typeof text!=='string')throw protocolError('missing_text');
 const cleaned=text.trim().replace(/^```(?:json)?\s*\r?\n/i,'').replace(/\r?\n```\s*$/,'');
 try{return JSON.parse(cleaned);}catch{throw protocolError('invalid_json',{responseChars:text.length,responseShape:cleaned.startsWith('{')?'object_like':cleaned.startsWith('[')?'array_like':cleaned.startsWith('```')?'fenced':'prose'});}
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
 return {...value,action};
}
function object(text){return normalize(parse(text));}
function decodeAction(result) {
 if(result.toolCalls?.length){
  if(result.toolCalls.length!==1)throw protocolError('multiple_tools',{count:result.toolCalls.length});
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
 return state.phase==='route'?['route']:state.requiredAction==='checkpoint'?['checkpoint','pause','blocked','clarify']:state.requiredAction==='plan_update'?['plan','clarify','blocked','pause']:state.requiredAction==='plan_or_clarify'?['plan','clarify','blocked','pause','checkpoint']:names.filter(name=>name!=='route'&&(name!=='assistant'||state.personalAssistant===true)&&(name!=='mcp'||!!state.mcpConnections?.length)&&(state.phase!=='chat'||!['plan','write_file','edit_spreadsheet','request_directory','run_command','build_android','android_device','artifact','finish'].includes(name)));
}
module.exports={tool,decodeAction,protocolError,parseAction:object,allowedActions,actionTools};

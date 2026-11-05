const {fields:planFields}=require('./plan.cjs');
const names=['request_network','memory','assistant','knowledge','web_search','mcp','amap','feishu','route','load_skill','checkpoint','reply','clarify','plan','list_files','read_file','batch_read','view_image','browser','write_file','edit_file','edit_spreadsheet','read_material','read_source','inspect_source','search_materials','read_history','read_execution','request_directory','request_network','run_command','build_android','android_device','artifact','verify','finish','blocked','pause'];
const text={type:'string'};
const strings={type:'array',items:text};
// Most actions only need a small status/memory update. Keep the complete issue
// and execution-state schema on plan, rather than repeating it for every tool.
const progressSchema=require('./attached-progress.cjs').schema;
const attachedProgress=require('./attached-progress.cjs');
const compactProgress={...progressSchema,properties:{steps:progressSchema.properties.steps,memory:progressSchema.properties.memory}};
const batchRequiredFields={read_file:['path'],read_material:['id'],read_source:['id'],inspect_source:['id'],search_materials:['query'],list_files:[],read_execution:[]};
const tool={type:'function',function:{name:'ailo_action',description:'提交一个 Ailo 动作。遵循系统中的阶段、工具参数和项目权限要求，每次只调用一次。',parameters:{type:'object',additionalProperties:false,required:['action'],properties:{
 action:{type:'string',enum:names},conversationTitle:{type:'string',minLength:1,maxLength:40,description:'概括当前对话任务的简短标题，动作加具体对象，不截取输入开头'},kind:{type:'string',enum:['chat','task']},text:{...text,description:'动作正文；checkpoint须为20–10000字符累计任务摘要。'},progress:require('./attached-progress.cjs').schema,items:{type:'array',minItems:1,maxItems:6,items:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:require('./batch-read.cjs').actions},itemId:{type:'string',minLength:1,maxLength:40,pattern:'^[a-zA-Z0-9_-]+$'},path:text,id:text,view:{type:'string',enum:['record','result']},entry:text,pointer:text,query:text,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:4000}}}},review:require('./completion-review.cjs').schema,...planFields,
 clarification:{type:'object',required:['title','questions'],properties:{title:text,defaults:strings,questions:{type:'array',items:{type:'object',required:['id','kind','title'],properties:{id:text,kind:{type:'string',enum:['choice','attachment']},title:text,description:text,options:{type:'array',items:{type:'object',required:['id','label'],properties:{id:text,label:text,description:text,recommended:{type:'boolean'}}}}}}}}},
 reference:text,display:require('./android-display.cjs').schema,view:{type:'string',enum:['record','result'],description:'result 直接读取工具结果正文，record 读取完整执行包装；两种视图的 offset 独立。'},operation:{type:'string',enum:['open','inspect','click','fill','scroll','close','status','start','install','launch','logs','screenshot','stop','search','call','schema','api','help','shortcut','list','read','delegate','continue','update','pause','schedule','schedule_toggle','save','forget']},tasks:{type:'array',minItems:1,maxItems:8,items:text},
 method:{type:'string',enum:['GET','POST','PUT','PATCH','DELETE']},params:{type:'object',additionalProperties:true},data:{type:'object',additionalProperties:true},
 selector:text,width:{type:'integer',minimum:320,maximum:2560},height:{type:'integer',minimum:240,maximum:1600},x:{type:'integer'},y:{type:'integer'},crop:{type:'object',additionalProperties:false,required:['x','y','width','height'],properties:{x:{type:'integer',minimum:0},y:{type:'integer',minimum:0},width:{type:'integer',minimum:1},height:{type:'integer',minimum:1}}},scope:require('./evidence.cjs').scopeSchema,version:{type:'string',pattern:'^[a-f0-9]{64}$'},edits:require('./edit-file.cjs').schema,outcome:{type:'string',enum:['complete','limited']},path:text,content:{type:'string',maxLength:200000},id:text,offset:{type:'integer',minimum:0,description:'字符位置；下一页使用上一结果的 next，不是页码。'},limit:{type:'integer',minimum:1,maximum:12000,description:'单页字符数，不是总字符数或行数。建议3000，最多12000；更多内容使用 next 继续分页。可省略使用默认值，不要填写0、负数或小数。'},entry:text,pointer:text,query:text,command:{type:'string',maxLength:8000},purpose:text,label:text,evidence:strings,stepId:text,checks:require('./verification-request.cjs').schema,artifact:{type:'object',additionalProperties:false,required:['label'],properties:{label:{type:'string',minLength:1,maxLength:120}},description:'写入成功后随即把该文件登记为交付成果（同 artifact 动作），省去单独往返；中间文件不要登记。'},
}}}};
tool.function.parameters.properties.items.description='只合并独立本地读取。每项action对应必填字段：read_file→path；read_material/read_source/inspect_source→真实材料id；search_materials→query；list_files/read_execution可省略目标。尚无计划时progress只能附memory，不得填写不存在的步骤。';
tool.function.parameters.properties.answeredInputIds=require('./input-coverage.cjs').replySchema;
tool.function.parameters.properties.taskChange=require('./request-scope.cjs').schema;
tool.function.parameters.properties.skillIds=require('./action-request.cjs').skillIdsSchema;
const skillCatalogIds=state=>[...new Set((state.skillCatalog||[]).map(item=>item?.id).filter(id=>typeof id==='string'&&id.trim()))];
const automaticSkillIds=state=>[...new Set([...skillCatalogIds(state),...(state.loadedSkills||[]).filter(item=>item?.source==='auto').map(item=>item.id).filter(id=>typeof id==='string'&&id.trim())])];
// Named tools remove the redundant action discriminator for providers that omit it.
// The decoder still passes every action through normal phase and permission checks.
tool.function.parameters.properties.operation.enum.push('check');
for(const operation of require('./android-device.cjs').operations)if(!tool.function.parameters.properties.operation.enum.includes(operation))tool.function.parameters.properties.operation.enum.push(operation);
function constrainAdoptionPlan(schema,state){
 if(state.phase!=='task')return;
 const material=state.materialInput;
 if(material?.required&&material.status!=='adopted'){
  const ids=(material.materials||[]).map(m=>m.id);
  schema.required.push('materialUse');
  schema.properties.materialUse={...schema.properties.materialUse,minItems:ids.length,maxItems:ids.length,description:'仅逐项列出materialInput.materials中的本批附件，说明实际用途、理由与受影响的真实要求ID；不能把materials目录中的历史附件重复列入。附件已读取不代表已采用，不能默认使用旧稿。',items:{...schema.properties.materialUse.items,properties:{...schema.properties.materialUse.items.properties,id:{type:'string',...(ids.length?{enum:ids}:{})}}}};
 }
 const inputs=state.inputCoverage?.inputs||[],waiting=inputs.filter(e=>e.status==='received');
 if(state.steps?.length&&(waiting.length||material?.required&&material.status!=='adopted'||state.currentInput?.followup&&!state.currentInput.requirementsRecorded))schema.required.push('mode');
 if(waiting.length>1){
  schema.required.push('inputUse');
  schema.properties.inputUse={...schema.properties.inputUse,minItems:waiting.length,description:'逐条关联本批待采用输入：'+waiting.map(e=>e.inputId).join('、')+'。requirementIds须引用本次顶层requirements真实声明的ID，不能只关联无关旧要求；撤回须保留后续用户来源。',items:{...schema.properties.inputUse.items,allOf:[{if:{properties:{disposition:{const:'requirements'}},required:['disposition']},then:{properties:{inputId:{type:'string',enum:inputs.map(e=>e.inputId)}}}}]}};
 }
}
function actionTools(state,selection) {
 return allowedActions(state).filter(name=>!selection||selection.includes(name)).map(name=>{
  const schema=structuredClone(tool.function.parameters);
  const fields={route:['kind'],load_skill:['id','purpose'],plan:['mode','inputUse','materialUse','goal','decisions','acceptance','acceptanceTypes','requirements','steps'],run_command:['command','purpose','scope'],request_network:['purpose'],request_directory:['path','purpose'],write_file:['path','content','artifact','checks'],edit_file:['path','version','edits','purpose','artifact','checks'],edit_spreadsheet:['path','data','purpose'],view_image:['path','crop','purpose'],browser:['operation','path','selector','crop','text','width','height','x','y','purpose'],batch_read:['items'],read_file:['path','offset','limit'],list_files:['path'],reply:['text','answeredInputIds'],pause:['text'],blocked:['text'],checkpoint:['text'],finish:['text','evidence','review','outcome'],clarify:['text','clarification'],artifact:['path','label'],verify:['checks'],web_search:['query'],read_material:['id','offset','limit'],read_source:['id','entry','offset'],inspect_source:['id','entry','pointer','offset','query'],search_materials:['query'],read_history:['offset','limit'],read_execution:['id','view','offset','limit'],build_android:['tasks','purpose'],android_device:['operation','path','display','x','y','text','purpose'],knowledge:['operation','query','id','entry','offset'],mcp:['operation','id','query','params','purpose'],amap:['operation','query','params','purpose'],feishu:['operation','query','method','path','params','data','purpose'],memory:['operation','id','data','query','purpose'],assistant:['operation','id','data','purpose']};
  fields.route.push('taskChange');
  const catalogIds=skillCatalogIds(state),automaticIds=automaticSkillIds(state);
  if(automaticIds.length)fields.route.push('skillIds');
  fields.view_image.push('reference');
  schema.properties=Object.fromEntries((fields[name]||[]).map(field=>[field,schema.properties[field]]));
  if(name==='route'&&schema.properties.skillIds)schema.properties.skillIds.items={...schema.properties.skillIds.items,enum:automaticIds};
  if(name==='load_skill'){schema.properties.id={type:'string',minLength:1,enum:catalogIds};schema.properties.purpose={type:'string',minLength:1,description:'该技能与当前用户请求的具体关联；加载不会执行技能中的命令，也不会扩大权限。'};}
  if(name==='feishu')require('../feishu-request.cjs').constrain(schema);
  if(name==='checkpoint')schema.properties.text={...require('./working-memory.cjs').schema};
  if(['write_file','edit_file'].includes(name)&&schema.properties.checks)schema.properties.checks=require('./attached-delivery.cjs').checksSchema;
  if(name==='android_device'){schema.properties.operation.enum=[...require('./android-device.cjs').operations,'check'];schema.properties.operation.description='仅操作当前项目的受管模拟器：tap使用屏幕内x/y，back返回，type输入安全ASCII；须已安装应用且该应用位于前台。输入发送成功不等于功能验收通过。';schema.properties.path={...schema.properties.path,description:'install/check使用当前APK的项目相对路径；其他操作不要填。screenshot输出路径由服务生成。'};schema.properties.x={type:'integer',minimum:0,maximum:3839};schema.properties.y={type:'integer',minimum:0,maximum:3839};schema.properties.text={type:'string',minLength:1,maxLength:120,pattern:'^[A-Za-z0-9 ._@+\\-]+$',description:'受管应用ASCII输入，仅字母、数字、空格、._@+-；不支持中文或shell语法。'};}
  if(['route','plan','reply','clarify','finish'].includes(name))schema.properties.conversationTitle=tool.function.parameters.properties.conversationTitle;
  if(!['route','load_skill','plan','reply','finish','pause','blocked','clarify','checkpoint'].includes(name))schema.properties.stepId=tool.function.parameters.properties.stepId;
  if(schema.properties.stepId&&Array.isArray(state.steps)){const ids=attachedProgress.stepIds(state.steps);if(ids.length)schema.properties.stepId={...schema.properties.stepId,enum:ids,description:'仅填当前已有步骤ID；无需归属时可省略，不能创建新步骤。'};else delete schema.properties.stepId;}
  if(!['route','load_skill'].includes(name)){
   schema.properties.progress=attachedProgress.scopedSchema(name==='plan'?progressSchema:compactProgress,state.steps,{prospective:name==='plan'});
  }
  schema.required=[...(require('./action-request.cjs').required[name]||[])];
  if(name==='plan')constrainAdoptionPlan(schema,state);
  if(name==='reply'){const waiting=(state.inputCoverage?.inputs||[]).filter(e=>e.status==='received');if(waiting.length){schema.properties.answeredInputIds.items={type:'string',enum:waiting.map(e=>e.inputId)};if(waiting.length>1)schema.required.push('answeredInputIds');}}
  require('./verification-request.cjs').constrain(schema,state.acceptanceCriteria,state.verificationEvidence);
  if(state.decisionRecovery){if(schema.properties.content)schema.properties.content.maxLength=8000;if(schema.properties.command)schema.properties.command.maxLength=2000;if(schema.properties.items)schema.properties.items.maxItems=3;}
  return {type:'function',function:{name,description:`提交 ${name} 动作。遵循 Ailo 阶段和权限要求，每次只调用一次。`,parameters:schema}};
 });
}
function menuTool(state,selection,discovery=true){
 const selected=actionTools(state,selection),properties={action:{...tool.function.parameters.properties.action,enum:[...selection]}},schema={type:'object',additionalProperties:false,required:['action'],properties};
 for(const item of selected)Object.assign(properties,item.function.parameters.properties);
 // Shared operation must accept every selected tool's vocabulary. Per-action
 // branches narrow Feishu without removing another tool's valid operations.
 const operationSchemas=selected.map(item=>item.function.parameters.properties.operation).filter(Boolean);
 if(operationSchemas.length)properties.operation={...properties.operation,enum:[...new Set(operationSchemas.flatMap(schema=>schema.enum||[]))]};
 if(state.phase!=='route'){
  const ordinary=attachedProgress.scopedSchema(compactProgress,state.steps);
  properties.progress=selection.includes('plan')?attachedProgress.scopedSchema(progressSchema,state.steps,{prospective:true}):ordinary;
  // A merged alias carries both plan and ordinary actions. Keep the plan's
  // future IDs possible while ordinary metadata remains scoped to live IDs.
  if(selection.includes('plan')&&Array.isArray(state.steps)){
   properties.progress.description+=` 普通动作只能使用当前ID：${attachedProgress.stepIds(state.steps).join('、')||'无，只能附memory'}；只有plan.progress可使用该次顶层steps声明的新ID。`;
   schema.allOf=[...(schema.allOf||[]),{if:{properties:{action:{const:'plan'}},required:['action']},then:{properties:{progress:attachedProgress.scopedSchema(progressSchema,state.steps,{prospective:true})}},else:{properties:{progress:ordinary}}}];
  }
 }
 // Keep the established recovery size contract visible even when the menu's
 // current phase has no writing action; this never adds an allowed action.
 if(state.decisionRecovery){properties.content={...tool.function.parameters.properties.content,maxLength:8000};properties.command={...tool.function.parameters.properties.command,maxLength:2000};}
 if(state.phase==='route'&&selection.length===1&&selection[0]==='route')schema.required.push('kind');
 if(discovery&&state.phase!=='route'){
  properties.action.enum.push(require('./tool-menu.cjs').discoveryName);
  properties.names=require('./tool-menu.cjs').schema(allowedActions(state)).properties.names;
 }
 schema.allOf=[...(schema.allOf||[]),...selected.filter(item=>item.function.parameters.required?.length).map(item=>({if:{properties:{action:{const:item.function.name}},required:['action']},then:{required:item.function.parameters.required,...(item.function.name==='feishu'?{properties:{operation:item.function.parameters.properties.operation,method:item.function.parameters.properties.method},allOf:item.function.parameters.allOf}:item.function.name==='load_skill'?{properties:{id:item.function.parameters.properties.id,purpose:item.function.parameters.properties.purpose},not:{anyOf:[{required:['progress']},{required:['stepId']}]}}:{})}}))];
 require('./verification-request.cjs').constrain(schema,state.acceptanceCriteria,state.verificationEvidence);
 return {type:'function',function:{name:'ailo_action',description:tool.function.description,parameters:schema}};
}
// In JSON/text compatibility mode these are prompt DATA, not a new vendor API
// parameter. Shared field definitions keep the current menu's full contract small.
function jsonActionContract(state,selection,discovery=true){
 const variants=actionTools(state,selection).map(t=>({name:t.function.name,parameters:t.function.parameters}));
 if(discovery&&state.phase!=='route')variants.push({name:'request_tools',parameters:require('./tool-menu.cjs').schema(allowedActions(state))});
 const definitions={},shared=new Map();
 const reference=(field,value)=>{const key=JSON.stringify(value);if(!shared.has(key)){const id=field+'_'+shared.size;shared.set(key,id);definitions[id]=structuredClone(value);}return {$ref:'#/$defs/'+shared.get(key)};};
 const branches=variants.map(({name,parameters})=>{
  const properties={action:{const:name}};
  for(const [field,original]of Object.entries(parameters.properties)){
   let value=original;
   if(name==='batch_read'&&field==='items'){
    value=structuredClone(original);
    value.items.allOf=[{oneOf:require('./batch-read.cjs').actions.map(action=>({properties:{action:{const:action}},required:['action',...(batchRequiredFields[action]||[])]}))}];
   }
   properties[field]=reference(field,value);
  }
  return {type:'object',additionalProperties:false,required:['action',...(parameters.required||[])],properties,...(parameters.allOf?{allOf:structuredClone(parameters.allOf)}:{})};
 });
 return {parametersSchema:{type:'object',oneOf:branches,$defs:definitions},...(selection.includes('batch_read')?{batchItemRequiredFields:batchRequiredFields}:{})};
}
function protocolError(reason='invalid_action',diagnostics={}){return Object.assign(Error('模型暂时未能给出可执行的下一步，任务和材料已保留。可重试当前步骤。'),{code:'AGENT_PROTOCOL',reason,diagnostics});}
const identifier=v=>typeof v==='string'&&/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(v)?v:'<非标准标识>';
const paginatedActions=new Set(['read_file','read_material','read_source','inspect_source','read_history','read_execution','knowledge']);
function parameterValue(value){
 const type=value===null?'null':Array.isArray(value)?'array':typeof value;
 const numericString=typeof value==='string'&&/^\d{1,20}$/.test(value.trim());
 return {receivedType:type,...(type==='number'&&Number.isFinite(value)||type==='boolean'||value===null||numericString?{receivedValue:numericString?value.trim():value}:{})};
}
function parameterHint(diagnostics={}){
 if(diagnostics.expected==='skill_selection')return 'route.skillIds 只能是最多5个不重复、非空的真实技能ID数组，允许[]，省略则保留已加载自动技能；从skillCatalog或loadedSkills中source=auto的条目选取，不能传名称或将错误字段静默删除。load_skill只填写目录中的id及非空purpose，不附stepId/progress；加载技能不是任务进展或执行授权。';
 if(diagnostics.expected==='feishu_request')return require('../feishu-request.cjs').hint(diagnostics);
 if(diagnostics.expected==='action_string_length')return `${diagnostics.action}.${diagnostics.field} 收到 ${diagnostics.receivedLength} 字符，最多 ${diagnostics.maxLength} 字符。整条动作尚未执行，原步骤与证据保留；不截断内容、不重复提交相同超限参数。`+(diagnostics.action==='run_command'&&diagnostics.field==='command'?' 缩短命令；生成文件改用 write_file 或 edit_file，按文件或模块拆分，不把整份成果嵌入 shell 命令。':' 保留原要求，精简此字段或拆成完整的小动作。');
 if(diagnostics.expected==='action_required_field')return `${diagnostics.action}.${diagnostics.field} 是必填参数，需要 ${diagnostics.expectedType}。本动作必填字段：${(diagnostics.requiredFields||[]).join('、')}。保留已确认的目标与其他合法参数，只补齐此合同缺口；不猜路径、不丢弃progress后执行。文件path必须使用已读取的真实项目相对路径。`;
 if(diagnostics.expected==='progress_step_contract')return `${diagnostics.field||'progress'} 无效（${diagnostics.issue||'步骤元数据不符'}）。当前允许步骤 ID：${(diagnostics.allowedIds||[]).join('、')||'无，先用plan声明计划'}；同一ID只能更新一次。普通动作没有更新可省略progress；不允许静默丢弃错误progress后执行工具。plan.progress必须使用该次顶层steps声明的ID。`;
 if(diagnostics.expected==='authorized_action_names')return 'request_tools.names 必须是1–8个真实动作名组成的数组，例如 ["android_device"]。从 availableActions 逐字选取动作名，不能填逗号拼接的字符串、子操作名或工具说明；此参数不是整数或分页位置。';
 if(diagnostics.expected==='verification_checks')return require('./verification-request.cjs').hint(diagnostics);
 if(diagnostics.expected==='string_20_10000')return `${diagnostics.action||'动作'}.${diagnostics.field}${Number.isInteger(diagnostics.receivedLength)?' 收到 '+diagnostics.receivedLength+' 字符（去除首尾空白后 '+diagnostics.trimmedLength+' 字符）':' 收到类型 '+diagnostics.receivedType}，需要20–10000字符的累计任务摘要。融合旧 workingMemory，写明用户要求、已确认结果及真实来源ID、未解决缺口和下一步；建议80–800字符。不能只写“已读取”，不能机械补字或编造来源；不清楚的内容标为未确认。checkpoint 使用 text 字段，实际动作可用 progress.memory 附带同样摘要；修正后继续原任务。`;
 if(diagnostics.field==='limit')return `${diagnostics.action||'读取动作'}.limit${Object.hasOwn(diagnostics,'receivedValue')?' 收到 '+JSON.stringify(diagnostics.receivedValue):diagnostics.receivedType?' 收到类型 '+diagnostics.receivedType:''}，必须是 1–12000 的整数（单页字符数）。保持读取对象与 offset 不变，将 limit 改为 3000 或省略；更多内容按工具返回的 next 继续分页。`;
 if(diagnostics.field==='view')return 'view 必须是 record（完整执行记录）或 result（工具结果正文）';
 if(diagnostics.field==='items')return 'items 必须是 1–6 个本地只读操作组成的数组；每项包含 action，分页 limit 为 1–4000。不能把飞书等应用调用放入 batch_read，请逐个调用对应应用工具。'+(diagnostics.hint?' 具体原因：'+diagnostics.hint:'');
 return `${diagnostics.field||'参数'} 必须是有效整数；offset 不小于 0，limit 为 1–12000，请使用结果中的 next 继续分页。`;
}
function pagination(value,action,options={}) {
 const result={...value,action};
 if(action==='read_execution'&&value.view!==undefined&&!['record','result'].includes(value.view))throw protocolError('invalid_parameter',{field:'view',expected:'record_or_result'});
 if(!paginatedActions.has(action))return result;
 for(const field of ['read_material','read_file','read_execution','read_history'].includes(action)?['offset','limit']:['offset']) {
  if(!Object.hasOwn(result,field))continue;
  const original=result[field];
  if(options.boundReadPages&&field==='limit'&&original===null){
   delete result.limit;options.onNormalization?.({action,field,reason:'optional_null_omitted',...parameterValue(original),normalized:'default'});continue;
  }
  // Some providers serialize integer arguments as decimal strings. Normalize
  // only pagination fields, before execution and repeat detection; never coerce
  // booleans, fractions, expressions, or arbitrary connector parameters. The
  // optional read limit alone may omit null above, using the tool's default.
  const n=typeof original==='string'&&/^\d+$/.test(original.trim())?Number(original.trim()):original;
  const min=field==='limit'?1:0,max=field==='limit'?12000:Number.MAX_SAFE_INTEGER;
  const pageMax=Number.isSafeInteger(options.readPageMax)&&options.readPageMax>0?Math.min(max,options.readPageMax):max;
  if(options.boundReadPages&&field==='limit'&&Number.isSafeInteger(n)&&n>=pageMax){
   const bounded=Math.min(n,pageMax);result[field]=bounded;
   if(bounded!==n)options.onNormalization?.({action,field,reason:'page_limit_capped',...parameterValue(original),normalizedValue:bounded});
   continue;
  }
  if(!Number.isSafeInteger(n)||n<min||n>max)throw protocolError('invalid_parameter',{action,field,expected:field==='limit'?'integer_1_12000':'nonnegative_safe_integer',...parameterValue(original)});
  result[field]=n;
 }
 return result;
}
function parse(text) {
 if(typeof text!=='string')throw protocolError('missing_text');
 const cleaned=text.trim().replace(/^```(?:json)?\s*\r?\n/i,'').replace(/\r?\n```\s*$/,'');
 try{return JSON.parse(cleaned);}catch(error){throw protocolError('invalid_json',{responseChars:text.length,responseShape:cleaned.startsWith('{')?'object_like':cleaned.startsWith('[')?'array_like':cleaned.startsWith('```')?'fenced':'prose',jsonIssue:(/end of JSON|unterminated/i.test(error.message)||Number(error.message.match(/position (\d+)/)?.[1])===cleaned.length)?'incomplete':'syntax',...jsonErrorDiagnostics(cleaned,error)});}
}
function jsonErrorDiagnostics(text,error){
 const match=String(error?.message||'').match(/(?:position|at character)\s+(\d+)/i);
 const offset=match?Number(match[1]):/end of JSON|unterminated/i.test(String(error?.message||''))?text.length:undefined;
 const char=Number.isSafeInteger(offset)?text[offset]:undefined;
 const kind=offset===text.length?'end':char===undefined?'unknown':/\s/.test(char)?'whitespace':char==='"'?'quote':char==='\\'?'backslash':'{}[]:,'.includes(char)?({'{':'object_open','}':'object_close','[':'array_open',']':'array_close',':':'colon',',':'comma'})[char]:/\d/.test(char)?'digit':/[A-Za-z]/.test(char)?'ascii_letter':char.codePointAt(0)>127?'non_ascii':'other_ascii';
 return {jsonCleanedChars:text.length,...(offset===undefined?{}:{jsonErrorOffset:offset}),jsonErrorCharacterClass:kind};
}
function normalize(value,depth=0,options={}) {
 const diagnostics={shape:Array.isArray(value)?'array':value===null?'null':typeof value,keys:value&&typeof value==='object'?Object.keys(value).slice(0,12).map(identifier):[]};
 if(!value||Array.isArray(value)||typeof value!=='object'||depth>2)throw protocolError('invalid_action',diagnostics);
 // Only unambiguous wrappers are accepted. Never extract executable JSON from prose.
 if(Object.keys(value).length===1&&value.action&&typeof value.action==='object')return normalize(value.action,depth+1,options);
 if(Object.keys(value).every(k=>['name','arguments'].includes(k))&&value.name==='ailo_action'&&value.arguments!==undefined)return normalize(typeof value.arguments==='string'?parse(value.arguments):value.arguments,depth+1,options);
 const action=typeof value.action==='string'?value.action.trim():value.action;
 if(!names.includes(action))throw protocolError('invalid_action',{...diagnostics,receivedAction:identifier(action),issue:action===undefined?'missing_action':'unknown_action'});
 const wrapper=['parameters','arguments'].find(k=>Object.hasOwn(value,k));
 if(wrapper&&Object.keys(value).every(k=>k==='action'||k===wrapper)) {
  const args=typeof value[wrapper]==='string'?parse(value[wrapper]):value[wrapper];
  if(!args||Array.isArray(args)||typeof args!=='object'||(args.action!==undefined&&args.action!==action))throw protocolError('conflicting_action',diagnostics);
  return normalize({...args,action},depth+1,options);
 }
 try{require('./action-request.cjs').validateSkills(value);}catch(error){if(error.code!=='ACTION_REQUEST_INVALID')throw error;throw protocolError('invalid_parameter',error.diagnostics);}
 const memory=require('./working-memory.cjs');
 if(Array.isArray(options.steps)){
  const submittedSteps=Array.isArray(value.steps)?value.steps:[];
  const steps=action==='plan'?(value.mode==='amend'?[...options.steps.filter(s=>!submittedSteps.some(p=>p?.id===s.id)),...submittedSteps]:submittedSteps):options.steps;
  try{attachedProgress.validateStepMetadata(value,steps);}catch(error){if(error.code!=='PROGRESS_REQUEST_INVALID')throw error;throw protocolError('invalid_parameter',{action,...error.diagnostics});}
 }
 // Validate summaries before the runner can change steps, memory, checkpoint
 // counters or execute side effects. A missing text may use an explicitly
 // supplied progress.memory; never replace an explicitly invalid text.
 if(value.progress&&Object.hasOwn(value.progress,'memory')){
  const issue=memory.diagnostics(value.progress.memory);
  if(issue)throw protocolError('invalid_parameter',{action,field:'progress.memory',expected:'string_20_10000',...issue});
 }
 if(action==='checkpoint'){
  if(!Object.hasOwn(value,'text')&&typeof value.progress?.memory==='string')value={...value,text:value.progress.memory};
  const issue=memory.diagnostics(value.text);
  if(issue)throw protocolError('invalid_parameter',{action,field:'text',expected:'string_20_10000',...issue});
 }
 if(options.boundActionContract){try{require('./action-request.cjs').validate(value,{properties:tool.function.parameters.properties});}catch(error){if(error.code!=='ACTION_REQUEST_INVALID')throw error;throw protocolError('invalid_parameter',error.diagnostics);}}
 if(action==='feishu'){
  try{require('../feishu-request.cjs').apiArgs(value);}catch(error){if(error.code!=='FEISHU_REQUEST_INVALID')throw error;throw protocolError('invalid_parameter',error.diagnostics);}
 }
 if(action==='verify'){
  try{require('./verification-request.cjs').validate(value,options.acceptanceCriteria,options.resolveEvidenceId,options.nativeFileOperations);}
  catch(error){if(error.code!=='VERIFY_REQUEST_INVALID')throw error;throw protocolError('invalid_parameter',{action,...error.diagnostics});}
 }
 if(action==='batch_read'){
  try{
   const items=Array.isArray(value.items)?value.items.map(item=>{const normalized=pagination(item,item?.action,{...options,readPageMax:4000});if(Number.isSafeInteger(normalized.limit))normalized.limit=Math.min(normalized.limit,4000);return normalized;}):value.items;
   return {...pagination(value,action,options),items:require('./batch-read.cjs').validate(items)};
  }catch(error){throw protocolError('invalid_parameter',{field:'items',expected:'1_6_local_read_actions',hint:error.code==='AGENT_PROTOCOL'?parameterHint(error.diagnostics):error.message,...(error.diagnostics?{itemDiagnostics:error.diagnostics}:{})});}
 }
 return pagination(value,action,options);
}
function object(text,options={}){return normalize(parse(text),0,options);}
function decodeAction(result,options={}) {
 try{return decodeResponse(result,options);}catch(error){
  if(error.code==='AGENT_PROTOCOL')error.diagnostics={...error.diagnostics,responseChannel:result.toolCalls?.length?'tool_arguments':'content',...(result.finishReason?{finishReason:result.finishReason}:{}),...(Number.isSafeInteger(result.toolArgumentDeltas)?{toolArgumentDeltas:result.toolArgumentDeltas}:{})};
  throw error;
 }
}
function decodeResponse(result,options={}) {
 if(result.toolCalls?.length){
  if(result.toolCalls.length!==1){
   const items=result.toolCalls.map(call=>decodeResponse({toolCalls:[call]},{...options,readPageMax:4000}));
   try{return {action:'batch_read',items:require('./batch-read.cjs').validate(items)};}catch{throw protocolError('multiple_tools',{count:result.toolCalls.length});}
  }
  const call=result.toolCalls[0].function;
  const name=call.name==='functions.ailo_action'?'ailo_action':call.name;
  if(name==='ailo_action')return object(call.arguments,options);
  // A known action used as the tool name has the same semantics; normal runtime
  // phase checks, path validation and permissions still apply.
  if(names.includes(name)) {
   const args=parse(call.arguments);
   if(!args||Array.isArray(args)||typeof args!=='object'||(args.action!==undefined&&args.action!==name))throw protocolError('conflicting_action');
   return normalize({...args,action:name},0,options);
  }
  throw protocolError('wrong_tool',{receivedTool:identifier(name)});
 }
 return object(result.content,options);
}
function allowedActions(state) {
 const available=[...new Set(names)].filter(name=>(name!=='view_image'||state.observationCapabilities?.images!==false)&&(name!=='request_network'||!!state.permissions)&&(name!=='memory'||state.memoryAvailable===true)&&name!=='route'&&(name!=='load_skill'||skillCatalogIds(state).length>0&&!['finish_review','checkpoint','plan_update','plan_or_clarify'].includes(state.requiredAction))&&(name!=='assistant'||state.personalAssistant===true)&&(name!=='mcp'||!!state.mcpConnections?.length)&&(state.phase!=='chat'||!['plan','browser','write_file','edit_file','edit_spreadsheet','request_directory','request_network','run_command','build_android','android_device','artifact','verify','finish'].includes(name)));
 // A plain question may be answered in the same request that would otherwise
 // only classify it. reply at route implies chat; task work still needs route.
 if(state.phase==='route')return ['route','reply',...(available.includes('load_skill')?['load_skill']:[])];
 if(state.phase==='task'&&state.pendingArtifactUpdates?.length&&state.requiredAction!=='checkpoint')return ['artifact','view_image','browser','read_file','batch_read','read_execution','read_history','plan','checkpoint','clarify','blocked','pause'].filter(name=>available.includes(name));
 // Recovery changes request size and format, never the task's authorized tools.
 if(state.decisionRecovery)return available.filter(name=>name!=='batch_read'||state.decisionRecovery.stage==='small_action');
 if(state.requiredAction==='checkpoint'||state.requiredAction==='plan_update')return available;
 if(state.requiredAction==='plan_or_clarify')return ['plan','clarify','blocked','pause','checkpoint'];
 return available;
}

module.exports={parameterHint,tool,decodeAction,protocolError,parseAction:object,allowedActions,actionTools,menuTool,jsonActionContract,jsonErrorDiagnostics,compactProgress};

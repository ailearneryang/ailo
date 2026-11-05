// One source for named tools, the merged menu, JSON prompts and pre-execution
// checks. Missing arguments are protocol defects, not product repair attempts.
const required={feishu:['operation'],route:['kind'],load_skill:['id','purpose'],android_device:['operation'],plan:['goal','decisions','steps'],run_command:['command','purpose'],request_network:['purpose'],request_directory:['path','purpose'],write_file:['path','content'],edit_file:['path','version','edits'],edit_spreadsheet:['path','data','purpose'],view_image:['path'],browser:['operation'],batch_read:['items'],read_file:['path'],reply:['text'],pause:['text'],blocked:['text'],checkpoint:['text'],finish:['text','review'],clarify:['text','clarification'],verify:['checks'],artifact:['path']};
const types={kind:'string',id:'string',operation:'string',goal:'string',decisions:'array',steps:'array',command:'string',purpose:'string',path:'string',content:'string',version:'string',edits:'array',items:'array',text:'string',review:'object',clarification:'object',checks:'array'};
const skillIdsSchema={type:'array',maxItems:5,uniqueItems:true,items:{type:'string',minLength:1},description:'按当前请求用途选择自动技能的真实ID，最多5项；省略保留已加载自动技能，[]清空自动选择。手动已加载技能不必重复选择。'};
function validateSkills(value){
 const fail=(field,issue)=>{throw Object.assign(Error('技能选择参数无效'),{code:'ACTION_REQUEST_INVALID',diagnostics:{action:value.action,field,expected:'skill_selection',issue}});};
 if(Object.hasOwn(value,'skillIds')){
  if(value.action!=='route')fail('skillIds','route_only');
  if(!Array.isArray(value.skillIds))fail('skillIds','expected_array');
  if(value.skillIds.length>skillIdsSchema.maxItems)fail('skillIds','too_many');
  if(value.skillIds.some(id=>typeof id!=='string'||!id.trim()||id!==id.trim()))fail('skillIds','invalid_id');
  if(new Set(value.skillIds).size!==value.skillIds.length)fail('skillIds','duplicate_id');
 }
 if(value.action==='load_skill'){
  for(const field of ['id','purpose'])if(typeof value[field]!=='string'||!value[field].trim()||field==='id'&&value[field]!==value[field].trim())fail(field,'expected_nonempty_string');
  for(const field of ['progress','stepId'])if(Object.hasOwn(value,field))fail(field,'context_only');
 }
 return value;
}
function validate(value,{properties={}}={}){
 validateSkills(value);
 for(const field of required[value.action]||[]){
  const received=value[field],type=received===null?'null':Array.isArray(received)?'array':typeof received;
  if(received===undefined||received===null||types[field]&&type!==types[field]||field==='path'&&typeof received==='string'&&!received.trim())throw Object.assign(Error('动作缺少有效必填参数'),{code:'ACTION_REQUEST_INVALID',diagnostics:{action:value.action,field,expected:'action_required_field',expectedType:types[field]||'present_value',receivedType:type,issue:received===undefined?'missing_field':'invalid_field_type',requiredFields:[...(required[value.action]||[])]}});
 }
 // Reuse the advertised field limits before progress, journals or files can
 // change. Leave checkpoint, pagination and semantic validators in charge of
 // their own richer contracts; never truncate a command or source document.
 for(const [field,schema]of Object.entries(properties)){
  const received=value[field];
  if(typeof received==='string'&&schema?.type==='string'&&Number.isSafeInteger(schema.maxLength)&&received.length>schema.maxLength)throw Object.assign(Error('动作字符串参数超过已声明上限'),{code:'ACTION_REQUEST_INVALID',diagnostics:{action:value.action,field,expected:'action_string_length',receivedType:'string',receivedLength:received.length,maxLength:schema.maxLength,issue:'max_length_exceeded'}});
 }
 return value;
}
module.exports={required,validate,validateSkills,skillIdsSchema};

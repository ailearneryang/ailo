// One source for named tools, the merged menu, JSON prompts and pre-execution
// checks. Missing arguments are protocol defects, not product repair attempts.
const required={feishu:['operation'],route:['kind'],android_device:['operation'],plan:['goal','decisions','steps'],run_command:['command','purpose'],request_network:['purpose'],request_directory:['path','purpose'],write_file:['path','content'],edit_file:['path','version','edits'],edit_spreadsheet:['path','data','purpose'],view_image:['path'],browser:['operation'],batch_read:['items'],read_file:['path'],reply:['text'],pause:['text'],blocked:['text'],checkpoint:['text'],finish:['text','review'],clarify:['text','clarification'],verify:['checks'],artifact:['path']};
const types={kind:'string',operation:'string',goal:'string',decisions:'array',steps:'array',command:'string',purpose:'string',path:'string',content:'string',version:'string',edits:'array',items:'array',text:'string',review:'object',clarification:'object',checks:'array'};
function validate(value){
 for(const field of required[value.action]||[]){
  const received=value[field],type=received===null?'null':Array.isArray(received)?'array':typeof received;
  if(received===undefined||received===null||types[field]&&type!==types[field]||field==='path'&&typeof received==='string'&&!received.trim())throw Object.assign(Error('动作缺少有效必填参数'),{code:'ACTION_REQUEST_INVALID',diagnostics:{action:value.action,field,expected:'action_required_field',expectedType:types[field]||'present_value',receivedType:type,issue:received===undefined?'missing_field':'invalid_field_type',requiredFields:[...(required[value.action]||[])]}});
 }
 return value;
}
module.exports={required,validate};

// A successful write may register its own deliverable and prove requirements
// that the written file alone can satisfy. This only removes model round trips:
// registration and verification run through the same runtime paths as the
// standalone artifact and verify actions, with the same evidence rules.
const carriers=new Set(['write_file','edit_file']);
const staticKinds=['text_contains','json_valid','file_exists'];
const nonempty={type:'string',minLength:1,pattern:'\\S'};
// Deliberately small: only checks the written file itself can satisfy. The
// complete verify schema (evidence IDs, visual regions) stays on verify.
const checksSchema={type:'array',minItems:1,maxItems:12,description:'写入成功后立即执行的验收检查，格式同 verify 但仅限本次写入文件即可证明的要求；失败不撤销写入。',items:{type:'object',additionalProperties:false,required:['criterionId','kind','reason'],properties:{criterionId:{type:'string'},kind:{type:'string',enum:staticKinds},path:nonempty,contains:{type:'array',minItems:1,maxItems:24,items:{type:'string',minLength:1,maxLength:800}},reason:{...nonempty,maxLength:800,description:'说明此检查如何覆盖该验收要求，建议20–120字符。'}}}};
function validate(workspace,action){
 if(!carriers.has(action.action))return undefined;
 if(action.artifact===undefined&&action.checks===undefined)return undefined;
 const run=workspace.run,result={};
 if(run.mode!=='task'||!run.steps?.length)throw Error('附带成果登记或验收需要先制定任务计划');
 if(action.artifact!==undefined){
  const spec=action.artifact;
  if(!spec||typeof spec!=='object'||Array.isArray(spec)||Object.keys(spec).some(k=>k!=='label')||typeof spec.label!=='string'||!spec.label.trim()||spec.label.length>120)throw Object.assign(Error('附带 artifact 只接受 {label}，名称为 1–120 字符'),{code:'ACTION_REQUEST_INVALID',diagnostics:{action:action.action,field:'artifact',expected:'attached_artifact_label',issue:'invalid_field'}});
  if(action.path.split('/').includes('.runtime'))throw Error('运行时目录中的文件不能登记为成果');
  result.artifact={action:'artifact',path:action.path,label:spec.label};
 }
 if(action.checks!==undefined){
  const verifyAction={action:'verify',checks:action.checks};
  require('./verification-request.cjs').validate(verifyAction,require('./acceptance.cjs').criteria(run),id=>require('./evidence.cjs').resolveId(run,id),require('./native-operation.cjs').context(run));
  for(const [index,check] of action.checks.entries())if(!staticKinds.includes(check.kind))throw Object.assign(Error(`附带 checks 第${index+1}条 kind=${check.kind} 不能随写入核验；只接受 ${staticKinds.join(' / ')}，运行、视觉与设备证据请在相应操作后单独 verify`),{code:'VERIFY_REQUEST_INVALID',diagnostics:{field:'checks',expected:'attached_static_checks',issue:'attached_check_kind',index:index+1}});
  result.verify=verifyAction;
 }
 return result;
}
module.exports={validate,checksSchema,staticKinds};

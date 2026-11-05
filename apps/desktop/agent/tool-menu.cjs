// A menu is an inference aid, never an authorization boundary. The runner still
// validates every returned action with the complete allowedActions contract.
const discoveryName='request_tools';
const discoverySchema={type:'object',additionalProperties:false,required:['names'],properties:{names:{type:'array',minItems:1,maxItems:8,items:{type:'string'},description:'从 availableActions 选择需要补充参数说明的真实动作名；最多8项。'}}};
function pendingAdoption(state){return state.phase==='task'&&((state.inputCoverage?.inputs||[]).some(e=>e.status==='received')||state.materialInput?.required&&state.materialInput.status!=='adopted'||state.currentInput?.followup&&!state.currentInput.requirementsRecorded);}
function select(state,allowed,extra=[],full=false){
 const authorized=[...new Set(allowed)];
 if(full||state.phase==='route')return authorized;
 let names;
 if(state.phase==='chat')names=['reply','read_material','search_materials','read_source','read_file','batch_read','clarify'];
 else if(pendingAdoption(state))return [...new Set(['plan','read_material','read_source','inspect_source','search_materials','read_file','batch_read','list_files','read_execution','read_history','view_image','clarify','checkpoint','load_skill',...extra])].filter(name=>authorized.includes(name));
 else if(!state.steps?.length)names=['plan','read_material','search_materials','read_source','inspect_source','batch_read','clarify','blocked'];
 else if(state.requiredAction==='finish_review')names=['verify','artifact','finish','plan','read_execution','view_image','clarify','blocked'];
 else if(state.repairContext||state.repairTargets?.length||state.executionState?.blocker)names=['edit_file','read_file','batch_read','run_command','build_android','verify','blocked'];
 else names=['edit_file','write_file','run_command','read_file','batch_read','verify','artifact'];
 if(authorized.includes('load_skill'))names.push('load_skill');
 if(state.deliveryValidation?.mode==='document'&&!state.pendingVisualReview&&!state.acceptanceCriteria?.some(c=>c.type==='visual'))names=names.filter(n=>n!=='view_image');
 if(state.requiredAction==='checkpoint')names.push('checkpoint');
 if(state.requiredAction==='plan_update')names.push('plan');
 if(state.pendingVisualReview||state.acceptanceCriteria?.some(c=>c.type==='visual'))names.push('view_image');
 // A stale model-written nextAction=plan must not keep advertising complete
 // replanning after that plan exists. Gates and discovery still expose it.
 if(state.executionState?.nextAction&&state.executionState.nextAction!=='plan')names.push(state.executionState.nextAction);
 const request=String(state.currentRequest||'');
 if(names.includes('run_command')&&state.permissions?.network!==true)names.push('request_network');
 if(state.memoryAvailable&&/记住|忘记|记忆|memory/i.test(request))names.push('memory');
 for(const [enabled,name] of [[state.mcpConnections?.length,'mcp'],[state.personalAssistant,'assistant'],[state.webSearchEnabled,'web_search'],[state.androidDesign||state.androidDisplay,'android_device'],[state.knowledgeLibraries?.length,'knowledge']])if(enabled)names.push(name);
 return [...new Set([...names,...extra])].filter(name=>authorized.includes(name));
}
function schema(allowed){return {...discoverySchema,properties:{names:{...discoverySchema.properties.names,items:{type:'string',enum:[...new Set(allowed)]}}}};}
function discovery(result){
 let value;
 if(result.toolCalls?.length===1){const call=result.toolCalls[0].function;
  if(!['ailo_action','functions.ailo_action',discoveryName].includes(call?.name))return;
  try{value=JSON.parse(call.arguments);}catch{return;}
  if(call.name===discoveryName)value={...value,action:discoveryName};
 }else if(!result.toolCalls?.length){try{value=JSON.parse(result.content);}catch{return;}}
 if(value?.action!==discoveryName)return;
 if(!Array.isArray(value.names)||value.names.length<1||value.names.length>8||value.names.some(n=>typeof n!=='string')||Object.keys(value).some(k=>!['action','names'].includes(k)))throw Object.assign(Error('工具目录请求需要1–8个真实动作名。'),{code:'AGENT_PROTOCOL',reason:'invalid_parameter',diagnostics:{field:'names',expected:'authorized_action_names'}});
 return [...new Set(value.names)];
}
module.exports={discoveryName,select,schema,discovery,pendingAdoption};

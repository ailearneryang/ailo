// Regenerating an answer may refresh authorized sources, never replay effects.
const reads=new Set(['reply','clarify','blocked','pause','checkpoint','load_skill','web_search','knowledge','list_files','read_file','batch_read','read_material','read_source','inspect_source','search_materials','read_execution','read_history']);
function context(task){return task?.responseOnly===true?{readOnly:true,instruction:'本轮是重新生成回答。使用当前已启用的搜索与只读资料工具重新核对原问题，新闻等实时问题应先搜索；关闭的能力不得绕过。只在当前对话回答，不执行写入、发送、安装、命令或其他外部修改，不重放历史操作。原消息与旧执行保留在历史中。'}:undefined;}
function allowed(name,state){return reads.has(name)&&(name!=='web_search'||state.webSearchEnabled===true)&&(name!=='knowledge'||!!state.knowledgeLibraries?.length);}
function assert(action,state){
 if(!state.regeneration?.readOnly)return;
 if(!allowed(action.action,state))throw Object.assign(Error('重新生成仅允许回答、已启用的搜索和只读资料核对；不能执行写入、发送、安装或其他外部修改。'),{code:'REGENERATION_READ_ONLY'});
}
module.exports={context,allowed,assert};

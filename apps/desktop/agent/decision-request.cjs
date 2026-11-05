// Request projection only: never executes tools, mutates the run, or widens
// allowedActions. Keep this boundary independent of transport and recovery.
const {allowedActions,actionTools,menuTool,jsonActionContract,parameterHint}=require('./protocol.cjs');
const toolMenu=require('./tool-menu.cjs');
async function buildDecisionRequest({messages,state,formatMode='tools',namedActions=true,parallelControl=true,discoveredActions=[],discoveryCount=0}){
  const authorized=allowedActions(state);
  const {AGENT_PROMPT,promptForState,toolGuidanceForState}=await import('./prompt.mjs');
  const menu=toolMenu.select(state,authorized,discoveredActions);
  const discoveryEnabled=state.phase!=='route'&&discoveryCount<2;
  const selectedTools=actionTools(state,menu);
  if(discoveryEnabled)selectedTools.push({type:'function',function:{name:toolMenu.discoveryName,description:'按真实动作名补充工具参数说明；不会执行操作，也不扩大权限。',parameters:toolMenu.schema(authorized)}});
  const compact=formatMode==='tools'&&namedActions?require('./tool-descriptions.cjs').compactToolDescriptions(selectedTools):{tools:selectedTools,guidance:''};
  const format = formatMode === 'tools' ? {tools:namedActions?compact.tools:[menuTool(state,menu,discoveryEnabled)],tool_choice:namedActions?'required':{type:'function',function:{name:'ailo_action'}},...(parallelControl?{parallel_tool_calls:false}:{})}
    : formatMode === 'json' ? {response_format:{type:'json_object'}} : {};
  const instructions = formatMode === 'tools'
    ? namedActions ? '\n本次使用具名原生工具（例如 run_command、plan）。直接调用当前提供的一个工具，工具名就是动作，参数无需填写 action；不要调用 ailo_action，不要在 content 中输出动作或代码。' : '\n本次通过 ailo_action 原生工具调用提交动作，参数对应上述 action 协议，不要在 content 中输出动作或代码。'
    : '\n本次接口采用兼容模式，只返回一个合法 JSON 动作对象。';
  const projected=require('./decision-projection.cjs').deduplicate(state),wireState=projected.state;
  const repositoryAccess=require('../operation-feedback.cjs').repositoryContext(wireState);if(repositoryAccess)wireState.repositoryAccess=repositoryAccess;
  if(wireState.protocolRecovery)wireState.protocolRecovery.instruction=formatMode==='tools'
    ? (wireState.protocolRecovery.reason==='invalid_parameter'?parameterHint(wireState.protocolRecovery):'')+' 上次返回未执行。只调用当前提供的一个具名工具，工具名表示动作，参数无需 action。禁止解释文字、工具定义和动作数组。'
    : (wireState.protocolRecovery.reason==='invalid_parameter'?parameterHint(wireState.protocolRecovery):'')+' 上次返回未执行。只返回一个完整 JSON 对象，必须包含字符串 action，执行动作取值来自 allowedActions；仅补充工具说明可用 toolDiscovery.action。禁止解释文字、工具定义和动作数组。';
  wireState.responseContract=formatMode==='tools'
    ? {mode:namedActions?'named_tools':'ailo_action',allowedActions:authorized,advertisedActions:menu,toolDiscoveryCount:discoveryCount,...(discoveryEnabled?{toolDiscovery:{action:'request_tools',availableActions:authorized,instruction:'需要当前菜单外动作的参数说明时，提交 request_tools 与 names 数组；不能请求目录外动作。'}}:{}),instruction:namedActions?'工具名就是动作；只调用一个工具，参数不需要 action。':'只调用 ailo_action，参数必须包含 action。'}
    : {mode:'json',allowedActions:authorized,advertisedActions:menu,toolDiscoveryCount:discoveryCount,...(discoveryEnabled?{toolDiscovery:{action:'request_tools',availableActions:authorized,instruction:'需要其他动作说明时返回合法JSON，例如 {"action":"request_tools","names":["read_execution"]}。'}}:{}),instruction:'完整响应必须是一个 JSON 动作对象，必填 action。执行动作来自 allowedActions；工具目录动作仅用 toolDiscovery.action 与 names 数组，不执行工具。不要 Markdown 或解释文字。',example:{action:allowedActions(state).includes('route')?'route':'pause',...(allowedActions(state).includes('route')?{kind:'task'}:{text:'任务进度已保留'})}};
  if(formatMode!=='tools'){
    Object.assign(wireState.responseContract,jsonActionContract(state,menu,discoveryEnabled));
    wireState.responseContract.instruction+=' parametersSchema 是本轮完整参数合同，oneOf按action选择，$ref引用同一schema中的$defs；遵守对应required与批量项必填字段，缺少菜单外参数时先发现。';
  }
  let system=messages[0].content;
  const phasePrompt=promptForState(state);
  if(system.startsWith(AGENT_PROMPT))system=promptForState(state,menu)+system.slice(AGENT_PROMPT.length);
  else if(system.startsWith(phasePrompt))system=promptForState(state,menu)+system.slice(phasePrompt.length);
  else if(discoveryCount)system+='\n当前补充工具说明：\n'+toolGuidanceForState(state,menu);
  const wireMessages=[{...messages[0],content:system+instructions+compact.guidance},...messages.slice(1,-1),{...messages.at(-1),content:JSON.stringify(wireState)}];
  const requestComposition={systemBytes:Buffer.byteLength(wireMessages[0].content),stateBytes:Buffer.byteLength(JSON.stringify(wireState)),toolSchemaBytes:Buffer.byteLength(JSON.stringify(format.tools||[])),toolResultBytes:Buffer.byteLength(JSON.stringify(wireState.toolResults||[])),deduplicatedBytes:projected.savedBytes};
  return {wireMessages,format,menu,authorized,discoveryEnabled,requestComposition};
}
module.exports={buildDecisionRequest};

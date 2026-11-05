// A single persisted recovery state. Legacy properties are non-enumerable
// accessors for existing integrations, never independent stores or budgets.
const fields=Object.freeze({decisionRecovery:'decision',failureEpisodes:'failures',loopEpisodes:'loops',loopRecovery:'loopFocus',repairValue:'repair',resultRecovery:'remaining',segmentState:'segment',unresolvedFailureStreak:'failureStreak',toolRecovery:'toolFocus'});
const bound=new WeakSet();
function bind(run){
 if(!run||typeof run!=='object')throw Error('恢复状态缺少所属执行');
 if(bound.has(run))return run.executionRecovery;
 const stored=run.executionRecovery;
 if(stored&&stored.version!==1)throw Object.assign(Error('恢复状态版本不受支持，保留原记录，不能重置后重放操作'),{code:'RECOVERY_STATE_VERSION'});
 const state=stored||{version:1,executionId:run.executionId||null};
 for(const [legacy,key]of Object.entries(fields)){
  const descriptor=Object.getOwnPropertyDescriptor(run,legacy);
  if(!stored&&descriptor&&'value'in descriptor&&descriptor.value!==undefined)state[key]=descriptor.value;
 }
 run.executionRecovery=state;
 for(const [legacy,key]of Object.entries(fields))Object.defineProperty(run,legacy,{enumerable:false,configurable:true,get(){return run.executionRecovery?.[key];},set(value){if(value===undefined)delete run.executionRecovery[key];else run.executionRecovery[key]=value;}});
 bound.add(run);return state;
}
function clear(run,...keys){bind(run);for(const key of keys){if(!Object.hasOwn(fields,key))throw Error('未知恢复状态字段：'+key);run[key]=undefined;}}
function reset(run,executionId){const previous=bind(run);if(previous.executionId&&previous.executionId!==executionId&&Object.keys(previous).some(k=>!['version','executionId'].includes(k)))run.executionRecoveryHistory=[...(run.executionRecoveryHistory||[]),structuredClone(previous)].slice(-8);run.executionRecovery={version:1,executionId};return run.executionRecovery;}
function setExecution(run,executionId){const state=bind(run);state.executionId=executionId;return state;}
function hydrate(value){return value?.taskId&&value.executionRecovery&&Array.isArray(value.steps)&&Array.isArray(value.artifacts)?(bind(value),value):value;}
function inspect(run){const s=run.executionRecovery||{};return {executionId:run.executionId,repair:s.repair??run.repairValue,remaining:s.remaining??run.resultRecovery,failures:s.failures??run.failureEpisodes,loops:s.loops??run.loopEpisodes,decision:s.decision??run.decisionRecovery,segment:s.segment??run.segmentState};}
module.exports={bind,clear,reset,setExecution,hydrate,inspect,fields};

const {validate}=require('./execution-state.cjs');
// Optional bookkeeping must not block the real action merely because an
// unsupported claim was put in facts. Never promote that claim to evidence.
function normalize(progress,run){
 if(!progress?.executionState)return {progress,demoted:0};
 const state=progress.executionState;
 validate({...state,facts:[]},run);
 if(!Array.isArray(state.facts)||state.facts.length>16)return {progress,demoted:0};
 const facts=[],unconfirmed=[];
 for(const fact of state.facts){
  if(typeof fact?.text!=='string'||!fact.text.trim()||fact.text.length>1200)return {progress,demoted:0};
  try{facts.push(validate({...state,facts:[fact]},run).facts[0]);}
  catch(error){
   if(error.code!=='EXECUTION_STATE_SOURCE'&&!(!Array.isArray(fact.sourceIds)||fact.sourceIds.length===0))throw error;
   unconfirmed.push('未核实（缺少有效来源）：'+fact.text);
  }
 }
 if(!unconfirmed.length)return {progress,demoted:0};
 const next={...progress};
 // Retain every existing gap. If there is no room, retain the original execution
 // state and skip this optional replacement rather than dropping user needs.
 if(state.gaps.length+unconfirmed.length>12||unconfirmed.some(t=>t.length>1200))delete next.executionState;
 else next.executionState={...state,facts,gaps:[...state.gaps,...unconfirmed]};
 return {progress:Object.keys(next).length?next:undefined,demoted:unconfirmed.length};
}
module.exports={normalize};

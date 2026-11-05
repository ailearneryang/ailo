// Remove exact duplicate text only, with a local/archived reference. No ledger,
// requirement, permission, original result or recovery budget is modified.
function deduplicate(state){
 const before=Buffer.byteLength(JSON.stringify(state)),wire=structuredClone(state);
 for(const row of wire.toolResults||[]){
  const result=row.result;if(!result||typeof result.output!=='string'||!result.output)continue;
  for(const key of ['stdout','stderr'])if(result[key]===result.output){delete result[key];result[key+'Ref']='output';}
 }
 for(const event of wire.recentEvents||[]){
  const d=event.detail;if(!d)continue;
  const row=(wire.toolResults||[]).find(r=>r.eventId===event.id&&r.observationId);
  if(row&&typeof d.command==='string'&&d.command===row.arguments?.command){delete d.command;d.commandRef={observationId:row.observationId,field:'arguments.command'};}
  for(const field of ['steps','requirements','decisions','acceptance','executionState','workingMemory']){
   if(d[field]!==undefined&&wire[field]!==undefined&&JSON.stringify(d[field])===JSON.stringify(wire[field])){delete d[field];(d.currentStateFields||=[]).push(field);}
  }
 }
 return {state:wire,savedBytes:Math.max(0,before-Buffer.byteLength(JSON.stringify(wire)))};
}
module.exports={deduplicate};

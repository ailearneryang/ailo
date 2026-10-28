// Presentation only: output must not alter execution budgets or replay tools.
const LIMIT=24000;
function commandOutput(run,actionId,publish){
 let active=true;
 return {
  update(output,metadata={}){
   if(!active||run.inFlight?.actionId!==actionId||typeof output!=='string')return;
   Object.assign(run.inFlight,{output:output.slice(-LIMIT),outputTruncated:!!metadata.truncated||output.length>LIMIT,outputAt:new Date().toISOString()});
   try{Promise.resolve(publish()).catch(()=>{});}catch{}
  },
  close(){active=false;}
 };
}
module.exports={commandOutput,LIMIT};

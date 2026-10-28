const {randomUUID,createHash}=require('node:crypto');
function inputKey(message) {
  return message?.id || createHash('sha256').update(JSON.stringify(message||{})).digest('hex');
}
// A pause/retry continues the same execution. Only a new input after a terminal
// execution starts another one; project files and material ownership never move.
function beginRound(run,task,snapshot) {
  const messages=task.messages||[{role:'user',content:task.request}];
  const index=messages.findLastIndex(m=>m.role==='user');
  const trigger=inputKey(messages[index]);
  const terminal=['completed','idle'].includes(run.status);
  const newInput=run.inputKey ? run.inputKey!==trigger : messages.at(-1)?.role==='user';
  run.history ||= [];
  if(newInput&&!terminal&&run.delivery?.status==='settled'){
    const anchor=messages.slice(0,index).findLast(m=>m.role==='assistant');
    if(anchor&&!run.history.some(r=>r.afterMessageId===anchor.id))run.history.push({...structuredClone(snapshot(run)),history:undefined,afterMessageId:anchor.id});
  }
  if(newInput && (terminal || task.editedInputId===trigger)) {
    if(run.mode==='task' || run.loadedExtensions?.length) {
      const anchor=messages.slice(0,index).findLast(m=>m.role==='assistant');
      run.history.push({...snapshot(run),history:undefined,afterMessageId:anchor?.id});
    }
    Object.assign(run,{loadedExtensions:[],progressInputId:undefined,executionId:randomUUID(),status:'understanding',mode:'chat',goal:'',steps:[],decisions:[],acceptance:[],events:[],observations:[],observationIndex:[],checkpointObservationCount:0,actionsSincePlan:0,inFlight:undefined,contextUsage:undefined,question:undefined,requirements:undefined,requirementsManaged:undefined,issues:[],executionState:undefined,delivery:undefined,observationStates:{},acceptanceResults:{},acceptanceTypes:[],visualObservations:[],completionReview:undefined,performance:undefined,decisionRecovery:undefined,loopRecovery:undefined,actionJournal:[],pendingArtifactUpdates:[]});
    run.visualComparisons=[];
    run.designRegionIssues={};run.designRegionReviews={};
    run.progressEvidence=[];
    run.executionInputStart=index;
    run.unresolvedFailureStreak=0;
    run.validationRepairs={};delete run.toolRecovery;
    run.loopEpisodes=[];delete run.failureEpisodes;delete run.taskState;delete run.segmentState;delete run.interventionTracking;delete run.runtimeContinuation;
    run.readAttempts=[];delete run.readReceipts;delete run.contextArchives;delete run.visualReplayBoundary;delete run.taskContinuation;delete run.waitingError;
    delete run.androidCheck;delete run.resultRecovery;delete run.visualAnalysisFailures;delete run.optionalContextFailures;delete run.extensionPreparationFailure;
    if(task.editedInputId===trigger)run.workingMemory='';
  }
  run.executionId ||= randomUUID();
  run.inputKey=trigger;
  run.currentRequest=messages[index]?.content||task.request||'';
}
module.exports={beginRound,inputKey};

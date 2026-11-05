const {randomUUID,createHash}=require('node:crypto');
function inputKey(message) {
  return message?.id || createHash('sha256').update(JSON.stringify(message||{})).digest('hex');
}
// A pause/retry continues the same execution. Only a new input after a terminal
// execution starts another one; project files and material ownership never move.
function beginRound(run,task,snapshot,{inputOverride,relationOverride,forceCurrentInput=false}={}) {
  require('./recovery-state.cjs').bind(run);
  const messages=task.messages||[{role:'user',content:task.request}];
  let index=inputOverride?messages.findIndex(m=>m===inputOverride||m.id&&m.id===inputOverride.id):forceCurrentInput?messages.findLastIndex(m=>m.role==='user'&&inputKey(m)===run.inputKey):messages.findLastIndex(m=>m.role==='user');
  if(index<0)index=messages.findLastIndex(m=>m.role==='user');
  if(!inputOverride&&messages[index]?.id&&run.acceptedInputIds?.includes(messages[index].id)&&run.inputKey&&run.inputKey!==messages[index].id){const active=messages.findIndex(m=>m.id===run.inputKey);if(active>=0)index=active;}
  if(!inputOverride&&run.pendingTaskChange?.inputId&&require('./input-turn.cjs').continuationOnly(messages[index]?.content)&&!messages[index]?.materials?.length){const active=messages.findIndex(m=>m.role==='user'&&inputKey(m)===run.pendingTaskChange.inputId);if(active>=0)index=active;}
  const trigger=inputKey(messages[index]);
  const terminal=['completed','idle'].includes(run.status);
  const newInput=(run.inputKey ? run.inputKey!==trigger : messages.at(-1)?.role==='user')||forceCurrentInput&&relationOverride?.kind==='independent'&&run.requestScope?.kind!=='independent';
  const relation=relationOverride||require('./request-scope.cjs').relation(run,messages[index]);
  const independent=newInput&&relation.kind==='independent';
  const parentExecutionId=run.executionId,parentInputId=run.inputKey,priorJournal=run.actionJournal||[];
  if(newInput&&parentInputId&&relation.kind!=='continuation')require('./request-scope.cjs').suspendRecovery(run,messages[index]);
  if(independent)run.requestArchive=[...(run.requestArchive||[]),{...require('./request-scope.cjs').archive(run),archivedAt:new Date().toISOString(),reason:relation.reason}].slice(-24);
  run.history ||= [];
  if(newInput&&!terminal&&!independent&&run.delivery?.status==='settled'){
    const anchor=messages.slice(0,index).findLast(m=>m.role==='assistant');
    if(anchor&&!run.history.some(r=>r.afterMessageId===anchor.id))run.history.push({...structuredClone(snapshot(run)),history:undefined,afterMessageId:anchor.id});
  }
  if(newInput && (terminal || independent || task.editedInputId===trigger)) {
    if(run.mode==='task' || run.loadedExtensions?.length) {
      const anchor=messages.slice(0,index).findLast(m=>m.role==='assistant');
      run.history.push({...snapshot(run),history:undefined,afterMessageId:anchor?.id});
    }
    const nextExecutionId=randomUUID();require('./recovery-state.cjs').reset(run,nextExecutionId);
    Object.assign(run,{loadedExtensions:[],progressInputId:undefined,executionId:nextExecutionId,status:'understanding',mode:'chat',goal:'',steps:[],decisions:[],acceptance:[],events:[],observations:[],observationIndex:[],checkpointObservationCount:0,actionsSincePlan:0,inFlight:undefined,contextUsage:undefined,question:undefined,requirements:undefined,requirementsManaged:undefined,issues:[],executionState:undefined,delivery:undefined,observationStates:{},acceptanceResults:{},acceptanceTypes:[],visualObservations:[],completionReview:undefined,performance:undefined,decisionRecovery:undefined,loopRecovery:undefined,actionJournal:[],pendingArtifactUpdates:[]});
    delete run.problemState;delete run.inputCoverage;
    run.visualComparisons=[];
    run.designRegionIssues={};run.designRegionReviews={};run.designRegionChecks={};
    run.progressEvidence=[];
    run.executionInputStart=index;
    run.unresolvedFailureStreak=0;
    run.validationRepairs={};require('./recovery-state.cjs').clear(run,'toolRecovery');
    run.loopEpisodes=[];require('./recovery-state.cjs').clear(run,'failureEpisodes');delete run.taskState;require('./recovery-state.cjs').clear(run,'segmentState');delete run.interventionTracking;delete run.runtimeContinuation;
    run.readAttempts=[];delete run.readReceipts;delete run.contextArchives;delete run.visualReplayBoundary;delete run.taskContinuation;delete run.waitingError;
    delete run.androidCheck;require('./recovery-state.cjs').clear(run,'resultRecovery');delete run.visualAnalysisFailures;delete run.optionalContextFailures;delete run.extensionPreparationFailure;delete run.pendingTaskChange;
    if(independent){delete run.resultPreview;run.artifacts=[];run.workingMemory='';run.fileReadMemory=[];run.sourceFragments=[];run.readCoverage=[];delete run.acceptanceInputKey;delete run.materialInput;delete run.androidDesignSourceBaseline;delete run.visualQuality;delete run.htmlDocumentChecks;delete run.inputTurn;require('./recovery-state.cjs').clear(run,'repairValue');run.actionJournal=priorJournal;}
    if(task.editedInputId===trigger)run.workingMemory='';
  }
  run.executionId ||= randomUUID();
  require('./recovery-state.cjs').setExecution(run,run.executionId);
  if(newInput)run.requestScope={...relation,inputId:trigger,parentInputId,parentExecutionId,executionId:run.executionId,startedAt:new Date().toISOString()};
  run.inputKey=trigger;
  run.currentRequest=messages[index]?.content||task.request||'';
}
module.exports={beginRound,inputKey};

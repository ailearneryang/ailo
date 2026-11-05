// An offline plan and strict comparison over the existing schema-v2 trials.
// This module never reads API credentials, calls models, or executes tools.
const fs=require('node:fs/promises'),path=require('node:path');
const config=require('./agent-eval-config.cjs'),catalog=require('./agent-eval-quality-cases.cjs');
function publicSelection(input){
 return require('./agent-eval-reference.cjs').publicSelection(input);
}
function fixedConfiguration(options,model,cases){return config.configuration({suite:'net-gain',stratum:'cold',...options,concurrency:1},model,cases);}
async function plan({model,baselineSource,candidateSource,repeats=3,timeoutMs=180000,reasoningEffort='medium'}={}){
 if(!Number.isSafeInteger(repeats)||repeats<1||repeats>10||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>1200000||!['none','minimal','low','medium','high','xhigh'].includes(reasoningEffort))throw Error('Invalid paired evaluation budget');
 const selected=publicSelection(model),cases=catalog.selectedCases(),runnable=catalog.runnableCases(),blockers=[];
 if(!selected)blockers.push('explicit_model_metadata_missing');
 const runtime={};for(const [version,source]of Object.entries({baseline:baselineSource,candidate:candidateSource})){if(!source){blockers.push(version+'_frozen_source_missing');continue;}runtime[version]={source:path.resolve(source),runtimeFingerprint:await config.fingerprint(path.resolve(source))};}
 const options={repeats,timeoutMs,reasoningEffort},configuration=selected?fixedConfiguration(options,selected,runnable):null;
 const batches=[];for(let repeat=1;repeat<=repeats;repeat++)for(const version of repeat%2?['baseline','candidate']:['candidate','baseline'])batches.push({sequence:batches.length+1,repeat,version,cases:runnable.map(c=>c.id),argv:['scripts/agent-live-eval.cjs','--suite','net-gain','--version',version,'--repeats',String(repeats),'--trial-repeat',String(repeat),'--concurrency','1','--timeout-ms',String(timeoutMs),'--reasoning-effort',reasoningEffort,...(selected?['--model-id',selected.id]:[]),...(runtime[version]?['--source-root',runtime[version].source]:[]),'--output','<new-isolated-experiment>']});
 const missing=cases.filter(c=>!require('./agent-eval-scenarios.cjs').supports(c));
 const ablations=[{mechanism:'candidate-preservation',requiredAcceptance:'unchanged',source:runtime.candidate,configuration:configuration?config.configuration({suite:'net-gain',stratum:'cold',...options,concurrency:1,ablation:'candidate-preservation'},selected,runnable):null,batches:Array.from({length:repeats},(_,i)=>({repeat:i+1,order:i%2?['ablation','control']:['control','ablation'],argv:['scripts/agent-live-eval.cjs','--suite','net-gain','--version','candidate','--ablation','candidate-preservation','--repeats',String(repeats),'--trial-repeat',String(i+1),'--concurrency','1','--timeout-ms',String(timeoutMs),'--reasoning-effort',reasoningEffort,...(selected?['--model-id',selected.id]:[]),...(runtime.candidate?['--source-root',runtime.candidate.source]:[]),'--output','<new-isolated-ablation-experiment>']}))}];
 const result={schemaVersion:1,kind:'paired_net_gain_plan',status:'not_run',candidateQuality:'offline_only',netGain:'unproven',modelRequests:0,configuration,runtime,readiness:{metadataComplete:blockers.length===0,fullSuiteReady:blockers.length===0&&!missing.length,requiresIndependentEnvironmentEvidence:true,blockers,staticRunnable:cases.filter(c=>!c.adapter).length,dynamicRunnable:cases.filter(c=>c.adapter&&!missing.includes(c)).length,dynamicAdapterMissing:missing.map(c=>({case:c.id,adapter:c.adapter}))},cases:cases.map(({id,category,request,files,outputs,rubric,adapter,scenario,materialFingerprint,environmentFingerprint})=>({id,category,request,files,outputs,rubric,materialFingerprint,environmentFingerprint,execution:{supported:!missing.some(c=>c.id===id),driver:adapter?'isolated_dynamic_scenario_driver':'existing_agent_live_eval',missingAdapter:missing.some(c=>c.id===id)?adapter:null},scenario})),batches,ablations,policy:{requiredAcceptance:'unchanged_in_every_version',environmentFingerprint:'fixed_fixture_constraints_only_actual_host_requires_independent_evidence',externalEffects:'isolated_only_never_shadow_real_writes',humanReview:'required_for_quality_claim',elapsed:'include_failed_trials_and_setup',redLines:['false_completion','unknown_side_effect_replay'],releaseGate:{minimumPairs:24,minimumRepeats:3,maxTimeRatio:1.10,maxRequestRatio:1.10,pairedOneSidedP:0.05,perCaseRegressionAllowed:false,visualCalibrationRequired:true},interpretation:'Short paired trials screen mechanisms; a pilot gain is not population improvement.'},notice:'离线计划未执行真实模型或任务。八类场景均有隔离适配；必要视觉验收保持。环境哈希是固定约束，实际宿主一致性、人工验收与视觉校准仍须真实证据。缺样本或来源不一致时不宣称净收益。'};
 return {...result,planFingerprint:config.hash(result)};
}
const median=values=>{const list=values.filter(Number.isFinite).sort((a,b)=>a-b);return !list.length?null:list.length%2?list[Math.floor(list.length/2)]:(list[list.length/2-1]+list[list.length/2])/2;};
function compare(plan,report,{hardGuardEvidence}={}){
 const result={schemaVersion:1,kind:'paired_net_gain_comparison',status:'not_run',candidateQuality:'offline_only',netGain:'unproven',pairs:0,metrics:null,reasons:[]};
 const {planFingerprint,...frozen}=plan||{};if(!planFingerprint||config.hash(frozen)!==planFingerprint)throw Error('Frozen plan changed; regenerate in a new experiment');
 if(!plan?.configuration){result.reasons.push('explicit_frozen_configuration_missing');return result;}
 if(!report?.trials?.length){result.reasons.push('no_real_trials');return result;}
 const expected=plan.configuration;
 if(report.schemaVersion!==2||report.configurationFingerprint!==expected.configurationFingerprint||report.modelConfigurationFingerprint!==expected.model.configurationFingerprint||report.evaluationPurpose==='bounded_diagnostic')throw Error('Comparison requires the identical non-diagnostic model, input, rubric and environment configuration');
 if(report.trials.some(t=>t.version==='candidate'&&t.falseCompletion)||hardGuardEvidence?.unknownSideEffectReplay?.violations>0||hardGuardEvidence?.requiredAcceptancePreserved?.violations>0){result.status='rejected';result.netGain='rejected';result.reasons.push('safety_or_false_completion_red_line');return result;}
 const tasks=expected.cases.flatMap(c=>Array.from({length:expected.repeats},(_,i)=>({id:c.id,repeat:i+1}))),byKey=new Map();
 for(const t of report.trials){const key=JSON.stringify([t.version,t.case,t.repeat]);if(!['baseline','candidate'].includes(t.version)||!tasks.some(j=>j.id===t.case&&j.repeat===t.repeat)||byKey.has(key))throw Error('Comparison contains duplicate, unexpected or mixed trials');byKey.set(key,t);}
 const pairs=[];for(const task of tasks){const a=byKey.get(JSON.stringify(['baseline',task.id,task.repeat])),b=byKey.get(JSON.stringify(['candidate',task.id,task.repeat]));if(a&&b)pairs.push({baseline:a,candidate:b});}
 result.pairs=pairs.length;
 if(pairs.length!==tasks.length){result.status='incomplete';result.reasons.push('missing_paired_trials');return result;}
 if(!plan.runtime?.baseline?.runtimeFingerprint||!plan.runtime?.candidate?.runtimeFingerprint||pairs.some(p=>Object.entries(p).some(([version,t])=>t.runtimeFingerprint!==plan.runtime[version].runtimeFingerprint))){result.status='inconclusive';result.reasons.push('frozen_runtime_evidence_missing_or_changed');return result;}
 if(pairs.some(p=>Object.values(p).some(t=>t.serviceBlocked))){result.status='inconclusive';result.reasons.push('provider_blocked_trials_not_comparable');return result;}
 if(pairs.some(p=>Object.values(p).some(t=>t.assistedResume||t.boundedDiagnostic||t.stratum!==expected.stratum))){result.status='inconclusive';result.reasons.push('stratum_or_assistance_changed');return result;}
 if(pairs.some(p=>Object.values(p).some(t=>t.qualityPending||!['passed','failed'].includes(t.human)||typeof t.humanVerifiedSuccess!=='boolean'||!Number.isFinite(t.elapsedMs)||t.elapsedMs<0||t.executionInterventions===null||!Number.isSafeInteger(t.executionInterventions)))){result.status='quality_pending';result.reasons.push('quality_or_intervention_evidence_incomplete');return result;}
 const success=t=>t.humanVerifiedSuccess&&t.executionInterventions===0,metrics={};
 for(const version of ['baseline','candidate']){const trials=pairs.map(p=>p[version]);metrics[version]={trials:trials.length,unassistedVerifiedSuccess:trials.filter(success).length,unassistedVerifiedCompletionRate:trials.filter(success).length/trials.length,knownFalseCompletion:trials.filter(t=>t.falseCompletion).length,medianAllTrialMs:median(trials.map(t=>t.elapsedMs)),totalAllTrialMs:trials.reduce((n,t)=>n+t.elapsedMs,0),totalRequests:trials.every(t=>Number.isFinite(t.requests))?trials.reduce((n,t)=>n+t.requests,0):null};}
 result.metrics=metrics;result.candidateQuality='real_trials_observed';result.status='measured';
 const guards=hardGuardEvidence;
 const redLine=metrics.candidate.knownFalseCompletion>0||guards?.unknownSideEffectReplay?.violations>0||guards?.requiredAcceptancePreserved?.violations>0;
 if(redLine){result.status='rejected';result.netGain='rejected';result.reasons.push('safety_or_false_completion_red_line');return result;}
 if(!guards||!['unknownSideEffectReplay','requiredAcceptancePreserved','sameEnvironment'].every(k=>guards[k]?.complete===true&&guards[k]?.violations===0&&typeof guards[k]?.evidenceId==='string'&&guards[k].evidenceId)){result.status='inconclusive';result.reasons.push('independent_safety_acceptance_or_environment_evidence_missing');return result;}
 result.candidateQuality='real_full_suite_measured';
 const better=metrics.candidate.unassistedVerifiedSuccess>metrics.baseline.unassistedVerifiedSuccess,worse=metrics.candidate.unassistedVerifiedSuccess<metrics.baseline.unassistedVerifiedSuccess;
 result.observedStaticSubset=better?'more_verified_success':worse?'fewer_verified_success':'same_verified_success';
 if(worse){result.netGain='regression';result.status='rejected';result.reasons.push('verified_completion_regressed');return result;}
 const dynamicIds=new Set(catalog.selectedCases().filter(c=>c.adapter).map(c=>c.id));
 if(pairs.some(p=>Object.values(p).some(t=>dynamicIds.has(t.case)&&t.scenarioValidated!==true))){result.status='inconclusive';result.reasons.push('dynamic_trigger_or_recovery_proof_missing');return result;}
 if(pairs.some(p=>Object.values(p).some(t=>!t.reviewFingerprint))){result.status='quality_pending';result.reasons.push('independent_review_provenance_missing');return result;}
 const byCase=expected.cases.map(c=>({case:c.id,baseline:pairs.filter(p=>p.baseline.case===c.id&&success(p.baseline)).length,candidate:pairs.filter(p=>p.candidate.case===c.id&&success(p.candidate)).length}));result.byCase=byCase;
 if(byCase.some(c=>c.candidate<c.baseline)){result.netGain='regression';result.status='rejected';result.reasons.push('individual_scenario_regressed');return result;}
 const minimum=plan.policy.releaseGate;
 if(!plan.readiness.fullSuiteReady||pairs.length<minimum.minimumPairs||expected.repeats<minimum.minimumRepeats){result.reasons.push('complete_fixed_suite_or_minimum_repeats_missing');return result;}
 const calibration=guards.visualCalibration;
 if(!calibration||calibration.complete!==true||!calibration.evidenceId||calibration.result?.status!=='measured'||calibration.result.imageEvidence?.verified!==true||calibration.result.predictionEvidence?.verified!==true||calibration.result.counts?.falseBlock!==0||calibration.result.counts?.falseClose!==0||calibration.result.metrics?.precision!==1||calibration.result.metrics?.recall!==1){result.status='inconclusive';result.reasons.push('verified_visual_calibration_missing_or_failed');return result;}
 const calibrated=calibration.result.counts;
 if(!(calibrated.truePositive>=3&&calibrated.trueNegative>=3&&calibrated.uncertainCorrect>=2)){result.status='inconclusive';result.reasons.push('visual_calibration_class_coverage_missing');return result;}
 const wins=pairs.filter(p=>success(p.candidate)&&!success(p.baseline)).length,losses=pairs.filter(p=>!success(p.candidate)&&success(p.baseline)).length,p=pairedP(wins,losses);result.pairedEvidence={wins,losses,oneSidedP:p};
 const timeRatio=metrics.candidate.totalAllTrialMs/Math.max(1,metrics.baseline.totalAllTrialMs),requestRatio=metrics.baseline.totalRequests===null||metrics.candidate.totalRequests===null?null:metrics.candidate.totalRequests/Math.max(1,metrics.baseline.totalRequests);result.costRatios={allTrialTime:timeRatio,requests:requestRatio};
 if(!better||p>minimum.pairedOneSidedP){result.reasons.push('paired_gain_not_yet_supported');return result;}
 if(timeRatio>minimum.maxTimeRatio||requestRatio===null||requestRatio>minimum.maxRequestRatio){result.status='inconclusive';result.reasons.push('gain_exceeded_frozen_time_or_request_budget');return result;}
 result.status='passed';result.netGain='pilot_gain_verified';result.reasons.push('fixed_suite_gain_only_not_population_claim');
 return result;
}
function pairedP(wins,losses){const n=wins+losses;if(!n)return 1;let term=2**(-n),sum=0;for(let k=0;k<=n;k++){if(k>=wins)sum+=term;term=term*(n-k)/(k+1);}return Math.min(1,sum);}
function compareAblation(plan,control,ablated,{hardGuardEvidence}={}){
 const feature=plan.ablations?.find(a=>a.mechanism===ablated?.ablation?.mechanism),result={kind:'optional_mechanism_ablation',status:'inconclusive',mechanism:feature?.mechanism||null,requiredAcceptance:'unchanged'};
 if(!feature||control?.configurationFingerprint!==plan.configuration?.configurationFingerprint||ablated.configurationFingerprint!==feature.configuration?.configurationFingerprint||control.modelConfigurationFingerprint!==ablated.modelConfigurationFingerprint)return {...result,reason:'same_frozen_input_model_and_ablation_provenance_required'};
 const a=control.trials.filter(t=>t.version==='candidate'),b=ablated.trials.filter(t=>t.version==='candidate'),expected=plan.configuration.cases.length*plan.configuration.repeats;
 if(a.length!==expected||b.length!==expected||[...a,...b].some(t=>t.runtimeFingerprint!==plan.runtime.candidate.runtimeFingerprint||t.qualityPending||!t.reviewFingerprint||!['passed','failed'].includes(t.human)||t.executionInterventions===null))return {...result,reason:'full_independently_reviewed_same_runtime_pairs_required'};
 if(!hardGuardEvidence?.requiredAcceptancePreserved?.complete||hardGuardEvidence.requiredAcceptancePreserved.violations!==0||!hardGuardEvidence?.unknownSideEffectReplay?.complete||hardGuardEvidence.unknownSideEffectReplay.violations!==0||a.some(t=>t.falseCompletion)||b.some(t=>t.falseCompletion))return {...result,status:'rejected',reason:'safety_and_original_acceptance_required'};
 const count=list=>list.filter(t=>t.humanVerifiedSuccess&&t.executionInterventions===0).length;
 return {...result,status:'measured',control:{verifiedSuccess:count(a),elapsedMs:a.reduce((n,t)=>n+t.elapsedMs,0),requests:a.reduce((n,t)=>n+(t.requests||0),0)},ablated:{verifiedSuccess:count(b),elapsedMs:b.reduce((n,t)=>n+t.elapsedMs,0),requests:b.reduce((n,t)=>n+(t.requests||0),0)},recommendation:count(a)>count(b)?'retain_with_measured_benefit':count(a)<count(b)?'investigate_mechanism_regression':'no_completion_benefit_observed'};
}
async function main(argv=process.argv.slice(2)){
 const names={'--output':'output','--reference-config':'reference','--baseline-source':'baselineSource','--candidate-source':'candidateSource','--repeats':'repeats','--timeout-ms':'timeoutMs','--reasoning-effort':'reasoningEffort','--report':'report'};const options={};
 for(let i=0;i<argv.length;i++){const key=names[argv[i]];if(!key||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Unknown or missing plan option: '+argv[i]);options[key]=argv[++i];}
 if(!options.output)throw Error('Use --output with a new isolated plan directory');
 const directory=path.resolve(options.output);try{if((await fs.readdir(directory)).length)throw Error('Plan output must be empty; historical results are never overwritten');}catch(e){if(e.code!=='ENOENT')throw e;}
 const p=await plan({...options,model:options.reference?JSON.parse(await fs.readFile(options.reference,'utf8')):undefined,...(options.repeats?{repeats:Number(options.repeats)}:{}),...(options.timeoutMs?{timeoutMs:Number(options.timeoutMs)}:{})});
 await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.writeFile(path.join(directory,'plan.json'),JSON.stringify(p,null,2),{flag:'wx',mode:0o600});await fs.writeFile(path.join(directory,'visual-calibration.json'),JSON.stringify(require('./agent-eval-visual-calibration.cjs').template(),null,2),{flag:'wx',mode:0o600});
 if(options.report){const comparison=compare(p,JSON.parse(await fs.readFile(options.report,'utf8')));await fs.writeFile(path.join(directory,'comparison.json'),JSON.stringify(comparison,null,2),{flag:'wx',mode:0o600});}
 console.log(JSON.stringify({status:p.status,candidateQuality:p.candidateQuality,netGain:p.netGain,modelRequests:0,cases:p.cases.length,staticRunnable:p.readiness.staticRunnable,dynamicAdapterMissing:p.readiness.dynamicAdapterMissing.length,blockers:p.readiness.blockers,plan:path.join(directory,'plan.json')}));return p;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={plan,compare,compareAblation,pairedP,publicSelection,fixedConfiguration,median,main};

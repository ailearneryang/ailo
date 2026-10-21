// Finish independent grading as live trials arrive, without touching their
// in-flight workspaces. Stops after the complete matrix has been graded.
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {cases}=require('./agent-eval-cases.cjs');
const {serviceFailure}=require('./agent-eval-service.cjs');
const electron=process.argv[2],directory=path.resolve(process.argv[3]||'.local/evals/iteration-20261020');
if(!electron){console.error('Usage: node scripts/agent-eval-watch.cjs <electron-binary> [results-directory]');process.exit(1);}
const run=(binary,args)=>new Promise((resolve,reject)=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(binary,args,{stdio:'inherit',env});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Evaluator exited '+code)));});
(async()=>{for(;;){
 let count=0,pending=0,blocked=0;
 for(const version of ['baseline','candidate'])for(const fixture of cases)for(let repeat=1;repeat<=3;repeat++)try{const result=JSON.parse(await fs.readFile(path.join(directory,version,fixture.id+'-'+repeat,'result.json'),'utf8'));count++;if(result.error){let requests=[];try{requests=JSON.parse(await fs.readFile(path.join(directory,version,fixture.id+'-'+repeat,'requests.json'),'utf8'));}catch{}if(serviceFailure(requests,result.error))blocked++;}if(result.externalChecksVersion!==2)pending++;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(pending){await run(electron,[path.join(__dirname,'agent-eval-grade.cjs'),directory]);await run(process.execPath,[path.join(__dirname,'agent-eval-report.cjs'),directory]);}
 console.log(new Date().toISOString(),'trial records',count,'of',cases.length*6);
 if(blocked){console.log('SERVICE BLOCKED:',blocked,'trials; restore service and use --retry-service');break;}
 if(count===cases.length*6)break;
 await new Promise(r=>setTimeout(r,45000));
}})().catch(e=>{console.error(e.message);process.exitCode=1;});

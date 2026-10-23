const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {cases}=require('./reliability-cases.cjs'),quality=require('./release-quality.cjs');
const root=path.resolve(__dirname,'..');
async function main(){
 const host=process.argv.includes('--host'),selected=cases.filter(c=>host||!c.host);
 if(process.argv.some(a=>a==='--help')){console.log('node scripts/reliability-gate.cjs [--host]\n离线故障回归；--host 额外验证 macOS 宿主沙箱。不会调用公司模型、操作用户任务或启动真实模拟器。');return;}
 const testFiles=[...new Set(selected.flatMap(c=>c.files))],before=await quality.inputs(root,testFiles),directory=path.join(root,'.local/quality');
 await fs.mkdir(directory,{recursive:true});
 // Invalidate an earlier green report before starting a new check.
 const report={schemaVersion:1,startedAt:new Date().toISOString(),passed:false,host,testFiles,cases:selected.map(({id,incident})=>({id,incident})),fingerprint:before.fingerprint,notice:'这是离线工程回归，不是公司模型实际任务完成率或人工质量验收。跳过用例不视为通过。'};
 const target=path.join(directory,'reliability-latest.json');await fs.writeFile(target,JSON.stringify(report,null,2));
 console.log('可靠性回归：'+selected.map(c=>c.id).join('、'));
 const child=spawn(process.execPath,['--test','--test-reporter=tap',...testFiles],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});let output='';
 const capture=data=>{output+=data.toString();};child.stdout.on('data',capture);child.stderr.on('data',capture);
 const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 await fs.writeFile(path.join(directory,'reliability-latest.tap'),output);
 const after=await quality.inputs(root,testFiles),result=quality.assess(exitCode,output);
 Object.assign(report,result,{exitCode,finishedAt:new Date().toISOString(),passed:result.passed&&before.fingerprint===after.fingerprint});
 report.failures=output.split('\n').filter(line=>line.startsWith('not ok '));
 if(before.fingerprint!==after.fingerprint)report.error='回归期间源码或用例发生变化，结果作废';
 await fs.writeFile(target,JSON.stringify(report,null,2));
 const history=path.join(directory,'history');await fs.mkdir(history,{recursive:true});
 const name=Date.now()+'-'+process.pid+'-'+report.fingerprint.slice(0,12);
 await fs.writeFile(path.join(history,name+'.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(history,name+'.tap'),output);
 console.log(JSON.stringify({passed:report.passed,counts:report.counts,report:target,fingerprint:report.fingerprint.slice(0,12)}));
 if(!report.passed){console.error(output.split('\n').filter(line=>/^(not ok|# (tests|pass|fail|cancelled|skipped|todo) )/.test(line)).join('\n'));console.error('完整诊断：'+path.join(directory,'reliability-latest.tap'));process.exitCode=1;}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};

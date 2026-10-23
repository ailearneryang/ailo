const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const digest=value=>createHash('sha256').update(value).digest('hex');
async function runtimeFiles(root){
 const base=path.join(root,'apps/desktop'),code=n=>/\.(cjs|mjs)$/.test(n);
 return [...(await fs.readdir(base)).filter(n=>code(n)&&!['forge.config.cjs','vite.config.mjs'].includes(n)).map(n=>'apps/desktop/'+n),...(await fs.readdir(path.join(base,'agent'))).filter(code).map(n=>'apps/desktop/agent/'+n)].sort();
}
async function inputs(root,files){
 const names=[...new Set([...(await runtimeFiles(root)),...files,'package.json','apps/desktop/package.json','apps/desktop/package-lock.json','apps/desktop/forge.config.cjs','scripts/reliability-cases.cjs','scripts/reliability-gate.cjs','scripts/release-quality.cjs','scripts/agent-eval-report.cjs','scripts/agent-eval-service.cjs'])].sort();
 const sources=await Promise.all(names.map(async name=>({path:name,sha256:digest(await fs.readFile(path.join(root,name)))})));
 return {fingerprint:digest(JSON.stringify(sources)),sources};
}
function assess(exitCode,text){
 const read=key=>{const match=text.match(new RegExp('^# '+key+' (\\d+)$','m'));return match?Number(match[1]):null;};
 const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>[k,read(k)]));
 return {counts,passed:exitCode===0&&counts.tests>0&&counts.pass===counts.tests&&['fail','cancelled','skipped','todo'].every(k=>counts[k]===0)};
}
function assertGate(report,current){
 if(report?.schemaVersion!==1||!report.passed)throw Error('可靠性回归未全部通过，不能生成交付包；失败、跳过、未执行均不算通过');
 if(report.fingerprint!==current.fingerprint)throw Error('源码或回归用例在检查后发生变化，请重新运行可靠性回归再打包');
}
async function assertPacked(root,output,platform){
 const report=JSON.parse(await fs.readFile(path.join(root,'.local/quality/reliability-latest.json'),'utf8'));
 const current=await inputs(root,report.testFiles);assertGate(report,current);
 const bundle=platform==='darwin'?path.join(output,'Ailo.app/Contents/Resources/app.asar'):path.join(output,'resources/app.asar');
 const asar=require(path.join(root,'apps/desktop/node_modules/@electron/asar'));
 for(const file of await runtimeFiles(root)){
  const expected=await fs.readFile(path.join(root,file)),packed=asar.extractFile(bundle,file.replace('apps/desktop/',''));
  if(!expected.equals(packed))throw Error('打包后的运行时代码与已测试源码不一致：'+file);
 }
 return {bundle,fingerprint:current.fingerprint};
}
module.exports={inputs,runtimeFiles,assess,assertGate,assertPacked};

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {runCommand,execute}=require('../apps/desktop/agent/tools.cjs');
async function root(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-output-host-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('real isolated command streams stdout and stderr before exit and flushes the final short chunk',async t=>{
 const files=await root(t),snapshots=[];let done=false;
 const result=await execute({files,run:{taskId:'fixture'}},{action:'run_command',command:"printf 'first\\n'; /bin/sleep 0.2; printf 'warning\\n' >&2; /bin/sleep 1.2; printf 'last\\n'"},new AbortController().signal,{onOutput:(output,meta)=>{assert.equal(done,false);snapshots.push({output,...meta});}});done=true;
 assert.equal(result.exitCode,0,result.output);assert.ok(snapshots.length>=2);assert.match(snapshots[0].output,/first/);assert.doesNotMatch(snapshots[0].output,/last/);
 assert.match(snapshots.at(-1).output,/warning[\s\S]*last/);assert.equal(snapshots.at(-1).output,result.output);assert.match(result.stderr,/warning/);
});
test('output observers cannot fail a host command and truncation is explicit',async t=>{
 const files=await root(t);let truncated=false;
 const result=await runCommand(files,"/usr/bin/yes abc | /usr/bin/head -c 26000; printf 'TAIL'",new AbortController().signal,5000,{onOutput:(output,metadata)=>{assert.ok(output.length<=24000);truncated ||= metadata.truncated;throw Error('view closed');}});
 assert.equal(result.exitCode,0,result.output);assert.equal(result.output.length,24000);assert.equal(truncated,true);assert.equal(result.truncated,true);assert.match(result.output,/TAIL$/);
});
test('standard build forwards live output and retains the exact Gradle command',async t=>{
 const files=await root(t),snapshots=[];
 await fs.writeFile(path.join(files,'gradlew'),"printf 'build started\\n'\nsleep 0.2\nprintf 'build checked\\n'\n");
 const result=await require('../apps/desktop/agent/android-build.cjs').buildAndroid(files,{tasks:[':app:lintDebug']},new AbortController().signal,{authorizeBuild:async()=>true,onOutput:output=>snapshots.push(output)});
 assert.equal(result.exitCode,0,result.output);assert.match(result.command,/--console=plain :app:lintDebug$/);assert.match(snapshots[0],/build started/);assert.doesNotMatch(snapshots[0],/build checked/);assert.match(snapshots.at(-1),/build checked/);
});
test('split UTF-8 chunks remain readable in live and final command output',async t=>{
 const files=await root(t),snapshots=[];
 const result=await runCommand(files,"printf '\\344'; /bin/sleep 0.1; printf '\\270\\255\\346\\226\\207'",new AbortController().signal,5000,{onOutput:output=>snapshots.push(output)});
 assert.equal(result.exitCode,0,result.output);assert.equal(result.output,'中文');assert.equal(snapshots.at(-1),'中文');
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createDirectoryAccess}=require('../apps/desktop/agent/directory-access.cjs');
const {runCommand}=require('../apps/desktop/agent/tools.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-access-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
const signal=()=>new AbortController().signal;
test('only user selected directory is granted, scoped to task, cancellation and abort grant nothing',async t=>{
 const dir=await setup(t);let selected=dir;
 const access=createDirectoryAccess({select:async()=>selected});
 const result=await access.request('t',{path:'/Users',purpose:'项目分析'},signal());
 assert.equal(result.path,await fs.realpath(dir));assert.deepEqual(access.directories('other'),[]);
 selected=null;await assert.rejects(access.request('other',{path:dir,purpose:'分析'},signal()),{code:'DIRECTORY_DECLINED'});
 const c=new AbortController();c.abort();await assert.rejects(access.request('other',{path:dir,purpose:'分析'},c.signal),{code:'DIRECTORY_DECLINED'});
 assert.deepEqual(access.directories('other'),[]);
 await assert.rejects(access.request('other',{path:'relative',purpose:'分析'},signal()),/绝对/);
});
test('real command can read granted directory but cannot write it or read ungranted sibling',async t=>{
 if(process.platform!=='darwin')return t.skip('macOS sandbox');
 const base=await setup(t);const work=path.join(base,'work'),external=path.join(base,'external'),other=path.join(base,'other');
 for(const d of [work,external,other])await fs.mkdir(d);
 await fs.writeFile(path.join(external,'data'),'approved-data');await fs.writeFile(path.join(other,'secret'),'unapproved-data');
 const access=createDirectoryAccess({select:async()=>external});await access.request('t',{path:external,purpose:'读取'},signal());
 const opts={readDirectories:access.directories('t')};
 assert.equal((await runCommand(work,`cat '${external}/data'`,signal(),120000,opts)).output,'approved-data');
 const denied=await runCommand(work,`cat '${other}/secret'; touch '${external}/new'`,signal(),120000,opts);
 assert.notEqual(denied.exitCode,0);assert.ok(!denied.output.includes('unapproved-data'));await assert.rejects(fs.access(path.join(external,'new')));
});
test('runner waits for approval and continues automatically; cancellation preserves plan without retry',async t=>{
 const base=await setup(t),states=[];let selected=base;
 const access=createDirectoryAccess({select:async()=>selected});
 const actions=[{action:'route',kind:'task'},{action:'plan',goal:'分析目录',decisions:[],acceptance:['交付整理方案'],steps:[{id:'s1',title:'分析',status:'pending'}]},{action:'request_directory',path:base,purpose:'分析目录'},{action:'pause',text:'读取权限已验证'}];
 const result=await runAgent({base,task:{id:'t',request:'分析目录'},model:{contextWindow:32768},signal:signal(),directoryAccess:access,onRun:r=>states.push(r.status),ask:async()=>({content:JSON.stringify(actions.shift())})});
 assert.ok(states.includes('waiting_permission'));assert.equal(result.agentRun.status,'paused');assert.equal(access.directories('t').length,1);
 selected=null;let n=0;
 const cancelled=await runAgent({base,task:{id:'t',request:'继续'},model:{contextWindow:32768},signal:signal(),directoryAccess:access,ask:async()=>({content:JSON.stringify(n++?{action:'request_directory',path:base,purpose:'继续读取'}:{action:'route',kind:'task'})})});
 assert.equal(n,2);assert.equal(cancelled.agentRun.status,'waiting_permission');assert.equal(cancelled.agentRun.steps[0].id,'s1');
});

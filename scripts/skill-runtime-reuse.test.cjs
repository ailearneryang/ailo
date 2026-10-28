const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const JSZip=require('../apps/desktop/node_modules/jszip');
const {createSkillPackages}=require('../apps/desktop/skill-packages.cjs');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
const {runSegments}=require('../apps/desktop/agent/execution-segments.cjs');
const {execute}=require('../apps/desktop/agent/tools.cjs');
const script='#!/usr/bin/env node\nmodule.exports="original renderer";\n';
async function fixture(t){
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ailo-skill-reuse-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));const packages=path.join(base,'packages'),manager=createSkillPackages(packages),files=path.join(base,'project');await fs.mkdir(files);
 const archive=new JSZip();archive.file('SKILL.md','---\nname: render-fixture\n---\nRead scripts/render.js and use the selected local dependency.');archive.file('scripts/render.js',script,{unixPermissions:0o100755});archive.file('references/guide.txt','original source guidance');
 const item=await manager.importSkill({name:'render.zip',buffer:await archive.generateAsync({type:'nodebuffer',platform:'UNIX'})});
 return {base,packages,manager,item,w:{files},relative:'.runtime/ailo-skills/'+item.package.id};
}
async function dependency(root){const module=path.join(root,'scripts/node_modules/@resvg/resvg-js/index.js');await fs.mkdir(path.dirname(module),{recursive:true});await fs.writeFile(module,'module.exports="dependency retained";');await fs.writeFile(path.join(root,'scripts/package.json'),JSON.stringify({dependencies:{'@resvg/resvg-js':'fixture'}}));await fs.writeFile(path.join(root,'scripts/package-lock.json'),'fixture lock');return module;}
test('unchanged selected skill retains installed dependencies and locks while restoring every original bundled file',async t=>{
 const {manager,item,w,relative}=await fixture(t);await manager.prepare(w,[item]);const root=path.join(w.files,relative),module=await dependency(root);
 await fs.writeFile(path.join(root,'scripts/render.js'),'modified model script');await fs.chmod(path.join(root,'scripts/render.js'),0o600);await fs.writeFile(path.join(root,'references/guide.txt'),'modified guidance');
 await manager.prepare(w,[item]);assert.equal(await fs.readFile(module,'utf8'),'module.exports="dependency retained";');assert.equal(await fs.readFile(path.join(root,'scripts/package-lock.json'),'utf8'),'fixture lock');assert.equal(JSON.parse(await fs.readFile(path.join(root,'scripts/package.json'),'utf8')).dependencies['@resvg/resvg-js'],'fixture');
 assert.equal(await fs.readFile(path.join(root,'scripts/render.js'),'utf8'),script);assert.equal((await fs.stat(path.join(root,'scripts/render.js'))).mode&0o777,0o700);assert.equal(await fs.readFile(path.join(root,'references/guide.txt'),'utf8'),'original source guidance');
});
test('corrupted source packages are rejected before touching either mounted originals or installed dependencies',async t=>{
 const {manager,item,w,relative,packages}=await fixture(t);await manager.prepare(w,[item]);const root=path.join(w.files,relative),module=await dependency(root);await fs.writeFile(path.join(packages,item.package.id,'files/scripts/render.js'),'corrupted original');
 await assert.rejects(manager.prepare(w,[item]),/损坏/);assert.equal(await fs.readFile(path.join(root,'scripts/render.js'),'utf8'),script);assert.equal(await fs.readFile(module,'utf8'),'module.exports="dependency retained";');
});
test('deselecting a skill removes its generated dependencies but leaves a selected package and its dependencies intact',async t=>{
 const {manager,item,w,relative}=await fixture(t);const archive=new JSZip();archive.file('SKILL.md','Second selected fixture');const second=await manager.importSkill({name:'second.zip',buffer:await archive.generateAsync({type:'nodebuffer'})});await manager.prepare(w,[item,second]);const firstRoot=path.join(w.files,relative),firstModule=await dependency(firstRoot),secondRoot=path.join(w.files,'.runtime/ailo-skills',second.package.id);await fs.writeFile(path.join(secondRoot,'generated-extra.txt'),'second extra');
 await manager.prepare(w,[item,{...second,enabled:false}]);assert.equal(await fs.readFile(firstModule,'utf8'),'module.exports="dependency retained";');await assert.rejects(fs.access(secondRoot),{code:'ENOENT'});
 await manager.prepare(w,[{...item,enabled:false}]);assert.deepEqual(await fs.readdir(path.join(w.files,'.runtime/ailo-skills')),['.ailo-owned']);
});
test('mounted selected package and script directory symlinks are rejected without modifying outside files',async t=>{
 for(const location of ['package','scripts']){
  const {manager,item,w,relative,base}=await fixture(t);await manager.prepare(w,[item]);const outside=path.join(base,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'render.js'),'outside sentinel');await fs.writeFile(path.join(outside,'SKILL.md'),'outside skill');
  const redirect=path.join(w.files,relative,location==='scripts'?'scripts':'');await fs.rm(redirect,{recursive:true});await fs.symlink(outside,redirect);await assert.rejects(manager.prepare(w,[item]),/符号链接/);assert.equal(await fs.readFile(path.join(outside,'render.js'),'utf8'),'outside sentinel');assert.equal(await fs.readFile(path.join(outside,'SKILL.md'),'utf8'),'outside skill');
 }
});
test('unselected symlinks are removed without following their targets and ownership markers remain mandatory',async t=>{
 const {manager,item,w,base}=await fixture(t);await manager.prepare(w,[item]);const mount=path.join(w.files,'.runtime/ailo-skills'),outside=path.join(base,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'sentinel'),'must remain');await fs.symlink(outside,path.join(mount,'unselected-link'));
 await manager.prepare(w,[item]);assert.equal(await fs.readFile(path.join(outside,'sentinel'),'utf8'),'must remain');await assert.rejects(fs.lstat(path.join(mount,'unselected-link')),{code:'ENOENT'});
 await fs.unlink(path.join(mount,'.ailo-owned'));await fs.writeFile(path.join(mount,'user-file'),'preserve');await assert.rejects(manager.prepare(w,[item]),/冲突/);assert.equal(await fs.readFile(path.join(mount,'user-file'),'utf8'),'preserve');
});
test('automatic execution segments preserve the skill dependency without trusting a modified renderer script',async t=>{
 const {base,manager,item,relative}=await fixture(t),task={id:'segments',request:'使用已选技能生成天气说明'},agentBase=path.join(base,'agent'),w=await createWorkspace(agentBase,task);let calls=0,installations=0,secondSegmentObserved=false;
 const plan={action:'plan',goal:task.request,decisions:[],requirements:[{id:'weather',text:'天气说明包含完整标题',type:'content'}],steps:[{id:'s',title:'生成并验收说明',status:'running'}]};
 const actions=[{action:'route',kind:'task'},plan,{action:'read_file',path:relative+'/scripts/render.js'},{action:'run_command',command:'fixture dependency installation',purpose:'准备技能依赖'},{action:'write_file',path:'weather.txt',content:'完整天气标题'},{action:'artifact',path:'weather.txt',label:'天气说明'},{action:'verify',checks:[{criterionId:'weather',kind:'text_contains',path:'weather.txt',contains:['完整天气标题'],reason:'核对实际输出包含原要求标题'}],progress:{steps:[{id:'s',status:'done'}]}},{action:'finish',text:'天气说明已交付',review:{summary:'技能依赖跨片段保留，当前文件内容已按原要求核验',issues:[],unverified:[]}}];
 const signal=new AbortController().signal;
 const result=await runSegments(segment=>runAgent({...segment,base:agentBase,task,model:{contextWindow:128000},signal,extensions:[item],skillPackages:manager,
  ask:async()=>{if(calls===4){secondSegmentObserved=true;assert.equal(await fs.readFile(path.join(w.files,relative,'scripts/node_modules/@resvg/resvg-js/index.js'),'utf8'),'module.exports="dependency retained";');assert.equal(await fs.readFile(path.join(w.files,relative,'scripts/render.js'),'utf8'),script);}return {content:JSON.stringify(actions[calls++])};},
  executeTool:async(workspace,action,...rest)=>{if(action.action==='run_command'){installations++;await dependency(path.join(workspace.files,relative));await fs.writeFile(path.join(workspace.files,relative,'scripts/render.js'),'modified while installing');return {exitCode:0,output:'fixture dependency prepared'};}return execute(workspace,action,...rest);}}),{signal,policy:{segmentSteps:4,segmentDurationMs:60000,maxSegments:3,maxTotalDurationMs:180000}});
 assert.equal(result.agentRun.status,'completed');assert.equal(installations,1);assert.equal(secondSegmentObserved,true);assert.equal(result.agentRun.performance.automaticContinuations,1);assert.equal(calls,8);
});

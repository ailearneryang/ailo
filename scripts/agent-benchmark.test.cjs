const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const config=require('./agent-eval-config.cjs'),weather=require('./weather-benchmark.cjs');
const model={id:'selected-company-model',name:'GLM-5.2',model:'glm-5.2',baseUrl:'https://private-provider.example/v1',apiKey:'never-log-this-key',encryptedKey:'never-log-this-cipher',contextWindow:1048576,maxOutputTokens:131072,imageInput:'auto'};
const selected=['--model-id',model.id,'--output','/tmp/new-experiment'];
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-benchmark-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function materialFixture(t){const root=await temp(t),materials=path.join(root,'private-materials'),environment=path.join(root,'independent-environment');await fs.mkdir(materials);const manifest={id:'weather-app-e2e-v1',materials:[{path:'requirements.md',role:'requirements'},{path:'api.md',role:'api'},{path:'weather.sketch',role:'design'}]};for(const file of manifest.materials)await fs.writeFile(path.join(materials,file.path),file.role==='design'?'PK\x03\x04test-sketch-fixture':'private example material');await fs.writeFile(path.join(materials,'benchmark.json'),JSON.stringify(manifest));return {root,materials,environment,manifest};}
test('the frozen runtime fingerprint includes response parsing and other root runtime modules',async t=>{
 const source=await temp(t),desktop=path.join(source,'apps/desktop');await fs.mkdir(path.join(desktop,'agent'),{recursive:true});await fs.writeFile(path.join(desktop,'package.json'),'{}');await fs.writeFile(path.join(desktop,'chat.cjs'),'module.exports={}');await fs.writeFile(path.join(desktop,'chat-response.cjs'),'module.exports={parse:1}');await fs.writeFile(path.join(desktop,'agent/runner.cjs'),'module.exports={}');
 const before=await config.fingerprint(source);await fs.writeFile(path.join(desktop,'chat-response.cjs'),'module.exports={parse:2}');assert.notEqual(await config.fingerprint(source),before);
});
test('the exact original request and a bounded 30MB Sketch are frozen without weakening acceptance',async t=>{
 const f=await materialFixture(t),file=path.join(f.materials,'weather.sketch');await fs.truncate(file,30*1024*1024);
 f.manifest.request='按原始要求接入真实数据，保留指定车机横屏和原稿组件';await fs.writeFile(path.join(f.materials,'benchmark.json'),JSON.stringify(f.manifest));
 const first=await weather.fixture(f.materials,f.environment);assert.equal(first.request,f.manifest.request);assert.equal(first.privateMaterials.find(m=>m.role==='design').size,30*1024*1024);assert.deepEqual(first.rubric,[...weather.spec.rubric]);
 f.manifest.request+='，不得省略搜索';await fs.writeFile(path.join(f.materials,'benchmark.json'),JSON.stringify(f.manifest));assert.notEqual((await weather.fixture(f.materials,f.environment)).materialFingerprint,first.materialFingerprint);
 await fs.truncate(file,101*1024*1024);await assert.rejects(weather.fixture(f.materials,f.environment),/bounded size/);
});
test('model, output and baseline runtime selection are explicit; repetitions, limits and concurrency are bounded',()=>{
 assert.throws(()=>config.args([],{}),/exact configured model/);assert.throws(()=>config.args(['--model-id','x'],{}),/--output/);
 assert.throws(()=>config.args(['baseline',...selected],{}),/--source-root/);
 const a=config.args(['baseline','7','web-normal',...selected,'--source-root','/tmp/frozen','--concurrency','2','--timeout-ms','3600000'],{});assert.equal(a.repeats,7);assert.equal(a.filter,'web-normal');assert.equal(a.concurrency,2);assert.equal(a.timeoutMs,3600000);
 for(const argv of [['--repeats','0'],['--concurrency','9'],['--timeout-ms','NaN'],['--repeats','1.5'],['--unknown','x']])assert.throws(()=>config.args([...selected,...argv],{}));
 assert.throws(()=>config.args([...selected,'--suite','weather','--materials-dir','/tmp/a','--environment-dir','/tmp/b','--concurrency','2'],{}),/concurrency=1/);
});
test('public configuration fingerprints preserve the chosen model without storing endpoints, tokens, request bodies or private material',()=>{
 const options=config.args(selected,{}),c=config.configuration(options,model,[{id:'weather',request:'private-body-secret',rubric:['fixed-rubric'],materialFingerprint:'abc'}]);const text=JSON.stringify(c);
 for(const secret of [model.baseUrl,model.apiKey,model.encryptedKey,'private-body-secret'])assert.ok(!text.includes(secret));
 assert.equal(c.model.model,'glm-5.2');assert.equal(c.model.contextWindow,1048576);assert.match(c.model.endpointFingerprint,/^[a-f0-9]{64}$/);
 assert.notEqual(config.publicModel({...model,baseUrl:'https://another-provider.example/v1'}).configurationFingerprint,c.model.configurationFingerprint);
 assert.notEqual(config.configuration({...options,stratum:'warm'},model,[]).configurationFingerprint,config.configuration(options,model,[]).configurationFingerprint);
});
test('preflight configuration reads do not create output files; historical or different-model experiments cannot mix',async t=>{
 const root=await temp(t),directory=path.join(root,'new'),options=config.args([...selected,'--output',directory],{}),c=config.configuration(options,model,[]);
 await config.assertConfiguration(directory,c);await assert.rejects(fs.stat(directory),e=>e.code==='ENOENT');
 await config.assertConfiguration(directory,c,{write:true});await config.assertConfiguration(directory,c,{write:true});
 await assert.rejects(config.assertConfiguration(directory,config.configuration(options,{...model,model:'glm-5.3-flash'},[])),/differs|historical/);
 const historical=path.join(root,'historical');await fs.mkdir(historical);await fs.writeFile(path.join(historical,'configuration.json'),JSON.stringify({model:'glm-5.3-flash'}));await assert.rejects(config.assertConfiguration(historical,c,{write:true}),/historical/);assert.deepEqual(JSON.parse(await fs.readFile(path.join(historical,'configuration.json'))),{model:'glm-5.3-flash'});
});
test('interventions are unknown for old or incomplete data; only explicit user continuations and real steering count',()=>{
 assert.deepEqual(config.interventions({}),{executionInterventions:null,userContinuations:null,resumeOutcome:'not_measured'});
 assert.equal(config.interventions({interventionEvidence:{complete:false,events:[]}}).executionInterventions,null);
 const events=[{id:'auto',type:'batch_continue'},{id:'init',type:'intent'},{id:'not-user',type:'user_resume',origin:'automatic'},{id:'resume',type:'user_continuation',origin:'user'},{id:'resume',type:'user_continuation',origin:'user'},{id:'steer',type:'steering'}];
 assert.deepEqual(config.interventions({interventionEvidence:{complete:true,events},result:{agentRun:{status:'blocked'}}}),{executionInterventions:2,userContinuations:1,resumeOutcome:'not_completed_after_resume'});
 assert.equal(config.interventions({interventionEvidence:{complete:true,events:[]}}).executionInterventions,0);
 assert.equal(config.interventions({interventionEvidence:{complete:true,events:[{id:'unknown-origin',type:'user_continuation',origin:'unknown'}]}}).executionInterventions,null);
});
test('fixed weather preflight hashes explicit materials, preserves rubric, calls no model and creates no environment',async t=>{
 const f=await materialFixture(t),a=await weather.fixture(f.materials,f.environment,'cold');assert.equal(a.id,'weather-app-raw');assert.deepEqual(a.rubric,[...weather.spec.rubric]);assert.equal(a.seed,undefined);
 const before=await fs.readdir(f.root);const r=await promisify(execFile)(process.execPath,[path.join(__dirname,'weather-benchmark.cjs'),'--preflight','--materials-dir',f.materials,'--environment-dir',f.environment]);const result=JSON.parse(r.stdout);assert.equal(result.modelRequests,0);assert.equal(result.preflight,true);assert.deepEqual(await fs.readdir(f.root),before);
 await fs.writeFile(path.join(f.materials,'api.md'),'changed API contract');const b=await weather.fixture(f.materials,f.environment);assert.notEqual(a.materialFingerprint,b.materialFingerprint);
});
test('weather material paths cannot escape, follow links, omit roles or silently reduce the fixed rubric',async t=>{
 const f=await materialFixture(t);f.manifest.rubric=['only file exists'];await fs.writeFile(path.join(f.materials,'benchmark.json'),JSON.stringify(f.manifest));assert.deepEqual((await weather.fixture(f.materials,f.environment)).rubric,[...weather.spec.rubric]);
 await assert.rejects(weather.fixture(f.materials,path.join(f.materials,'env')),/separate/);
 f.manifest.materials[0].path='../outside.md';await fs.writeFile(path.join(f.root,'outside.md'),'outside');await fs.writeFile(path.join(f.materials,'benchmark.json'),JSON.stringify(f.manifest));await assert.rejects(weather.fixture(f.materials,f.environment),/相对路径/);
 f.manifest.materials[0].path='linked.md';await fs.symlink(path.join(f.root,'outside.md'),path.join(f.materials,'linked.md'));await fs.writeFile(path.join(f.materials,'benchmark.json'),JSON.stringify(f.manifest));await assert.rejects(weather.fixture(f.materials,f.environment),/符号链接/);
 f.manifest.materials=f.manifest.materials.filter(m=>m.role!=='api');await fs.writeFile(path.join(f.materials,'benchmark.json'),JSON.stringify(f.manifest));await assert.rejects(weather.fixture(f.materials,f.environment),/requires|requires id/);
});
test('warm and prepared strata require actual seeds/assets; warm seed hashes prevent changing or linked cache inputs',async t=>{
 const f=await materialFixture(t);await assert.rejects(weather.fixture(f.materials,f.environment,'warm'),e=>e.code==='ENOENT');
 const seed=path.join(f.environment,'gradle-cache');await fs.mkdir(seed,{recursive:true});await fs.writeFile(path.join(seed,'artifact'),'cache-v1');const warm=await weather.fixture(f.materials,f.environment,'warm');const dst=path.join(f.root,'trial/.runtime/gradle');await weather.seedCache(seed,dst,warm.environmentFingerprint);assert.equal(await fs.readFile(path.join(dst,'artifact'),'utf8'),'cache-v1');
 await fs.writeFile(path.join(seed,'artifact'),'cache-v2');await assert.rejects(weather.seedCache(seed,path.join(f.root,'other-cache'),warm.environmentFingerprint),/changed/);
 await fs.symlink(path.join(seed,'artifact'),path.join(seed,'link'));await assert.rejects(weather.cacheFingerprint(seed),/links/);
 f.manifest.designInput='prepared';await fs.writeFile(path.join(f.materials,'benchmark.json'),JSON.stringify(f.manifest));await assert.rejects(weather.fixture(f.materials,f.environment,'cold'),/Prepared design/);
});
test('new report uses configured repeat counts and exact provenance; unknown intervention data cannot claim unassisted success',async t=>{
 const root=await temp(t),c={schemaVersion:2,repeats:4,configurationFingerprint:'experiment-one',model:{configurationFingerprint:'model-one'},cases:[{id:'weather-app-raw',category:'weather'}]};await fs.writeFile(path.join(root,'configuration.json'),JSON.stringify(c));
 for(const [repeat,evidence]of [[1,{complete:true,events:[]}],[4,undefined]]){const trial=path.join(root,'candidate','weather-app-raw-'+repeat);await fs.mkdir(trial,{recursive:true});await fs.writeFile(path.join(trial,'result.json'),JSON.stringify({configurationFingerprint:c.configurationFingerprint,elapsedMs:100,checks:[{passed:true}],externalChecks:[],humanAcceptance:'passed',interventionEvidence:evidence,result:{agentRun:{status:'completed',delivery:{outcome:'complete'}}}}));}
 await promisify(execFile)(process.execPath,[path.join(__dirname,'agent-eval-report.cjs'),root]);let report=JSON.parse(await fs.readFile(path.join(root,'report.json')));assert.equal(report.versions.candidate.expected,4);assert.equal(report.versions.candidate.attempted,2);assert.equal(report.versions.candidate.verifiedCompletionRate,1);assert.equal(report.versions.candidate.unassistedVerifiedCompletionRate,null);assert.equal(report.trials[1].executionInterventions,null);
 const trial=path.join(root,'candidate/weather-app-raw-2');await fs.mkdir(trial);await fs.writeFile(path.join(trial,'result.json'),JSON.stringify({configurationFingerprint:'wrong-experiment'}));await assert.rejects(promisify(execFile)(process.execPath,[path.join(__dirname,'agent-eval-report.cjs'),root]),/Mixed or missing experiment provenance/);
});

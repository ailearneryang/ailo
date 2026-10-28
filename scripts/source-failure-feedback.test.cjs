const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const JSZip=require('../apps/desktop/node_modules/jszip');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const batch=require('../apps/desktop/agent/batch-read.cjs'),performance=require('../apps/desktop/agent/performance.cjs');
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-source-feedback-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const zip=new JSZip();zip.file('pages/large.json',JSON.stringify({text:'x'.repeat(2100000)}));zip.file('meta.json','{"small":true}');
 const sourceId=randomUUID();await fs.mkdir(path.join(base,'imports'));await fs.writeFile(path.join(base,'imports',sourceId),await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
 const workspace=await createWorkspace(base,{id:'source-errors',request:'按原稿开发天气页面',materials:[{name:'design.sketch',sourceId,text:'原件已保存'}]});return workspace;
}
test('oversized Sketch extraction explicitly explains why changing offsets cannot recover the same entry',async t=>{
 const w=await fixture(t),id=w.catalog[0].id;
 for(const offset of [0,10000])await assert.rejects(w.source(id,'pages/large.json',offset),error=>{assert.equal(error.code,'SOURCE_ENTRY_TOO_LARGE');assert.match(error.message,/2 MB/);assert.match(error.message,/offset/);assert.match(error.message,/Sketch/);return true;});
 const small=await w.source(id,'meta.json',0);assert.equal(JSON.parse(small.text).small,true);
});
test('JSON inspection of an archive manifest asks for a real entry before pointer traversal',async t=>{
 const w=await fixture(t),id=w.catalog[0].id;
 await assert.rejects(w.inspect(id,undefined,'/layers'),{code:'SOURCE_ENTRY_REQUIRED'});
 const result=await w.inspect(id,'meta.json','/small');assert.equal(result.text,'true');
});
test('batch child error codes survive while successes are not replayed or misreported as top-level failures',async()=>{
 const items=[{action:'read_source',id:'a',entry:'large.json'},{action:'read_source',id:'a',entry:'small.json'}];let successfulReads=0;
 const results=await batch.execute(items,new AbortController().signal,async item=>{if(item.entry==='large.json')throw Object.assign(Error('entry too large'),{code:'SOURCE_ENTRY_TOO_LARGE'});successfulReads++;return {text:'complete',next:null};});
 assert.equal(results[0].errorCode,'SOURCE_ENTRY_TOO_LARGE');assert.equal(results[1].result.text,'complete');assert.equal(successfulReads,1);
 const run={};performance.batch(run,results);assert.equal(run.performance.toolErrors,0);assert.equal(run.performance.batchItemErrors,1);assert.equal(run.performance.batchItemsSucceeded,1);assert.equal(run.performance.batchItems,2);
});
test('new item counters on an old run are partial from their recorded start and reused reads stay separate',()=>{
 const run={performance:{version:1,batchItems:180,runtimeCountersSince:'old',toolErrors:11}};
 performance.batch(run,[{result:{notExecuted:true}},{result:{text:'new'}},{error:'failed',errorCode:'SOURCE_ENTRY_TOO_LARGE'}]);
 assert.ok(run.performance.batchItemCountersSince);assert.equal(run.performance.batchItems,183);assert.equal(run.performance.batchItemErrors,1);assert.equal(run.performance.batchItemsSucceeded,1);assert.equal(run.performance.batchItemsNotExecuted,1);assert.equal(run.performance.toolErrors,11);
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const quality=require('./release-quality.cjs'),{cases}=require('./reliability-cases.cjs');
const summary=(overrides={})=>Object.entries({tests:2,pass:2,fail:0,cancelled:0,skipped:0,todo:0,...overrides}).map(([k,v])=>'# '+k+' '+v).join('\n');
test('release gate rejects incomplete, skipped, failed, interrupted and missing test summaries',()=>{
 assert.equal(quality.assess(0,summary()).passed,true);
 for(const [exit,text] of [[1,summary()],[null,summary()],[0,''],[0,summary({tests:0,pass:0})],[0,summary({pass:1,skipped:1})],[0,summary({pass:1,todo:1})],[0,summary({pass:1,fail:1})],[0,summary({pass:1,cancelled:1})]])assert.equal(quality.assess(exit,text).passed,false);
});
test('packaging cannot reuse a green report from different source or tests',()=>{
 quality.assertGate({schemaVersion:1,passed:true,fingerprint:'a'},{fingerprint:'a'});
 assert.throws(()=>quality.assertGate({schemaVersion:1,passed:true,fingerprint:'a'},{fingerprint:'b'}),/变化/);
 assert.throws(()=>quality.assertGate({schemaVersion:1,passed:false,fingerprint:'a'},{fingerprint:'a'}),/未全部通过/);
});
test('historical incident coverage keeps recall, progress, quality and large binaries in the release matrix',()=>{
 const files=cases.flatMap(c=>c.files);
 for(const name of ['recovery-continuation','evidence-archive','source-memory','binary-presence','android-design','android-display','agent-eval-report'])assert.ok(files.includes('scripts/'+name+'.test.cjs'));
 assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
});

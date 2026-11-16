const {test}=require('node:test'),assert=require('node:assert/strict');
const {isReadOnly}=require('../apps/desktop/agent/read-only-command.cjs');
const journal=require('../apps/desktop/agent/action-journal.cjs');
const scan='df -h / 2>&1; echo "===USERDIR==="; du -sh /Users/fixture/Downloads /Users/fixture/Library 2>/dev/null | sort -rh; echo "===CACHES==="; du -sh /Users/fixture/Library/Caches/* 2>/dev/null | sort -rh | head -15';
test('fixed timed-out multi-directory scan is read-only; mutations and shell indirection are not',()=>{
 assert.equal(isReadOnly(scan),true);
 for(const command of ['du -sh /tmp; rm -rf /tmp/x','du -sh /tmp > result.txt','echo x > result.txt','du -sh /tmp | sort -o out','du $(touch x)','echo "$(rm x)"','du /tmp && rm x','python scan.py','sh -c "du /tmp"','find /tmp -delete','du /tmp | tee out','du /tmp &','du /tmp |','echo x 2>out'])assert.equal(isReadOnly(command),false,command);
});
test('read scan timeout remains incomplete but does not create unknown side effects or reset budgets',async()=>{
 const run={steps:[],revision:0,events:[],executionRecovery:{failureStreak:3}},w={run,save:async()=>{}};
 const entry=journal.begin(run,{action:'run_command',command:scan});
 const result=await journal.executeWithRecovery(w,entry,{},new AbortController().signal,async()=>({timedOut:true,exitCode:null,stdout:'partial',fileChanges:[]}));
 assert.equal(result.stdout,'partial');assert.equal(entry.status,'interrupted');assert.equal(journal.unknown(run),false);assert.equal(run.executionRecovery.failureStreak,3);
 const write=journal.begin(run,{action:'run_command',command:'touch out'});await journal.executeWithRecovery(w,write,{},new AbortController().signal,async()=>({timedOut:true,exitCode:null}));assert.equal(write.status,'unknown');assert.equal(journal.unknown(run),true);
});
test('legacy unknown scan is reclassified only from its own recorded timeout command',async()=>{
 const safe={id:'safe',action:'run_command',status:'unknown'},unsafe={id:'unsafe',action:'run_command',status:'unknown'};
 const run={actionJournal:[safe,unsafe],events:[{type:'run_command',detail:{actionId:'safe',command:scan,result:{timedOut:true}}},{type:'run_command',detail:{actionId:'unsafe',command:'du /tmp; touch out',result:{timedOut:true}}}]};
 await journal.reconcile({run,save:async()=>{}});
 assert.equal(safe.status,'interrupted');assert.equal(safe.readOnly,true);assert.equal(unsafe.status,'unknown');assert.equal(journal.unknown(run),true);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/desktop/src/pending-attention.ts',import.meta.url),'utf8'));
const {pendingAttention}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const task=(id,status,extra={})=>({id,title:id,created:'2026-10-17T00:00:00Z',agentRun:{status},...extra});
test('only unresolved actionable work appears; viewing does not resolve it',()=>{
 const items=[task('permission','waiting_permission'),task('question','waiting_user'),task('failed','failed',{petReadToken:'seen'}),task('blocked','blocked'),task('done','completed'),task('paused','paused'),task('stopped','failed',{assistantPaused:true}),task('live','failed'),task('my-ailo-assistant','failed')];
 assert.deepEqual(pendingAttention(items,['live']).map(i=>i.task.id),['permission','question','failed','blocked']);
 assert.equal(pendingAttention([task('done','completed')],[]).length,0);
});
test('answered clarification is not reintroduced while waiting for execution',()=>{
 const answered=task('question','waiting_user',{messages:[{role:'assistant',clarification:{title:'选择格式'}},{role:'user',content:'PDF'}]});
 assert.equal(pendingAttention([answered],[]).length,0);
 const question=task('question','chat',{messages:[{role:'assistant',clarification:{title:'选择格式'}}]});
 assert.equal(pendingAttention([question],[])[0].description,'选择格式');
});
test('latest scheduled run supersedes old failures, including when latest is running',()=>{
 const old=task('old','failed',{scheduledTaskId:'daily',scheduledAt:'2026-10-16T00:00:00Z'});
 const latest=task('new','completed',{scheduledTaskId:'daily',scheduledAt:'2026-10-17T00:00:00Z'});
 assert.equal(pendingAttention([old,latest],[]).length,0);
 assert.equal(pendingAttention([old,{...latest,lastError:'temporary'}],['new']).length,0);
 assert.deepEqual(pendingAttention([old,{...latest,lastError:'failed'}],[]).map(i=>i.task.id),['new']);
});

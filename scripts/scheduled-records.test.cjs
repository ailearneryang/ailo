const {test}=require('node:test'),assert=require('node:assert/strict');
const {associateScheduledRecords}=require('../apps/desktop/scheduled-records.cjs');
test('saved run IDs identify legacy records even when the schedule was renamed',()=>{
 const tasks=[{id:'run-task',title:'定时 · 旧名称'},{id:'ordinary',title:'定时 · 旧名称'}];
 const result=associateScheduledRecords(tasks,[{id:'schedule',title:'新名称',runs:[{id:'run',taskId:'run-task',at:'2026-10-02T01:00:00Z'}]}]);
 assert.equal(result[0].scheduledTaskId,'schedule');assert.equal(result[0].scheduledRunId,'run');assert.equal(result[1].scheduledTaskId,undefined);
});
test('older unindexed records need an execution marker and a unique title match',()=>{
 const record={id:'old',title:'定时 · 学习',request:'学习\n[定时执行时间：2026/10/1]',created:'2026-10-01'};
 assert.equal(associateScheduledRecords([record],[{id:'s',title:'学习'}])[0].scheduledTaskId,'s');
 assert.equal(associateScheduledRecords([record],[{id:'s',title:'学习'},{id:'s2',title:'学习'}])[0].scheduledTaskId,undefined);
 assert.equal(associateScheduledRecords([{...record,request:'普通聊天'}],[{id:'s',title:'学习'}])[0].scheduledTaskId,undefined);
});
test('deleting a schedule makes preserved conversations accessible again',()=>{
 const record={id:'record',scheduledTaskId:'removed'};
 assert.equal(associateScheduledRecords([record],[])[0].scheduledArchived,true);
 assert.equal(associateScheduledRecords([record],[{id:'removed'}])[0].scheduledArchived,false);
});

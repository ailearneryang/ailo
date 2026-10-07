const { test } = require('node:test');
const assert = require('node:assert/strict');
const source = require('node:module').stripTypeScriptTypes(require('node:fs').readFileSync(require('node:path').join(__dirname, '../apps/desktop/src/pet-state.ts'), 'utf8'));
const { taskPetState, workspacePetState, petResultToken, petNotificationToken, attentionTasks, unreadAttentionTasks } = new Function(source.replace(/export /g, '') + '\nreturn {taskPetState, workspacePetState, petResultToken, petNotificationToken, attentionTasks, unreadAttentionTasks};')();
const task = status => ({ id: 'task', agentRun: { status } });
test('live operations differ from thinking and queuing', () => {
  assert.equal(taskPetState(task('running'), '正在思考'), 'thinking');
  const running = { ...task('running'), agentRun: { status: 'running', inFlight: { action: 'write_file' } } };
  assert.equal(taskPetState(running, '正在写入'), 'running');
  assert.equal(taskPetState(running, '等待执行'), 'thinking');
});
test('completed work and actionable states keep static indicators', () => {
  assert.equal(taskPetState(task('completed')), 'completed');
  for (const state of ['failed','blocked','waiting_permission','waiting_user','paused']) assert.equal(taskPetState(task(state)), 'attention');
  assert.equal(taskPetState({ id: 'task', lastError: 'error' }), 'attention');
  assert.equal(taskPetState({ id: 'task', messages: [{role:'assistant',clarification:{}}] }), 'attention');
  assert.equal(taskPetState(undefined), 'idle');
});
test('attention and unread results outrank running work', () => {
  const running = {id:'live',agentRun:{status:'running',inFlight:{action:'write_file'}}};
  assert.equal(workspacePetState([task('failed'), running], {live:{status:'执行中'}}), 'attention');
  assert.equal(workspacePetState([task('completed'), task('waiting_user')], {}), 'attention');
  assert.equal(workspacePetState([task('completed')], {}), 'completed');
  assert.equal(workspacePetState([], {}), 'idle');
});

test('reading a result clears it and a new result becomes unread', () => {
  const completed = {...task('completed'),messages:[{id:'reply1',role:'assistant',content:'第一份成果'}]};
  const read = {...completed,petReadToken:petResultToken(completed)};
  assert.equal(workspacePetState([read],{}),'idle');
  assert.equal(workspacePetState([{...read,messages:[{id:'reply2',role:'assistant',content:'第二份成果'}]}],{}),'completed');
  assert.equal(workspacePetState([read],{task:{status:'执行中'}}),'thinking');
});

test('viewed attention stops reminding while task remains actionable',()=>{
 for(const status of ['failed','blocked','waiting_permission','waiting_user','paused']) {
  const pending={...task(status),messages:[{id:'reply',role:'assistant',content:'需要处理'}]};
  const read={...pending,petReadToken:petNotificationToken(pending)};
  assert.equal(workspacePetState([read],{}),'idle');
  assert.equal(attentionTasks([read],[]).length,1);
  assert.equal(unreadAttentionTasks([read],[]).length,0);
  assert.equal(workspacePetState([{...read,agentRun:{status:'blocked',updatedAt:'new'}}],{}),'attention');
 }
});
test('viewing one reminder leaves other reminders and new events unread',()=>{
 const first={...task('failed'),lastError:'first'};
 const read={...first,petReadToken:petNotificationToken(first)};
 assert.equal(workspacePetState([read,{...task('waiting_user'),id:'other'}],{}),'attention');
 assert.equal(workspacePetState([{...read,lastError:'new error'}],{}),'attention');
 const clarification={id:'clarify',messages:[{id:'q1',role:'assistant',clarification:{question:'first'}}]};
 const seen={...clarification,petReadToken:petNotificationToken(clarification)};
 assert.equal(workspacePetState([seen],{}),'idle');
 assert.equal(workspacePetState([{...seen,messages:[{id:'q2',role:'assistant',clarification:{question:'next'}}]}],{}),'attention');
});

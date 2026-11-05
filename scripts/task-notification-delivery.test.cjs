const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {notifyingCompletion,createNotificationPresenter}=require('../apps/desktop/task-notification-delivery.cjs');
function fixture(){let owner='a';const notices=[],task={id:'t'};return {notices,task,switch:()=>owner='b',storage:{isTemporary:()=>false,account:async()=>({id:owner}),readWorkspace:async()=>({tasks:[task]}),mutateWorkspace:async fn=>fn({tasks:[task]})},notifications:{publish:async(...args)=>notices.push(args)}};}
test('stream forwards updates, sends one output plus truthful final and preserves task result',async()=>{
 const f=fixture(),run={status:'running',currentInputId:'i',resultPreview:{available:true,changedSinceInput:true}},result={agentRun:{status:'partial'}};let updates=0;
 const wrapped=notifyingCompletion({...f,complete:async input=>{input.onRun(run);input.onRun(run);return result;}});
 assert.equal(await wrapped({taskId:'t',id:'r',onRun:()=>updates++}),result);assert.equal(updates,2);assert.deepEqual(f.notices.map(x=>x[3].stage),['progress','final']);
});
test('transport failures do not alter success or original failure; cancellations do not alert',async()=>{
 const f=fixture();f.notifications.publish=async()=>{throw Error('transport');};const result={text:'answer'};
 assert.equal(await notifyingCompletion({...f,complete:async()=>result})({taskId:'t',id:'r'}),result);
 const original=Error('network');await assert.rejects(notifyingCompletion({...f,complete:async()=>{throw original;}})({taskId:'t',id:'e'}),e=>e===original);
 const g=fixture();await assert.rejects(notifyingCompletion({...g,complete:async()=>{throw Object.assign(Error('cancel'),{code:'MODEL_CANCELLED'});}})({taskId:'t',id:'c'}));assert.equal(g.notices.length,0);
});
test('account change suppresses old task notifications and responseOnly mutations',async()=>{
 const f=fixture();f.task.responseOnly=true;
 await notifyingCompletion({...f,complete:async()=>{f.switch();return {};}})({taskId:'t',id:'r'});assert.equal(f.notices.length,0);assert.equal(f.task.responseOnly,true);
});
test('foreground toast and background native banner route clicks safely without stealing focus',async()=>{
 let focused=true,owner='a',restored=0,shown=0;const sent=[],native=[];
 class Notice extends EventEmitter{static isSupported(){return true;}constructor(options){super();this.options=options;native.push(this);}show(){shown++;}}
 const win={isDestroyed:()=>false,isFocused:()=>focused,isMinimized:()=>true,restore:()=>restored++,show:()=>{},focus:()=>{},webContents:{send:(...v)=>sent.push(v)}};
 const p=createNotificationPresenter({getWin:()=>win,createWindow:()=>{},Notification:Notice,account:async()=>({id:owner})}),item={id:'n',taskId:'t',title:'天气任务',kind:'ended'};
 await p.foreground(item,'a');await p.native(item,'a');assert.equal(sent[0][0],'notifications:toast');assert.equal(native.length,0);
 focused=false;await p.foreground(item,'a');await p.native(item,'a');assert.equal(shown,1);assert.equal(restored,0);assert.equal(native[0].options.body,'天气任务');assert.match(native[0].options.title,/本轮已结束/);
 native[0].emit('click');await new Promise(setImmediate);assert.equal(restored,1);assert.deepEqual(sent.at(-1),['navigation:task','t']);
 owner='b';native[0].emit('click');await new Promise(setImmediate);assert.equal(restored,1);
});
test('notification-created window waits for load, then rechecks owner',async()=>{
 const contents=new EventEmitter(),sent=[];contents.send=(...v)=>sent.push(v);let win,owner='a',notice;
 class Notice extends EventEmitter{static isSupported(){return true;}constructor(){super();notice=this;}show(){}}
 const p=createNotificationPresenter({getWin:()=>win,createWindow:()=>{win={isDestroyed:()=>false,isMinimized:()=>false,show(){},focus(){},webContents:contents};},Notification:Notice,account:async()=>({id:owner})});
 await p.native({id:'n',taskId:'t',kind:'output',title:'天气'},'a');notice.emit('click');await new Promise(setImmediate);assert.equal(sent.length,0);owner='b';contents.emit('did-finish-load');await new Promise(setImmediate);assert.equal(sent.length,0);
});

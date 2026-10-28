const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createDictation}=require('../apps/desktop/dictation.cjs');
test('dictation forwards streaming text, stops explicitly and cancels without emitting residual output',async()=>{if(process.platform!=='darwin')return;const events=[],writes=[];let child;const service=createDictation({app:{isPackaged:false},emit:e=>events.push(e),spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={write:text=>writes.push(text)};child.kill=()=>child.emit('exit',null);return child;}});await assert.rejects(service.start('invalid'),/语言/);await service.start('zh-CN');await assert.rejects(service.start('zh-CN'),/进行/);child.stdout.emit('data',Buffer.from('{"type":"text","text":"语'));child.stdout.emit('data',Buffer.from('音"}\n'));assert.equal(events[0].text,'语音');service.stop();assert.equal(writes[0],'stop\n');const count=events.length;service.cancel();child.stdout.emit('data',Buffer.from('{"type":"text","text":"late"}\n'));assert.equal(events.length,count);});
function fixture(){const events=[];let child;const service=createDictation({app:{isPackaged:false},emit:e=>events.push(e),spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={write(){}};child.kill=()=>child.emit('exit',null,'SIGTERM');return child;}});return {service,events,get child(){return child;}};}
test('a privacy-terminated helper is an explicit error, never a silent successful end',async()=>{
 const f=fixture();await f.service.start();f.child.emit('exit',null,'SIGABRT');assert.equal(f.events.length,1);assert.equal(f.events[0].type,'error');assert.match(f.events[0].text,/SIGABRT/);await f.service.start();f.service.cancel();assert.equal(f.events.length,1);
});
test('specific native permission errors survive process exit without being replaced by a generic end',async()=>{
 const f=fixture();await f.service.start();f.child.stdout.emit('data',Buffer.from(JSON.stringify({type:'error',text:'未获得语音识别权限'})+'\n'));f.child.emit('exit',1,null);assert.deepEqual(f.events,[{type:'error',text:'未获得语音识别权限'}]);
});
test('native success emits one end and cancel never emits an error or partial transcript',async()=>{
 const f=fixture();await f.service.start();f.child.stdout.emit('data',Buffer.from('{"type":"end"}\n'));f.child.emit('exit',0,null);assert.deepEqual(f.events,[{type:'end'}]);await f.service.start();f.service.cancel();f.child.stdout.emit('data',Buffer.from('{"type":"text","text":"late"}\n'));assert.equal(f.events.length,1);
});
test('dictation build embeds both privacy declarations and fails closed if self-check lacks one',()=>{
 const {buildDictation,checkDictation}=require('./build-dictation.cjs'),calls=[];
 buildDictation({exec:(binary,args)=>{calls.push({binary,args});return args.includes('--check')?'{"type":"privacy","microphone":true,"speechRecognition":true}\n':'';}});
 const args=calls[0].args;assert.ok(args.includes('__TEXT'));assert.ok(args.includes('__info_plist'));assert.ok(args.some(a=>a.endsWith('dictation-info.plist')));assert.deepEqual(calls[1].args,['--check']);
 for(const result of ['{"type":"privacy","microphone":true,"speechRecognition":false}','{"type":"capabilities"}'])assert.throws(()=>checkDictation('/fake',()=>result),/权限说明/);
});

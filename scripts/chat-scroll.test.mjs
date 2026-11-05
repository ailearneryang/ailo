import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/desktop/src/chat-scroll.ts',import.meta.url),'utf8'));
const {attachChatScroll}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('reading history survives content updates; returning to bottom resumes following',()=>{
 let resize,disconnected=false;
 globalThis.ResizeObserver=class{constructor(callback){resize=callback;}observe(){}disconnect(){disconnected=true;}};
 const handlers=new Map();let top=0;
 const viewport={scrollHeight:1000,clientHeight:200,
  get scrollTop(){return top;},set scrollTop(value){top=Math.min(value,this.scrollHeight-this.clientHeight);},
  addEventListener(name,handler){handlers.set(name,handler);},removeEventListener(name){handlers.delete(name);},querySelector(){return {};}};
 const cleanup=attachChatScroll(viewport);
 assert.equal(top,800);
 viewport.scrollHeight=1200;resize();assert.equal(top,1000);
 handlers.get('wheel')({deltaY:-100});viewport.scrollTop=900;handlers.get('scroll')();
 viewport.scrollHeight=1400;resize();assert.equal(top,900);
 resize();assert.equal(top,900);
 viewport.scrollTop=1200;handlers.get('scroll')();
 viewport.scrollHeight=1600;resize();assert.equal(top,1400);
 cleanup();assert.equal(disconnected,true);assert.equal(handlers.size,0);
});

test('an upward wheel pauses following before a resize in the same frame',()=>{
 let resize;globalThis.ResizeObserver=class{constructor(callback){resize=callback;}observe(){}disconnect(){}};
 const handlers={};const viewport={scrollHeight:1000,clientHeight:200,scrollTop:0,addEventListener(name,handler){handlers[name]=handler;},removeEventListener(){},querySelector(){return null;}};
 const cleanup=attachChatScroll(viewport);handlers.wheel({deltaY:-1});
 viewport.scrollTop=800;viewport.scrollHeight=1100;resize();assert.equal(viewport.scrollTop,800);cleanup();
});

test('expanding process details pauses bottom following before layout grows and keeps the summary near the viewport top',()=>{let resize;globalThis.ResizeObserver=class{constructor(callback){resize=callback;}observe(){}disconnect(){}};const handlers={};const viewport={scrollHeight:1000,clientHeight:400,scrollTop:0,addEventListener(n,h){handlers[n]=h;},removeEventListener(){},querySelector(){return null;},getBoundingClientRect(){return {top:100}}};const cleanup=attachChatScroll(viewport);const summary={getBoundingClientRect(){return {top:400}}};handlers.pointerdown({target:{closest:()=>summary}});viewport.scrollHeight=1800;resize();assert.equal(viewport.scrollTop,1000);handlers.toggle({target:{open:true,matches:()=>true,querySelector:()=>summary}});assert.equal(viewport.scrollTop,1280);viewport.scrollHeight=2000;resize();assert.equal(viewport.scrollTop,1280);cleanup();});
test('programmatic live details expansion does not disable following without a user click',()=>{let resize;globalThis.ResizeObserver=class{constructor(cb){resize=cb;}observe(){}disconnect(){}};const handlers={};const viewport={scrollHeight:1000,clientHeight:400,scrollTop:0,addEventListener(n,h){handlers[n]=h;},removeEventListener(){},querySelector(){return null;}};const cleanup=attachChatScroll(viewport);handlers.toggle({target:{open:true,matches:()=>true,querySelector:()=>assert.fail('default live open must not scroll to summary')}});viewport.scrollHeight=1400;resize();assert.equal(viewport.scrollTop,1400);cleanup();});
test('keyboard and touch pause streaming follow; explicit latest resumes and removes listeners on cleanup',()=>{
 let resize;globalThis.ResizeObserver=class{constructor(cb){resize=cb;}observe(){}disconnect(){}};const handlers={};let top=0;
 const viewport={scrollHeight:1000,clientHeight:200,get scrollTop(){return top;},set scrollTop(v){top=Math.min(v,this.scrollHeight-this.clientHeight)},addEventListener(n,h){handlers[n]=h;},removeEventListener(n){delete handlers[n]},querySelector(){return null;}};
 const cleanup=attachChatScroll(viewport);handlers.keydown({key:'PageUp'});viewport.scrollHeight=1200;resize();assert.equal(top,800);
 handlers['ailo-follow-latest']();assert.equal(top,1000);viewport.scrollHeight=1400;resize();assert.equal(top,1200);
 handlers.touchstart({touches:[{clientY:100}]});handlers.touchmove({touches:[{clientY:150}]});viewport.scrollHeight=1600;resize();assert.equal(top,1200);
 handlers['ailo-follow-latest']();assert.equal(top,1400);cleanup();assert.equal(Object.keys(handlers).length,0);
});
test('a small upward scroll inside the bottom threshold still stops following',()=>{
 let resize;globalThis.ResizeObserver=class{constructor(cb){resize=cb;}observe(){}disconnect(){}};const handlers={};let top=0;
 const viewport={scrollHeight:1000,clientHeight:200,get scrollTop(){return top;},set scrollTop(v){top=Math.min(v,this.scrollHeight-this.clientHeight)},addEventListener(n,h){handlers[n]=h;},removeEventListener(){},querySelector(){return null;}};
 const cleanup=attachChatScroll(viewport);handlers.wheel({deltaY:-5});viewport.scrollTop=795;handlers.scroll();viewport.scrollHeight=1200;resize();assert.equal(top,795);handlers['ailo-follow-latest']();assert.equal(top,1000);cleanup();
});

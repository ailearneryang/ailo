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

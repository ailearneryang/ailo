const {test}=require('node:test'),assert=require('node:assert/strict');
const {payload,html}=require('../apps/desktop/mobile-pairing-window.cjs');
test('desktop pairing QR contains only short-lived credentials and renders locally',async()=>{
 const p={url:'https://example.com',code:'12345678',expires:Date.now()+300000,phoneToken:'never-share',desktopToken:'never-share'};
 assert.deepEqual(Object.keys(payload(p)),['type','version','url','code','expires']);
 const output=await html(p);assert.match(output,/<svg/);assert.match(output,/default-src 'none'/);assert.doesNotMatch(output,/never-share|<script/);
 assert.throws(()=>payload({...p,expires:0}));assert.throws(()=>payload({...p,url:'http://example.com'}));
});

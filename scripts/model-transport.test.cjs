const {test}=require('node:test');const assert=require('node:assert/strict');
const {createModelTransport}=require('../apps/desktop/model-transport.cjs');
const {networkError}=require('../apps/desktop/network-error.cjs');
test('desktop model transport waits for readiness and forwards cancellation and authenticated POST to Chromium',async()=>{
 let ready=false,received;const controller=new AbortController();
 const response=new Response('ok');
 const transport=createModelTransport(()=>({app:{whenReady:async()=>{ready=true;}},net:{fetch:async(url,options)=>{assert.ok(ready);received={url,options};return response;}}}));
 assert.equal(await transport(new URL('https://example.test/v1/chat/completions'),{method:'POST',body:'{"stream":true}',headers:{Authorization:'Bearer test'},signal:controller.signal,redirect:'error'}),response);
 assert.equal(transport.transport,'electron-net');assert.equal(received.url,'https://example.test/v1/chat/completions');assert.equal(received.options.signal,controller.signal);assert.equal(received.options.headers.Authorization,'Bearer test');assert.equal(received.options.body,'{"stream":true}');assert.equal(received.options.redirect,'error');assert.equal(received.options.credentials,'omit');assert.equal(received.options.cache,'no-store');
});
test('cancellation while waiting for Electron readiness never sends a request',async()=>{
 const controller=new AbortController();let calls=0;
 const transport=createModelTransport(()=>({app:{whenReady:async()=>controller.abort()},net:{fetch:()=>calls++}}));
 await assert.rejects(transport('https://example.test',{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);
});
test('Chromium proxy and certificate errors are classified without leaking URLs',()=>{
 for(const code of ['ERR_PROXY_CONNECTION_FAILED','ERR_TUNNEL_CONNECTION_FAILED','ERR_CERT_AUTHORITY_INVALID','ERR_NETWORK_CHANGED']){
  const failure=networkError(Error(`net::${code} https://secret:key@example.test`),true);
  assert.equal(failure.code,'MODEL_NETWORK');assert.equal(failure.networkCode,code);assert.ok(!failure.message.includes('secret'));assert.ok(!failure.message.includes('https://'));
 }
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const {networkError}=require('../apps/desktop/network-error.cjs');
test('network diagnostics reveal safe codes and hide raw credentials and URLs',()=>{
 const e=new TypeError('fetch failed',{cause:new AggregateError([Object.assign(Error('https://secret:key@example.com'),{code:'ECONNRESET'})])});
 const result=networkError(e,true);assert.match(result.message,/ECONNRESET/);assert.ok(!result.message.includes('secret'));assert.equal(result.code,'MODEL_NETWORK');
});
test('programming TypeErrors outside fetch are not mislabeled as network errors',()=>{
 const e=new TypeError('Cannot read properties of undefined');assert.equal(networkError(e),e);
 assert.match(networkError(new TypeError('fetch failed'),true).message,/底层未提供明确原因/);
 assert.match(networkError(new TypeError('terminated',{cause:{code:'UND_ERR_SOCKET'}})).message,/传输过程中断开/);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {supportsReasoning,reasoningParameters}=require('../apps/desktop/reasoning.cjs');
const {createChat}=require('../apps/desktop/chat.cjs');
const bailian={baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'glm-5.2',name:'百炼'};
test('capabilities require verified provider and model',()=>{
 assert.equal(supportsReasoning(bailian),true);
 for(const baseUrl of ['https://token.baicgroup.com.cn/v1','https://dashscope.aliyuncs.com.evil.example/v1','invalid'])assert.equal(supportsReasoning({...bailian,baseUrl}),false);
 assert.equal(supportsReasoning({...bailian,model:'GLM-5.2-0807'}),false);
 assert.deepEqual(reasoningParameters(bailian,undefined),{});
 assert.throws(()=>reasoningParameters(bailian,'invalid'),/无效/);
});
test('all three levels reach provider; gateway receives no reasoning controls',async()=>{
 for(const [model,effort] of [['glm-5.2','low'],['glm-5.2','medium'],['glm-5.2','high'],['GLM-5.2-0807','high']]){
  const provider=model==='glm-5.2'?bailian:{...bailian,model,baseUrl:'https://token.baicgroup.com.cn/v1'};
  let body;
  const chat=createChat({modelCredentials:async()=>provider},async(url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}));});
  await chat.complete({id:effort+model,modelId:'test',reasoningEffort:effort,messages:[{role:'user',content:'test'}]});
  assert.equal(body.reasoning_effort,model==='glm-5.2'?effort:undefined);
  assert.equal(body.enable_thinking,model==='glm-5.2'?true:undefined);
 }
});

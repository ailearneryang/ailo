import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateClarification,parseClarification,visibleReply,formatAnswers,questionContext} from '../apps/desktop/clarification.mjs';
import {serializeMessage} from '../apps/desktop/context.mjs';
import {createChat} from '../apps/desktop/chat.cjs';
const card={title:'确认方案',questions:[{id:'days',kind:'choice',title:'预报展示几天？',options:[{id:'actual',label:'按实际天数',recommended:true},{id:'seven',label:'固定七天'}]},{id:'api',kind:'attachment',title:'提供接口文件'}],defaults:['先沿用现有样式']};
const block=c=>`说明文字\n\n\`\`\`ailo-questions\n${JSON.stringify(c)}\n\`\`\``;
test('valid terminal protocol parses, normal and malformed replies are untouched',()=>{
 assert.equal(parseClarification(block(card)).clarification.questions.length,2);
 assert.equal(parseClarification(block(card)).content,'说明文字');
 for(const s of ['普通回复','```json\n{}\n```',block({...card,questions:[]}),block(card)+'\n后续说明',block(card).slice(0,-2)])assert.deepEqual(parseClarification(s),{content:s});
});
test('schema rejects duplicate IDs, ambiguous recommendations, reserved IDs and oversized labels',()=>{
 assert.equal(validateClarification({...card,questions:[card.questions[0],card.questions[0]]}),undefined);
 for(const options of [[{id:'a',label:'a',recommended:true},{id:'b',label:'b',recommended:true}],[{id:'__custom',label:'a'},{id:'b',label:'b'}],[{id:'a',label:'a'.repeat(121)},{id:'b',label:'b'}]]) assert.equal(validateClarification({...card,questions:[{...card.questions[0],options}]}),undefined);
});
test('stream hides even partially emitted protocol marker, not ordinary fences',()=>{
 const prefix='准备确认\n';const marker='```ailo-questions';
 for(let n=1;n<=marker.length;n++)assert.equal(visibleReply(prefix+marker.slice(0,n)),'准备确认');
 assert.equal(visibleReply(block(card)),'说明文字');assert.equal(visibleReply('```js\nlet x=1;'),'```js\nlet x=1;');
});
test('questions survive serialization for model context and answers are formatted as one message',()=>{
 const parsed=parseClarification(block(card));
 const wire=serializeMessage({role:'assistant',...parsed});
 assert.ok(wire.content.includes('预报展示几天'));assert.ok(wire.content.includes('recommended'));
 const answer=formatAnswers(parsed.clarification,[{questionId:'days',answer:'实际六天'},{questionId:'api',answer:'稍后提供'}]);
 assert.ok(answer.includes('实际六天'));assert.ok(answer.includes('稍后提供'));assert.ok(!answer.includes('固定七天'));
 assert.throws(()=>formatAnswers(card,[]),/每个问题/);
 assert.equal(questionContext({}), '');
});
test('chat returns validated structured cards without requiring tools or JSON mode',async()=>{
 let body;
 const chat=createChat({modelCredentials:async()=>({baseUrl:'https://example.com/v1',model:'test'})},async(url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:block(card)},finish_reason:'stop'}]}));});
 const result=await chat.complete({id:'r',modelId:'m',messages:[{role:'user',content:'还有哪些问题需要确认？'}]});
 assert.ok(body.messages[0].content.includes('ailo-questions'));assert.equal(result.content,'说明文字');assert.equal(result.clarification.title,'确认方案');
});

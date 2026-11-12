const {test}=require('node:test'),assert=require('node:assert/strict');
const {replyHtml,documentHtml}=require('../apps/desktop/reply-html.cjs');
const html='<html><head><meta charset="UTF-8"><title>AI每日一练</title></head><body><h1>机器学习</h1></body></html>';
test('daily learning complete fenced HTML and raw documents are recoverable, including multiple outputs',()=>{
 assert.deepEqual(replyHtml('以下是 HTML 格式的完整推送内容：\n```html\n'+html+'\n```'),[html]);
 assert.deepEqual(replyHtml(html),[html]);
 assert.equal(replyHtml('```html\n'+html+'\n```\n```html\n'+html+'\n```').length,2);
});
test('fragments, unfinished streams and ordinary examples stay code',()=>{
 for(const value of ['<div>例子</div>',html.slice(0,-7),'const a=1;'])assert.equal(documentHtml(value),undefined);
 assert.deepEqual(replyHtml('```html\n'+html),[]);
});

test('meta-first styled learning page without outer html tags is viewable',()=>{const page='<meta charset="UTF-8"><title>AI每日一练</title><style>body{color:red}</style><div><h1>学习</h1></div>';assert.deepEqual(replyHtml('```html\n'+page+'\n```'),[page]);});

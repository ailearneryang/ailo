import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const js=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/desktop/src/progress-summary.ts',import.meta.url),'utf8'),{mode:'strip'});
const {progressSummary}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('completed text cannot crowd current work out of preview',()=>{
 assert.deepEqual(progressSummary('已完成：章节删除（eventId=2fb9af68）；编号同步 (obs=8c386d78)\n剩余逐文件：更新互引'),[{label:'已完成',text:'章节删除；编号同步'},{label:'待处理',text:'更新互引'}]);
});
test('unlabelled progress never invents a current action',()=>{
 assert.deepEqual(progressSummary('已完成：删除章节'),[{label:'已完成',text:'删除章节'}]);
 assert.deepEqual(progressSummary('核对目录'),[{label:'进展',text:'核对目录'}]);
 assert.deepEqual(progressSummary(''),[]);
});
test('headline preserves known progress and pause context',async()=>{
 const {progressHeadline,confirmationNotice}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 assert.equal(progressHeadline('已完成：重新编号（eventId=abc）\n正在处理：清理旧引用'),'正在处理：清理旧引用；已完成：重新编号');
 assert.equal(progressHeadline('正在处理：清理旧引用',true),'暂停前进展：清理旧引用');
 assert.equal(progressHeadline(''), '');
 assert.equal(confirmationNotice(true,'pending','running',false),'执行到此时需你确认');
 assert.equal(confirmationNotice(true,'pending','waiting_user',true),'需你确认');
 assert.equal(confirmationNotice(true,'pending','waiting_user',false),'执行到此时需你确认');
 assert.equal(confirmationNotice(true,'done','running',false),'');
});
test('remaining work is not presented as an action currently executing',async()=>{
 const {progressHeadline}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 assert.equal(progressHeadline('剩余：同步清单'),'待处理：同步清单');
 assert.equal(progressHeadline('正在处理：运行 make_review_html.py 和 3→2 映射'),'详细进展已记录，可展开本步查看。');
});

test('display copy translates technical labels without rewriting file names',async()=>{
 const {readableProgressText}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 assert.equal(readableProgressText('verify验收项并登记artifact'),'核对验收项并登记交付成果');
 assert.equal(readableProgressText('运行 scripts/verify.js，读取 artifact.json'),'运行 scripts/verify.js，读取 artifact.json');
});

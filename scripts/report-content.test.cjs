const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspect,assertReadable}=require('../apps/desktop/agent/report-content.cjs');
const scan={platform:'Darwin',disks:{'/':{used_pct:44}},user_profile:[],library:[],caches:[],app_support:[],program_dirs:[],confidence:{score:10}};
const document=body=>'<html><head><title>扫描报告</title></head><body>'+body+'</body></html>';
test('fixed storage-report incident: headings and JS data are not readable chapter content',()=>{
 const html=document('<h1>存储报告</h1><h2>磁盘总览</h2><div id="overview"></div><h2>目录排行</h2><table><tr><th>路径</th><th>大小</th></tr></table><script>const DATA = '+JSON.stringify(scan)+';\ndocument.getElementById("overview").innerHTML="data";</script>');
 assert.deepEqual(inspect(html).emptySections,['磁盘总览','目录排行']);assert.throws(()=>assertReadable(html),/仅标题无正文/);
});
test('real static chapters, nested headings, SVG and honest empty results stay readable',()=>{
 assert.doesNotThrow(()=>assertReadable(document('<h1>报告</h1><h2>磁盘</h2><p>总容量100GB，已用44GB。</p><h2>缓存</h2><p>未扫描：当前无目录读取权限，不能推算大小。</p>')));
 assert.doesNotThrow(()=>assertReadable(document('<h1>报告</h1><h2>分布</h2><svg><text>44GB</text></svg><h2>目录</h2><table><tr><td>测试缓存 2GB</td></tr></table>')));
});
test('empty scan arrays do not prove full coverage; explicit empty receipts and lower confidence remain distinct',()=>{
 const html=d=>document('<h1>报告</h1><p>扫描结果</p><script>const DATA = '+JSON.stringify(d)+';</script>');
 assert.throws(()=>assertReadable(html(scan)),/缺少逐项覆盖证据/);
 assert.doesNotThrow(()=>assertReadable(html({...scan,confidence:{score:4}})));
 assert.doesNotThrow(()=>assertReadable(html({...scan,scan_status:Object.fromEntries(['user_profile','library','caches','app_support','program_dirs'].map(k=>[k,{status:'empty'}]))})));
});
test('preview reports dynamic empty chapters without running the embedded script',async()=>{
 const {htmlPreview}=require('../apps/desktop/html-preview.cjs');
 const p=await htmlPreview(document('<h2>总览</h2><div></div><h2>排行</h2><div></div><script>throw new Error("must not run")</script>'),null,'report.html');
 assert.equal(p.htmlResources.scriptsBlocked,1);assert.ok(p.htmlResources.issues.some(x=>x.includes('只有标题')));assert.doesNotMatch(p.content,/<script/);
});

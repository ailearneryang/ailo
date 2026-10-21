const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {audit}=require('../apps/desktop/agent/sketch-fidelity.cjs');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-source-audit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'sketch_extracted/pages'),{recursive:true});
 const text=Array.from({length:12},(_,i)=>({_class:'text',attributedString:{string:'City',attributes:[{attributes:{MSAttributedStringFontAttribute:{attributes:{size:32+i%3*16}}}}]}}));
 const page={_class:'page',layers:[{_class:'group',name:'天气-首页',layers:[...text,{_class:'bitmap',image:{_ref:'images/sky.png'}},{_class:'symbolInstance',symbolID:'missing',name:'天气图标'}]}]};
 const file=path.join(root,'sketch_extracted/pages/page.json');await fs.writeFile(file,JSON.stringify(page));
 await fs.writeFile(path.join(root,'index.html'),'<h1>天气-首页</h1>');
 const dom={renderHealth:{imageElements:0,cssImageElements:0,svgElements:0,canvasElements:0,textSamples:12,defaultSmallText:12,tinyLineHeightText:12}};
 return {root,page,file,dom};
}
test('source audit independently detects omitted images, broken typography and missing symbol definitions',async t=>{
 const f=await fixture(t),result=await audit(f.root,'index.html',f.dom);
 assert.equal(result.status,'checked');assert.equal(result.bitmapInstances,1);assert.equal(result.textInstances,12);
 assert.deepEqual(result.fontSizes,[32,48,64]);assert.equal(result.unresolvedSymbols,1);
 assert.equal(result.issues.length,3);assert.match(result.issues.join(' '),/资源|图片/);assert.match(result.issues.join(' '),/行高/);assert.match(result.issues.join(' '),/组件定义/);
 assert.equal(result.sources.length,1);
});
test('source structure repaired and real rendered media/typography clear independent defects',async t=>{
 const f=await fixture(t);f.page.layers.push({_class:'symbolMaster',symbolID:'missing',layers:[]});await fs.writeFile(f.file,JSON.stringify(f.page));
 f.dom.renderHealth.imageElements=1;f.dom.renderHealth.defaultSmallText=0;f.dom.renderHealth.tinyLineHeightText=0;
 assert.deepEqual((await audit(f.root,'index.html',f.dom)).issues,[]);
});
test('a reproduction cannot evade source binding by removing all source page names',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'index.html'),'<h1>Different</h1>');
 assert.match((await audit(f.root,'index.html',f.dom,{reproduce:true})).issues.join(' '),/绑定/);
 assert.deepEqual((await audit(f.root,'index.html',f.dom)).issues,[]);
});
test('ordinary HTML without Sketch pages has no invented source defects',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-no-sketch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'index.html'),'<h1>Normal</h1>');
 const result=await audit(root,'index.html',{});assert.equal(result.status,'unavailable');assert.deepEqual(result.issues,[]);
});
test('foreign symbol definitions in Sketch document.json satisfy component dependencies',async t=>{
 const f=await fixture(t);
 await fs.writeFile(path.join(f.root,'sketch_extracted/document.json'),JSON.stringify({_class:'document',foreignSymbols:[{symbolMaster:{_class:'symbolMaster',symbolID:'missing',layers:[]}}]}));
 const result=await audit(f.root,'index.html',f.dom);
 assert.equal(result.unresolvedSymbols,0);assert.equal(result.sources.length,2);
 assert.ok(!result.issues.some(i=>i.includes('组件定义')));
});

test('source-bound reproduction rejects widespread empty styles from a broken converter',async t=>{
 const f=await fixture(t);f.page.layers[0].layers.pop();await fs.writeFile(f.file,JSON.stringify(f.page));
 f.dom.renderHealth={imageElements:1,cssImageElements:0,svgElements:0,canvasElements:0,textSamples:12,defaultSmallText:0,tinyLineHeightText:0};
 const broken='<h1>天气-首页</h1>'+Array.from({length:12},()=>'<div style="position:absolute;left:0px;top:0px;color:;background:;font-size:14px;">City</div>').join('');
 await fs.writeFile(path.join(f.root,'index.html'),broken);
 assert.match((await audit(f.root,'index.html',f.dom)).issues.join(' '),/大量空样式/);
 await fs.writeFile(path.join(f.root,'index.html'),broken.replaceAll('color:;background:;','color:white;background:transparent;'));
 assert.deepEqual((await audit(f.root,'index.html',f.dom)).issues,[]);
});

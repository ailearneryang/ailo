const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-sidebar-'));let app;
 const title='排查book-writing-workspace未显示在技能列表的问题并核对完整的最终处理结果';
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[{id:'long',title,pinned:true,request:title,materials:[],created:new Date().toISOString(),messages:[]},{id:'short',title:'短标题',pinned:true,request:'测试',materials:[],messages:[]}],projects:[],models:[]}));
 try {
  app=await _electron.launch({executablePath:path.resolve('apps/desktop/out/Ailo-darwin-arm64/Ailo.app/Contents/MacOS/Ailo'),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:dir}});
  const page=await app.firstWindow();page.setDefaultTimeout(10000);
  const row=page.locator('.task-nav-row').filter({has:page.getByRole('button',{name:title,exact:true})});
  const viewport=row.locator('.task-nav-title'),text=viewport.locator('span');await viewport.waitFor();
  assert.ok(await viewport.evaluate(el=>el.scrollWidth>el.clientWidth));
  const idle=await row.evaluate(el=>getComputedStyle(el).backgroundColor);
  await row.hover();assert.notEqual(await row.evaluate(el=>getComputedStyle(el).backgroundColor),idle);
  await text.evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});
  const bounds=await viewport.evaluate(el=>({viewport:el.getBoundingClientRect().right,text:el.firstElementChild.getBoundingClientRect().right}));
  assert.ok(Math.abs(bounds.viewport-bounds.text)<2);
  await page.getByRole('button',{name:'短标题',exact:true}).hover();
  assert.equal(await text.evaluate(el=>getComputedStyle(el).transform),'none');
  await page.emulateMedia({reducedMotion:'reduce'});await row.hover();
  await page.waitForFunction(()=>document.querySelector('.task-nav-title.revealing span')?.getAnimations().every(a=>a.playState==='finished'));
  await page.screenshot({path:'.local/sidebar-hover.png'});
  console.log('PASS: row hover highlight, full long-title reveal, reset on leave, reduced-motion support.');
 }finally{if(app)await app.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

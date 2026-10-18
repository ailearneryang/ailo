const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-memory-ui-'));let app;const snapshots=[];
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw),state=JSON.parse(input.messages.at(-1).content);snapshots.push(state);
  let action;if(state.phase==='route')action={action:'route',kind:'chat'};
  else if(state.currentRequest==='请记住：周报先讲风险，再讲进展'&&!state.personalMemory.entries.some(i=>i.topic==='周报偏好'))action={action:'memory',operation:'save',data:{topic:'周报偏好',content:'周报先讲风险，再讲进展',type:'preference',scope:'personal',quote:'周报先讲风险，再讲进展'}};
  else action={action:'reply',text:state.currentRequest.startsWith('请记住')?'已记住周报偏好。':state.personalMemory?.enabled?'已按记忆中的偏好整理。':'本次没有读取个人记忆。'};
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{tool_calls:[{id:'memory-test',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},finish_reason:'stop'}]}));
 }catch(e){res.statusCode=500;res.end('mock failed');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 await fs.writeFile(path.join(directory,'workspace.json'),JSON.stringify({tasks:[],projects:[{id:'p',name:'产品项目'}],extensions:[],models:[{id:'m',name:'演示模型',model:'mock',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}],defaultModelId:'m'}));
 try{
  app=await _electron.launch({executablePath:path.resolve('apps/desktop/out/Ailo-darwin-arm64/Ailo.app/Contents/MacOS/Ailo'),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:directory}});
  const page=await app.firstWindow();page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const input=page.getByRole('textbox',{name:'任务需求',exact:true});await input.waitFor();await input.fill('请记住：周报先讲风险，再讲进展');await input.press('Enter');await page.getByText('已记住周报偏好。',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.ailo.memoryRead())).items[0].source.quote,'周报先讲风险，再讲进展');
  await page.getByRole('button',{name:'查看用户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'个人记忆',exact:true}).click();await page.getByRole('heading',{name:'个人记忆',exact:true}).waitFor();
  const memorySwitch=page.getByRole('switch',{name:'使用个人记忆',exact:true});assert.ok((await memorySwitch.boundingBox()).width>=30);await memorySwitch.click();await page.waitForFunction(()=>document.querySelector('[role=switch][aria-label="使用个人记忆"]').getAttribute('aria-checked')==='false');await memorySwitch.click();await page.waitForFunction(()=>document.querySelector('[role=switch][aria-label="使用个人记忆"]').getAttribute('aria-checked')==='true');
  await page.getByRole('button',{name:'添加记忆',exact:true}).click();const form=page.locator('dialog[open]');await form.getByLabel('主题',{exact:true}).fill('交付风格');await form.getByLabel('内容',{exact:true}).fill('交付时说明验证结果和仍需处理的问题。');await form.getByRole('button',{name:'保存',exact:true}).click();await form.waitFor({state:'hidden'});await page.getByRole('heading',{name:'交付风格',exact:true}).waitFor();
  await page.getByRole('button',{name:'导入记忆',exact:true}).click();await page.getByRole('textbox',{name:'导入的记忆内容'}).fill('报告使用清晰的小标题');await page.getByRole('button',{name:'预览',exact:true}).click();await page.getByRole('button',{name:'导入 1 条建议'}).click();await page.getByRole('button',{name:'采纳',exact:true}).click();await page.getByRole('tab',{name:/已记住/}).click();
  const card=page.locator('.memory-card').filter({has:page.getByRole('heading',{name:'报告使用清晰的小标题',exact:true})});await card.getByRole('button',{name:'忘记',exact:true}).click();await page.getByRole('button',{name:'确认移除',exact:true}).click();await card.waitFor({state:'hidden'});
  const saved=await page.evaluate(()=>window.ailo.memoryRead());assert.equal(saved.items.length,2);
  await fs.mkdir('.local',{recursive:true});await page.screenshot({path:'.local/personal-memory-desktop.png',fullPage:true});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(820,720));await page.screenshot({path:'.local/personal-memory-small.png',fullPage:true});assert.equal(await page.locator('.personal-memory-page').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await page.getByRole('button',{name:'新的对话',exact:true}).click();await page.getByRole('button',{name:'在此对话中使用和保存记忆'}).click();await input.fill('请按我的偏好写周报');await input.press('Enter');await page.getByText('本次没有读取个人记忆。',{exact:true}).waitFor();assert.equal(snapshots.at(-1).personalMemory.entries.length,0);
  await page.getByRole('button',{name:'新的对话',exact:true}).click();await input.fill('按照周报偏好继续');await input.press('Enter');await page.getByText('已按记忆中的偏好整理。',{exact:true}).waitFor();assert.ok(snapshots.at(-1).personalMemory.entries.some(i=>i.topic==='周报偏好'));assert.deepEqual(errors,[]);
  await app.close();app=await _electron.launch({executablePath:path.resolve('apps/desktop/out/Ailo-darwin-arm64/Ailo.app/Contents/MacOS/Ailo'),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:directory}});const reopened=await app.firstWindow();await reopened.getByRole('textbox',{name:'任务需求',exact:true}).waitFor();assert.equal((await reopened.evaluate(()=>window.ailo.memoryRead())).items.length,2);
  console.log('PASS: real IPC/model tool save, source receipt, settings CRUD, import/review/forget, per-chat exclusion, new-chat recall, restart persistence and narrow layout.');
 }finally{if(app)await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});

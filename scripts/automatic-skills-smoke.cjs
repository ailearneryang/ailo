const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');

// Offline UI smoke: a fresh userData directory and loopback model substitute.
// It never reads the installed Ailo profile or calls a real model provider.
(async()=>{
 const root=process.cwd();await fs.mkdir(path.join(root,'.local'),{recursive:true});
 const directory=await fs.mkdtemp(path.join(root,'.local/automatic-skills-ui-'));
 const screenshots={settings:path.join(directory,'settings.png'),live:path.join(directory,'live.png'),completed:path.join(directory,'completed.png'),expanded:path.join(directory,'expanded.png')};
 const skills=[
  {id:'book-auto',kind:'skill',name:'书稿整理',description:'整理零散笔记，提炼书稿章节提纲。',instructions:'AUTO_BOOK_SKILL_TOKEN: 根据笔记整理章节提纲。',enabled:true},
  {id:'manual-only',kind:'skill',name:'手动审校',description:'手动选择后检查书稿',instructions:'MANUAL_ONLY_TOKEN',enabled:true,invocation:'manual'},
  {id:'disabled-skill',kind:'skill',name:'停用技能',description:'停用技能不可自动加载',instructions:'DISABLED_SKILL_TOKEN',enabled:false,invocation:'auto'},
 ];
 const answer='已把零散笔记整理为三章提纲：背景、核心观点、实践方法。';
 let app,page,release,modelCalls=0;const serverErrors=[],pageErrors=[],gate=new Promise(resolve=>release=resolve);
 const server=http.createServer(async(req,res)=>{
  try{
   assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');
   let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw),state=JSON.parse(payload.messages.at(-1).content),system=payload.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
   modelCalls++;assert.ok(modelCalls<=2,'automatic selection must share the route request');
   assert.ok(!system.includes('MANUAL_ONLY_TOKEN'));assert.ok(!system.includes('DISABLED_SKILL_TOKEN'));
   let action;
   if(modelCalls===1){assert.equal(state.phase,'route');assert.deepEqual(state.skillCatalog.map(s=>s.id),['book-auto']);assert.ok(!system.includes('AUTO_BOOK_SKILL_TOKEN'));action={action:'route',kind:'chat',skillIds:['book-auto']};}
   else{assert.equal(state.phase,'chat');assert.ok(system.includes('AUTO_BOOK_SKILL_TOKEN'));assert.equal(state.loadedSkills[0].source,'auto');await gate;action={action:'reply',text:answer};}
   const names=(payload.tools||[]).map(tool=>tool.function.name);assert.ok(names.includes(action.action)||names.includes('ailo_action'));
   const named=names.includes(action.action),{action:name,...args}=action;
   res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{tool_calls:[{id:'smoke-'+modelCalls,type:'function',function:{name:named?name:'ailo_action',arguments:JSON.stringify(named?args:action)}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}));
  }catch(error){serverErrors.push(error.stack||String(error));res.statusCode=500;res.end('Offline smoke assertion failed');}
 });
 server.on('error',error=>{console.error(error);process.exitCode=1;});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 await fs.writeFile(path.join(directory,'workspace.json'),JSON.stringify({tasks:[],projects:[],extensions:skills,models:[{id:'mock',name:'离线技能测试',model:'offline',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}],defaultModelId:'mock'}));
 const launch=()=>_electron.launch({executablePath:process.env.AILO_EXECUTABLE||process.env.ELECTRON_PATH||path.join(root,'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:process.env.AILO_EXECUTABLE?[]:[path.join(root,'apps/desktop')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:directory}});
 try{
  app=await launch();page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>pageErrors.push(error.message));
  await app.evaluate(({BrowserWindow,session})=>{BrowserWindow.getAllWindows()[0].setSize(1280,900);session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{const url=new URL(details.url);callback({cancel:['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname)});});});
  await page.getByRole('textbox',{name:'任务需求',exact:true}).waitFor();await page.getByRole('button',{name:'扩展',exact:true}).click();await page.getByRole('tab',{name:'技能',exact:true}).click();
  const policy=page.getByRole('combobox',{name:'技能调用方式：书稿整理',exact:true});await policy.waitFor();assert.equal(await policy.inputValue(),'auto');assert.deepEqual(await policy.locator('option').allTextContents(),['自动可用','仅手动','停用']);
  for(const mode of ['manual','off','auto']){await policy.selectOption(mode);await page.waitForFunction(async({mode})=>{const item=(await window.ailo.read()).extensions.find(s=>s.id==='book-auto');return mode==='off'?!item.enabled:item.enabled&&item.invocation===mode;},{mode});assert.equal(await policy.inputValue(),mode);}
  assert.equal(await page.getByRole('combobox',{name:'技能调用方式：手动审校',exact:true}).inputValue(),'manual');assert.equal(await page.getByRole('combobox',{name:'技能调用方式：停用技能',exact:true}).inputValue(),'off');
  await page.screenshot({path:screenshots.settings,fullPage:true});await page.getByRole('button',{name:'新的对话',exact:true}).click();
  const input=page.getByRole('textbox',{name:'任务需求',exact:true});await input.fill('把这些零散笔记整理成一本书的章节提纲');await input.press('Enter');
  const liveBadge=page.locator('.task-activity .execution-process-skills > span').filter({hasText:'自动加载技能 · 书稿整理'});await liveBadge.waitFor();assert.equal(await page.locator('.execution-extensions:visible').count(),0);assert.equal(await page.locator('.execution-process-skills:visible > span').filter({hasText:'自动加载技能 · 书稿整理'}).count(),1);assert.equal(await page.getByText(answer,{exact:true}).count(),0);assert.equal(modelCalls,2);await page.screenshot({path:screenshots.live,fullPage:true});
  release();await page.getByText(answer,{exact:true}).waitFor();await page.locator('.task-activity').waitFor({state:'hidden'});
  const details=page.locator('.reply-details').last();await details.waitFor();assert.equal(await details.getAttribute('open'),null);assert.match(await details.locator(':scope > summary').innerText(),/^已完成/);await page.screenshot({path:screenshots.completed,fullPage:true});
  await details.locator(':scope > summary').click();await details.locator('.execution-process-skills').getByText('自动加载技能 · 书稿整理',{exact:true}).waitFor();await page.screenshot({path:screenshots.expanded,fullPage:true});
  const saved=await page.evaluate(()=>window.ailo.read()),task=saved.tasks[0];assert.deepEqual(task.agentRun.loadedExtensions.map(s=>[s.id,s.source]),[['book-auto','auto']]);assert.deepEqual(task.messages.findLast(m=>m.role==='assistant').replyDetails.loadedExtensions.map(s=>[s.id,s.source]),[['book-auto','auto']]);
  await app.close();app=await launch();page=await app.firstWindow();page.setDefaultTimeout(15000);await page.getByRole('button',{name:task.title,exact:true}).first().click();const restored=page.locator('.reply-details').last();await restored.waitFor();assert.equal(await restored.getAttribute('open'),null);await restored.locator(':scope > summary').click();await restored.locator('.execution-process-skills').getByText('自动加载技能 · 书稿整理',{exact:true}).waitFor();
  assert.equal(modelCalls,2);assert.deepEqual(serverErrors,[]);assert.deepEqual(pageErrors,[]);
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify({passed:true,modelCalls,checks:['three skill policies persisted','natural input route selected automatic skill','manual and disabled skills excluded','body absent from route and loaded for reply','one live automatic skill receipt before response without legacy duplicate','completion defaults collapsed','receipt preserved after expanding and restarting'],screenshots},null,2));
  console.log(JSON.stringify({passed:true,directory,screenshots,modelCalls},null,2));
 }catch(error){if(page)await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});console.error('Smoke artifacts:',directory);if(serverErrors.length)console.error(serverErrors.join('\n'));throw error;}
 finally{release();if(app)await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

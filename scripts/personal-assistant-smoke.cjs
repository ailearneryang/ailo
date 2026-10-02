const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-assistant-'));let app;
 const server=http.createServer(async(req,res)=>{try{
   let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body),s=JSON.parse(request.messages.at(-1).content);let action;
   const used=operation=>s.toolResults.some(r=>r.arguments?.action==='assistant'&&r.arguments.operation===operation);
   if(s.phase==='route')action={action:'route',kind:'chat'};
   else if(!s.personalAssistant)action={action:'reply',text:'任务结果：反馈整理已完成。'};
   else if(s.currentRequest.includes('制作反馈'))action=used('delegate')?{action:'reply',text:'已开始整理，进度可以在任务卡片中查看。'}:{action:'assistant',operation:'delegate',data:{title:'内测反馈整理',prompt:'制作反馈整理建议'}};
   else if(s.currentRequest.includes('进度'))action=used('list')?{action:'reply',text:'进度汇报：已找到反馈任务，结果已准备好。'}:{action:'assistant',operation:'list'};
   else if(s.currentRequest.includes('每周五'))action=used('schedule')?{action:'reply',text:'已安排每周五上午九点整理公开行业动态。'}:{action:'assistant',operation:'schedule',data:{title:'每周行业动态',prompt:'整理公开行业动态',frequency:'weekly',weekday:5,time:'09:00'}};
   else action={action:'reply',text:'可以，我们先讨论方案。'};
   res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{tool_calls:[{id:'mock',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]}}]}));
 }catch(e){res.statusCode=500;res.end(e.message);}});
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[],projects:[],models:[{id:'mock',name:'测试模型',model:'mock',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}],defaultModelId:'mock'}));
  async function open(){app=await _electron.launch({executablePath:process.env.ELECTRON_PATH||path.join(root,'.local/my-ailo-electron/Electron.app/Contents/MacOS/Electron'),args:[path.join(root,'apps/desktop')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:dir}});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1200,900));const page=await app.firstWindow();await page.getByRole('button',{name:'新的对话',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.sidebar .new').disabled);return page;}
  let page=await open();page.on('pageerror',e=>console.error('UI ERROR',e.message));page.on('console',m=>{if(m.type()==='error')console.error(m.text());});const send=async text=>{await page.getByRole('textbox',{name:'任务需求',exact:true}).fill(text);await page.getByRole('button',{name:'发送需求',exact:true}).click();};
  await send('讨论方案');await page.getByText('可以，我们先讨论方案。',{exact:true}).waitFor({timeout:5000}).catch(async e=>{await page.screenshot({path:path.join(root,'.local/my-ailo-debug.png'),scale:'css'});console.log((await page.locator('body').innerText()).slice(-2500));console.log(JSON.stringify((await page.evaluate(()=>window.ailo.read())).tasks));throw e;});assert.equal(await page.locator('header strong').textContent(),'我的 Ailo');
  let state=await page.evaluate(()=>window.ailo.read());assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].id,'my-ailo-assistant');
  await send('制作反馈整理建议');await page.getByText('已开始整理，进度可以在任务卡片中查看。',{exact:true}).waitFor();await page.locator('.assistant-linked-task').filter({hasText:'已有结果'}).waitFor({timeout:20000});
  state=await page.evaluate(()=>window.ailo.read());assert.equal(state.tasks.length,2);assert.equal(state.tasks.find(t=>t.id!=='my-ailo-assistant').parentAssistantId,'my-ailo-assistant');
  await page.locator('.assistant-linked-task').click();await page.getByText('任务结果：反馈整理已完成。',{exact:true}).waitFor();await page.getByRole('button',{name:'我的 Ailo',exact:true}).click();await page.getByText('可以，我们先讨论方案。',{exact:true}).waitFor();
  await send('反馈的进度怎么样');await page.getByText('进度汇报：已找到反馈任务，结果已准备好。',{exact:true}).waitFor();
  await send('每周五上午九点整理公开行业动态');await page.getByText('已安排每周五上午九点整理公开行业动态。',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.ailo.schedulesList())).length,1);
  await fs.mkdir(path.join(root,'.local'),{recursive:true});await page.screenshot({path:path.join(root,'.local/my-ailo-conversation.png'),animations:'disabled',scale:'css'});
  const inputBox=await page.getByRole('textbox',{name:'任务需求',exact:true}).boundingBox();assert.ok(inputBox && inputBox.y+inputBox.height<900);
  await page.getByRole('button',{name:'查看任务',exact:true}).click();await page.getByRole('dialog',{name:'任务',exact:true}).waitFor();await page.locator('.my-ailo-task').filter({hasText:'内测反馈整理'}).waitFor();
  await page.screenshot({path:path.join(root,'.local/my-ailo-tasks.png'),animations:'disabled',scale:'css'});
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,700));
  await page.screenshot({path:path.join(root,'.local/my-ailo-clean-small.png'),animations:'disabled',scale:'css'});
  assert.equal(await page.locator('.assistant-conversation').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await app.close();app=null;page=await open();await page.getByText('已安排每周五上午九点整理公开行业动态。',{exact:true}).waitFor();assert.equal(await page.locator('.assistant-linked-task').count(),2);
  await page.getByRole('button',{name:'新的对话',exact:true}).click();assert.equal(await page.locator('.assistant-linked-task').count(),0);await page.getByRole('button',{name:'我的 Ailo',exact:true}).click();await page.getByText('进度汇报：已找到反馈任务，结果已准备好。',{exact:true}).waitFor();
  console.log('PASS: same-page send/reply, discussion without task, linked independent task/result, follow-up query, real schedule, navigation, restart persistence.');
 }finally{if(app)await app.close();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

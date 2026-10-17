const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const dir=await fs.mkdtemp(path.join(process.cwd(),'.local/skill-feedback-ui-'));
 let app,first=true,release;const gate=new Promise(r=>release=r);
 const server=http.createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;
   const payload=JSON.parse(raw),state=JSON.parse(payload.messages.at(-1).content);
   if(first){first=false;assert.match(payload.messages[0].content,/BOOK_SKILL_TOKEN/);await gate;}
   const action=state.phase==='route'?{action:'route',kind:'chat'}:{action:'reply',text:state.currentRequest==='请整理书稿'?'书稿整理完成':'普通回复完成'};
   res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{tool_calls:[{id:'test',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]}}]}));
  }catch(e){res.statusCode=500;res.end(e.message);}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[],projects:[],extensions:[{id:'book',kind:'skill',name:'书稿工作区',description:'整理书稿',instructions:'BOOK_SKILL_TOKEN',enabled:true}],models:[{id:'m',name:'测试模型',model:'test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}],defaultModelId:'m'}));
 const launch=()=>_electron.launch({executablePath:path.resolve('apps/desktop/out/Ailo-darwin-arm64/Ailo.app/Contents/MacOS/Ailo'),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:dir}});
 try{
  app=await launch();let page=await app.firstWindow();
  await page.getByRole('textbox',{name:'任务需求',exact:true}).waitFor();
  const input=page.getByRole('textbox',{name:'任务需求',exact:true});
  await input.fill('/书稿工作区');await input.press('Enter');await page.getByTitle('移除本次调用：书稿工作区',{exact:true}).waitFor();
  await input.fill('请整理书稿');await input.press('Enter');
  await page.getByRole('status',{name:'本轮已加载的技能与专家'}).getByText('技能 · 书稿工作区',{exact:true}).waitFor();
  // The model is still held at its first response; the receipt must already be visible.
  assert.equal(await page.getByText('书稿整理完成',{exact:true}).count(),0);
  release();await page.getByText('书稿整理完成',{exact:true}).waitFor();
  await input.fill('你好');await input.press('Enter');await page.getByText('普通回复完成',{exact:true}).waitFor();
  const state=await page.evaluate(()=>window.ailo.read());const task=state.tasks[0];
  assert.deepEqual(task.agentRun.loadedExtensions,[]);
  assert.equal(task.agentRun.history[0].loadedExtensions[0].name,'书稿工作区');
  assert.equal(await page.locator('.execution-extension').count(),1);
  await page.screenshot({path:'.local/skill-feedback.png',fullPage:true});
  await app.close();app=await launch();page=await app.firstWindow();
  await page.getByRole('button',{name:task.title,exact:true}).first().click();
  await page.getByRole('status',{name:'本轮已加载的技能与专家'}).waitFor();
  assert.equal(await page.locator('.execution-extension').count(),1);
  console.log('PASS: / selection reports loading before model output, retains receipt after completion/restart, and scopes it to the correct turn.');
 }finally{release();if(app)await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

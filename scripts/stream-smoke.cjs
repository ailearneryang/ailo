const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const root=process.cwd();let calls=0,finishFirst;
 const frame=(text,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:finish}]})}\n\n`;
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const payload=JSON.parse(raw);assert.equal(payload.stream,true);calls++;
  res.setHeader('Content-Type','text/event-stream');res.flushHeaders();
  if(calls===1){res.write(frame('第一段已显示'));finishFirst=()=>res.end(frame('','length')+'data: [DONE]\n\n');}
  else if(calls===2)res.end(frame('，回复完成。','stop')+'data: [DONE]\n\n');
  else if(calls===3)res.write(frame('这是未完成的草稿'));
  else {assert.ok(!JSON.stringify(payload.messages).includes('这是未完成的草稿'));res.end(frame('重试完成。','stop')+'data: [DONE]\n\n');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const dir=await fs.mkdtemp(path.join(root,'.local/stream-ui-'));
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[{id:'t',title:'流式测试',request:'开始',created:new Date().toISOString(),materials:[],messages:[{id:'u',role:'user',content:'开始'}],projectId:'p',modelId:'m'}],projects:[{id:'p',name:'测试项目'}],models:[{id:'m',name:'本地测试',model:'mock',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}],defaultModelId:'m'}));
 let app;
 const launch=()=>_electron.launch({executablePath:path.join(root,'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:[path.join(root,'apps/desktop')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:dir}});
 try{
  app=await launch();let page=await app.firstWindow();await page.getByText('本地记录已就绪').waitFor();await page.getByRole('button',{name:'流式测试',exact:true}).click();
  await page.getByRole('button',{name:'发送给模型',exact:true}).click();await page.getByText('第一段已显示',{exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'停止回复',exact:true}).isVisible());
  const stopBox=await page.getByRole('button',{name:'停止回复',exact:true}).boundingBox();assert.equal(stopBox.width,34);assert.equal(stopBox.height,34);
  await page.screenshot({path:'.local/stream-progress.png'});finishFirst();await page.getByText('第一段已显示，回复完成。',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'任务需求'}).fill('第二个问题');await page.getByRole('button',{name:'发送需求',exact:true}).click();await page.getByText('这是未完成的草稿',{exact:true}).waitFor();await page.getByRole('button',{name:'停止回复',exact:true}).click();
  await page.getByText('查看未完成的回复（不计入后续上下文）',{exact:true}).waitFor();
  await app.close();app=await launch();page=await app.firstWindow();await page.getByText('本地记录已就绪').waitFor();await page.getByRole('button',{name:'流式测试',exact:true}).click();
  await page.getByText('查看未完成的回复（不计入后续上下文）',{exact:true}).click();await page.getByText('这是未完成的草稿',{exact:true}).waitFor();
  await page.getByRole('button',{name:'重试回复',exact:true}).click();await page.getByText('重试完成。',{exact:true}).waitFor();await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'});
  const saved=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(saved.tasks[0].messages.length,4);assert.equal(saved.tasks[0].partialReply,undefined);
  console.log('PASS: progressive rendering before completion, stop, partial persistence across restart, retry excludes partial text.');
 }finally{if(app)await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

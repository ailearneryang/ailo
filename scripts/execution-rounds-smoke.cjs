const {_electron}=require(process.env.PLAYWRIGHT_MODULE),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
(async()=>{
 const root=process.cwd(),dir=await fs.mkdtemp(path.join(root,'.local/rounds-ui-'));
 const task={id:'weather',projectId:'p',title:'天气应用',request:'开发天气应用',materials:[],created:new Date().toISOString(),modelId:'m',messages:[{id:'u1',role:'user',content:'开发天气应用'},{id:'a1',role:'assistant',content:'天气工程已交付，尚未进行模拟器运行验证。'}]};
 const server=http.createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const s=JSON.parse(JSON.parse(raw).messages.at(-1).content);let action;
 if(s.phase==='route')action={action:'route',kind:s.currentRequest==='解释一下结构'?'chat':'task'};
 else if(s.phase==='chat')action={action:'reply',text:'已有工程采用 Kotlin 分层结构。'};
 else if(!s.steps.length)action={action:'plan',goal:'在模拟器启动天气应用',decisions:['复用已有天气工程'],acceptance:['应用启动并记录日志'],steps:[{id:'env',title:'检查 Android SDK 和模拟器',status:'running'},{id:'launch',title:'构建、安装并启动应用',status:'pending'}]};
 else action={action:'pause',text:'测试暂停点：已建立独立的模拟器验证计划。'};
 res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{tool_calls:[{id:'call',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]}}]}));
 }catch(e){res.statusCode=500;res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[task],projects:[{id:'p',name:'天气项目'}],models:[{id:'m',name:'本地测试',model:'test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}],defaultModelId:'m'}));
 const w=await createWorkspace(path.join(dir,'agent'),task);Object.assign(w.run,{executionId:'first',inputKey:'u1',status:'completed',mode:'task',goal:'开发天气应用',steps:[{id:'dev',title:'实现天气工程并测试',status:'done'}],decisions:['Kotlin'],acceptance:['测试通过']});await w.save();
 let app;const launch=()=>_electron.launch({executablePath:path.join(root,'apps/desktop/out/Ailo-darwin-arm64/Ailo.app/Contents/MacOS/Ailo'),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:dir}});
 try{app=await launch();let page=await app.firstWindow();await page.getByRole('button',{name:'天气应用',exact:true}).click();await page.locator('.completed-execution').waitFor();assert.equal(await page.locator('.completed-execution').getAttribute('open'),null);
 const send=async text=>{await page.getByRole('textbox',{name:'任务需求'}).fill(text);await page.getByRole('button',{name:'发送需求'}).click();};
 await send('解释一下结构');await page.getByText('已有工程采用 Kotlin 分层结构。',{exact:true}).waitFor();assert.equal(await page.locator('.completed-execution').count(),1);assert.equal(await page.locator('.thread > .task-progress').count(),0);
 await send('在模拟器启动天气应用');await page.getByText('测试暂停点：已建立独立的模拟器验证计划。',{exact:true}).waitFor();
 assert.equal(await page.locator('.completed-execution').count(),1);await page.locator('.thread > .task-progress').getByText('检查 Android SDK 和模拟器',{exact:true}).waitFor();
 const state=await page.evaluate(()=>window.ailo.read());const run=state.tasks[0].agentRun;assert.equal(run.history.length,1);assert.equal(run.history[0].afterMessageId,'a1');assert.equal(run.history[0].steps[0].status,'done');assert.equal(run.steps[0].status,'running');
 await page.locator('.completed-execution > summary').click();await page.getByText('实现天气工程并测试',{exact:true}).waitFor();await page.screenshot({path:'.local/execution-rounds.png',fullPage:true});
 await app.close();app=await launch();page=await app.firstWindow();await page.getByRole('button',{name:'天气应用',exact:true}).click();await page.locator('.completed-execution').waitFor();await page.locator('.thread > .task-progress').getByText('检查 Android SDK 和模拟器',{exact:true}).waitFor();console.log('PASS: completed plan collapses, chat preserves history, follow-up has a separate plan, restart retains both.');
 }finally{if(app)await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 let malformed=3, steeringDelay=true;
 const root=process.cwd(),source='Weather project\nVerified deliverable\n';
 const server=http.createServer(async(req,res)=>{
  try{
   let raw='';for await(const c of req)raw+=c;const payload=JSON.parse(raw);
   const state=JSON.parse(payload.messages.at(-1).content);let action;
   assert.equal(payload.tools[0].function.name,'ailo_action');
   if(steeringDelay && state.goal && state.conversation.length>1){steeringDelay=false;await new Promise(r=>setTimeout(r,1500));}
   if(state.originalRequest==='测试模型格式错误'&&state.phase!=='route'&&malformed-->0){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'我来生成代码，但没有调用工具'}}]}));return;}
   if(state.originalRequest==='你好')await new Promise(resolve=>setTimeout(resolve,1800));
   if(state.phase==='route')action={action:'route',kind:state.originalRequest==='你好'?'chat':'task'};
   else if(state.requiredAction==='checkpoint')action={action:'checkpoint',text:'已确认天气项目交付需求，已保存的文件和验证结果见任务计划及最近执行记录。下一步检查成果并完成交付。'};
   else if(state.phase==='chat')action={action:'reply',text:'你好！可以直接聊天，也可以委托我交付项目。'};
   else if(!state.goal)action={action:'plan',goal:'天气材料交付验证',decisions:['成果保存在当前项目'],acceptance:['文件存在，检查命令成功'],steps:[{id:'create',title:'生成项目文件',status:'pending'},{id:'verify',title:'验证并交付',status:'pending'}]};
   else if(state.conversation.length===1)action={action:'clarify',text:'先确认交付格式。',clarification:{title:'交付格式',questions:[{id:'format',kind:'choice',title:'选择格式',options:[{id:'md',label:'Markdown',recommended:true},{id:'txt',label:'纯文本'}]}],defaults:[]}};
   else if(!state.recentEvents.some(e=>e.type==='write_file'))action={action:'write_file',path:'deliverables/weather.md',content:source};
   else if(!state.recentEvents.some(e=>e.type==='run_command'))action={action:'run_command',command:"test -f deliverables/weather.md && /usr/bin/grep -q 'Verified deliverable' deliverables/weather.md",purpose:'验证交付文件'};
   else if(!state.artifacts.length)action={action:'artifact',path:'deliverables/weather.md',label:'天气项目说明'};
   else if(state.steps.some(s=>s.status!=='done'))action={action:'plan',goal:state.goal,decisions:state.decisions,acceptance:state.acceptance,steps:state.steps.map(s=>({...s,status:'done'}))};
   else action={action:'finish',text:'项目文件已生成，文件检查通过。可以在成果区预览。',evidence:[state.recentEvents.find(e=>e.type==='run_command').id]};
   res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'call1',type:'function',function:{name:'ailo_action',arguments:JSON.stringify(action)}}]},finish_reason:'tool_calls'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:1234,completion_tokens:234,completion_tokens_details:{reasoning_tokens:100}}})+'\n\ndata: [DONE]\n\n');
  }catch(e){res.writeHead(500);res.end(e.message);}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const dir=await fs.mkdtemp(path.join(root,'.local/agent-ui-'));
 const make=(id,title,content)=>({id,title,request:content,created:new Date().toISOString(),materials:[],messages:[{id:'u'+id,role:'user',content}],projectId:'p',modelId:'m'});
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[make('chat','普通对话','你好'),make('task','交付测试','请生成天气项目说明并交付'),make('retry','恢复测试','测试模型格式错误')],projects:[{id:'p',name:'测试项目'}],models:[{id:'m',name:'本地测试',model:'mock',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}],defaultModelId:'m'}));
 let app;
 const launch=()=>_electron.launch({executablePath:process.env.AILO_EXECUTABLE||path.join(root,'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:process.env.AILO_EXECUTABLE?[]:[path.join(root,'apps/desktop')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:dir}});
 try{
  app=await launch();let page=await app.firstWindow();await page.getByText('本地记录已就绪').waitFor();
  await page.getByRole('button',{name:'普通对话',exact:true}).click();await page.getByRole('button',{name:'发送给模型',exact:true}).click();
  const input=page.getByRole('textbox',{name:'任务需求'});
  await page.getByRole('button',{name:'停止回复',exact:true}).waitFor();
  await page.getByLabel('当前任务活动',{exact:true}).waitFor();
  assert.equal(await input.getAttribute('placeholder'),'');
  await input.fill('补充信息初稿');assert.equal(await page.getByRole('button',{name:'停止回复',exact:true}).count(),0);assert.equal(await page.locator('.composerbar .send').count(),1);await page.getByRole('button',{name:'加入待发送队列',exact:true}).click();await page.getByRole('button',{name:'停止回复',exact:true}).waitFor();
  const queue=page.locator('.message-queue');await queue.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByRole('textbox',{name:'编辑待发送消息'}).fill('补充信息已编辑');await queue.getByRole('button',{name:'保存',exact:true}).click();
  await input.fill('删除的消息');await page.getByRole('button',{name:'加入待发送队列',exact:true}).click();
  await queue.locator('.queued-message').filter({hasText:'删除的消息'}).getByRole('button',{name:'删除',exact:true}).click();
  await page.screenshot({path:'.local/message-queue.png'});
  await queue.getByRole('button',{name:'立即执行',exact:true}).click();await queue.waitFor({state:'hidden'});
  await page.getByText('你好！可以直接聊天，也可以委托我交付项目。',{exact:true}).waitFor();
  const chatState=await page.evaluate(()=>window.ailo.read());
  assert.equal(chatState.tasks.find(t=>t.id==='chat').messages.filter(m=>m.content==='补充信息已编辑').length,1);
  assert.ok(!chatState.tasks.find(t=>t.id==='chat').messages.some(m=>m.content==='删除的消息'));

  await input.fill('继续聊天');await page.getByRole('button',{name:'发送需求',exact:true}).click();
  await input.fill('自动继续的信息');await page.getByRole('button',{name:'加入待发送队列',exact:true}).click();
  await page.locator('.message-queue').waitFor({state:'hidden'});
  const autoState=await page.evaluate(()=>window.ailo.read());
  assert.equal(autoState.tasks.find(t=>t.id==='chat').messages.filter(m=>m.content==='自动继续的信息').length,1);
  assert.equal(await page.getByRole('region',{name:'任务计划与成果'}).count(),0);
  await page.getByRole('button',{name:'交付测试',exact:true}).click();await page.getByText('暂无项目文件',{exact:true}).waitFor();await page.getByRole('button',{name:'发送给模型',exact:true}).click();await page.getByRole('button',{name:'提交答案',exact:true}).click();
  await page.getByRole('textbox',{name:'任务需求'}).fill('请保留原目标，继续交付天气说明');
  await page.getByRole('button',{name:'加入待发送队列',exact:true}).click();await page.locator('.message-queue').getByRole('button',{name:'立即执行',exact:true}).click();
  await page.getByText('项目文件已生成，文件检查通过。可以在成果区预览。',{exact:true}).waitFor();
  assert.ok(!(await page.locator('.assistant-text').allTextContents()).join('').includes('Verified deliverable'));
  await page.getByRole('button',{name:'交付成果（1）',exact:true}).click();await page.getByRole('button',{name:/天气项目说明/}).click();await page.locator('.artifact-preview pre').waitFor();assert.equal(await page.locator('.artifact-preview pre').textContent(),source);
  const panel=page.getByRole('complementary',{name:'当前任务产物'});
  await page.getByRole('button',{name:'展开产物栏',exact:true}).click();
  assert.equal(await panel.evaluate(el=>el.classList.contains('expanded')),true);
  await page.getByRole('button',{name:'还原产物栏',exact:true}).click();
  await page.locator('.artifact-preview').scrollIntoViewIfNeeded();await page.screenshot({path:'.local/agent-delivery.png',fullPage:true});
  await page.getByRole('button',{name:/^项目文件（/}).click();await page.getByRole('button',{name:/^weather.md/}).click();assert.equal(await page.locator('.artifact-preview pre').textContent(),source);
  const saved=await page.evaluate(()=>window.ailo.read());assert.equal(saved.tasks.find(t=>t.id==='task').agentRun.status,'completed');assert.equal(saved.tasks.find(t=>t.id==='task').messages.filter(m=>m.content==='请保留原目标，继续交付天气说明').length,1);
  assert.equal(saved.tasks.find(t=>t.id==='task').agentRun.contextUsage.providerUsage.inputTokens,1234);
  await page.getByRole('button',{name:/^上下文用量/}).click();
  const meter=page.getByRole('dialog',{name:'上下文用量',exact:true});
  await meter.getByText('最近一次请求用量',{exact:true}).waitFor();
  assert.ok((await meter.textContent()).includes('工具调用与结果'));
  assert.ok((await meter.textContent()).includes('服务商返回：输入 1.2K'));
  await page.screenshot({path:'.local/request-context.png',fullPage:true});
  await page.getByRole('button',{name:'关闭上下文用量'}).click();
  await app.close();app=await launch();page=await app.firstWindow();await page.getByText('本地记录已就绪').waitFor();await page.getByRole('button',{name:'交付测试',exact:true}).click();await page.getByRole('button',{name:'交付成果（1）',exact:true}).click();await page.getByRole('button',{name:/天气项目说明/}).waitFor();
  await page.setViewportSize({width:800,height:650});await page.getByRole('button',{name:/天气项目说明/}).scrollIntoViewIfNeeded();await page.screenshot({path:'.local/agent-delivery-small.png',fullPage:true});
  await page.getByRole('button',{name:'收起产物栏',exact:true}).click();
  await page.getByRole('button',{name:'恢复测试',exact:true}).click();await page.getByRole('button',{name:'发送给模型',exact:true}).click();
  await page.getByRole('button',{name:'重试当前步骤',exact:true}).waitFor();
  assert.equal(await page.locator('.task-progress').getByRole('button',{name:'打开项目文件夹',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'重试回复',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'继续任务',exact:true}).count(),0);
  await page.screenshot({path:'.local/agent-recovery.png'});
  await page.getByRole('button',{name:'重试当前步骤',exact:true}).click();await page.getByRole('button',{name:'提交答案',exact:true}).waitFor();
  await page.getByRole('button',{name:'查看产物',exact:true}).click();
  await page.getByRole('button',{name:'交付成果（0）',exact:true}).click();await page.getByText('暂无交付成果',{exact:true}).waitFor();
  assert.equal(await page.locator('.artifact-preview').count(),0);
  await page.getByRole('button',{name:'收起产物栏',exact:true}).click();
  const recovered=await page.evaluate(()=>window.ailo.read());assert.equal(recovered.tasks.find(t=>t.id==='retry').messages.filter(m=>m.role==='user').length,1);
  console.log('Agent UI passed: native tools, single retry, no folder prerequisite, chat, clarification, project file, sandbox verification, artifact preview, restart, small window.');
 }finally{if(app)await app.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

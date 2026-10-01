// Explicitly invoked integration check. Uses a configured provider for a small
// synthetic greeting/file/material task; credentials stay encrypted on disk and in Electron's main process.
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
 const root=process.cwd();
 const source=JSON.parse(await fs.readFile(path.join(os.homedir(),'Library/Application Support/Ailo/workspace.json'),'utf8'));
 const modelId=process.env.AILO_LIVE_MODEL_ID;
 if(!modelId)throw Error('请通过 AILO_LIVE_MODEL_ID 指定本机测试模型');
 const model=source.models.find(m=>m.id===modelId);if(!model)throw Error('未找到指定测试模型');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-live-'));
 let app;
 try {
  const materialTest=process.env.AILO_LIVE_MATERIALS==='1';
  const request=materialTest?'请读取本项目两份附件，合并其中需求，先用 checkpoint 保存带来源的需求结论，再制定计划，在 deliverables/weather-check.txt 写入要求的三行内容，运行命令验证，然后登记成果完成交付。不开发应用，不需要联网或澄清。':process.env.AILO_LIVE_TASK==='1'?'请在当前项目创建 deliverables/weather-check.txt，内容仅为 hello。运行命令验证内容确实为 hello，然后把该文件作为成果交付。这只是文件交付测试，不开发应用，不需要联网或澄清。':'你好，请简短回复。';
  const task={id:'live-test',title:'接口适配测试',request,created:new Date().toISOString(),projectId:'isolated-test',modelId:model.id,materials:[],messages:[{id:'u',role:'user',content:request}]};
  if(materialTest)task.messages[0].materials=[{name:'requirements.md',text:'交付文件必须恰好三行：第一行 weather，第二行 sunny，第三行 days=6。'},{name:'api.md',text:'天气预报实际接口只返回6天，应按接口实有天数交付。'}];
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[task],projects:[{id:'isolated-test',name:'临时接口测试'}],models:[model],defaultModelId:model.id}),{mode:0o600});
  app=await _electron.launch({executablePath:process.env.AILO_LIVE_SOURCE==='1'?path.join(root,'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'):path.join(root,'apps/desktop/out/Ailo-darwin-arm64/Ailo.app/Contents/MacOS/Ailo'),args:process.env.AILO_LIVE_SOURCE==='1'?[path.join(root,'apps/desktop')]:[],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:dir}});
  const page=await app.firstWindow();await page.getByText('本地记录已就绪').waitFor();await page.getByRole('button',{name:'接口适配测试',exact:true}).click();await page.getByRole('button',{name:'发送给模型',exact:true}).click();
  let result;
  const deadline=Date.now()+(materialTest?300000:90000);
  while(Date.now()<deadline){
    result=await page.evaluate(async()=>{const t=(await window.ailo.read()).tasks[0];return {reply:t.messages.find(m=>m.role==='assistant')?.content,error:t.lastError,status:t.agentRun?.status};});
    if(result.reply||result.error)break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!result.reply&&!result.error)result.error='真实模型在测试期限内未完成';
  if(materialTest && result.status==='completed') {
   const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');const w=await createWorkspace(path.join(dir,'agent'),task);
   const content=await fs.readFile(path.join(w.files,'deliverables/weather-check.txt'),'utf8');
   if(content.trim()!=='weather\nsunny\ndays=6'||!w.run.workingMemory||w.run.readCoverage.length<2)throw Error('材料交付或摘要验证失败');
   result.validation='两份材料读取、摘要保存、三行文件及命令验证通过';
  }
  if(result.error){const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');const w=await createWorkspace(path.join(dir,'agent'),task);result.diagnostics=w.run.events.map(e=>({type:e.type,reason:e.detail.reason,action:e.detail.action}));}
  console.log(JSON.stringify(result));if(result.error||!result.reply||((materialTest||process.env.AILO_LIVE_TASK==='1')&&result.status!=='completed'))process.exitCode=1;
 }finally{if(app)await app.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

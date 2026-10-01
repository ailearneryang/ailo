const {_electron}=require(process.env.PLAYWRIGHT_MODULE),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const root=process.cwd();let payload;
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;payload=JSON.parse(raw);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'扩展测试完成'}}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const dir=await fs.mkdtemp(path.join(root,'.local/extensions-ui-'));
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[],projects:[{id:'p',name:'扩展测试项目'}],models:[{id:'m',name:'本地测试',model:'test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}],defaultModelId:'m'}));
 let app;
 const launch=()=>_electron.launch({executablePath:path.join(root,'apps/desktop/out/Ailo-darwin-arm64/Ailo.app/Contents/MacOS/Ailo'),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:dir}});
 try {
  app=await launch();let page=await app.firstWindow();await page.getByText('本地记录已就绪').waitFor();
  await page.getByRole('button',{name:'扩展',exact:true}).click();
  await page.getByRole('heading',{name:'产品经理',exact:true}).waitFor();
  await page.getByRole('button',{name:'＋ 新建专家',exact:true}).click();
  await page.getByLabel('扩展名称',{exact:true}).fill('测试顾问');await page.getByLabel('扩展用途',{exact:true}).fill('帮忙梳理需求');await page.getByLabel('扩展指令',{exact:true}).fill('CUSTOM_EXPERT_TOKEN');await page.getByRole('button',{name:'保存扩展',exact:true}).click();
  await page.getByRole('heading',{name:'测试顾问',exact:true}).waitFor();
  await page.getByRole('tab',{name:'技能',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles({name:'SKILL.md',mimeType:'text/markdown',buffer:Buffer.from('---\nname: 导入技能\ndescription: 测试导入\n---\nIMPORTED_SKILL_TOKEN')});
  assert.equal(await page.getByLabel('扩展名称',{exact:true}).inputValue(),'导入技能');await page.getByRole('button',{name:'保存扩展',exact:true}).click();await page.getByRole('heading',{name:'导入技能',exact:true}).waitFor();
  await page.screenshot({path:'.local/extensions-center.png'});
  await page.getByRole('button',{name:'对话',exact:true}).click();await page.getByRole('button',{name:'选择项目',exact:true}).click();await page.getByRole('dialog',{name:'选择项目',exact:true}).getByRole('button',{name:'扩展测试项目',exact:true}).click();
  await page.getByRole('button',{name:'✧ 使用扩展',exact:true}).click();const picker=page.getByRole('dialog',{name:'选择扩展',exact:true});await picker.getByRole('checkbox',{name:/测试顾问/}).check();await picker.getByRole('checkbox',{name:/导入技能/}).check();await picker.getByRole('button',{name:'设为项目默认',exact:true}).click();await page.getByText('已保存为项目默认扩展，将用于该项目的新对话。',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'任务需求'}).fill('请分析材料');await page.getByRole('button',{name:'发送需求'}).click();await page.getByText('扩展测试完成',{exact:true}).waitFor();assert.ok(payload.messages.some(m=>m.role==='system'&&m.content.includes('CUSTOM_EXPERT_TOKEN')));assert.ok(payload.messages.some(m=>m.role==='system'&&m.content.includes('IMPORTED_SKILL_TOKEN')));
  await page.screenshot({path:'.local/extensions-chat.png'});
  await app.close();app=await launch();page=await app.firstWindow();await page.getByText('本地记录已就绪').waitFor();await page.getByRole('button',{name:'请分析材料',exact:true}).click();await page.getByRole('button',{name:'移除扩展 测试顾问',exact:true}).waitFor();await page.getByRole('button',{name:'移除扩展 导入技能',exact:true}).waitFor();
  await page.getByRole('button',{name:'新的对话',exact:true}).click();await page.getByRole('button',{name:'移除扩展 导入技能',exact:true}).waitFor();
  await page.getByRole('button',{name:'扩展',exact:true}).click();await page.getByRole('tab',{name:'技能',exact:true}).click();await page.locator('article').filter({has:page.getByRole('heading',{name:'导入技能',exact:true})}).getByRole('button',{name:'停用',exact:true}).click();await page.getByRole('button',{name:'对话',exact:true}).click();await page.getByRole('button',{name:'移除扩展 导入技能',exact:true}).waitFor({state:'hidden'});
  console.log('PASS: create expert, import skill, project defaults, model instructions, restart persistence and disable.');
 } finally {if(app)await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const root=process.cwd();let calls=0,finishCard;const payloads=[];
 const card={title:'确认后继续',questions:[{id:'days',kind:'choice',title:'预报展示几天？',options:[{id:'actual',label:'按实际天数',description:'跟随接口返回',recommended:true},{id:'seven',label:'固定七天'}]},{id:'can',kind:'choice',title:'缺失数据如何处理？',options:[{id:'stub',label:'先保留接口',recommended:true},{id:'car',label:'采用车端数据'}]},{id:'api',kind:'attachment',title:'提供接口定义'}],defaults:['先保留现有界面风格']};
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;payloads.push(JSON.parse(raw));calls++;
  if(calls===1){res.setHeader('Content-Type','text/event-stream');res.write(`data: ${JSON.stringify({choices:[{delta:{content:'请确认这些问题。\n\n```ailo-questions\n'+JSON.stringify(card)}}]})}\n\n`);finishCard=()=>res.end(`data: ${JSON.stringify({choices:[{delta:{content:'\n```'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);}
  else if(calls===2){res.statusCode=503;res.end('temporary mock error');}
  else res.end(JSON.stringify({choices:[{message:{content:'已根据你的选择继续。'},finish_reason:'stop'}]}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const dir=await fs.mkdtemp(path.join(root,'.local/questions-ui-')),fixture=path.join(dir,'接口.txt');await fs.writeFile(fixture,'WEATHER_API_FIXTURE: forecast days 6');
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[{id:'t',title:'天气需求',created:new Date().toISOString(),request:'请澄清需求',materials:[],messages:[{id:'u',role:'user',content:'请澄清需求'}],projectId:'p',modelId:'m'}],projects:[{id:'p',name:'测试项目'}],models:[{id:'m',name:'本地模型',model:'mock',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}],defaultModelId:'m'}));
 let app;const launch=()=>_electron.launch({executablePath:path.join(root,'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:[path.join(root,'apps/desktop')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:dir}});
 try{
  app=await launch();let page=await app.firstWindow();await page.getByText('本地记录已就绪').waitFor();await page.getByRole('button',{name:'天气需求',exact:true}).click();await page.getByRole('button',{name:'发送给模型',exact:true}).click();
  await page.getByText('请确认这些问题。',{exact:true}).waitFor();assert.ok(!(await page.locator('.thread').innerText()).includes('ailo-questions'));finishCard();
  let form=page.getByRole('form',{name:'确认后继续'});await form.waitFor();await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'});
  assert.ok(await form.getByRole('radio',{name:/按实际天数/}).isChecked());assert.ok(await form.getByRole('button',{name:'提交答案',exact:true}).isDisabled());assert.equal(calls,1);
  await form.getByRole('group',{name:/缺失数据/}).getByRole('radio',{name:'自定义回答',exact:true}).check();await form.getByRole('textbox',{name:'缺失数据如何处理？ 自定义回答'}).fill('不推算，缺失字段暂不上报');
  await form.getByRole('radio',{name:'稍后提供',exact:true}).check();assert.ok(await form.getByRole('button',{name:'提交答案',exact:true}).isEnabled());
  await app.evaluate(({dialog},fixture)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});},fixture);
  await form.getByRole('button',{name:'添加材料',exact:true}).click();await form.getByRole('button',{name:'移除材料 接口.txt',exact:true}).waitFor();
  await form.getByRole('button',{name:'提交答案',exact:true}).waitFor({state:'visible'});assert.equal(calls,1);
  await page.screenshot({path:'.local/clarification-card.png'});
  await form.getByRole('button',{name:'提交答案',exact:true}).click();await page.getByRole('button',{name:'重试回复',exact:true}).waitFor();
  assert.equal(calls,2);assert.ok(payloads[1].messages.at(-1).content.includes('不推算'));assert.ok(payloads[1].messages.at(-1).content.includes('WEATHER_API_FIXTURE'));assert.ok(payloads[1].messages.at(-2).content.includes('ailo-questions'));
  await form.getByText('已提交',{exact:true}).waitFor();
  await app.close();app=await launch();page=await app.firstWindow();await page.getByText('本地记录已就绪').waitFor();await page.getByRole('button',{name:'天气需求',exact:true}).click();
  form=page.getByRole('form',{name:'确认后继续'});await form.getByText('不推算，缺失字段暂不上报',{exact:true}).waitFor();assert.equal(await form.getByRole('button',{name:'提交答案',exact:true}).count(),0);
  await page.getByRole('button',{name:'重试回复',exact:true}).click();await page.getByText('已根据你的选择继续。',{exact:true}).waitFor();await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'});
  const saved=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(saved.tasks[0].messages.length,4);assert.equal(saved.tasks[0].messages.filter(m=>m.clarificationReplyTo).length,1);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(760,600));await page.waitForTimeout(150);await page.screenshot({path:'.local/clarification-small.png'});
  console.log('PASS: streamed protocol hidden, recommended preselection without sending, custom answers, later/file choices, one-message submission, failure/retry, restart persistence and compact layout.');
 }finally{if(app)await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

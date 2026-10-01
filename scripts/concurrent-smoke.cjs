const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const held=new Map();
 const reply=(res,action)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(action)}}]}));};
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const p=JSON.parse(raw);const s=JSON.parse(p.messages.at(-1).content);if(s.phase==='route')reply(res,{action:'route',kind:'chat'});else held.set(s.originalRequest,res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const root=process.cwd(),dir=await fs.mkdtemp(path.join(root,'.local/concurrent-ui-'));
 const tasks=['A','B','C','D','E'].map(id=>({id,title:`会话${id}`,request:id,projectId:id==='E'?'A':id,materials:[],modelId:'m',messages:[{id:'u'+id,role:'user',content:id}]}));
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks,projects:['A','B','C','D'].map(id=>({id,name:'项目'+id})),models:[{id:'m',name:'测试模型',model:'mock',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}],defaultModelId:'m'}));
 let app;
 const wait=async condition=>{for(let i=0;i<300;i++){if(condition())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out waiting for server request');};
 try{
 app=await _electron.launch({executablePath:process.env.AILO_EXECUTABLE||path.join(root,'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:process.env.AILO_EXECUTABLE?[]:[path.join(root,'apps/desktop')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,AILO_DATA_DIR:dir}});
 const page=await app.firstWindow();await page.getByText('本地记录已就绪').waitFor();
 for(const id of ['A','B','C']){await page.getByRole('button',{name:'会话'+id,exact:true}).click();await page.getByRole('button',{name:'发送给模型',exact:true}).click();await wait(()=>held.has(id));}
 await page.reload();await page.getByText('本地记录已就绪').waitFor();
 await page.locator('.history button').filter({hasText:'会话A'}).getByText('执行中').waitFor();
 await page.locator('.history button').filter({hasText:'会话A'}).click();await page.getByRole('button',{name:'停止回复',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'重试当前步骤',exact:true}).count(),0);
 const duplicate=await page.evaluate(async()=>{try{await window.ailo.complete({id:'duplicate',taskId:'A',modelId:'m',messages:[{role:'user',content:'A'}]});}catch(e){return String(e);}});
 assert.match(duplicate,/执行或排队/);
 const snapshot=await page.evaluate(()=>window.ailo.read());assert.equal(snapshot.tasks.find(t=>t.id==='A').lastError,undefined);
 await page.getByRole('button',{name:'新的对话',exact:true}).click();await page.getByRole('textbox',{name:'任务需求'}).fill('新会话草稿');
 for(const id of ['D','E']){await page.getByRole('button',{name:'会话'+id,exact:true}).click();await page.getByRole('button',{name:'发送给模型',exact:true}).click();await page.locator('.history button').filter({hasText:'会话'+id}).getByText('排队中').waitFor();}
 assert.equal(held.has('D'),false);assert.equal(held.has('E'),false);
 await page.locator('.history button').filter({hasText:'会话D'}).click();await page.getByRole('button',{name:'停止回复',exact:true}).click();await page.getByRole('button',{name:'重试回复',exact:true}).waitFor();
 reply(held.get('B'),{action:'reply',text:'B 独立完成'});await page.locator('.history button').filter({hasText:'会话B'}).click();await page.getByText('B 独立完成',{exact:true}).waitFor();assert.equal(held.has('E'),false);
 reply(held.get('A'),{action:'reply',text:'A 独立完成'});await wait(()=>held.has('E'));
 reply(held.get('C'),{action:'reply',text:'C 独立完成'});reply(held.get('E'),{action:'reply',text:'E 独立完成'});
 await page.locator('.history button').filter({hasText:'会话E'}).click();await page.getByText('E 独立完成',{exact:true}).waitFor();
 await page.getByRole('button',{name:'新的对话',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'任务需求'}).inputValue(),'新会话草稿');
 const state=await page.evaluate(()=>window.ailo.read());for(const id of ['A','B','C','E'])assert.ok(state.tasks.find(t=>t.id===id).messages.some(m=>m.content===id+' 独立完成'));
 assert.equal(held.has('D'),false);console.log('Concurrent UI passed: three active, two queued, project serialization, queued cancellation, independent replies, new chat and draft preservation.');
 }finally{await app?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

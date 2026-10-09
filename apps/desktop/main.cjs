const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  safeStorage,
  shell,
} = require("electron");
app.setName("Ailo");
const { readMaterial, extensions, importPastedMaterials } = require("./materials.cjs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
if (process.env.AILO_DATA_DIR)
  app.setPath("userData", process.env.AILO_DATA_DIR);
console.info(`[Ailo ${app.getVersion()}] 主进程启动；任务决策等待上限 600 秒`);
const primaryInstance=app.requestSingleInstanceLock();
if(!primaryInstance)app.quit();
let win;
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
const storage = require("./storage.cjs").createStorage(
  app.getPath("userData"),
  safeStorage,
);
const chat = require("./chat.cjs").createChat(storage);
storage.agentDirectory = path.join(app.getPath("userData"), "agent");
const { key, json, resolveFile, writeJson } = require("./agent/workspace.cjs");
const { publicRun } = require("./agent/runner.cjs");
storage.directoryAccess=require('./agent/directory-access.cjs').createDirectoryAccess({
  select:async({path:requested,purpose},signal)=>{
    const choice=await dialog.showMessageBox(win,{type:'question',title:'目录只读授权',message:'允许 Ailo 只读分析此文件夹？',detail:`请求目录：${requested}\n用途：${purpose}\n将读取目录元数据和必要文件内容。授权仅用于当前任务、本次应用会话；移动、删除需另行确认。`,buttons:['选择文件夹并授权','取消'],defaultId:1,cancelId:1});
    if(choice.response!==0||signal.aborted)return null;
    const selected=await dialog.showOpenDialog(win,{title:'选择允许只读访问的文件夹',defaultPath:requested,properties:['openDirectory','dontAddToRecent']});
    return selected.canceled||signal.aborted?null:selected.filePaths[0];
  },
});
const androidGrants=new Set(),androidApprovals=new Map();
const buildGrants=new Set(),buildApprovals=new Map();
storage.authorizeBuild=async(root,signal)=>{
  if(signal.aborted)return false;
  if(buildGrants.has(root))return true;
  if(buildApprovals.has(root))return buildApprovals.get(root);
  const pending=(async()=>{
    const state=await storage.readWorkspace();
    const project=state.projects.find(p=>path.join(storage.agentDirectory,'projects',key(p.id),'files')===root);
    if(!project)throw Error('项目不存在，不能授权构建');
    const choice=await dialog.showMessageBox(win,{
      type:'question',title:'授权项目构建',message:`允许构建“${project.name}”？`,
      detail:'本次 Ailo 会话内允许执行项目 Gradle 构建脚本、下载依赖及创建构建所需的网络服务。文件写入仍限制在当前项目；此 macOS 沙箱不能保证脚本监听只对本机开放，请仅授权信任的项目。构建最长20分钟，可随时停止。',
      buttons:['允许本项目','暂不允许'],defaultId:1,cancelId:1,
    });
    if(choice.response!==0||signal.aborted)return false;
    buildGrants.add(root);return true;
  })();
  buildApprovals.set(root,pending);
  try{return await pending;}finally{buildApprovals.delete(root);}
};

storage.androidManager=require('./agent/android-device.cjs').createAndroidManager({
  directory:path.join(app.getPath('userData'),'android-runtime'),
  authorize:async(root,signal)=>{
    if(signal.aborted)return false;
    if(androidGrants.has(root))return true;
    if(androidApprovals.has(root))return androidApprovals.get(root);
    const pending=(async()=>{
      const state=await storage.readWorkspace();
      const project=state.projects.find(p=>path.join(storage.agentDirectory,'projects',key(p.id),'files')===root);
      if(!project)throw Error('项目不存在，不能授权设备操作');
      const choice=await dialog.showMessageBox(win,{
        type:'question',title:'授权项目模拟器验证',
        message:`允许“${project.name}”使用本机测试模拟器？`,
        detail:'本次 Ailo 会话内，允许创建并运行该项目专用模拟器、安装项目 APK、启动应用、读取测试日志和截图。不会操作个人设备、卸载应用或清除数据。模拟器会在 Ailo 退出时停止。',
        buttons:['允许本项目','暂不允许'],defaultId:1,cancelId:1,
      });
      if(choice.response!==0||signal.aborted)return false;
      androidGrants.add(root);return true;
    })();
    androidApprovals.set(root,pending);
    try{return await pending;}finally{androidApprovals.delete(root);}
  },
});

ipcMain.handle("chat:sessions", e=>{trusted(e);return chat.sessions();});
ipcMain.handle("chat:complete", async (e, input) => {
  trusted(e);
  const send=value=>{if(!e.sender.isDestroyed())e.sender.send('chat:status',{id:input.id,taskId:input.taskId,...value});};
  // A reconnect must attach to the existing job, never mark it as failed.
  if(chat.sessions().some(s=>s.taskId===input.taskId))throw Error('此会话正在执行或排队，请补充消息或等待完成。');
  try {
    const result=await chat.complete({...input,onRun:run=>send({run}),onText:content=>send({content}),onStatus:message=>send({message})});
    if(input.taskId)await storage.patchTask(input.taskId,{contextCheckpoint:result.contextCheckpoint,promptTokens:result.promptTokens,lastError:undefined,partialReply:undefined},[{id:input.id+'-assistant',role:'assistant',content:result.content,clarification:result.clarification,modelName:result.modelName}]);
    send({finished:true});return result;
  }catch(error){
    if(input.taskId&&!chat.sessions().some(s=>s.taskId===input.taskId))await storage.patchTask(input.taskId,{lastError:error.message});
    send({finished:!chat.sessions().some(s=>s.taskId===input.taskId)});throw error;
  }
});
ipcMain.handle("task:edit-last-message", (e, {id,messageId,content}) => {
  trusted(e);
  if(chat.sessions().some(s=>s.taskId===id))throw Error('请先停止回复再编辑消息');
  return storage.editLastMessage(id,messageId,content);
});
ipcMain.handle("task:patch", (e, {id,patch,append}) => { trusted(e); return storage.patchTask(id,patch,append); });
ipcMain.handle("chat:steer", (e, input) => { trusted(e); return chat.steer(input); });
ipcMain.handle("chat:cancel", (e, id) => {
  trusted(e);
  chat.cancel(id);
});
const schedules=require('./scheduled-tasks.cjs').createScheduledTasks({
  directory:app.getPath('userData'),cancel:id=>chat.cancel(id),
  execute:async(task,run)=>{
    const prompt=task.prompt+'\n\n[定时执行时间：'+new Date().toLocaleString('zh-CN')+'。请直接完成任务并报告结果；缺少信息或权限时请说明，不要假装已经完成。]';
    await storage.patchTask(run.taskId,{scheduledTaskId:task.id,scheduledRunId:run.id,scheduledAt:run.at,title:'定时 · '+task.title,request:prompt,materials:[],created:new Date().toISOString(),modelId:task.modelId,feishuEnabled:task.feishuEnabled===true,searchEnabled:task.searchEnabled},[{id:run.id+'-user',role:'user',content:prompt}]);
    try{
      const result=await chat.complete({id:run.id,taskId:run.taskId,modelId:task.modelId,feishuEnabled:task.feishuEnabled===true,searchEnabled:task.searchEnabled,messages:[{role:'user',content:prompt}]});
      await storage.patchTask(run.taskId,{modelName:result.modelName,contextCheckpoint:result.contextCheckpoint,promptTokens:result.promptTokens},[{id:run.id+'-assistant',role:'assistant',content:result.content,modelName:result.modelName,clarification:result.clarification}]);
      if(result.clarification||['blocked','waiting_permission','paused','running','understanding'].includes(result.agentRun?.status))throw Error('任务需要人工处理，请查看对话继续。');
    }catch(error){await storage.patchTask(run.taskId,{lastError:error.message});throw error;}
  },
  notify:(task,result)=>{
    if(win&&!win.isDestroyed())win.webContents.send('chat:status',{finished:true});
    const {Notification}=require('electron');
    if(Notification.isSupported())new Notification({title:result.status==='completed'?'定时任务已完成':'定时任务未完成',body:task.title}).show();
  },
});
storage.personalAssistant=require('./personal-assistant.cjs').createPersonalAssistant({storage,chat,schedules,notify:value=>{if(win&&!win.isDestroyed())win.webContents.send('chat:status',value);}});
for(const method of ['list','save','toggle','remove','run'])ipcMain.handle('schedules:'+method,(e,input)=>{trusted(e);return schedules[method](input);});
const page = pathToFileURL(path.join(__dirname, "dist/index.html")).href;
function trusted(e) {
  if (e.sender !== win?.webContents || e.senderFrame?.url !== page)
    throw Error("Untrusted caller");
}
ipcMain.handle("state:read", async (e) => {
  trusted(e);
  const state = await storage.readWorkspace();
  for (const task of state.tasks) {

    const run = await json(path.join(require('./agent/workspace-path.cjs').workspacePath(storage.agentDirectory,task),"runs",key(task.id)+".json"),null);
    if (run) {task.agentRun = publicRun(run);if(!chat.sessions().some(s=>s.taskId===task.id)&&['running','understanding'].includes(task.agentRun.status))task.agentRun.status='paused';}
  }
  state.tasks=require('./scheduled-records.cjs').associateScheduledRecords(state.tasks,await schedules.list());
  return state;
});
ipcMain.handle('project:openFolder',async(e,id)=>{
 trusted(e);const state=await storage.readWorkspace();const project=state.projects.find(p=>p.id===id);if(!project)throw Error('项目不存在');
 const root=await require('./agent/workspace-path.cjs').workspaceFiles(storage.agentDirectory,{id:'project-folder',projectId:project.id});
 if(!project.localPath)await require('node:fs/promises').mkdir(root,{recursive:true,mode:0o700});
 const error=await shell.openPath(root);if(error)throw Error('无法打开项目文件夹：'+error);
});
ipcMain.handle('project:remove',async(e,id)=>{
 trusted(e);const state=await storage.readWorkspace();const project=state.projects.find(p=>p.id===id);if(!project)throw Error('项目不存在');
 const canRemove=tasks=>!chat.sessions().some(s=>tasks.some(t=>t.id===s.taskId));
 if(!canRemove(state.tasks.filter(t=>t.projectId===id)))throw Error('项目有任务正在执行或排队，请先停止后再删除。');
 const answer=await dialog.showMessageBox(win,{type:'question',title:'删除项目',message:`删除“${project.name}”？`,detail:'项目及所属对话将从 Ailo 中删除，本地文件夹和文件保留。',buttons:['取消','删除项目'],defaultId:0,cancelId:0});
 if(answer.response!==1)return false;
 await storage.removeProject(id,canRemove);return true;
});
ipcMain.handle('project:openLocal' ,async e=>{
 trusted(e);
 const choice=await dialog.showOpenDialog(win,{title:'打开本地文件夹作为项目',buttonLabel:'打开项目',properties:['openDirectory']});
 if(choice.canceled||!choice.filePaths[0])return null;
 return storage.addLocalProject(choice.filePaths[0]);
});
ipcMain.handle("agent:files", async (e, taskId) => {
  trusted(e);
  const state=await storage.readWorkspace();
  const task=state.tasks.find(t=>t.id===taskId);
  if(!task)throw Error('任务不存在');
  return require('./agent/project-files.cjs').listProjectFiles(await require('./agent/workspace-path.cjs').workspaceFiles(storage.agentDirectory,task));
});
ipcMain.handle("agent:reveal", async (e, {taskId, artifactPath, projectFile = false}) => {
  trusted(e);
  const state = await storage.readWorkspace();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) throw Error("任务不存在");
  const project = require('./agent/workspace-path.cjs').workspacePath(storage.agentDirectory,task);
  const run = await json(path.join(project,"runs",key(task.id)+".json"),null);
  if (artifactPath) {
    if (projectFile) await require("./agent/project-files.cjs").projectFile(await require('./agent/workspace-path.cjs').workspaceFiles(storage.agentDirectory,task),artifactPath);
    else if (!run?.artifacts.some(a => a.path === artifactPath)) throw Error("成果不属于此任务");
    shell.showItemInFolder(await resolveFile(await require('./agent/workspace-path.cjs').workspaceFiles(storage.agentDirectory,task),artifactPath));
  } else {
    const error = await shell.openPath(await require('./agent/workspace-path.cjs').workspaceFiles(storage.agentDirectory,task));
    if (error) throw Error(error);
  }
});
ipcMain.handle('project:memory',async(e,id)=>{trusted(e);const state=await storage.readWorkspace();const p=state.projects.find(p=>p.id===id);if(!p)throw Error('项目不存在');return require('./project-memory.cjs').readMemory(storage.agentDirectory,p,state.tasks);});
ipcMain.handle('project:memorySave',async(e,{id,input})=>{trusted(e);const state=await storage.readWorkspace();if(!state.projects.some(p=>p.id===id))throw Error('项目不存在');return require('./project-memory.cjs').saveMemory(storage.agentDirectory,id,input);});
ipcMain.handle('agent:edit',async(e,{taskId,artifactPath,input})=>{trusted(e);const state=await storage.readWorkspace();const task=state.tasks.find(t=>t.id===taskId);if(!task)throw Error('任务不存在');if(chat.sessions().some(s=>s.taskId===taskId||(task.projectId&&state.tasks.find(t=>t.id===s.taskId)?.projectId===task.projectId)))throw Error('请等待当前任务停止后编辑');const root=await require('./agent/workspace-path.cjs').workspaceFiles(storage.agentDirectory,task);await require('./agent/project-files.cjs').projectFile(root,artifactPath);return require('./artifact-edit.cjs').editFile(root,path.join(require('./agent/workspace-path.cjs').workspacePath(storage.agentDirectory,task),'backups'),artifactPath,input);});
ipcMain.handle("agent:preview", async (e, {taskId, artifactPath, projectFile = false}) => {
  trusted(e);
  const state=await storage.readWorkspace();
  const task=state.tasks.find(t=>t.id===taskId);
  if(!task)throw Error('任务不存在');
  const project=require('./agent/workspace-path.cjs').workspacePath(storage.agentDirectory,task);
  const run=await json(path.join(project,'runs',key(task.id)+'.json'),null);
  if(projectFile)await require('./agent/project-files.cjs').projectFile(await require('./agent/workspace-path.cjs').workspaceFiles(storage.agentDirectory,task),artifactPath);
  else if(!run?.artifacts.some(a=>a.path===artifactPath))throw Error('成果不属于当前任务');
  const file=await resolveFile(await require('./agent/workspace-path.cjs').workspaceFiles(storage.agentDirectory,task),artifactPath);
  return require('./artifact-edit.cjs').previewFile(file);
});
ipcMain.handle("state:write", (e, state) => {
  trusted(e);
  if (Array.isArray(state?.tasks)) state = {...state,tasks:state.tasks.map(({agentRun,...task})=>task)};
  return storage.saveWorkspace(state, true);
});
for (const method of ["account", "register", "login", "logout"])
  ipcMain.handle("account:" + method, (e, input) => {
    trusted(e);
    return storage[method](input);
  });
const feishuCli=require('./feishu-cli.cjs').createFeishuCli({
  directory:app.getPath('userData'),openExternal:url=>shell.openExternal(url),
  confirmWrite:async(action,signal)=>{
    if(signal?.aborted)return false;
    const result=await dialog.showMessageBox(win,{type:'question',title:'确认飞书操作',
      message:action.purpose||'允许执行这项飞书操作？',
      detail:'将以你的飞书用户身份执行。请核对目标及完整内容：\n'+JSON.stringify({operation:action.operation,query:action.query,method:action.method,path:action.path,params:action.params,data:action.data},null,2),
      buttons:['执行','取消'],defaultId:1,cancelId:1});
    return result.response===0&&!signal?.aborted;
  }
});
ipcMain.handle('web:open',async(e,value)=>{trusted(e);let url;try{url=new URL(value);}catch{throw Error('链接无效');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>4000)throw Error('链接无效');await shell.openExternal(url.href);});
storage.feishuCli=feishuCli;
storage.knowledge=require('./knowledge.cjs').createKnowledge(app.getPath('userData'));
for(const method of ['list','save','search','read'])ipcMain.handle('knowledge:'+method,(e,input)=>{trusted(e);return storage.knowledge[method](input);});
ipcMain.handle('knowledge:removeDocument',async(e,input)=>{trusted(e);const choice=await dialog.showMessageBox(win,{type:'question',title:'删除资料',message:'从知识库移除此资料？',detail:'只删除 Ailo 中的文本副本，原文件不受影响。',buttons:['取消','删除'],defaultId:0,cancelId:0});if(choice.response===1)await storage.knowledge.removeDocument(input);});
ipcMain.handle('knowledge:remove',async(e,id)=>{trusted(e);const choice=await dialog.showMessageBox(win,{type:'question',title:'删除知识库',message:'删除此知识库及全部资料？',detail:'只删除 Ailo 中的副本，原文件不受影响。已有对话回答仍保留。',buttons:['取消','删除'],defaultId:0,cancelId:0});if(choice.response===1){await storage.knowledge.remove(id);return true;}return false;});
ipcMain.handle('knowledge:import',async(e,id)=>{trusted(e);const result=await dialog.showOpenDialog(win,{title:'导入知识库资料',properties:['openFile','multiSelections'],filters:[{name:'知识库资料',extensions:['pdf','xlsx','pptx','ppt','docx','txt','md','markdown','csv','tsv','json','yaml','yml','toml','xml','html','sql','py','js','ts']}]});return result.canceled?[]:storage.knowledge.import(id,result.filePaths);});
storage.amap=require('./amap-mcp.cjs').createAMap({directory:app.getPath('userData'),safeStorage,confirmWrite:async(action,signal)=>{
  if(signal.aborted)return false;
  const choice=await dialog.showMessageBox(win,{type:'question',title:'确认高德地图操作',message:action.purpose||'允许调用此高德工具？',detail:JSON.stringify({tool:action.query,params:action.params},null,2),buttons:['执行','取消'],defaultId:1,cancelId:1});return choice.response===0&&!signal.aborted;
}});
for(const method of ['status','save','test','disconnect'])ipcMain.handle('amap:'+method,(e,input)=>{trusted(e);return storage.amap[method](method==='save'?input:undefined);});
storage.mcpConnections=require('./mcp-connections.cjs').createMCPConnections({directory:app.getPath('userData'),safeStorage,openExternal:url=>shell.openExternal(url),confirmCall:async({server,tool,params,purpose},signal)=>{
  if(signal.aborted)return false;
  const choice=await dialog.showMessageBox(win,{type:'question',title:'确认应用工具操作',message:purpose||`允许调用“${server.name}”的工具？`,detail:`应用：${server.name}\n工具：${tool}\n参数：${JSON.stringify(params,null,2)}`,buttons:['执行','取消'],defaultId:1,cancelId:1});
  return choice.response===0&&!signal.aborted;
}});
for(const method of ['list','save','test','authorize','disconnect','remove','permissions','resolveCall'])ipcMain.handle('mcp:'+method,(e,input)=>{trusted(e);return storage.mcpConnections[method](input);});
storage.webSearch=require('./web-search.cjs').createWebSearch({directory:app.getPath('userData'),safeStorage});
for(const method of ['status','save','test','disconnect'])ipcMain.handle('web-search:'+method,(e,input)=>{trusted(e);return storage.webSearch[method](method==='save'?input:undefined);});
for(const method of ['status','begin','disconnect','openAuthorization','openPermissions'])ipcMain.handle('feishu-cli:'+method,(e,input)=>{trusted(e);return feishuCli[method](method==='begin'?input:undefined);});
ipcMain.handle('feishu-cli:installGuide',e=>{trusted(e);return shell.openExternal('https://github.com/larksuite/cli#installation--quick-start');});
const feishu=require('./feishu.cjs').createFeishu({directory:app.getPath('userData'),safeStorage});
for(const method of ['status','save','test','disconnect','readDocument'])ipcMain.handle('feishu:'+method,async(e,input)=>{
  trusted(e);
  const result=await feishu[method](input);
  if(method==='readDocument'){
    const fs=require('node:fs/promises'),sourceId=require('node:crypto').randomUUID();
    const directory=path.join(storage.agentDirectory,'imports');
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    await fs.writeFile(path.join(directory,sourceId),result.text,{mode:0o600});
    return {...result,sourceId};
  }
  return result;
});
ipcMain.handle('feishu:guide',e=>{trusted(e);return shell.openExternal('https://open.feishu.cn/app');});
ipcMain.handle("materials:paste", async (e, entries) => {
  trusted(e);
  return importPastedMaterials(entries, path.join(storage.agentDirectory, 'imports'));
});
ipcMain.handle("materials:pick", async (e) => {
  trusted(e);
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "需求与界面材料",
        extensions,
      },
    ],
  });
  if (result.canceled) return [];
  if (result.filePaths.length > 10) throw Error("一次最多添加 10 个材料文件。");
  const files = [];
  for (const filename of result.filePaths) {
    try {
      const material = await readMaterial(filename);
      const sourceId = require('node:crypto').randomUUID();
      const fs = require('node:fs/promises');
      const directory = path.join(storage.agentDirectory,'imports');
      await fs.mkdir(directory,{recursive:true,mode:0o700});
      await fs.copyFile(filename,path.join(directory,sourceId));
      await fs.chmod(path.join(directory,sourceId),0o600);
      files.push({...material,sourceId});
    } catch (error) {
      throw Error(path.basename(filename) + "：" + error.message);
    }
  }
  return files;
});
function create() {
  win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 760,
    minHeight: 600,
    title: "Ailo",
    icon: path.join(__dirname, "assets/ailo.png"),
    backgroundColor: "#faf9f5",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== page) e.preventDefault();
  });
  win.loadURL(page);
}
app.whenReady().then(async () => {
  if(!primaryInstance)return;
  app.setAboutPanelOptions({applicationName:"Ailo",applicationVersion:app.getVersion(),iconPath:path.join(__dirname,"assets/ailo.png")});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{label:"Ailo",submenu:[
      {role:"about",label:"关于 Ailo"},{type:"separator"},
      {role:"services",label:"服务"},{type:"separator"},
      {role:"hide",label:"隐藏 Ailo"},{role:"hideOthers",label:"隐藏其他"},{role:"unhide",label:"显示全部"},
      {type:"separator"},{role:"quit",label:"退出 Ailo"}
    ]}] : [{label:"文件",submenu:[{role:"quit",label:"退出 Ailo"}]}]),
    {label:"编辑",submenu:[{role:"undo",label:"撤销"},{role:"redo",label:"重做"},{type:"separator"},{role:"cut",label:"剪切"},{role:"copy",label:"复制"},{role:"paste",label:"粘贴"},{role:"selectAll",label:"全选"}]},
    {label:"显示",submenu:[{role:"resetZoom",label:"实际大小"},{role:"zoomIn",label:"放大"},{role:"zoomOut",label:"缩小"},{type:"separator"},{role:"togglefullscreen",label:"全屏"}]},
    {role:"windowMenu",label:"窗口"}
  ]));
  if (process.platform === "darwin") app.dock.setIcon(path.join(__dirname, "assets/ailo.png"));
  const state = await storage.readWorkspace();
  for (const task of state.tasks) {

    const file = path.join(require('./agent/workspace-path.cjs').workspacePath(storage.agentDirectory,task),"runs",key(task.id)+".json");
    const run = await json(file,null);
    if (run && ['running','understanding'].includes(run.status)) {
      run.status = 'paused';
      run.events.push({id:require('node:crypto').randomUUID(),type:'interrupted',at:new Date().toISOString(),detail:{message:'应用重新启动，执行已暂停。继续前检查已有文件与执行记录。'}});
      await writeJson(file,run);
    }
  }
  create();
  await schedules.start();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) create();
  });
});
let quitting=false;
app.on("before-quit", e => {
  if(quitting)return;
  e.preventDefault();schedules.stop();chat.cancelAll();
  Promise.allSettled([storage.androidManager.dispose(),feishuCli.dispose(),storage.amap.dispose(),storage.mcpConnections.dispose()]).finally(()=>{quitting=true;app.quit();});
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

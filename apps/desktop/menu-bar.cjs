function createMenuBar({Tray,Menu,nativeImage,iconPath,notifications,sessions,account,openWindow,openTask,testNotification,quit,platform=process.platform,intervalMs=3000}){
 const image=nativeImage.createFromPath(iconPath);if(image.isEmpty())throw Error('Ailo 菜单栏图标缺失');if(platform==='darwin')image.setTemplateImage(true);
 const tray=new Tray(image);let disposed=false,refreshing=false;
 const safe=fn=>()=>{void Promise.resolve().then(fn).catch(()=>{});};
 async function refresh(){
  if(disposed||refreshing)return;refreshing=true;
  try{
   const owner=(await account())?.id||'local',data=await notifications.read();
   if(disposed||owner!==((await account())?.id||'local'))return;
   const live=sessions(),waiting=live.filter(s=>s.phase==='queued').length,running=live.length-waiting,unread=data.items.filter(i=>!i.read).length;
   const recent=data.items.slice(0,5).map(item=>({label:(item.read?'':'• ')+item.title.slice(0,50),click:safe(()=>openTask(item.taskId,owner,item.id))}));
   const template=[{label:'Ailo',enabled:false},{label:live.length?`${running} 个任务执行中${waiting?` · ${waiting} 个等待执行`:''}`:'随时为你准备',enabled:false},{type:'separator'},
    {label:'显示 Ailo',click:safe(openWindow)},{label:'我的 Ailo',click:safe(()=>openTask('my-ailo-assistant',owner))},
    {label:`最近回复${unread?` · ${unread} 条未读`:''}`,submenu:recent.length?recent:[{label:'暂无提醒',enabled:false}]},{type:'separator'},
    {label:'系统回复提醒',type:'checkbox',checked:data.settings.enabled&&data.settings.native,click:item=>{void notifications.update({action:'settings',value:{enabled:true,native:item.checked}}).then(refresh).catch(()=>{});}},
    {label:'发送测试提醒',click:safe(testNotification)},{type:'separator'},{label:'退出 Ailo',click:safe(quit)}];
   tray.setToolTip(`Ailo${running?` · ${running} 个任务执行中`:''}${waiting?` · ${waiting} 个排队`:''}${unread?` · ${unread} 条未读`:''}`);
   if(platform==='darwin')tray.setTitle('');
   tray.setContextMenu(Menu.buildFromTemplate(template));
  }finally{refreshing=false;}
 }
 tray.on('right-click',()=>{void refresh().catch(()=>{});});
 const timer=setInterval(()=>void refresh().catch(()=>{}),intervalMs);timer.unref?.();
 void refresh().catch(()=>{});
 return {refresh,dispose(){if(disposed)return;disposed=true;clearInterval(timer);tray.destroy();}};
}
module.exports={createMenuBar};

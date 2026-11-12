const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createMenuBar}=require('../apps/desktop/menu-bar.cjs');
function setup(){
 let tray,menu,owner='local',opened=0,quit=0,tested=0;const navigated=[],settings={enabled:true,native:true};
 const image={isEmpty:()=>false,setTemplateImage(value){this.template=value;}};
 class Tray extends EventEmitter{constructor(icon){super();tray=this;this.icon=icon;}setToolTip(value){this.tooltip=value;}setTitle(value){this.title=value;}setContextMenu(value){menu=value;}destroy(){this.destroyed=true;}}
 const notices=[{id:'notice',taskId:'task',title:'天气回复',read:false}],live=[{phase:'running'},{phase:'queued'}];
 const notifications={read:async()=>({settings,items:notices}),update:async input=>{Object.assign(settings,input.value);}};
 const bar=createMenuBar({Tray,Menu:{buildFromTemplate:value=>value},nativeImage:{createFromPath:()=>image},iconPath:'template.png',notifications,sessions:()=>live,account:async()=>owner==='local'?null:{id:owner},openWindow:()=>{opened++;},openTask:(...value)=>navigated.push(value),testNotification:()=>{tested++;},quit:()=>{quit++;},intervalMs:100000});
 return {bar,notifications,settings,live,notices,image,menu:()=>menu,tray:()=>tray,openCount:()=>opened,navigated,quitCount:()=>quit,testCount:()=>tested,setOwner:value=>{owner=value;}};
}
test('macOS menu bar uses a theme-adaptive monochrome icon without a numeric badge',async t=>{
 const f=setup();t.after(()=>f.bar.dispose());await new Promise(setImmediate);
 assert.equal(f.image.template,process.platform==='darwin'?true:undefined);assert.match(f.tray().tooltip,/1 个任务执行中.*1 个排队.*1 条未读/);if(process.platform==='darwin')assert.equal(f.tray().title,'');
 assert.ok(f.menu().some(row=>row.label==='1 个任务执行中 · 1 个等待执行'));
 f.menu().find(row=>row.label==='显示 Ailo').click();f.menu().find(row=>row.label==='最近回复 · 1 条未读').submenu[0].click();f.menu().find(row=>row.label==='发送测试提醒').click();await new Promise(setImmediate);
 assert.equal(f.openCount(),1);assert.deepEqual(f.navigated[0],['task','local','notice']);assert.equal(f.testCount(),1);
 f.notices[0].read=true;f.live.splice(0);await f.bar.refresh();assert.ok(f.menu().some(row=>row.label==='随时为你准备'));assert.equal(f.tray().title,'');
 f.bar.dispose();assert.equal(f.tray().destroyed,true);f.bar.dispose();
});
test('notification checkbox persists the existing setting and account refresh does not reuse previous notices',async t=>{
 const f=setup();t.after(()=>f.bar.dispose());await new Promise(setImmediate);
 f.menu().find(row=>row.label==='系统回复提醒').click({checked:false});await new Promise(setImmediate);assert.equal(f.settings.native,false);
 f.setOwner('another');f.notices.splice(0);await f.bar.refresh();assert.equal(f.menu().find(row=>row.label==='最近回复').submenu[0].label,'暂无提醒');
 f.menu().find(row=>row.label==='退出 Ailo').click();await new Promise(setImmediate);assert.equal(f.quitCount(),1);
});
test('menu bar Shiba assets retain transparent facial details with black pixels at native and retina sizes',async()=>{
 const {createCanvas,loadImage}=require('../apps/desktop/node_modules/@napi-rs/canvas');
 for(const size of [18,36]){const filename=size===18?'ailo-trayTemplate.png':'ailo-trayTemplate@2x.png',actual=await loadImage(require('node:path').resolve(__dirname,'../apps/desktop/assets',filename));assert.equal(actual.width,size);assert.equal(actual.height,size);const canvas=createCanvas(size,size),ctx=canvas.getContext('2d');ctx.drawImage(actual,0,0);const data=ctx.getImageData(0,0,size,size).data;assert.equal(data[3],0);let visible=0;for(let i=0;i<data.length;i+=4)if(data[i+3]){visible++;assert.equal(data[i],0);assert.equal(data[i+1],0);assert.equal(data[i+2],0);}assert.ok(visible>size&&visible<size*size*.8);}
});

const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {resolveFile,normalizeProjectPath}=require('./workspace.cjs');
const {hash}=require('./visual-observation.cjs');
const mime={'.html':'text/html','.htm':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
async function projectResponse(root,request,onResource=()=>{}){
 try{
  const url=new URL(request.url);
  if(url.protocol!=='ailo-project:'||url.host!=='local'||!['GET','HEAD'].includes(request.method))return new Response('Blocked',{status:403});
  const relative=normalizeProjectPath(decodeURIComponent(url.pathname).replace(/^\//,''));
  if(relative.split('/').some(p=>p.startsWith('.')))return new Response('Blocked',{status:403});
  const type=mime[path.extname(relative).toLowerCase()];if(!type)return new Response('Unsupported resource',{status:415});
  const file=await resolveFile(root,relative),stat=await fs.stat(file);
  if(!stat.isFile()||stat.size>20*1024*1024)return new Response('Resource limit',{status:413});
  const bytes=await fs.readFile(file);onResource({path:relative,sha256:hash(bytes)});
  return new Response(request.method==='HEAD'?null:bytes,{headers:{'content-type':type,'content-security-policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'",'cache-control':'no-store'}});
 }catch{try{const relative=normalizeProjectPath(decodeURIComponent(new URL(request.url).pathname).replace(/^\//,''));onResource({path:relative,sha256:null});}catch{}return new Response('Unavailable project resource',{status:404});}
}
// No credentials, filesystem URLs, remote navigation, downloads, or Node in project pages.
function createBrowserObserver({BrowserWindow,session}){
 const active=new Map();
 function close(key){const state=active.get(key);if(state){active.delete(key);if(!state.win.isDestroyed())state.win.destroy();state.session.protocol.unhandle('ailo-project');}}
 async function execute(workspace,action,signal){
  const key=workspace.run.executionId+':'+workspace.files;
  const operation=action.operation||'open';
  if(!['open','inspect','click','fill','scroll','close'].includes(operation))throw Error('browser 操作无效');
  if(operation==='close'){close(key);return {closed:true};}
  if(signal.aborted)throw Error('已停止执行');
  let state=active.get(key);
  if(operation==='open'){
   const relative=normalizeProjectPath(action.path);
   if(!/\.html?$/i.test(relative))throw Error('请打开项目内 HTML 文件');
   await resolveFile(workspace.files,relative);
   const width=action.width??1280,height=action.height??900;
   if(!Number.isSafeInteger(width)||width<320||width>2560||!Number.isSafeInteger(height)||height<240||height>1600)throw Error('视口宽度须为320–2560，高度须为240–1600');
   close(key);
   const isolated=session.fromPartition('ailo-observe-'+randomUUID());
   isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
   isolated.setPermissionCheckHandler(()=>false);
   isolated.on('will-download',event=>event.preventDefault());
   isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!/^ailo-project:\/\/local\//.test(details.url)&&!details.url.startsWith('data:')}));
   const sources=new Map();
   isolated.protocol.handle('ailo-project',request=>projectResponse(workspace.files,request,source=>{if(sources.size>=300&&!sources.has(source.path))throw Error('资源数量超限');sources.set(source.path,source);}));
   const win=new BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{session:isolated,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true,backgroundThrottling:false,devTools:false}});
   state={win,session:isolated,path:relative,revision:workspace.run.revision,sources,errors:[]};active.set(key,state);
   win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('ailo-project://local/'))event.preventDefault();});
   win.webContents.on('will-redirect',(event,url)=>{if(!url.startsWith('ailo-project://local/'))event.preventDefault();});
   win.webContents.on('console-message',details=>{if(details.level==='error'&&state.errors.length<20)state.errors.push(String(details.message).slice(0,500));});
   win.webContents.on('render-process-gone',()=>close(key));
  }
  if(!state||state.win.isDestroyed())throw Error('浏览器未打开；请先 browser.open');
  const abort=()=>close(key);signal.addEventListener('abort',abort,{once:true});
  let timer;
  try{
   const work=async()=>{
    const web=state.win.webContents;
    if(operation!=='open')await require('./visual-observation.cjs').assertSources(workspace,{sources:[...state.sources.values()]});
    if(operation==='open')await web.loadURL('ailo-project://local/'+state.path.split('/').map(encodeURIComponent).join('/'));
    if(['click','fill'].includes(operation)){
     if(typeof action.selector!=='string'||!action.selector||action.selector.length>500)throw Error('需要不超过500字符的 CSS selector');
     if(operation==='fill'&&(typeof action.text!=='string'||action.text.length>10000))throw Error('填写内容须为10000字符以内文本');
     await web.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(action.selector)});if(!e)throw Error('未找到目标元素');${operation==='click'?'e.click();':`if(!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement))throw Error('仅支持文本输入框');const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set;setter.call(e,${JSON.stringify(action.text)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));`}return true;})()`);
    }
    if(operation==='scroll'){
     if(!Number.isSafeInteger(action.x??0)||!Number.isSafeInteger(action.y)||Math.abs(action.y)>100000||Math.abs(action.x??0)>100000)throw Error('滚动坐标无效');
     await web.executeJavaScript(`window.scrollTo(${action.x??0},${action.y})`);
    }
    // Scope belongs to the actual capture, never to a caller-provided label.
    const targetSelector=['open','inspect'].includes(operation)?action.selector:null;
    if(targetSelector&&(typeof targetSelector!=='string'||targetSelector.length>500))throw Error('selector 必须是不超过500字符的 CSS 选择器');
    const dom=await web.executeJavaScript('('+snapshotDOM.toString()+')('+JSON.stringify(targetSelector||null)+')');
    let rect=action.crop,scope={kind:'viewport',path:state.path,rect:{x:dom.scroll.x,y:dom.scroll.y,width:dom.viewport.width,height:dom.viewport.height}};
    if(targetSelector){
     if(!dom.target)throw Error('未找到观察元素');
     const r=dom.target.rect;
     if(r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>dom.viewport.width||r.y+r.height>dom.viewport.height)throw Error('目标元素未完整进入视口，请先滚动或调整视口，不能以局部截图声称完整观察');
     rect={x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.x+r.width)-Math.floor(r.x),height:Math.ceil(r.y+r.height)-Math.floor(r.y)};
     scope={kind:'element',path:state.path,selector:targetSelector,rect:{...rect,x:rect.x+dom.scroll.x,y:rect.y+dom.scroll.y}};
    }else if(rect){
     if(!['x','y','width','height'].every(k=>Number.isSafeInteger(rect[k]))||rect.x<0||rect.y<0||rect.width<=0||rect.height<=0||rect.x+rect.width>dom.viewport.width||rect.y+rect.height>dom.viewport.height)throw Error('截图区域必须位于当前视口内');
     scope={kind:'region',path:state.path,rect:{...rect,x:rect.x+dom.scroll.x,y:rect.y+dom.scroll.y}};
    }
    if(targetSelector&&action.crop)throw Error('selector 与 crop 请选择一种观察目标');
    const sourceAudit=await require('./sketch-fidelity.cjs').audit(workspace.files,state.path,dom,{reproduce:/sketch|设计稿|效果图|还原|复刻/i.test(workspace.run.currentRequest||workspace.run.goal||'')});
    for(const source of sourceAudit.sources)state.sources.set(source.path,source);
    const bytes=(await web.capturePage(rect)).toPNG(),relative='.ailo-observations/'+randomUUID()+'.png';
    await fs.writeFile(await resolveFile(workspace.files,relative,true),bytes,{mode:0o600});
    const rendererState={id:key,version:(workspace.run.observationStates?.[key]||0)+1};
    workspace.run.observationStates||={};workspace.run.observationStates[key]=rendererState.version;
    return {path:state.path,screenshot:relative,sha256:hash(bytes),pixelSize:{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)},revision:workspace.run.revision,sources:[...state.sources.values()],scope,rendererState,dom,sourceAudit,errors:state.errors.slice(),notice:'本地隔离网页观察；远程资源被阻止。visibleText 为当前视口文本近似，不代表遮挡与视觉质量已验证；fullText 为文档内容。四向越界、裁剪与资源诊断仅供调查，长页面下方内容不自动属于缺陷。'};
   };
   return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{close(key);reject(Error('网页观察超过20秒，已关闭页面'));},20000);})]);
  }catch(error){close(key);throw error;}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
 }
 return {execute,close(workspace){close(workspace.run.executionId+':'+workspace.files);},dispose(){for(const key of active.keys())close(key);}};
}
async function snapshotDOM(selector){
 await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const elements=[...document.querySelectorAll('body *')].slice(0,3000),root=selector?document.querySelector(selector):document.body;
 const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
 const visible=r=>r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
 const fullText=(document.body?.textContent||'').slice(0,12000),parts=[];
 // Diagnose the entire document even when the screenshot targets a small element.
 // A scrollport can reveal content outside its current bounds. Project reachable
 // text into that scrollport before checking outer clipping ancestors.
 function clipping(node,bounds){
  const projected={left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom};
  let currentlyClipped=false,unreachable=false;
  for(let e=node.parentElement;e;e=e.parentElement){
   const css=getComputedStyle(e),box=e.getBoundingClientRect();
   for(const [start,end,mode,position,extent,client] of [
    ['left','right',css.overflowX,e.scrollLeft,e.scrollWidth,e.clientWidth],
    ['top','bottom',css.overflowY,e.scrollTop,e.scrollHeight,e.clientHeight]
   ]){
    if(!/^(hidden|clip|auto|scroll|overlay)$/.test(mode))continue;
    if(bounds[end]<=box[start]||bounds[start]>=box[end])currentlyClipped=true;
    if(projected[end]>box[start]&&projected[start]<box[end])continue;
    const needed=projected[end]<=box[start]?box[start]-projected[end]+1:projected[start]-box[end]+1;
    const available=projected[end]<=box[start]?position:Math.max(0,extent-client-position);
    if(!/^(auto|scroll|overlay)$/.test(mode)||needed>available+1){unreachable=true;continue;}
    const size=Math.min(projected[end]-projected[start],box[end]-box[start]);
    projected[start]=Math.max(box[start],Math.min(projected[start],box[end]-size));
    projected[end]=projected[start]+size;
   }
  }
  return {currentlyClipped,unreachable};
 }
 const renderHealth={imageElements:document.images.length,cssImageElements:0,svgElements:0,canvasElements:0,textSamples:0,defaultSmallText:0,tinyLineHeightText:0};
 let textNodes=0,clippedTextNodes=0,scrollableTextNodes=0,textScanTruncated=false;
 if(document.body){const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n,count=0;while((n=walker.nextNode())&&count++<12000){
  if(!n.textContent.trim())continue;let shown=true;
  for(let e=n.parentElement;e;e=e.parentElement){const css=getComputedStyle(e);if(css.visibility==='hidden'||css.display==='none'||Number(css.opacity)===0||e.hidden||e.inert||e.getAttribute('aria-hidden')==='true'){shown=false;break;}}
  if(!shown)continue;const range=document.createRange();range.selectNodeContents(n);const r=range.getBoundingClientRect();
  if(!r.width||!r.height)continue;
  const textStyle=getComputedStyle(n.parentElement);renderHealth.textSamples++;
  if(/Arial/i.test(textStyle.fontFamily||'')&&parseFloat(textStyle.fontSize)<=16)renderHealth.defaultSmallText++;
  if(parseFloat(textStyle.lineHeight)<=4)renderHealth.tinyLineHeightText++;
  textNodes++;const state=clipping(n,r);
  if(state.unreachable)clippedTextNodes++;
  else if(state.currentlyClipped)scrollableTextNodes++;
  if(!visible(r))continue;
  if(state.currentlyClipped)shown=false;
  if(shown&&parts.join(' ').length<6000)parts.push(n.textContent.trim());
 }textScanTruncated=!!n;}
 const overflow={left:0,top:0,right:0,bottom:0},clipped=[];
 for(const e of elements){const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;
  if(r.right+scrollX<0)overflow.left++;if(r.bottom+scrollY<0)overflow.top++;
  if(r.left+scrollX>=innerWidth)overflow.right++;if(r.top+scrollY>=innerHeight)overflow.bottom++;
  const css=getComputedStyle(e);if(css.backgroundImage&&css.backgroundImage!=='none'&&/url\(/.test(css.backgroundImage))renderHealth.cssImageElements++;
  if(e.tagName.toLowerCase()==='svg')renderHealth.svgElements++;if(e.tagName.toLowerCase()==='canvas')renderHealth.canvasElements++;
  if(clipped.length<20&&/hidden|clip/.test(css.overflow+css.overflowX+css.overflowY)&&(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1))clipped.push({tag:e.tagName,id:e.id,rect:rect(e)});
 }
 const visibleText=parts.join(' ').slice(0,6000);
 // Pending and lazy images are not proof of a failed resource request.
 const allImages=[...document.images],imageItems=allImages.slice(0,2000).map(i=>({src:i.getAttribute('src'),status:!i.complete?'pending':i.naturalWidth>0?'loaded':'failed'}));
 const imageHealth={items:imageItems,total:allImages.length,truncated:allImages.length>imageItems.length};
 return {title:document.title,text:(document.body?.innerText||'').slice(0,6000),visibleText,fullText,renderHealth,layoutHealth:{scope:'document',textNodes,clippedTextNodes,scrollableTextNodes,truncated:textScanTruncated},textCoverage:{visible:'viewport approximation; occlusion not proven',full:fullText.length<12000?'complete within DOM':'truncated'},target:selector&&root?{selector,rect:rect(root),text:(root.textContent||'').slice(0,6000)}:null,url:location.href,viewport:{width:innerWidth,height:innerHeight},page:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},scroll:{x:scrollX,y:scrollY},imageHealth,missingImages:imageItems.filter(i=>i.status==='failed').slice(0,20).map(i=>i.src),offscreen:overflow.left+overflow.top,overflow,clipped,diagnosticsCoverage:{elements:elements.length,truncated:document.querySelectorAll('body *').length>3000},controls:elements.filter(e=>e.matches('button,input,select,textarea,a')).slice(0,40).map(e=>({tag:e.tagName,id:e.id,text:(e.innerText||e.getAttribute('aria-label')||'').slice(0,100)}))};
}
module.exports={createBrowserObserver,projectResponse,snapshotDOM};

const QRCode=require('qrcode');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function payload(pair){const url=new URL(pair.url);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('配对地址无效');if(!/^\d{8}$/.test(pair.code)||!Number.isFinite(pair.expires)||pair.expires<=Date.now())throw Error('配对码已失效');return {type:'ailo-pair',version:1,url:url.origin,code:pair.code,expires:pair.expires};}
async function html(pair){
 const p=payload(pair),svg=await QRCode.toString(JSON.stringify(p),{type:'svg',errorCorrectionLevel:'M',margin:3,width:196});
 const time=new Date(p.expires).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>手机配对</title><style>
 *{box-sizing:border-box}body{margin:0;background:#fff;color:#24262a;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;text-align:center}
 main{padding:20px 28px 16px}h1{margin:0 0 7px;font-size:18px;line-height:26px;font-weight:600;letter-spacing:-.3px}.subtitle{margin:0;color:#858991;font-size:12px;line-height:19px}
 .qr{margin:12px auto 10px;width:206px;height:206px;border:1px solid #edf0f3;border-radius:16px;display:flex;align-items:center;justify-content:center}svg{display:block;width:196px;height:196px}
 .code-label{font-size:11px;color:#9398a0;margin:0 0 5px}code{font:500 21px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:3px;padding-left:3px}.address{margin:8px 0 0;color:#858991;font-size:11px;line-height:18px;overflow-wrap:anywhere}
 footer{margin-top:14px;border-top:1px solid #eff1f4;padding-top:12px;font-size:11px;line-height:18px;color:#969ba3}footer p{margin:0}.expiry{color:#727983;margin-bottom:3px}
 </style><main><h1>扫码连接手机</h1><p class="subtitle">手机 Ailo → ＋ → 扫一扫配对电脑</p><div class="qr">${svg}</div><p class="code-label">也可手动输入配对码</p><code>${escape(p.code)}</code><p class="address">${escape(p.url)}</p><footer><p class="expiry">有效至 ${escape(time)} · 仅限使用一次</p><p>${p.url.startsWith('http:')?'手机扫码需使用云端 HTTPS 连接。':'仅供自己的设备使用，过期后重新打开此窗口。'}</p></footer></main></html>`;
}
async function show({BrowserWindow,parent,pair}){const content=await html(pair),win=new BrowserWindow({width:360,height:490,parent,modal:false,autoHideMenuBar:true,resizable:false,title:'手机扫码配对',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(content));return win;}
module.exports={payload,html,show};

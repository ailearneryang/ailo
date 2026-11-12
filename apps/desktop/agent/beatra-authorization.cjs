// A narrowly matched collect_later helper may resume its durable device approval.
// This is not a general command retry policy. Never replay generation/payment calls.
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {resolveFile}=require('./workspace.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
async function helper(root,command){
 const match=/^((?:\/[A-Za-z0-9_.-]+)*\/?python3(?:\.\d+)?)\s+(?:-u\s+)?["']?(\.runtime\/ailo-skills\/[a-f0-9]{64}\/scripts\/authorize\.py)["']?(?:\s+--wait-seconds\s+(\d+))?\s*$/.exec(command||'');
 if(!match||match[3]&&(Number(match[3])<30||Number(match[3])>900))return;
 try{const script=await resolveFile(root,match[2]);const stat=await fs.stat(script);if(stat.size>300000)return;const text=await fs.readFile(script,'utf8');const slug=/^PACKAGE_SLUG = "([a-z0-9-]+)"/m.exec(text)?.[1];if(!slug||!text.includes('CLIENT_FEATURES = "collect_later"')||!text.includes('BEATRA_AUTH_PENDING')||!text.includes('pending_authorization.json')||!text.includes('"--wait-seconds"'))return;return {command:match[1]+' -u '+match[2]+' --wait-seconds 60',clientId:'beatra-skill-'+slug,scriptHash:hash(text)};}catch{return;}
}
async function json(root,name){try{const file=await resolveFile(root,'.runtime/home/.beatra/'+name);const s=await fs.stat(file);if(s.size>64000)return;return JSON.parse(await fs.readFile(file,'utf8'));}catch{return;}}
async function state(root,config,now=Date.now){
 const pending=await json(root,'pending_authorization.json');
 if(!pending||pending.schema_version!==1||pending.client_id!==config.clientId||typeof pending.device_code!=='string'||!pending.device_code||!Number.isFinite(pending.expires_at))return {state:'unknown'};
 return {state:pending.expires_at*1000>now()?'pending':'expired',approvalId:hash(config.clientId+'\0'+pending.device_code),expiresAt:pending.expires_at*1000,opened:pending.opened===true};
}
async function execute(root,command,signal,{run,onStatus,now=Date.now,maxDurationMs=15*60*1000,...options}){
 const config=await helper(root,command);if(!config)return run(root,command,signal,120000,options);
 const started=now();let pinned=(await state(root,config,now)).approvalId,last,attempts=0;
 while(attempts<15&&now()-started<maxDurationMs){
  signal.throwIfAborted();
  // Ensure the mounted helper and approval did not change between attempts.
  const current=await helper(root,command);if(!current||current.scriptHash!==config.scriptHash)return {...(last||{exitCode:3,output:''}),authorization:{provider:'beatra',state:'changed',attempts},notice:'授权脚本已变化，已停止自动续查。'};
  const before=await state(root,config,now);if(pinned&&before.approvalId!==pinned)return {...(last||{exitCode:3,output:''}),authorization:{provider:'beatra',state:'changed',attempts},notice:'原审批记录已变化或不可读取，未自动创建新审批。'};
  if(before.state==='expired'){return {...(last||{exitCode:3,output:''}),authorization:{provider:'beatra',state:'expired',attempts},notice:'Beatra 审批已过期，需要重新授权；未自动创建新审批。'};}
  try{onStatus?.(attempts?'仍在等待 Beatra 确认同一次授权，无需在对话中重复作答…':'正在等待 Beatra 授权确认…');}catch{}
  // The helper returns pending itself before the host command deadline.
  last=await run(root,config.command,signal,90000,options);attempts++;
  if(last.timedOut)return {...last,authorization:{provider:'beatra',state:'unknown',attempts},notice:'授权检查未完整退出；保留审批，不自动重放。'};
  if(last.exitCode===0)return {...last,authorization:{provider:'beatra',state:String(last.output||'').includes('Beatra is ready')?'ready':'stopped',attempts}};
  const after=await state(root,config,now);
  if(last.exitCode!==3||!String(last.output||'').includes('BEATRA_AUTH_PENDING'))return {...last,authorization:{provider:'beatra',state:'stopped',attempts}};
  if(!after.approvalId||pinned&&after.approvalId!==pinned)return {...last,authorization:{provider:'beatra',state:'changed',attempts},notice:'原审批记录已变化或不可读取，未自动续查。'};
  if(!pinned&&!after.opened)return {...last,authorization:{provider:'beatra',state:'needs_user',attempts},notice:'请先打开输出中的 Beatra 审批链接并选择 Allow；不用在聊天中重复填写答案。审批已保存，可继续同一流程。'};
  pinned=after.approvalId;
  if(after.state!=='pending')return {...last,authorization:{provider:'beatra',state:after.state,attempts}};
 }
 return {...(last||{exitCode:3,output:''}),authorization:{provider:'beatra',state:'pending',attempts},notice:'Beatra 尚未确认 Allow；同一次审批已保留，不需要在聊天里回答。请确认浏览器审批页是否已选择 Allow。'};
}
async function reconcile(workspace,entry){
 if(entry.action!=='run_command'||entry.status!=='unknown'||!entry.timedOut)return false;
 const event=[...(workspace.run.events||[])].reverse().find(e=>e.type==='run_command'&&e.detail?.actionId===entry.id&&e.detail.result?.timedOut);
 if(!event)return false;
 const config=await helper(workspace.files,event.detail.command);if(!config)return false;
 const pending=await state(workspace.files,config);if(pending.state!=='pending')return false;
 // A killed helper with a durable collect_later approval is a known pending
 // authorization, never proof of completion and never permission to replay others.
 entry.status='authorization_pending';entry.authorization={provider:'beatra',state:'pending',approvalId:pending.approvalId,expiresAt:pending.expiresAt};entry.recovery='same_approval';
 await workspace.event('authorization_pending',{actionId:entry.id,message:'已核对保存的 Beatra 审批，授权仍待确认，可继续同一审批；没有声明授权成功。'});return true;
}
module.exports={helper,state,execute,reconcile};

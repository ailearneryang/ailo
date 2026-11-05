// A user input is an accounting boundary, not a new task or recovery budget.
function continuationOnly(text){return /^(?:服务已恢复|网络已恢复|继续|继续任务|继续执行|继续验收|重试|再试一次|继续原任务|保留原要求|从已有文件继续检查|请从已保存的任务状态继续|先检查已有成果|不重复执行已完成步骤)+$/.test(String(text||'').replace(/[\s，。；、,.;！!]/g,''));}
function begin(run){
 if(run.inputTurn?.inputId===run.inputKey){run.inputTurn.problemBaseline||=require('./problem-state.cjs').rows(run).map(({id,status})=>({id,status}));return run.inputTurn;}
 run.inputTurn={previewSha256:run.resultPreview?.sha256,problemBaseline:require('./problem-state.cjs').rows(run).map(({id,status})=>({id,status})),inputId:run.inputKey,request:run.currentRequest,startedAt:new Date().toISOString(),eventIds:(run.events||[]).map(e=>e.id),observationIds:(run.observationIndex||[]).map(e=>e.id),artifacts:Object.fromEntries((run.artifacts||[]).map(f=>[f.path,f.sha256])),requiresPlan:!continuationOnly(run.currentRequest),followup:!!run.acceptanceInputKey&&run.acceptanceInputKey!==run.inputKey||!!run.inputTurn&&run.inputTurn.inputId!==run.inputKey};
 return run.inputTurn;
}
function events(run){const prior=new Set(run.inputTurn?.eventIds||[]);return (run.events||[]).filter(e=>!prior.has(e.id));}
function context(run){const turn=run.inputTurn;return turn&&{inputId:turn.inputId,request:turn.request,followup:turn.followup,existingObligation:require('./existing-obligation.cjs').context(run),requirementsRecorded:!turn.requiresPlan||run.acceptanceInputKey===turn.inputId,instruction:'首先处理本次输入。新增补充要求须纳入 plan 的 requirements；existingObligation中的明确续办可用inputUse关联已有未完成要求，保留原文与验收，不强制新增重复项。保留仍有效的原要求、未通过项和证据；受影响的旧核验不能替代本轮核验。继续指令可复用原计划与证据，不重做已完成操作。已有文件数量不是本轮完成量。'};}
function assertPlan(run,next,action){
 if(!run.inputTurn?.followup||!run.inputTurn.requiresPlan||run.acceptanceInputKey===run.inputKey)return;
 const reusable=require('./existing-obligation.cjs').current(run,next);
 if(reusable.length&&(!action?.inputUse||action.inputUse.some(m=>m.inputId===run.inputKey&&m.disposition==='requirements'&&m.requirementIds?.some(id=>reusable.includes(id)))))return;
 if(reusable.length&&Array.isArray(action?.inputUse)&&!action.inputUse.some(m=>m.inputId===run.inputKey))throw Object.assign(Error('输入落实记录无效：当前inputId='+run.inputKey+'；请逐字复制该ID并用requirementIds关联已有未完成要求：'+reusable.join('、')),{code:'INPUT_COVERAGE_PENDING'});
 const old=run.requirements||[];
 if(old.length&&!next.some(r=>!old.some(p=>p.id===r.id&&p.text===r.text&&p.type===r.type&&JSON.stringify(p.scope)===JSON.stringify(r.scope)&&JSON.stringify(p.scopes)===JSON.stringify(r.scopes))))throw Object.assign(Error('本次补充要求尚未映射到具体可验收的 requirements；当前inputId='+run.inputKey+'；若原要求已包含本次完整指令，可用inputUse关联已有未完成要求；否则请保留有效原要求，并补充或更新受本次输入影响的要求，不能原样沿用旧验收完成新请求。'),{code:'INPUT_REQUIREMENTS_PENDING'});
}
function assertReady(run){
 if(require('./input-coverage.cjs').pending(run).length||run.inputTurn?.requiresPlan&&run.inputTurn.followup&&run.acceptanceInputKey!==run.inputKey)throw Object.assign(Error('本次补充要求尚未纳入计划；请先读取必要来源并用 plan 关联本批每条输入、受影响要求与执行步骤，再修改、构建或核验。旧计划不能替代本次输入。'),{code:'INPUT_REQUIREMENTS_PENDING'});
}
// Classify from connector operation contracts, never inferred business names,
// API paths or a model-supplied claim that a call is read-only. Unknown remote
// calls must wait for adoption; their transport can carry durable side effects.
function requiresAdoption(action){
 if(!action||typeof action!=='object')return false;
 if(action.action==='android_device')return !['status','logs','screenshot'].includes(action.operation);
 if(['write_file','edit_file','edit_spreadsheet','run_command','build_android','browser','verify','finish','artifact'].includes(action.action))return true;
 if(action.action==='feishu'){
  if(['schema','help'].includes(action.operation))return false;
  if(action.operation==='api')return action.method!=='GET';
  if(action.operation==='shortcut')return require('../feishu-request.cjs').shortcuts[action.query]?.write!==false;
  return true;
 }
 if(action.action==='mcp'||action.action==='amap')return action.operation!=='list';
 if(action.action==='memory')return !['list','search','read'].includes(action.operation);
 if(action.action==='assistant')return !['list','read'].includes(action.operation);
 return false;
}
function changes(run,files){const prior=run.inputTurn?.artifacts||{},changed=files.filter(f=>prior[f.path]!==f.sha256);return {inputId:run.inputKey,request:run.currentRequest,changedArtifacts:changed.map(f=>f.path),retainedArtifacts:files.filter(f=>prior[f.path]===f.sha256).map(f=>f.path)};}
module.exports={begin,events,context,changes,assertPlan,assertReady,requiresAdoption,continuationOnly};

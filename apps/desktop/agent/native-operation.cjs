// A narrow, source-backed file transition: full native read -> one native write
// (or its original reconciled result) -> full native read. Historical contents
// are not current-state evidence; every proof also binds the current after hash.
const fs=require('node:fs/promises');
const proof=require('./evidence.cjs');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const text={type:'string',maxLength:4000};
const fields={phase:{type:'string',enum:['before','effect','after']},path:{type:'string',minLength:1,maxLength:500},beforeEvidenceId:{type:'string',minLength:36,maxLength:36},actionId:{type:'string',minLength:36,maxLength:36},afterEvidenceId:{type:'string',minLength:36,maxLength:36},beforeText:text,afterText:text,sourceInputId:{type:'string',minLength:1,maxLength:160},sourceQuote:{type:'string',minLength:1,maxLength:1200}};
const schema={type:'object',additionalProperties:false,required:Object.keys(fields),properties:fields};
const failure=message=>Object.assign(Error('原生文件过程证据无效：'+message),{code:'NATIVE_OPERATION_INVALID'});
function directive(text){return String(text||'').replace(/```[\s\S]*?```/g,'').split('\n').filter(line=>!/^\s*>/.test(line)).join('\n');}
function escape(text){return text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function literal(value){
 if(!value)return '(?:""|\'\'|空|[Ee]mpty)';
 const v=escape(value);return '(?:'+v+'|"'+v+'"|\''+v+'\'|“'+v+'”)';
}
function nativeLine(phase,path,value,{source=false}={}){
 const p=escape(path),v=literal(value),end='[。.]?$',read='(?:读取|[Rr]ead(?:_file)?)\\s*'+p+'\\s*';
 if(phase==='before'){
  const marker='(?:初始(?:值|内容)?|原始(?:值|内容)?|写入前(?:值|内容)?|[Ii]nitial(?:\\s+value)?|[Bb]efore(?:\\s+value)?'+(source?'|当前(?:值|内容)?|[Cc]urrent(?:\\s+value)?':'')+')';
  return new RegExp('^(?:请\\s*)?(?:先\\s*)?'+read+'(?:[，,]\\s*)?(?:当前值\\s*[，,]\\s*)?(?:确认|[Cc]onfirm)?\\s*'+marker+'\\s*(?:为|是|=|：|:)?\\s*(?:字符串|[Ss]tring)?\\s*'+v+end,'u');
 }
 if(phase==='effect')return new RegExp('^(?:(?:用|使用|通过)\\s*)?(?:一次\\s*)?write_file\\s*(?:将|把|to)?\\s*'+p+'\\s*(?:写为|写成|写入值(?:为)?|写入内容(?:为)?|as|to)\\s*(?:字符串|[Ss]tring)?\\s*'+v+'(?:\\s*[（(](?:不加换行|不换行|无换行|no newline)[）)])?'+end,'u');
 return new RegExp('^(?:写入后\\s*|[Aa]fter writing\\s*)?(?:再|重新|再次|然后)?\\s*'+read+'(?:[，,]\\s*)?(?:(?:核对|确认|检查|check|verify)\\s*(?:实际结果|实际值|结果|内容|actual result|value)(?:\\s*(?:为|是|=|：|:)\\s*'+v+')?)?'+end,'u');
}
function assertPositive(text){
 if(/(?:只|仅|仅需|只需)(?:分析|解释|讨论|评估|审查|描述|模拟)|(?:不要|禁止|请勿|勿|不得|不许)\s*(?:执行|运行|操作)(?:以下|这些|这段|上述|下面|任何|所有)|(?:analysis only|only analy[sz]e|do not execute|don't execute)/i.test(text))throw failure('完整用户消息是分析/禁止执行语境，不能摘录其中的步骤作为执行依据');
 if(/(?:不要|不得|禁止|不许|不能|不准|不允许|勿|do\s+not|don’t|don't|never)[^，。；,;\n]{0,40}(?:\bwrite_file\b|读取|\bread(?:_file)?\b)/i.test(text))throw failure('否定native操作的原文不是执行授权或过程验收依据');
}
function source(run,operation){
 const entry=run.inputCoverage?.entries?.find(e=>e.inputId===operation.sourceInputId);
 if(!entry||!['planned','verified'].includes(entry.status)||!entry.text||!entry.sourceHash)throw failure('须引用已纳入计划的原用户输入，不能引用模型摘要或未处理附件');
 if(entry.materialCount)throw failure('此窄入口不能核对带附件消息的完整原文哈希；不能跳过来源校验');
 if(proof.hash(JSON.stringify([entry.text,[]]))!==entry.sourceHash)throw failure('原用户消息原文/哈希不一致或仅剩截断摘要');
 if(!Number.isFinite(Date.parse(entry.receivedAt)))throw failure('缺少原用户输入的可信接收时间，不能倒推操作授权');
 const request=directive(entry.text),quote=operation.sourceQuote;assertPositive(request);
 if(!request.includes(quote))throw failure('须逐字引用用户明确的native文件过程');
 const read=/读取|\bread(?:_file)?\b/i.exec(request),writes=[...request.matchAll(/\bwrite_file\b/g)];
 if(!read||writes.length!==1||read.index>=writes[0].index)throw failure('完整用户消息须有唯一且有序的读取→write_file→后读指令，含糊过程不适用');
 const preamble=request.slice(0,read.index).trim();
 const localPrefix=/^(?:只|仅)在(?:隔离(?:试验)?目录|当前(?:项目)?(?:工作区|目录)|项目(?:目录|工作区))(?:内)?操作[：:]$/u;
 if(!/^(?:请|请先|先)?$/u.test(preamble)&&!localPrefix.test(preamble))throw failure('此窄入口只接受完整正向native操作指令，不从任意示例、分析或禁止语境中摘录步骤');
 const parts=text=>text.split(/[，。；,;\n]/u).map(x=>x.trim()).filter(Boolean),prior=parts(request.slice(read.index,writes[0].index));
 if(prior.length!==2||!/^(?:只)?(?:用|使用|通过)?一次$|^(?:use\s+)?(?:one|single)$/iu.test(prior[1]))throw failure('一次必须明确限定write_file动作自身的完整clause，不能来自别的读取或额外写入');
 const split=text=>text.split(/[，。；,;\n]/u)[0].trim(),before=prior[0],rest=request.slice(writes[0].index),effect=split(rest),remaining=rest.slice(effect.length),afterRead=/读取|\bread(?:_file)?\b/i.exec(remaining);
 if(!afterRead||!/^[，。；,;\n\s]*(?:然后\s*)?(?:再|重新|再次)?\s*$/u.test(remaining.slice(0,afterRead.index)))throw failure('原用户消息缺少唯一明确写入后读取指令，额外或含糊步骤不适用');
 const after=split(remaining.slice(afterRead.index));
 if(!quote.includes(before)||!quote.includes(effect)||!quote.includes(after)||!nativeLine('before',operation.path,operation.beforeText,{source:true}).test(before)||!nativeLine('effect',operation.path,operation.afterText,{source:true}).test(effect))throw failure('原用户各阶段的路径、完整值或方向不一致；不能用数字子串、另一路径或摘录改写授权');
 const implied=/^(?:读取|read(?:_file)?)\s*(?:实际结果|实际文件|文件实际内容|实际文件内容|实际值|文件内容|该文件|内容|结果|it|the file|actual result|the actual result)[。.]?$/iu;
 if(!nativeLine('after',operation.path,operation.afterText,{source:true}).test(after)&&!implied.test(after))throw failure('后读须明确同一路径或唯一无歧义的实际结果，不能改读其他文件');
 for(const tail of parts(remaining.slice(afterRead.index+after.length))){
  const output=/^输出\s+([^\s]+)\s+说明(?:最终值|最终结果|结果)(?:及|和)(?:核对依据|依据)$/u.exec(tail);
  if(output){require('./workspace.cjs').normalizeProjectPath(output[1]);continue;}
  if(/^(?:(?:结果未知时|未知结果)(?:必须)?(?:先)?核对(?:实际文件)?|不能(?:直接)?重放写入|不用脚本或命令替代这次(?:计数|写入|操作))$/u.test(tail))continue;
  throw failure('完整用户消息包含本窄过程之外的后续语境或义务，不能摘录其中步骤为machine proof');
 }
 return {inputId:entry.inputId,sourceHash:entry.sourceHash,quote,receivedAt:entry.receivedAt};
}
function prepare(run,operation,requirement){
 if(!operation||typeof operation!=='object'||Array.isArray(operation)||Object.keys(operation).some(k=>!Object.hasOwn(fields,k))||Object.keys(fields).some(k=>!Object.hasOwn(operation,k)))throw failure('operation须完整提供phase、路径、前后读取、原actionId、前后文本和用户来源');
 if(!['before','effect','after'].includes(operation.phase)||!uuid.test(operation.beforeEvidenceId)||!uuid.test(operation.afterEvidenceId)||!uuid.test(operation.actionId)||operation.beforeEvidenceId===operation.afterEvidenceId)throw failure('须使用不同的完整真实读取ID与原write_file actionId');
 const path=require('./workspace.cjs').normalizeProjectPath(operation.path);
 if(path!==operation.path||typeof operation.beforeText!=='string'||typeof operation.afterText!=='string'||operation.beforeText.length>4000||operation.afterText.length>4000||operation.beforeText===operation.afterText||typeof operation.sourceInputId!=='string'||!operation.sourceInputId||operation.sourceInputId.length>160||typeof operation.sourceQuote!=='string'||!operation.sourceQuote.trim()||operation.sourceQuote.length>1200)throw failure('仅支持有界完整文本的真实前后变化，不猜测、截断或改写目标值');
 if(requirement.type==='visual'||!['content','behavior'].includes(requirement.type)||requirement.type==='behavior'&&operation.phase!=='effect')throw failure('文件过程只能证明明确的文件读取/写入过程，不能代替视觉或一般行为验收');
 const ranges=[requirement.scope,...(requirement.scopes||[])].filter(Boolean);
 if(ranges.some(r=>r.kind!=='file'||r.path!==path)||!requirement.text?.includes(path))throw failure('必须保留原要求的同文件范围，不能覆盖网页、元素、区域或其他文件');
 const words=requirement.text;assertPositive(words);
 if(operation.phase==='effect'?!/\bwrite_file\b/.test(words):!/(?:读取|\bread(?:_file)?\b)/i.test(words))throw failure('原要求须明确对应native文件操作，读取不能证明任意业务功能');
 if(operation.phase==='before'&&!/(?:初始|原始|写入前|\binitial\b|\bbefore\b)/i.test(words)||operation.phase==='after'&&!/(?:写入后|重新|实际结果|核对|\bafter\b|\bagain\b)/i.test(words))throw failure('before/after须保留原要求的明确过程阶段，不能把历史值当当前值');
 if(!nativeLine(operation.phase,path,operation.phase==='before'?operation.beforeText:operation.afterText).test(words))throw failure('原要求不是同路径、同阶段、同完整值的纯native过程；额外业务义务不能用文件过程通过');
 source(run,operation);
 const reads=[operation.beforeEvidenceId,operation.afterEvidenceId].map(id=>run.observationIndex?.find(r=>r.id===id||r.eventId===id));
 if(reads.some(r=>!r||r.action!=='read_file'||r.path!==path))throw failure('前后证据须是本执行已登记的直接read_file回执');
 const entry=run.actionJournal?.find(e=>e.id===operation.actionId);
 if(!entry||entry.action!=='write_file'||entry.path!==path||entry.status!=='succeeded'||entry.readOnly||entry.expectedHash!==proof.hash(operation.afterText))throw failure('原write_file结果仍未知、未核对或目标hash不符，禁止重放或假定成功');
 const normalized={...operation,beforeEvidenceId:reads[0].id,afterEvidenceId:reads[1].id};
 return normalized;
}
function expectedId(operation){return operation.phase==='effect'?operation.actionId:operation.phase==='before'?operation.beforeEvidenceId:operation.afterEvidenceId;}
async function read(workspace,id,path,value){
 const record=await workspace.observationRecord(id,{archiveOnly:true}),result=record.response?.result;
 if(record.id!==id||record.executionId!==workspace.run.executionId||record.action?.action!=='read_file'||record.action.path!==path||record.response?.error||record.response?.notExecuted||!result||result.path!==path||result.offset!==0||result.next!==null||result.total!==value.length||result.text!==value||result.sha256!==proof.hash(value)||result.truncated)throw failure('读取须为同执行真实完整回执，文本及hash必须一致；局部、伪造或旧执行记录不能用');
 const event=await proof.lookup(workspace,record.response.eventId);
 if(!event||event.type!=='read_file'||event.detail.path!==path||event.detail.result?.sha256!==result.sha256||event.detail.result?.text!==value)throw failure('独立读取归档与原native事件不一致');
 const entry=workspace.run.actionJournal?.find(e=>e.id===event.detail.actionId);
 if(!entry||entry.action!=='read_file'||entry.path!==path||entry.status!=='succeeded'||!entry.readOnly)throw failure('读取缺少原native actionId成功回执');
 return {record,event,entry,digest:proof.hash(JSON.stringify(record))};
}
function core(entry){return {id:entry.id,action:entry.action,path:entry.path,expectedHash:entry.expectedHash,status:entry.status,readOnly:entry.readOnly,startedAt:entry.startedAt,finishedAt:entry.finishedAt,revision:entry.revision,recovered:entry.recovered===true,retries:entry.retries||0};}
async function verify(workspace,requirement,check){
 const binding=requirement.evidenceBinding;
 if(binding?.kind!=='operation')throw failure('须先在原要求的evidenceBinding显式登记operation阶段与原用户来源；不会自动把旧读取升级为验收');
 const operation=prepare(workspace.run,binding.operation,requirement);
 if(check.evidenceId!==binding.evidenceId||binding.evidenceId!==expectedId(operation))throw failure('evidenceId须使用绑定phase对应的完整回执/原actionId，不猜测或换证据');
 const before=await read(workspace,operation.beforeEvidenceId,operation.path,operation.beforeText),after=await read(workspace,operation.afterEvidenceId,operation.path,operation.afterText),journal=workspace.run.actionJournal,entry=journal.find(e=>e.id===operation.actionId);
 const sourceReceipt=source(workspace.run,operation);if(sourceReceipt.receivedAt>before.entry.startedAt)throw failure('用户操作指令须早于该过程，后续消息不能追认或改写已经发生的阶段');
 const b=journal.indexOf(before.entry),w=journal.indexOf(entry),a=journal.indexOf(after.entry);
 if(!(b<w&&w<a)||!before.entry.finishedAt||!entry.startedAt||!entry.finishedAt||!after.entry.startedAt||before.entry.finishedAt>entry.startedAt||entry.finishedAt>after.entry.startedAt||before.entry.revision>entry.revision||after.entry.revision<=entry.revision)throw failure('原native读取→写入→后读顺序不成立，不能用写入后的0伪装初始值');
 const tail=journal.slice(b+1),samePath=e=>{try{return require('./workspace.cjs').normalizeProjectPath(e.path)===operation.path;}catch{return false;}};
 if(tail.filter(e=>e.action==='write_file'&&samePath(e)).length!==1||entry.retries)throw failure('用户要求一次写入，发现额外write_file尝试或重放');
 if(tail.some(e=>['run_command','build_android'].includes(e.action)||['edit_file','edit_spreadsheet'].includes(e.action)&&samePath(e)))throw failure('native单写过程出现可能隐藏中间改动的命令/构建或同路径编辑；净hash相同也不能证明没有额外修改');
 let effect;
 if(entry.recovered){
  effect=await workspace.findEvent(e=>e.type==='action_recovered'&&e.detail.actionId===entry.id&&e.detail.path===operation.path);
  if(!effect||effect.at<entry.startedAt||effect.at>after.event.at)throw failure('未知结果必须先由原actionId核对恢复并取得实际后读，不能直接通过');
 }else{
  effect=await workspace.findEvent(e=>e.type==='write_file'&&e.detail.actionId===entry.id);
  if(!effect||effect.detail.path!==operation.path||effect.detail.result?.sha256!==entry.expectedHash||effect.detail.result?.changed!==true)throw failure('缺少原native write_file成功变更及真实结果hash');
 }
 const file=await require('./workspace.cjs').resolveFile(workspace.files,operation.path);
 if((await fs.stat(file)).size!==Buffer.byteLength(operation.afterText)||await proof.hashFile(file)!==proof.hash(operation.afterText))throw failure('当前文件已经不等于已核对的after值；历史读取不能证明当前状态');
 const marker=workspace.run.candidateRecovery;
 if(marker?.requiresReverification&&(marker.changedPaths?.includes(operation.path)||marker.affectedRequirementIds?.includes(requirement.id))&&(after.event.at<marker.requiredAfter||(marker.existingEventIds||[]).includes(after.event.id)))throw failure('候选恢复后须有新的实际后读，不得复用恢复前的过程证明');
 return {evidenceId:binding.evidenceId,scope:{kind:'file',path:operation.path},sources:[{path:operation.path,sha256:proof.hash(operation.afterText)}],nativeOperation:{version:1,executionId:workspace.run.executionId,operation,source:sourceReceipt,beforeDigest:before.digest,afterDigest:after.digest,actionDigest:proof.hash(JSON.stringify(core(entry))),effectId:effect.id,effectDigest:proof.hash(JSON.stringify(effect)),status:entry.recovered?'reconciled_effect':'native_effect',semantics:'historical_read_write_transition_with_current_after_state'}};
}
async function assertFresh(workspace,record){
 const requirement=require('./requirements.cjs').current(workspace.run).find(r=>r.id===record.criterionId);
 if(!requirement||record.nativeOperation?.version!==1||record.nativeOperation.executionId!==workspace.run.executionId)throw failure('过程证明所属执行/原要求已变');
 const current=await verify(workspace,requirement,record);
 if(!require('./evidence-binding.cjs').equal(current.nativeOperation,record.nativeOperation))throw failure('原始归档、actionId或过程绑定已变，须重新核验，不能沿用旧通过');
}
function context(run){
 const writes=(run.actionJournal||[]).filter(e=>e.action==='write_file'&&e.status==='succeeded'&&e.expectedHash&&(run.inputCoverage?.entries||[]).some(input=>!input.materialCount&&input.text?.includes(e.path)&&/\bwrite_file\b/.test(directive(input.text)))).slice(-4).map(e=>({actionId:e.id,path:e.path,recovered:e.recovered===true,expectedHash:e.expectedHash,reads:(run.observationIndex||[]).filter(r=>r.action==='read_file'&&r.path===e.path&&!r.error).slice(-12).map(r=>({observationId:r.id,eventId:r.eventId}))})).filter(e=>e.reads.length>=2);
 return writes.length?{writes,notice:'仅显式用户文件过程可用operation。先回查完整read_file归档，plan只补evidenceBinding，不改原ID/type/scope；before是历史初始值，effect为原write_file目标效果，after为真实后读。所有证明仍绑定当前after文件hash，不能代替一般功能或视觉核验。'}:undefined;
}
module.exports={schema,prepare,expectedId,verify,assertFresh,context};

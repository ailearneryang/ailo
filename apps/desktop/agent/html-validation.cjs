const fs=require('node:fs/promises'),path=require('node:path');
const {resolveFile}=require('./workspace.cjs'),proof=require('./evidence.cjs');
function configure(run,task){
 const contract=require('./request-contract.cjs').configure(run,task);
 const mode=contract.checks.visual?'rendered':contract.checks.behavior?'runtime':'document';
 run.htmlValidation={mode,basis:contract.reasons.visual,inputId:run.inputKey,checks:contract.checks,sourceMessageId:contract.sourceMessageId};
 return context(run);
}
function context(run){return run.htmlValidation&&{...run.htmlValidation,instruction:run.htmlValidation.mode==='runtime'?'本次需要真实运行与交互检查，优先DOM/控件状态和操作回执；未要求视觉比对时不自动调用视觉模型，运行正确不代替已明确的视觉要求。':run.htmlValidation.mode==='document'?'HTML仅为文档格式：检查正文准确性、六段等用户指定结构、图示定义、引用与资源完整性。不要自动新增browser打开/截图回看/渲染正常之类visual要求或步骤；图文并茂不等于设计稿还原。只有明确的设计还原、视觉要求或已发现页面缺陷才使用对应页面检查。既有真实要求与缺陷仍必须通过，不能因本策略删掉。':'按用户实际界面、交互和视觉要求检查；不能用源码关键词替代运行或设计比对。'};}
function assertPlan(run,action){
 const planned=(action.requirements||(action.acceptance||[]).map((text,i)=>({text,type:action.acceptanceTypes?.[i]}))).filter(r=>!require('./quality-contract.cjs').optional(r));
 const explicit=run.requestContract?.explicit;
 if(explicit?.visual&&!planned.some(r=>r.type==='visual'))throw Object.assign(Error('用户明确要求设计或视觉比对，计划须保留对应visual验收，不能只用正文关键词或文件存在代替。'),{code:'HTML_VALIDATION_SCOPE'});
 if(explicit?.behavior&&!planned.some(r=>r.type==='behavior'))throw Object.assign(Error('用户明确要求交互功能，计划须包含behavior运行验收，不能只检查源码文字。'),{code:'HTML_VALIDATION_SCOPE'});
 // A static design can establish real rendering through its visual proof.
 // Explicit interactions always need their own behavior evidence above.
 if(explicit?.runtime&&!planned.some(r=>['visual','behavior'].includes(r.type)))throw Object.assign(Error('应用交付须保留behavior运行验收或实际页面的visual验收，不能只检查文件与源码。'),{code:'HTML_VALIDATION_SCOPE'});
 if(!['document','runtime'].includes(run.htmlValidation?.mode))return;
 const extra=planned.find(r=>r.type==='visual'&&/(?:browser|截图|回看|渲染正常|页面渲染)/i.test(r.text));
 if(extra)throw Object.assign(Error('本次是内容型文档，用户未要求截图验收；不要自行增加流程型视觉要求：'+extra.text+'。请按正文、图示、引用与文件完整性制定验收；既有业务要求仍须保留。'),{code:'HTML_VALIDATION_SCOPE'});
}
function documentMode(run,artifact){
 const checks=require('./request-contract.cjs').validationFor(run,artifact.path);
 if(checks.visual||checks.behavior)return false;
 if(!run.requestContract&&run.htmlValidation?.mode!=='document')return false;
 if(run.issues?.some(i=>i.managedBy==='html-delivery'&&i.scope?.path===artifact.path&&i.status!=='resolved'))return false;
 return true;
}
async function checkDocument(workspace,artifact){
 const file=await resolveFile(workspace.files,artifact.path);if((await fs.stat(file)).size>4*1024*1024)throw Error('HTML文档超过静态检查范围，请拆分后检查');const bytes=await fs.readFile(file),source=bytes.toString('utf8');
 if(proof.hash(bytes)!==artifact.sha256)throw Error('HTML文档已变化，请重新登记当前成果');
 if(bytes.length>4*1024*1024)throw Error('HTML文档超过静态检查范围，请拆分后检查');
 if(!/<html\b/i.test(source)||!/<head\b/i.test(source)||!/<body\b/i.test(source)||!/<\/body\s*>/i.test(source)||!/<\/html\s*>\s*$/i.test(source))throw Error('HTML文档缺少完整html/head/body结构或结束标签');
 const text=source.replace(/<!--[\s\S]*?-->|<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi,'').replace(/<[^>]*>/g,'').trim();
 if(!text)throw Error('HTML文档没有可读取正文');
 const {DOMParser}=require('@xmldom/xmldom');
 const validateSvg=svg=>{let bad=false;try{new DOMParser({onError:()=>{bad=true;}}).parseFromString(svg,'image/svg+xml');}catch{bad=true;}if(bad)throw Error('SVG结构无效，请修复图示定义');};
 let depth=0,start=0;
 for(const tag of source.matchAll(/<!--[\s\S]*?-->|<\/?svg\b[^>]*>/gi)){
  if(tag[0].startsWith('<!--'))continue;
  if(/^<\/svg/i.test(tag[0])){if(--depth<0)throw Error('HTML内嵌SVG结构无效：结束标签不匹配');if(!depth)validateSvg(source.slice(start,tag.index+tag[0].length));}
  else if(/\/\s*>$/.test(tag[0])){if(!depth)validateSvg(tag[0]);}
  else{if(!depth)start=tag.index;depth++;}
 }
 if(depth)throw Error('HTML内嵌SVG结构无效：缺少结束标签');
 const refs=[];
 for(const tag of source.match(/<(?:img|script|link|source|image)\b[^>]*>/gi)||[]){
  if(/^<link\b/i.test(tag)&&! /\brel\s*=\s*["'](?:stylesheet|preload|icon)["']/i.test(tag))continue;
  const m=tag.match(/\b(?:src|href|xlink:href)\s*=\s*["']([^"']+)["']/i);if(m)refs.push(m[1]);
 }
 for(const m of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi))refs.push(m[1]);
 const sources=[{path:artifact.path,sha256:artifact.sha256}],offline=require('./requirements.cjs').current(workspace.run).filter(r=>!require('./quality-contract.cjs').optional(r)).some(r=>/自包含|离线|无外部资源/.test(r.text));
 for(const ref of new Set(refs)){
  if(/^(?:data:|#)/i.test(ref))continue;
  if(/^(?:https?:)?\/\//i.test(ref)){if(offline)throw Error('要求离线或自包含的HTML仍引用外部资源：'+ref);continue;}
  if(/^[a-z][a-z0-9+.-]*:/i.test(ref))throw Error('HTML资源使用不支持的地址协议');
  const relative=path.posix.normalize(path.posix.join(path.posix.dirname(artifact.path),decodeURIComponent(ref.split(/[?#]/)[0])));
  const data=await fs.readFile(await resolveFile(workspace.files,relative));if(/\.svg$/i.test(relative))validateSvg(data.toString('utf8'));sources.push({path:relative,sha256:proof.hash(data)});
 }
 const result={kind:'static_document',sources,at:new Date().toISOString(),notice:'已检查HTML结构、内嵌SVG与直接资源；未执行JS或浏览器渲染，不代表视觉或交互验收'};
 workspace.run.htmlDocumentChecks={...workspace.run.htmlDocumentChecks,[artifact.path]:result};return result;
}
module.exports={configure,context,assertPlan,documentMode,checkDocument};

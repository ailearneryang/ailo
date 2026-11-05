// Validation belongs to one user request. File extensions and old conversation
// wording do not create new visual acceptance obligations.
const {inputKey}=require('./execution-rounds.cjs');
const documentIntent=/(?:知识点|知识卡|课程|教程|学习笔记|日报|周报|总结|报告|文章|文档|简报|说明书|说明文|研究综述)/i;
const visualIntent=/(?:还原|复刻|像素级|截图验收|视觉验收|视觉检查|对照(?:设计稿|原稿|参考图)|比对(?:设计稿|原稿|参考图)|匹配(?:设计稿|原稿|参考图)|按.{0,15}(?:设计稿|原稿|参考图)|(?:设计稿|原稿|参考图).{0,20}(?:一致|相同|对齐))/i;
const behaviorIntent=/(?:点击|交互|跳转|登录|搜索功能|表单|按钮功能|筛选|切换|输入|提交|运行测试|可运行|功能测试|交互测试|功能验证)/i;
const appIntent=/(?:开发|制作|实现|搭建|生成|修复|修改).{0,35}(?:应用|app\b|网站|网页|界面|页面|仪表盘|控制台|dashboard)/i;
function continuation(text){const value=String(text||'').replace(/[\s。！!？?，,；;：:]/g,'');return require('./input-turn.cjs').continuationOnly?.(text)||new Set(['服务已恢复','网络已恢复','授权已恢复','额度已恢复','继续','继续任务','继续执行','继续验收','继续原任务','重试','再试一次','请从已保存的任务状态继续先检查已有成果不重复执行已完成步骤']).has(value);}
function directText(text){
 return String(text||'').replace(/```[\s\S]*?```/g,'').split(/[\n。；;，,]/).filter(s=>!/^\s*(?:比如|例如|除非|若是|如果是)/.test(s)).map(s=>s.replace(/(?:不需要|无需|不用|不要|禁止|不做).{0,12}(?:视觉检查|视觉验收|截图(?:检查|验收|回看|比对)?|看图|设计稿比对)/g,'')).join('\n');
}
function fileOnlyData(text){return /(?:只|仅)(?:做|处理|使用|用|修改|生成|输出|更新|维护).{0,60}(?:原生文件|本地(?:配置|文件|JSON)|JSON|Markdown|文件读写)/i.test(text)&&/(?:\.(?:json|md|csv|ya?ml|toml)\b|\bJSON\b|\bMarkdown\b)/i.test(text);}
function describe(raw){
 const direct=directText(raw);
 const informationLead=/^(?:(?:请|帮我|为我|每天|每日|定时|本次|现在)\s*)*(?:整理|总结|解释|讲解|介绍)/.test(direct.trim());
 const doc=documentIntent.test(direct)||informationLead,docLead=informationLead||/^(?:(?:请|帮我|为我|每天|每日|定时|本次|现在)\s*)*(?:写|撰写|生成|输出|分析).{0,28}(?:文章|文档|知识点|课程|教程|报告|笔记|综述)/.test(direct.trim());
 const extraApp=/(?:并且|同时|另外|并).{0,10}(?:开发|制作|实现|复刻|还原|搭建)/.test(direct);
 // A document can discuss UI engineering and can also be an interactive or
 // design-constrained deliverable. Look for output obligations in direct
 // clauses, rather than letting the word "report" disable those requirements.
 const obligations=direct.split('\n').filter(s=>!/^\s*(?:解释|讲解|介绍|讨论|比较|分析|说明).*(?:原理|概念|方法|流程|区别|取舍)/.test(s)).join('\n');
 const outputVisual=/(?:^|\n)\s*(?:按|按照|依据).{0,15}(?:设计稿|原稿|参考图)|(?:交付前|生成后|输出后|本次要求|必须进行|请对).{0,25}(?:视觉|截图|对照|比对)|(?:报告|文章|文档|页面|网页|排版|布局|效果).{0,20}(?:设计稿|原稿|参考图).{0,12}(?:一致|相同|对齐)|(?:报告|文章|文档).{0,12}(?:按|按照).{0,12}(?:设计稿|参考图).{0,12}(?:排版|布局)/.test(obligations);
 const outputBehavior=/(?:支持|实现|具备|添加|提供|允许|需要(?:能)?|要求|必须|应当|应|能够|可以).{0,20}(?:点击|交互|跳转|登录|搜索|输入|提交|筛选|切换)|交互式(?:页面|网页|教程|报告)|可(?:点击|交互|操作)|(?:运行|功能|交互)测试|功能验证/.test(obligations);
 const runtimeCheck=obligations.split('\n').some(s=>!/^\s*(?:不需要|无需|不要|禁止|不必|不做|说明|解释|介绍|讲解|记录|列出|讨论)/.test(s)&&/(?:实测|测试|运行).{0,16}(?:页面|网页|应用|界面|\bUI\b)|(?:验证|检查).{0,16}(?:页面|网页|应用|界面|\bUI\b).{0,16}(?:切换|点击|交互|跳转|功能|是否正常)|^\s*(?:(?:请|帮我|先|再|直接)\s*)*(?:点击|操作|打开|切换|输入|提交).{0,16}(?:页面|网页|应用|界面|按钮|控件)/i.test(s));
 const visual=visualIntent.test(direct)&&(!docLead||extraApp||outputVisual),app=appIntent.test(direct)&&(!docLead||extraApp);
 // A data value can describe switching/input/submission without requesting
 // an executable UI. Require an explicit file-only boundary as well as a data
 // or document artifact; a filename or output format alone never waives tests.
 const fileOnly=fileOnlyData(direct);
 const dataOnly=fileOnly&&!app&&!visual&&!outputBehavior&&!runtimeCheck;
 const behavior=runtimeCheck||!dataOnly&&(docLead&&!extraApp?outputBehavior:behaviorIntent.test(direct));
 const runtime=app&&/(?:应用|app\b|网站|仪表盘|控制台|dashboard)/i.test(direct);
 const onlyFormat=/(?:HTML|Markdown|MD).{0,12}(?:格式|输出)|(?:生成|导出).{0,20}(?:HTML|Markdown)/i.test(direct);
 const kind=visual?'design':dataOnly||doc&&!app?'document':app||behavior?'application':doc||onlyFormat?'document':'unspecified';
 const discussion=/^(?:(?:请|帮我|为我|每天|每日|定时|本次|现在)\s*)*(?:解释|讲解|介绍)/.test(direct.trim());
 return {kind,newGoal:docLead&&!discussion||app||visual||behavior,checks:{content:true,structure:true,behavior:behavior||app,visual:visual||kind==='unspecified'},explicit:{visual,behavior,runtime}};
}
function configure(run,task){
 const messages=task.messages?.length?task.messages:[{role:'user',content:task.request||''}];
 const current=messages.find(m=>m.role==='user'&&m.id===run.inputKey)||messages.findLast(m=>m.role==='user')||{role:'user',content:task.request||''},trigger=inputKey(current),prior=run.requestContract;
 if(prior?.version===2&&prior.inputId===(run.inputKey||trigger)&&prior.executionId===run.executionId)return prior;
 const resumes=continuation(current.content);
 if(resumes&&prior?.version===2&&prior.executionId===run.executionId){run.requestContract={...prior,inputId:run.inputKey||trigger,resumedFrom:prior.inputId};return run.requestContract;}
 const origin=resumes?messages.slice(0,messages.indexOf(current)).findLast(m=>m.role==='user'&&!continuation(m.content))||current:current;
 const raw=origin.content||task.request||'',observed=describe(raw),inherited=!!run.executionId&&prior?.executionId===run.executionId&&run.requestScope?.kind!=='independent';
 const parsedPrior=prior&&prior.version!==2?describe(prior.request||''):undefined;
 const reclassify=parsedPrior&&fileOnlyData(directText(prior.request))&&parsedPrior.kind==='document';
 const formal=reclassify?require('./requirements.cjs').current(run).filter(r=>!require('./quality-contract.cjs').optional(r)):[];
 const previous=reclassify?{...parsedPrior,explicit:{...parsedPrior.explicit,visual:formal.some(r=>r.type==='visual'),behavior:formal.some(r=>r.type==='behavior'),runtime:formal.some(r=>r.type==='behavior')},kind:formal.some(r=>r.type==='visual')?'design':formal.some(r=>r.type==='behavior')?'application':parsedPrior.kind}:prior;
 const visual=observed.explicit.visual||inherited&&previous.explicit?.visual===true,behavior=observed.explicit.behavior||inherited&&previous.explicit?.behavior===true,app=observed.checks.behavior||inherited&&previous.kind==='application',runtime=observed.explicit.runtime||inherited&&previous.explicit?.runtime===true;
 let kind=visual?'design':app||behavior?'application':observed.kind;
 // A small supplement (e.g. shorten the introduction) keeps its current task's
 // contract; a new document request never inherits an old design requirement.
 const supplemental=observed.kind==='unspecified'&&!!prior&&prior.executionId===run.executionId&&!resumes;
 const checks=supplemental?{...prior.checks}:{content:true,structure:true,behavior:behavior||app,visual:visual||kind==='unspecified'};
 if(supplemental)kind=prior.kind;
 const contract={version:2,inputId:run.inputKey||trigger,sourceMessageId:origin.id||inputKey(origin),executionId:run.executionId,kind,request:raw.slice(0,3000),checks,explicit:supplemental?{...previous.explicit}:{visual,behavior,runtime},
  reasons:{content:'核对本次用户要求与真实来源',structure:'检查文件、资源与结构完整性',behavior:checks.behavior?'当前请求包含应用或交互行为':'当前请求未要求运行或交互功能',visual:checks.visual?(visual?'当前请求明确要求设计或视觉核对':supplemental?prior.reasons.visual:'任务类型未明确，保留原页面检查保护'):'HTML/MD只是当前内容的交付格式，没有新增视觉比对要求'},
  instruction:'只为当前请求选择验收。content/structure/behavior/visual各自使用相应证据；截图或发现更多差异不能代替修复。已确认且与当前要求相关的缺陷仍须修复；疑似观察先调查。新输入先确认对目标和当前设计的影响，不让历史问题自动接管本轮。'};
 if(prior&&JSON.stringify([prior.kind,prior.checks,prior.request])!==JSON.stringify([contract.kind,contract.checks,contract.request]))run.requestContractHistory=[...(run.requestContractHistory||[]),prior].slice(-12);
 run.requestContract=contract;return contract;
}
// The full request and reasons remain in the persisted contract. The model
// already receives currentRequest/htmlValidation, so do not repeat them here.
function context(run){const c=run.requestContract;return c&&{version:c.version,inputId:c.inputId,sourceMessageId:c.sourceMessageId,kind:c.kind,checks:c.checks,explicit:c.explicit,instruction:c.instruction};}
function relevant(run,r,path){return !r.scope&&!r.scopes||r.scope?.path===path||r.scopes?.some(s=>s.path===path);}
function validationFor(run,path){
 const all=require('./requirements.cjs').current(run).filter(r=>!require('./quality-contract.cjs').optional(r)),visual=all.filter(r=>r.type==='visual'),behavior=all.filter(r=>r.type==='behavior');
 const visualNeeded=visual.length?visual.some(r=>relevant(run,r,path)):run.requestContract?run.requestContract.checks.visual===true:run.htmlValidation?.mode!=='document'&&run.htmlValidation?.mode!=='runtime';
 const behaviorNeeded=behavior.length?behavior.some(r=>relevant(run,r,path)):run.requestContract?.checks.behavior===true;
 return {content:true,structure:true,behavior:behaviorNeeded,visual:visualNeeded};
}
function requiresVisual(run,path){return validationFor(run,path).visual;}

module.exports={configure,context,requiresVisual,validationFor,directText,continuation,describe};

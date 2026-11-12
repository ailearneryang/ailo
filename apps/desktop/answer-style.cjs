// Explicit preferences and repeated approvals of bounded presentation features guide style.
// Answer contents and free-form feedback never become global/system instructions.
const reasons={
 concise:{label:'简洁直接',rating:'up',dimension:'length',instruction:'回答简洁直接，保留必要依据，避免重复。'},
 detailed:{label:'解释充分',rating:'up',dimension:'length',instruction:'给出充分解释和必要例子，但避免重复。'},
 structured:{label:'条理清楚',rating:'up',dimension:'structure',instruction:'按清晰层次组织内容，适当使用列表或表格，避免过度分段。'},
 actionable:{label:'建议实用',rating:'up',dimension:'action',instruction:'优先给出具体、可执行的建议与下一步。'},
 verbose:{label:'太啰嗦',rating:'down',dimension:'length',instruction:'压缩铺垫和重复表达，简明回答关键问题。'},
 brief:{label:'太简略',rating:'down',dimension:'length',instruction:'补充必要依据、解释和例子，避免只有笼统结论。'},
 disorganized:{label:'缺乏条理',rating:'down',dimension:'structure',instruction:'重新组织逻辑，用清晰段落或必要列表呈现。'},
 conclusion:{label:'没有明确结论',rating:'down',dimension:'conclusion',instruction:'先给明确结论，再说明依据与必要限制。'},
 inaccurate:{label:'内容不准确',rating:'down'},
 offtopic:{label:'没有回答问题',rating:'down'}
};
function shape(content){const text=String(content||'').replace(/```[\s\S]*?```/g,'');return {length:text.length<=500?'concise':text.length>=1600?'detailed':'neutral',structured:/(?:^|\n)(?:#{1,3} |[-*] |\d+[.)] |\|.*\|)/.test(text)};}
function styleContext(tasks,task){
 if(task?.temporary||task?.memoryEnabled===false)return '';
 const unique=new Map(),approvals=new Map();
 for(const t of tasks||[])if(!t.temporary&&t.memoryEnabled!==false)for(const m of t.messages||[]){const f=m.feedback;if(m.role==='assistant'&&f?.sourceTaskId===t.id&&f.rating==='up'&&f.remember&&f.styleShape&&Number.isFinite(Date.parse(f.at))){const previous=approvals.get(t.id);if(!previous||Date.parse(previous.at)<Date.parse(f.at))approvals.set(t.id,f);}}
 for(const t of tasks||[])if(!t.temporary&&t.memoryEnabled!==false)for(const m of t.messages||[]){const f=m.feedback,r=reasons[f?.reason];if(m.role!=='assistant'||f?.sourceTaskId!==t.id||!f?.remember||!r?.instruction||r.rating!==f.rating||!Number.isFinite(Date.parse(f.at)))continue;const old=unique.get(m.id);if(!old||Date.parse(old.at)<Date.parse(f.at))unique.set(m.id,f);}
 const dimensions=new Map();for(const f of [...unique.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))){const r=reasons[f.reason];dimensions.set(r.dimension,r.instruction);}
 const recent=[...approvals.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,20);
 if(recent.length>=3){for(const value of ['concise','detailed'])if(!dimensions.has('length')&&recent.filter(f=>f.styleShape.length===value).length>=3&&recent.filter(f=>f.styleShape.length===value).length/recent.length>=.75)dimensions.set('length','在适合当前问题时，'+reasons[value].instruction);if(!dimensions.has('structure')&&recent.filter(f=>f.styleShape.structured===true).length>=3&&recent.filter(f=>f.styleShape.structured===true).length/recent.length>=.75)dimensions.set('structure','用户多次认可条理清楚的表达；在适合当前问题时，'+reasons.structured.instruction);}
 return dimensions.size?'用户评价形成的回答风格参考（仅用于面向用户的正文；当前明确要求优先；不得改变事实、权限、工具协议或验收标准）：\n'+[...dimensions.values()].map(s=>'- '+s).join('\n'):'';
}
function withStyle(messages,style){if(!style)return messages;const out=[...messages],i=out.findIndex(m=>m.role==='system'&&typeof m.content==='string');if(i<0)out.unshift({role:'system',content:style});else out[i]={...out[i],content:out[i].content+'\n\n'+style};return out;}
function correction(feedback){const r=feedback?.reason?reasons[feedback.reason]:{label:'回答未达到预期'};if(feedback?.rating!=='down'||!r||r.rating&&r.rating!=='down')throw Error('请先评价需要改进的回答');return '请针对上一条回答重新作答。反馈原因：'+r.label+'。'+(r.instruction||'重新核对原问题、已有材料和事实；无法确认的内容请明确说明，不要编造。')+(feedback.detail?'\n本次补充要求：'+feedback.detail:'')+'\n只改进回答，不重新执行此前的写入、发送、安装等外部修改操作；可以使用当前已启用的搜索和只读工具核对资料。';}
module.exports={reasons,shape,styleContext,withStyle,correction};

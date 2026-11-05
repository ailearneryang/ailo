// A source-backed correction retires a mistaken finding, never the original
// requirement. Rendering/runtime/acceptance gates still apply independently.
async function prove(workspace,id,target){
 const record=await workspace.observationRecord(id,{archiveOnly:true});
 if(record.action?.action!=='android_design_details')throw Error('撤销设计误报须引用完整原稿规格归档，不能使用普通说明、文件存在或旧摘要');
 const raw=record.response?.result,text=raw?.text;
 const design=typeof text==='string'?JSON.parse(text):raw;
 const selected=require('./material-input.cjs').selectedDesign(workspace.run);
 if(require('./material-input.cjs').pending(workspace.run)||selected.some(m=>!design?.sources?.some(s=>s.path===m.sourcePath&&s.sha256===m.sourceHash)))throw Error('该归档未关联本次设计附件，不能沿用旧稿撤销问题');
 const sources=[...(design?.sourceBaseline||[]),...selected.map(m=>({path:m.sourcePath,sha256:m.sourceHash})),...(design?.sources||[]).filter(s=>s.path==='android-design.json')],original=workspace.run.androidDesignSourceBaseline?.sources;
 if(!Array.isArray(sources)||!sources.length||!original?.length||(design?.sourceBaseline||[]).some(s=>!original.some(o=>o.path===s.path&&o.sha256===s.sha256)))throw Error('设计归档未绑定原始规格版本，不能撤销问题');
 const screens=design.screens||[];
 if(!screens.length||screens.some(s=>s.baseline?.truncated))throw Error('原稿规格不完整，不能据此撤销问题');
 let bound;try{bound=JSON.parse(target.scopeKey||'null')?.[0];}catch{}
 const layout=bound||target.scope?.path;
 if(layout&&!screens.some(s=>s.layout===layout))throw Error('原稿规格没有覆盖问题对象');
 await require('./evidence.cjs').assertFresh(workspace,{sources});
 return {evidenceId:id,sources,at:new Date().toISOString(),basis:'model_source_review',layout};
}
async function assertFresh(workspace,record){for(const m of require('./material-input.cjs').selectedDesign(workspace.run))if(!record?.sources?.some(s=>s.path===m.sourcePath&&s.sha256===m.sourceHash))throw Error('误报撤销依据属于旧设计，须按当前附件重新核对');if(!record?.sources?.length)throw Error('误报撤销缺少原稿依据');await require('./evidence.cjs').assertFresh(workspace,record);}
module.exports={prove,assertFresh};

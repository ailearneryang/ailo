// Inspect document fallback content without evaluating untrusted scripts.
const {DOMParser}=require('@xmldom/xmldom');
function inspect(source){
 const result={emptySections:[],scanIssues:[]};
 let doc;try{doc=new DOMParser({onError:()=>{}}).parseFromString(source,'text/html');}catch{return result;}
 const sections=[];let current;
 function walk(node){
  const tag=String(node.tagName||'').toLowerCase();
  if(['head','script','style','template','nav','th'].includes(tag)||node.getAttribute?.('hidden')!==null&&node.hasAttribute?.('hidden')||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute?.('style')||''))return;
  if(/^h[1-6]$/.test(tag)){current={level:Number(tag[1]),title:(node.textContent||'').trim().slice(0,100),body:''};sections.push(current);return;}
  if(node.nodeType===3&&current)current.body+=(node.nodeValue||'').trim();
  if(['img','svg'].includes(tag)&&current)current.body+='[图示]';
  for(let child=node.firstChild;child;child=child.nextSibling)walk(child);
 }
 walk(doc);
 result.emptySections=sections.filter((s,i)=>s.title&&!s.body.trim()&&!(sections[i+1]?.level>s.level)).map(s=>s.title);
 // A full-confidence storage scan cannot establish coverage from empty arrays.
 // Empty is not failure, but needs an explicit section-level receipt.
 for(const match of source.matchAll(/\b(?:const|let|var)\s+DATA\s*=\s*(\{[^\n]+\})\s*;/g)){
  let data;try{data=JSON.parse(match[1]);}catch{continue;}
  if(!data.disks||data.platform!=='Darwin'||data.confidence?.score!==10)continue;
  const missing=['user_profile','library','caches','app_support','program_dirs'].filter(k=>Array.isArray(data[k])&&!data[k].length&&!['empty','not_applicable'].includes(data.scan_status?.[k]?.status));
  if(missing.length>=3)result.scanIssues.push('扫描多项结果为空且缺少逐项覆盖证据（'+missing.join('、')+'），不能标注10/10或全部扫描成功；须区分无匹配项、无权限、未扫描及失败');
 }
 return result;
}
function assertReadable(source){
 const result=inspect(source);
 if(result.emptySections.length>=2)throw Error('HTML报告存在仅标题无正文的章节：'+result.emptySections.slice(0,6).join('、')+'。将数据和表格预先写入HTML，图表脚本仅作增强；无数据章节须写明原因，不能用空容器或模板标题冒充正文');
 if(result.scanIssues.length)throw Error(result.scanIssues.join('；'));
 return result;
}
module.exports={inspect,assertReadable};

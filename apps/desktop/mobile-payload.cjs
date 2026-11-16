const MAX_BYTES=3*1024*1024;
function normalize(input){
 if(input.version!==undefined&&![1,2].includes(input.version))throw Error('手机任务协议版本不支持');
 const attachments=input.attachments===undefined?[]:input.attachments;
 if(!Array.isArray(attachments)||attachments.length>3)throw Error('一次最多添加3个附件');
 let size=0;
 const files=attachments.map(a=>{
  if(!a||typeof a.name!=='string'||a.name.length>120||/[\\/\x00-\x1f]/.test(a.name)||!/^.+\.(png|jpe?g|webp|gif|pdf|docx|xlsx|txt|md|csv|json)$/i.test(a.name)||typeof a.base64!=='string'||a.base64.length>2800000||a.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64)||Buffer.from(a.base64,'base64').toString('base64')!==a.base64)throw Error('附件格式无效或文件类型不支持');
  const n=Buffer.byteLength(a.base64,'base64');size+=n;if(!n||n>2*1024*1024||size>MAX_BYTES)throw Error('每个附件最多2MB，合计最多3MB');
  return {name:a.name,base64:a.base64};
 });
 let tools;
 if(input.tools!==undefined){
  const t=input.tools;if(!t||typeof t!=='object'||Array.isArray(t))throw Error('工具选择无效');tools={};
  for(const k of ['searchEnabled','feishuEnabled','amapEnabled'])if(t[k]!==undefined){if(typeof t[k]!=='boolean')throw Error('工具开关无效');tools[k]=t[k];}
  for(const [key,max] of [['extensionIds',5],['mcpConnectionIds',20]])if(t[key]!==undefined){if(!Array.isArray(t[key])||t[key].length>max||new Set(t[key]).size!==t[key].length||t[key].some(x=>typeof x!=='string'||!x||x.length>100))throw Error('技能或连接选择无效');tools[key]=t[key];}
 }
 return {attachments:files,...(tools?{tools}:{})};
}
module.exports={normalize,MAX_BYTES};

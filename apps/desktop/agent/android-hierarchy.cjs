const path=require('node:path');
const {DOMParser}=require(path.join(__dirname,'../node_modules/@xmldom/xmldom'));
function parse(bytes,packageName){
 if(bytes.length>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(bytes.toString('utf8')))throw Error('控件树超限或包含不允许的 XML 声明');
 const errors=[],doc=new DOMParser({onError:(level,message)=>errors.push(message)}).parseFromString(bytes.toString('utf8'),'text/xml');
 if(errors.length||doc.documentElement?.tagName!=='hierarchy')throw Error('控件树 XML 无效');
 const nodes=[],all=doc.getElementsByTagName('node');if(all.length>5000)throw Error('控件树超过5000项');
 for(let i=0;i<all.length;i++){
  const n=all[i];if(n.getAttribute('package')!==packageName)continue;
  const b=n.getAttribute('bounds').match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);if(!b)continue;
  nodes.push({id:'node_'+i,resourceId:n.getAttribute('resource-id'),class:n.getAttribute('class'),text:n.getAttribute('text').slice(0,160),description:n.getAttribute('content-desc').slice(0,160),bounds:{x:+b[1],y:+b[2],width:+b[3]-b[1],height:+b[4]-b[2]}});
 }
 return {nodes,complete:true,notice:'仅含当前应用可访问控件；自绘内容可能缺失。数量和边界检查不证明业务行为或视觉一致。'};
}
module.exports={parse};

function applyMessageFeedback(task,input){
 if(!input||!['up','down',null].includes(input.rating)||typeof input.messageId!=='string'||input.messageId.length>200)throw Error('评价参数无效');
 if(!task)throw Error('对话不存在');
 const messages=task.messages?.length?task.messages:[{id:task.id+'-original',role:'user',content:task.request,materials:task.materials,createdAt:task.created},...(task.answer?[{id:task.id+'-answer',role:'assistant',content:task.answer,modelName:task.modelName,createdAt:task.created}]:[])];
 const message=messages.find(m=>m.id===input.messageId&&m.role==='assistant');if(!message)throw Error('回答不存在');
 const reason=require('./answer-style.cjs').reasons[input.reason];
 if(input.reason!==undefined&&(!reason||reason.rating!==input.rating))throw Error('评价原因无效');
 if(input.detail!==undefined&&(typeof input.detail!=='string'||input.detail.length>1000))throw Error('补充说明最多1000字符');
 if(input.remember!==undefined&&typeof input.remember!=='boolean')throw Error('偏好设置无效');
 if(input.rating===null)delete message.feedback;else message.feedback={sourceTaskId:task.id,rating:input.rating,at:new Date().toISOString(),...(reason?{reason:input.reason}:{}),...(input.detail?.trim()?{detail:input.detail.trim()}:{}),...(input.remember&&!task.temporary&&task.memoryEnabled!==false&&(reason?.instruction||input.rating==='up')?{remember:true,...(!reason&&input.rating==='up'?{styleShape:require('./answer-style.cjs').shape(message.content)}:{})}:{})};
 task.messages=messages;return {messageId:message.id,feedback:message.feedback};
}
module.exports={applyMessageFeedback};

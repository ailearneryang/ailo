function applyMessageFeedback(task,input){
 if(!input||!['up','down',null].includes(input.rating)||typeof input.messageId!=='string'||input.messageId.length>200)throw Error('评价参数无效');
 if(!task)throw Error('对话不存在');
 const messages=task.messages?.length?task.messages:[{id:task.id+'-original',role:'user',content:task.request,materials:task.materials,createdAt:task.created},...(task.answer?[{id:task.id+'-answer',role:'assistant',content:task.answer,modelName:task.modelName,createdAt:task.created}]:[])];
 const message=messages.find(m=>m.id===input.messageId&&m.role==='assistant');if(!message)throw Error('回答不存在');
 if(input.rating===null)delete message.feedback;else message.feedback={rating:input.rating,at:new Date().toISOString()};
 task.messages=messages;return {messageId:message.id,feedback:message.feedback};
}
module.exports={applyMessageFeedback};

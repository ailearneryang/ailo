const {test}=require('node:test'),assert=require('node:assert/strict');
const {ASSISTANT_ID,createPersonalAssistant}=require('../apps/desktop/personal-assistant.cjs');
function fixture(){
 const state={tasks:[{id:ASSISTANT_ID,request:'hello',materials:[],messages:[{id:'u1',role:'user',content:'安排工作'}]}],projects:[]};let counter=0;const schedules=[];
 const storage={readWorkspace:async()=>structuredClone(state),patchTask:async(id,patch,append=[])=>{let task=state.tasks.find(t=>t.id===id);if(!task){task={id,messages:[]};state.tasks.unshift(task);}Object.assign(task,patch);task.messages=[...task.messages,...append];return structuredClone(task);}};
 const launches=[],steering=[];const chat={sessions:()=>launches.map(t=>({taskId:t.taskId,id:t.id})),complete:input=>{launches.push(input);return new Promise(()=>{});},cancel:id=>{const i=launches.findIndex(t=>t.id===id);if(i>=0)launches.splice(i,1);},steer:async input=>steering.push(input)};
 const execute=createPersonalAssistant({storage,chat,schedules:{list:async()=>schedules,save:async params=>{const s={...params,id:'s'+(++counter)};schedules.push(s);return s;},toggle:async()=>{}}});
 const context={task:state.tasks[0],modelId:'model',signal:new AbortController().signal};return {execute,context,state,launches,steering,schedules};
}
test('delegation links the originating message, copies materials, and does not duplicate on retry',async()=>{
 const f=fixture();f.context.task.materials=[{name:'feedback.md',text:'反馈'}];
 const action={operation:'delegate',data:{title:'反馈整理',prompt:'整理反馈'}};
 const first=await f.execute(action,f.context),again=await f.execute(action,f.context);
 assert.equal(first.taskId,again.taskId);assert.equal(f.launches.length,1);
 const child=f.state.tasks.find(t=>t.id===first.taskId);assert.equal(child.parentMessageId,'u1');assert.equal(child.parentAssistantId,ASSISTANT_ID);assert.equal(child.materials[0].text,'反馈');
 const listed=await f.execute({operation:'list'},f.context);assert.equal(listed.tasks.length,1);assert.equal(listed.tasks[0].status,'running');
 await assert.rejects(f.execute({operation:'delegate',data:{prompt:'工作',projectId:'unknown'}},f.context),/项目不存在/);
});
test('follow-ups reach a real task; pause stops that task; fabricated IDs and other conversations are rejected',async()=>{
 const f=fixture();const {taskId}=await f.execute({operation:'delegate',data:{prompt:'整理反馈'}},f.context);
 await f.execute({operation:'update',id:taskId,data:{prompt:'优先登录问题'}},f.context);assert.equal(f.steering[0].taskId,taskId);
 await f.execute({operation:'pause',id:taskId},f.context);assert.equal(f.launches.length,0);assert.equal(f.state.tasks.find(t=>t.id===taskId).assistantPaused,true);
 await assert.rejects(f.execute({operation:'continue',id:'invented',data:{prompt:'继续'}},f.context),/未找到/);
 await assert.rejects(f.execute({operation:'list'},{...f.context,task:{id:'other'}}),/仅限/);
});
test('schedule writes use selected model and remain idempotent across a retry',async()=>{
 const f=fixture();const action={operation:'schedule',data:{title:'周报',prompt:'整理公开行业动态',frequency:'weekly',time:'09:00',weekday:5}};
 const first=await f.execute(action,f.context),second=await f.execute(action,f.context);
 assert.equal(first.schedule.id,second.schedule.id);assert.equal(f.schedules.length,1);assert.equal(f.schedules[0].modelId,'model');
 const controller=new AbortController();controller.abort();await assert.rejects(f.execute(action,{...f.context,signal:controller.signal}),/已停止/);
});

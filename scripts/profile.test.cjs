const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const profile=require('../apps/desktop/profile.cjs'),{createStorage}=require('../apps/desktop/storage.cjs'),{createChat}=require('../apps/desktop/chat.cjs');
test('usage counts real reported tokens, retries and partial usage without adding reasoning twice',()=>{
 const u=profile.emptyUsage(),at='2026-10-10T12:00:00';
 assert.equal(profile.recordRequest(u,{id:'one',startedAt:at,providerUsage:{inputTokens:100,outputTokens:20,reasoningTokens:10}}),true);
 assert.equal(profile.recordRequest(u,{id:'one',startedAt:at,providerUsage:{inputTokens:100,outputTokens:20}}),false);
 profile.recordRequest(u,{id:'retry',startedAt:at});profile.recordRequest(u,{id:'partial',startedAt:at,providerUsage:{inputTokens:30,outputTokens:-1}});
 const s=profile.summarize(u,[],new Date(at));assert.equal(s.totalTokens,150);assert.equal(s.requests,3);assert.equal(s.reportedRequests,1);assert.equal(s.peakDayTokens,150);
});
test('activity merges historical user dates, respects gaps, future dates and year boundaries',()=>{
 const tasks=[{created:'2025-12-30T12:00:00',messages:[{role:'user'},{role:'assistant',createdAt:'2026-01-03T12:00:00'},{role:'user',createdAt:'2025-12-31T12:00:00'},{role:'user',createdAt:'2026-01-01T12:00:00'},{role:'user',createdAt:'2027-01-01T12:00:00'}]}];
 const u=profile.emptyUsage();let s=profile.summarize(u,tasks,new Date('2026-01-02T12:00:00'));assert.equal(s.longestStreak,3);assert.equal(s.currentStreak,3);assert.equal(s.totalTokens,0);assert.equal(s.activeDates.length,3);
 s=profile.summarize(u,tasks,new Date('2026-01-04T12:00:00'));assert.equal(s.currentStreak,0);
});
test('profile selections validate ownership and limits; usage and per-account preferences survive restart',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-profile-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const state={tasks:[{id:'task',agentRun:{artifacts:[{path:'result.html'}]}}]};
 const settings={name:'测试用户',bio:'我的作品',color:profile.colors[0],featured:[{taskId:'task',path:'result.html'}]};
 assert.throws(()=>profile.validateProfile({...settings,featured:[{taskId:'task',path:'../../secret'}]},state),/不存在/);assert.throws(()=>profile.validateProfile({...settings,featured:Array(7).fill(settings.featured[0])},state),/最多/);
 let storage=createStorage(dir,{});await storage.saveProfile(settings,state);
 await Promise.all(Array.from({length:205},(_,i)=>storage.recordModelRequest({id:String(i),startedAt:'2026-10-10T12:00:00',providerUsage:{inputTokens:1,outputTokens:2}})));
 await storage.recordExecution({id:'e',durationMs:65000,reasoningEffort:'high',skills:['skill','skill'],connections:['feishu']});await storage.recordExecution({id:'e',durationMs:90000,skills:['other']});
 storage=createStorage(dir,{});const local=await storage.profile();assert.equal(local.settings.name,'测试用户');assert.equal(local.stats.totalTokens,615);assert.equal(local.stats.executionCount,1);assert.equal(local.stats.longestExecutionMs,65000);assert.equal(local.stats.skills.skill,1);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'model-requests.json'),'utf8')).length,200);
 const user=await storage.register({name:'账号用户',email:'profile@example.com',password:'test-password'});assert.equal((await storage.profile()).settings.name,user.name);await storage.saveProfile({...settings,name:'更新昵称'},state);assert.equal((await storage.account()).name,'更新昵称');await storage.logout();assert.equal((await storage.profile()).settings.name,'测试用户');
});
test('stream usage negotiation falls back only for explicit unsupported options and records usage',async()=>{
 const records=[],executions=[],bodies=[],storage={modelCredentials:async()=>({baseUrl:'https://example.com/v1',model:'test',name:'Test'}),recordModelRequest:async r=>records.push(r),recordExecution:async r=>executions.push(r)};
 const chat=createChat(storage,async(_,options)=>{const body=JSON.parse(options.body);bodies.push(body);if(body.stream_options)return Response.json({error:{message:'stream_options is unsupported'}},{status:400});return Response.json({choices:[{message:{content:'hello'}}],usage:{prompt_tokens:10,completion_tokens:5,completion_tokens_details:{reasoning_tokens:2}}});});
 const result=await chat.complete({id:'r',modelId:'m',messages:[{role:'user',content:'hi'}]});assert.equal(result.content,'hello');assert.equal(bodies.length,2);assert.equal(bodies[1].stream_options,undefined);assert.deepEqual(records[1].providerUsage,{inputTokens:10,outputTokens:5,reasoningTokens:2});assert.equal(executions.length,1);
 const denied=createChat(storage,async()=>Response.json({error:{message:'bad request'}},{status:400}));await assert.rejects(denied.complete({id:'denied',modelId:'m',messages:[{role:'user',content:'hi'}]}),/HTTP 400/);
});
test('avatar persists per account, rejects active URLs and oversized PNGs, and can be removed',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-avatar-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
 const settings={name:'头像用户',bio:'',color:profile.colors[0],featured:[],avatar},state={tasks:[]};
 for(const value of ['https://example.com/avatar.png','data:image/svg+xml,<svg/>','data:image/png;base64,aGVsbG8='])assert.throws(()=>profile.validateProfile({...settings,avatar:value},state),/头像图片无效/);
 const large=Buffer.from(avatar.split(',')[1],'base64');large.writeUInt32BE(8192,16);assert.throws(()=>profile.validateProfile({...settings,avatar:'data:image/png;base64,'+large.toString('base64')},state),/头像图片无效/);
 const storage=createStorage(dir,{});await storage.saveProfile(settings,state);assert.equal((await createStorage(dir,{}).profile()).settings.avatar,avatar);
 await storage.register({name:'独立账号',email:'avatar@example.com',password:'test-password'});assert.equal((await storage.profile()).settings.avatar,undefined);
 await storage.logout();assert.equal((await storage.profile()).settings.avatar,avatar);
 await storage.saveProfile({...settings,avatar:undefined},state);assert.equal((await createStorage(dir,{}).profile()).settings.avatar,undefined);
 const {pickAvatar}=require('../apps/desktop/profile-avatar.cjs');assert.equal(await pickAvatar({showOpenDialog:async()=>({canceled:true,filePaths:[]})},null,{}),null);
});

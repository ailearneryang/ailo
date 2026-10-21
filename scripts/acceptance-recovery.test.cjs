const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createWorkspace}=require('../apps/desktop/agent/workspace.cjs');
const {verify,criterionId}=require('../apps/desktop/agent/acceptance.cjs');
const {runAgent}=require('../apps/desktop/agent/runner.cjs');
async function setup(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-acceptance-recovery-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const task={id:'t',request:'生成天气页面',materials:[]};return {base,task,w:await createWorkspace(base,task)};}
test('punctuation variants give repair feedback without silently passing exact checks',async t=>{
 const {w}=await setup(t);w.run.acceptance=['包含天气首页'];
 await fs.writeFile(path.join(w.files,'page.html'),'<h1>天气-首页</h1>');
 await assert.rejects(verify(w,{checks:[{criterionId:criterionId('包含天气首页'),kind:'text_contains',path:'page.html',contains:['天气首页'],reason:'检查首页'}]}),error=>{
  assert.equal(error.code,'ACCEPTANCE_TEXT_MISSING');assert.match(error.message,/近似文本/);assert.match(error.message,/page.html/);return true;
 });
 assert.equal(w.run.acceptanceResults?.[criterionId('包含天气首页')],undefined);
});
test('three different invalid verification attempts preserve results as blocked, not an execution crash',async t=>{
 const {base,task}=await setup(t);let n=0,failures=0;
 const plan={action:'plan',goal:'生成天气说明',decisions:[],acceptance:['包含天气首页'],steps:[{id:'s',title:'制作天气说明',status:'pending'}]};
 const actions=[plan,{action:'write_file',path:'page.txt',content:'天气-首页'},{action:'artifact',path:'page.txt',label:'天气说明'},{...plan,steps:[{...plan.steps[0],status:'done'}]}];
 const result=await runAgent({base,task,model:{contextWindow:128000},signal:new AbortController().signal,maxSteps:30,ask:async messages=>{
  const state=JSON.parse(messages.at(-1).content);
  if(state.phase==='route')return {content:JSON.stringify({action:'route',kind:'task'})};
  if(state.requiredAction==='checkpoint')return {content:JSON.stringify({action:'checkpoint',text:'保留现有文件与来源记录；首页内容尚未匹配原要求，下一步继续核验并定位差异。'})};
  const action=actions[n++]||{action:'verify',checks:[{criterionId:state.acceptanceCriteria[0].id,kind:'text_contains',path:'page.txt',contains:['天气首页'],reason:'核验首页 '+(++failures)}]};
  return {content:JSON.stringify(action)};
 }});
 assert.equal(result.agentRun.status,'blocked');assert.match(result.content,/最终验收未通过/);
 assert.equal(result.agentRun.steps[0].status,'done');assert.equal(result.agentRun.artifacts.length,1);
 assert.equal(result.agentRun.executionState.blocker.code,'ACCEPTANCE_FAILED');
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const quality=require('../apps/desktop/agent/quality-contract.cjs');
const requirements=require('../apps/desktop/agent/requirements.cjs');
const q={level:'must',origin:'user'};
function fixture(){const old={id:'page',text:'天气 App 主页面展示当前天气、预报等信息',type:'presence'};return {old,run:{executionId:'same',inputKey:'new-input',acceptanceInputKey:'old-input',currentRequest:'希望天气的背景图片可以根据天气的情况变换不同的背景，具体可以参考设计稿',requirementsManaged:true,requirements:[old],acceptanceResults:{page:{status:'passed',type:'presence'}}}};}
const citation='希望天气的背景图片可以根据天气的情况变换不同的背景';

test('the 0.1.93 false rejection permits literal provenance on an unchanged mandatory quality policy',()=>{
 const {old,run}=fixture(),before=structuredClone(old),next={...old,text:old.text+'，背景根据天气情况动态切换',quality:{...q,sourceQuote:citation}};
 const update=requirements.update(run,{requirements:[next]});
 assert.deepEqual(update.requirements[0].quality,{...q,sourceQuote:citation});assert.equal(update.requirements[0].type,'presence');assert.deepEqual(old,before);
 assert.equal(update.acceptanceResults.page,undefined,'real criterion text changes still invalidate the old acceptance result');
});

test('omitting a citation or the quality object preserves already registered provenance',()=>{
 const {old,run}=fixture();old.quality={...q,sourceQuote:'原要求保留所有已有信息'};
 assert.deepEqual(quality.prepare(run,{...old,quality:q},old,[old]),old.quality);
 assert.deepEqual(quality.prepare(run,{id:old.id,text:old.text,type:old.type},old,[old]),old.quality);
 assert.deepEqual(quality.prepare(run,{...old},old,[old]),old.quality,'copying a historical registered citation is still allowed after the current message changes');
 assert.equal(quality.context(run).requirements[0].sourceQuote,old.quality.sourceQuote);
});

test('a current literal source can update provenance without changing any quality policy field',()=>{
 const {old,run}=fixture();old.quality={...q,sourceQuote:'原要求保留所有已有信息'};
 const result=quality.prepare(run,{...old,quality:{...q,sourceQuote:citation}},old,[old]);
 assert.deepEqual(result,{...q,sourceQuote:citation});assert.equal(old.quality.sourceQuote,'原要求保留所有已有信息');
});

test('new or amended citations cannot be fabricated, borrowed from unrelated history, code or quoted material',()=>{
 for(const prior of [false,true])for(const source of ['不存在的来源','历史消息中的另一个要求']){
  const {old,run}=fixture();if(prior)old.quality={...q,sourceQuote:'已登记的历史来源'};
  assert.throws(()=>quality.prepare(run,{...old,quality:{...q,sourceQuote:source}},prior?old:undefined,prior?[old]:[]),/逐字来自当前用户指令/);
 }
 for(const wrapper of [s=>'请修改背景\n> '+s,s=>'请修改背景\n```\n'+s+'\n```']){
  const {old,run}=fixture();run.currentRequest=wrapper(citation);
  assert.throws(()=>quality.prepare(run,{...old,quality:{...q,sourceQuote:citation}},old,[old]),/逐字来自当前用户指令/);
 }
});

test('literal provenance cannot downgrade must, alter origin or polish linkage, or add and rewrite tolerance',()=>{
 const {old,run}=fixture();old.quality={...q,sourceQuote:citation};
 assert.throws(()=>quality.prepare(run,{...old,quality:{level:'optional',origin:'user',sourceQuote:citation}},old,[old]),/边界不可/);
 assert.throws(()=>quality.prepare(run,{...old,quality:{...q,polishOf:'another',sourceQuote:citation}},old,[old]),/质量契约不可/);
 const optional={...old,quality:{level:'optional',origin:'agent_polish',polishOf:'parent'}};
 assert.throws(()=>quality.prepare(run,{...optional,quality:{level:'optional',origin:'user',sourceQuote:citation}},optional,[optional]),/质量契约不可/);
 const tolerance={metric:'image.width',unit:'px',min:990,max:1010,sourceQuote:'宽度允许 990 到 1010 px'};run.currentRequest=citation+'，宽度允许 990 到 1010 px';
 assert.throws(()=>quality.prepare(run,{...old,quality:{...old.quality,tolerance}},old,[old]),/质量契约不可/);
 old.quality={...old.quality,tolerance};
 assert.throws(()=>quality.prepare(run,{...old,quality:{...old.quality,tolerance:{...tolerance,min:980}}},old,[old]),/质量契约不可/);
 assert.deepEqual(quality.prepare(run,{...old,quality:{...old.quality,sourceQuote:citation}},old,[old]).tolerance,tolerance);
});

test('agent polish remains optional in the shared schema and in runtime validation',()=>{
 const Ajv=require('../apps/desktop/node_modules/ajv'),validate=new Ajv({strict:false}).compile(quality.schema);
 assert.equal(validate(q),true);assert.equal(validate({level:'optional',origin:'agent_polish',polishOf:'page'}),true);
 assert.equal(validate({level:'must',origin:'agent_polish',polishOf:'page'}),false);
 assert.equal(validate({level:'optional',origin:'agent_polish'}),false);
 assert.equal(validate({level:'optional',origin:'agent_polish',polishOf:'page',tolerance:{metric:'image.width',unit:'px',min:0,max:1,sourceQuote:'0 到 1 px'}}),false);
 const {old,run}=fixture();assert.throws(()=>quality.prepare(run,{id:'polish',text:'温度单位排版',type:'visual',quality:{level:'must',origin:'agent_polish',polishOf:old.id}},undefined,[old]),/模型新增润色不能成为硬性/);
 assert.throws(()=>quality.prepare(run,{id:'polish',text:'温度单位排版',type:'visual',quality:{level:'optional',origin:'agent_polish'}},undefined,[old]),/须关联/);
});

test('named, merged and JSON plan schemas publish the same quality provenance and policy constraints',()=>{
 const protocol=require('../apps/desktop/agent/protocol.cjs'),state={phase:'task',steps:[]},named=protocol.actionTools(state,['plan'])[0].function.parameters,merged=protocol.menuTool(state,['plan'],false).function.parameters,json=protocol.jsonActionContract(state,['plan'],false).parametersSchema,branch=json.oneOf.find(b=>b.properties.action.const==='plan'),jsonRequirements=json.$defs[branch.properties.requirements.$ref.split('/').at(-1)];
 for(const requirementSchema of [named.properties.requirements,merged.properties.requirements,jsonRequirements])assert.deepEqual(requirementSchema.items.properties.quality,quality.schema);
});

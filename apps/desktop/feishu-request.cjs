// Shared by model schemas, protocol correction and the CLI execution boundary.
// Pure validation only: no credentials, subprocesses or remote requests.
const operations=['schema','api','help','shortcut'];
const methods=['GET','POST','PUT','PATCH','DELETE'];
const domains=['calendar','im','docs','docx','drive','sheets','base','bitable','task','tasks','wiki','contact','mail','minutes','vc','approval','attendance','okr','slides','whiteboard'];
const shortcuts={
 'im +messages-search':{flags:['query','chat-id','chat-type','sender','sender-type','exclude-sender-type','at-chatter-ids','include-attachment-type','is-at-me','start','end','page-size','page-token'],write:false},
 'im +chat-search':{flags:['query','member-ids','search-types','sort-by','page-size','page-token','exclude-muted','is-manager','disable-search-by-user'],write:false},
 'im +chat-messages-list':{flags:['chat-id','user-id','start','end','sort','page-size','page-token'],write:false},
 'im +messages-mget':{flags:['message-ids'],write:false},
 'calendar +agenda':{flags:['calendar-id','start','end'],write:false},
 'docs +search':{flags:['query','page-size','page-token','filter'],write:false},
 'docs +fetch':{flags:['doc','limit','offset'],write:false},
 'docs +create':{flags:['title','markdown','folder-token','wiki-node','wiki-space'],write:true},
 'im +messages-send':{flags:['chat-id','user-id','text','idempotency-key'],write:true},
};
function buildArgs(action){
 if(action.operation==='help'||action.operation==='shortcut'){
  const spec=shortcuts[action.query];
  if(!spec)throw Error('可用飞书快捷功能：'+Object.keys(shortcuts).join('、'));
  const args=action.query.split(' ');
  if(action.operation==='help')return [...args,'--help'];
  const inputParams=action.params||{};
  if(typeof inputParams!=='object'||Array.isArray(inputParams)||JSON.stringify(inputParams).length>20000)throw Error('飞书快捷参数无效或过长');
  // API responses use snake_case; the CLI requires kebab-case flags.
  const params=Object.create(null);
  for(const [inputKey,value] of Object.entries(inputParams)){
   const key=inputKey.replace(/_/g,'-');
   if(Object.hasOwn(params,key))throw Error('飞书快捷参数重复：'+key);
   params[key]=value;
  }
  for(const [key,inputValue] of Object.entries(params)){
   let value=inputValue;
   if(key==='page-size'&&typeof value==='number'&&Number.isInteger(value))value=String(value);
   if(['is-at-me','exclude-muted','is-manager','disable-search-by-user'].includes(key)&&typeof value==='boolean')value=String(value);
   // JSON output and user identity are bridge invariants, not model overrides.
   if(key==='format'){if(value!=='json')throw Error('Ailo 飞书工具仅支持 format=json，请移除其他输出格式');continue;}
   if(key==='as'){if(value!=='user')throw Error('Ailo 飞书工具仅支持 as=user');continue;}
   if(!spec.flags.includes(key)||typeof value!=='string'||value.trim().startsWith('@')||value.trim()==='-'||value.includes('\0'))throw Error('飞书快捷参数不受支持：'+key);
   if(key==='page-size'&&(!/^\d+$/.test(value)||Number(value)<1||Number(value)>(action.query==='im +chat-search'?100:action.query==='docs +search'?20:50)))throw Error('page-size 超出范围，请使用 1–'+(action.query==='im +chat-search'?100:action.query==='docs +search'?20:50));
   if(['is-at-me','exclude-muted','is-manager','disable-search-by-user'].includes(key)&&!['true','false'].includes(value))throw Error(key+' 必须为 true 或 false');
   args.push('--'+key+'='+value);
  }
  if(action.query==='im +messages-send'&&(!params.text||Boolean(params['chat-id'])===Boolean(params['user-id'])))throw Error('发送消息需要正文和唯一的群或用户 ID');
  if(action.query==='im +chat-messages-list'&&Boolean(params['chat-id'])===Boolean(params['user-id']))throw Error('读取聊天记录需要唯一的 chat-id 或 user-id');
  if(action.query==='im +messages-mget'&&(typeof params['message-ids']!=='string'||!/^om_[a-zA-Z0-9]+(,om_[a-zA-Z0-9]+){0,49}$/.test(params['message-ids'])))throw Error('message-ids 需要 1–50 个真实消息 ID，以逗号分隔');
  return [...args,'--as','user'];
 }
 if(action.operation==='schema'){
  if(typeof action.query!=='string'||!new RegExp('^('+domains.join('|')+')(\\.[a-zA-Z0-9_]+){0,3}$').test(action.query))throw Error('请提供业务域或 schema 名称，例如 calendar 或 calendar.events.get');
  // API versions belong in REST paths, not the CLI schema namespace.
  const query=action.query.replace(/^([a-z]+)\.v[0-9]+(?=\.)/,'$1');
  return ['schema',query];
 }
 if(!operations.includes(action.operation))throw requestError('operation','unsupported_operation');
 if(!methods.includes(action.method))throw requestError('method','invalid_http_method');
 if(typeof action.path!=='string'||!new RegExp('^/open-apis/('+domains.join('|')+')/v[0-9]+(/[A-Za-z0-9_-]+)+$').test(action.path))throw Error('仅允许飞书业务 API 路径，不支持认证接口、外部地址或文件路径');
 const object=v=>v===undefined||v!==null&&typeof v==='object'&&!Array.isArray(v);
 if(!object(action.params)||!object(action.data)||JSON.stringify([action.params,action.data]).length>20000)throw Error('飞书参数必须为 JSON 对象且总长不超过20000字符');
 if(action.method==='GET'&&action.data!==undefined)throw Error('GET 请求不能包含请求体');
 const args=['api',action.method,action.path,'--as','user','--format','json'];
 if(action.params)args.push('--params',JSON.stringify(action.params));
 if(action.data)args.push('--data',JSON.stringify(action.data));
 return args;
}

function requestError(field,issue,hint){return Object.assign(Error(hint||'飞书请求参数不符合工具协议'),{code:'FEISHU_REQUEST_INVALID',diagnostics:{action:'feishu',field,expected:'feishu_request',issue,...(hint?{hint}:{})}});}
function hint(d={}){
 if(d.field==='operation')return 'feishu.operation 只能是 schema、api、help、shortcut；不能使用 search、read、list 或 call。搜索消息先用 {"action":"feishu","operation":"help","query":"im +messages-search"} 查看参数，再用 operation="shortcut" 和同一 query。其他业务先用 schema 查询真实接口，不猜测资源ID。';
 if(d.field==='method')return 'feishu.operation="api" 时必须填写 method（GET、POST、PUT、PATCH、DELETE，区分大小写）及真实业务 path；保留已确认目标，不自动把未知操作改成写请求。';
 return '飞书请求尚未执行。'+(d.hint||'请按当前工具定义补齐参数。')+'；保留原任务、已确认目标与已有结果，修正参数后继续；不能猜测ID、扩大权限或重放结果未知的写操作。';
}
function apiArgs(action){
 try{return buildArgs(action);}catch(error){
  if(error.code==='FEISHU_REQUEST_INVALID'){error.message=hint(error.diagnostics);throw error;}
  throw requestError(action.operation==='schema'||action.operation==='help'?'query':action.operation==='api'?'path/params/data':'query/params','invalid_arguments',error.message);
 }
}
function constrain(schema){
 schema.properties.operation={type:'string',enum:[...operations],description:'仅限这四种飞书操作。搜索或读取使用 help/shortcut 查询具体快捷命令，不使用 search/read/list/call。'};
 schema.properties.query={type:'string',description:'schema：业务域或真实schema名称；help/shortcut：快捷命令名，如 im +messages-search。不能填搜索词；搜索词放 params.query。'};
 schema.properties.method={type:'string',enum:[...methods],description:'仅 api 使用，必须为大写HTTP方法。'};
 schema.allOf=[...(schema.allOf||[]),{if:{properties:{operation:{const:'api'}},required:['operation']},then:{required:['method','path']},else:{required:['query']}},{if:{properties:{operation:{enum:['help','shortcut']}},required:['operation']},then:{properties:{query:{enum:Object.keys(shortcuts)}}}}];
 return schema;
}
module.exports={apiArgs,shortcuts,operations,methods,hint,constrain};

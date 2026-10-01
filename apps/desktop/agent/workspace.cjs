const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const key = value => createHash('sha256').update(Buffer.isBuffer(value)?value:String(value)).digest('hex');
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive:true, mode:0o700});
  const temp = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value), {mode:0o600});
  await fs.rename(temp,file);
}
async function json(file, fallback) {
  try { return JSON.parse(await fs.readFile(file,'utf8')); }
  catch(e) { if(e.code==='ENOENT') return fallback; throw e; }
}
// All file operations reject symlinks as well as lexical escapes. Never accept
// absolute paths or project IDs supplied by a model.
function normalizeProjectPath(relative, allowRoot=false) {
  // Reject traversal BEFORE normalizing: a/../b must never become b.
  if(typeof relative!=='string' || relative.length>500 || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || /[\\\x00-\x1f]/.test(relative) || relative.split('/').includes('..'))
    throw Error('文件路径必须是项目内的相对路径，不允许绝对路径或 ..；查看项目根目录可使用 . 或省略 path');
  const normalized=relative.split('/').filter(part=>part && part!=='.').join('/');
  if(!normalized && !allowRoot)throw Error('请指定项目内的文件路径；. 仅用于查看项目目录');
  return normalized;
}
async function resolveFile(root, relative, createParents=false) {
  relative=normalizeProjectPath(relative);
  const parts=relative.split('/');
  let current=root;
  for(let i=0;i<parts.length;i++) {
    current=path.join(current,parts[i]);
    let stat;
    try {stat=await fs.lstat(current);} catch(e) {if(e.code!=='ENOENT')throw e;}
    if(stat?.isSymbolicLink())throw Error('不允许访问符号链接');
    if(stat?.isFile() && stat.nlink>1)throw Error('不允许访问硬链接文件');
    if(i<parts.length-1) {
      if(stat && !stat.isDirectory())throw Error('父路径不是目录');
      if(!stat && createParents)await fs.mkdir(current,{mode:0o700});
    }
  }
  return current;
}
function searchSelection(text,material,entry,pointer,offset,query) {
  if(typeof query!=='string'||!query.trim()||query.length>200)throw Error('检索词必须为1–200字符');
  if(!Number.isSafeInteger(offset)||offset<0)throw Error('读取位置无效');
  const hits=[];let cursor=offset;
  while(hits.length<8){const index=text.indexOf(query,cursor);if(index<0)break;hits.push({offset:Math.max(0,index-200),matchOffset:index,text:text.slice(Math.max(0,index-200),index+600)});cursor=index+query.length;}
  return {id:material.id,name:material.name,entry,pointer,kind:'json_search',query,hits,next:hits.length===8&&text.indexOf(query,cursor)>=0?cursor:null,total:text.length,notice:'大小写敏感的关键词定位；用同一 pointer 和命中 offset 读取上下文。next 用于继续搜索。没有命中不代表材料不存在，请核对关键词和所选节点。'};
}
async function createWorkspace(base, task) {
  const project=require('./workspace-path.cjs').workspacePath(base,task);
  const files=await require('./workspace-path.cjs').workspaceFiles(base,task);
  const runFile=path.join(project,'runs',key(task.id)+'.json');
  await fs.mkdir(files,{recursive:true,mode:0o700});
  const catalogFile=path.join(project,'materials.json');
  let catalog=await json(catalogFile,[]);
  const materials=task.messages?.flatMap(m=>m.materials||[]) || task.materials || [];
  for(const material of materials) {
    const id=key(JSON.stringify([material.name,material.sourceId || material.text]));
    let sourceId;
    if(typeof material.sourceId==='string' && /^[a-f0-9-]{36}$/.test(material.sourceId)) {
      const destination=path.join(project,'originals',material.sourceId);
      await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
      try {await fs.rename(path.join(base,'imports',material.sourceId),destination);sourceId=material.sourceId;}
      catch(e){if(e.code!=='ENOENT')throw e;try{await fs.access(destination);sourceId=material.sourceId;}catch{}}
    }
    const existing=catalog.find(m=>m.id===id);
    if(existing){if(sourceId)existing.sourceId=sourceId;continue;}
    await writeJson(path.join(project,'materials',id+'.json'),{text:material.text||'',name:material.name});
    catalog.push({id,name:material.name,chars:material.text?.length||0,summary:material.summary||'',readable:typeof material.text==='string',sourceId});
  }
  // Migrate legacy parsed-only records without collapsing different raw revisions.
  for(const item of catalog) {
    const parsed=await json(path.join(project,'materials',item.id+'.json'),{text:''});
    item.textHash=key(parsed.text);item.aliases ||= [];
    if(item.sourceId) {
      try {item.sourceHash=key(await fs.readFile(path.join(project,'originals',item.sourceId)));}
      catch(e){if(e.code!=='ENOENT')throw e;delete item.sourceId;delete item.sourceHash;}
    }
  }
  const merged=[];
  for(const item of catalog) {
    const candidates=catalog.filter(m=>m.name===item.name && m.textHash===item.textHash && m.sourceHash);
    const versions=new Set(candidates.map(m=>m.sourceHash));
    const identity=item.sourceHash || (versions.size===1?candidates[0].sourceHash:'parsed:'+item.textHash);
    const existing=merged.find(m=>m.name===item.name && m.identity===identity);
    if(existing) {
      existing.aliases=[...new Set([...existing.aliases,item.id,...item.aliases])].filter(id=>id!==existing.id);
      if(item.sourceId){existing.sourceId=item.sourceId;existing.sourceHash=item.sourceHash;}
    } else merged.push({...item,identity});
  }
  catalog=merged;
  await writeJson(catalogFile,catalog);
  let run=await json(runFile,{version:1,taskId:task.id,projectId:task.projectId,status:'understanding',mode:'chat',goal:'',steps:[],decisions:[],acceptance:[],artifacts:[],events:[],revision:0});
  if(run.taskId!==task.id||run.projectId!==task.projectId)throw Error('任务所属项目不匹配');
  await fs.mkdir(path.dirname(runFile),{recursive:true,mode:0o700});
  // Seed the archive once so upgrading does not orphan earlier execution records.
  try {await fs.writeFile(runFile+'.jsonl',run.events.map(e=>JSON.stringify(e)+'\n').join(''),{mode:0o600,flag:'wx'});}
  catch(e){if(e.code!=='EEXIST')throw e;}
  const lookup=id=>catalog.find(m=>m.id===id||m.aliases?.includes(id));
  async function save() {run.updatedAt=new Date().toISOString();await writeJson(runFile,run);}
  return {files,project,catalog,run,save,lookup,
    async source(id,entry,offset=0) {
      const material=lookup(id);
      if(!material)throw Error('材料 ID 无效或不属于当前项目，请使用 materials 清单中的 id');
      if(!material?.sourceId)throw Error('此材料没有保存原文件，请重新添加材料；已有解析文本仍可通过 read_material 读取');
      if(!Number.isInteger(offset)||offset<0)throw Error('读取位置无效');
      const {readSource}=require('../materials.cjs');
      const result=await readSource(path.join(project,'originals',material.sourceId),material.name,entry);
      return {id:material.id,name:material.name,entry:result.entry ?? entry,kind:result.kind,total:result.text.length,offset,text:result.text.slice(offset,offset+10000),next:offset+10000<result.text.length?offset+10000:null};
    },
    async execution(offset=0) {
      if(!Number.isInteger(offset)||offset<0)throw Error('记录读取位置无效');
      let text;try{text=await fs.readFile(runFile+'.jsonl','utf8');}catch(e){if(e.code!=='ENOENT')throw e;text=JSON.stringify(run.events);}
      return {offset,total:text.length,text:text.slice(offset,offset+6000),next:offset+6000<text.length?offset+6000:null};
    },
    async inspect(id,entry,pointer,offset=0,query) {
      const material=lookup(id);
      if(!material)throw Error('材料 ID 无效或不属于当前项目，请使用 materials 清单中的 id');
      if(!material.sourceId)throw Error('此材料没有保存原文件，可改用 read_material 读取解析文本');
      const {readSource}=require('../materials.cjs');
      const raw=await readSource(path.join(project,'originals',material.sourceId),material.name,entry);
      entry=raw.entry ?? entry;
      let value;try{value=JSON.parse(raw.text);}catch{throw Error('此条目不是 JSON，请使用 read_source 按范围读取');}
      if(pointer!==undefined) {
        if(typeof pointer!=='string'||(pointer!==''&&!pointer.startsWith('/')))throw Error('pointer 必须是 JSON Pointer，例如 /pages/0');
        for(const token of pointer===''?[]:pointer.slice(1).split('/')) {
          const field=token.replace(/~1/g,'/').replace(/~0/g,'~');
          if(!value||typeof value!=='object'||!Object.hasOwn(value,field))throw Error('JSON Pointer 不存在，请先检查结构');
          value=value[field];
        }
        if(!Number.isInteger(offset)||offset<0)throw Error('读取位置无效');
        const text=JSON.stringify(value);
        if(query!==undefined)return searchSelection(text,material,entry,pointer,offset,query);
        return {id:material.id,name:material.name,entry,pointer,kind:'json_selection',offset,total:text.length,text:text.slice(offset,offset+10000),next:offset+10000<text.length?offset+10000:null};
      }
      if(query!==undefined)return searchSelection(JSON.stringify(value),material,entry,'',offset,query);
      const nodes=[];
      function walk(v,p,depth) {
        if(nodes.length>=120)return;
        nodes.push({pointer:p,type:Array.isArray(v)?'array':v===null?'null':typeof v,count:v&&typeof v==='object'?Object.keys(v).length:undefined,preview:typeof v==='string'?v.slice(0,100):undefined});
        if(depth<3 && v && typeof v==='object')for(const k of Object.keys(v).slice(0,30))walk(v[k],p+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1'),depth+1);
      }
      walk(value,'',0);
      return {id:material.id,name:material.name,entry,kind:'json_outline',nodes,notice:'结构概览，最多120节点、每层30项、深度3；并非完整阅读。用 pointer 读取所需子树。'};
    },
    async material(id,offset=0,limit=6000) {
      const material=lookup(id);
      if(!material)throw Error('材料 ID 无效或不属于当前项目，请使用 materials 清单中的 id');
      if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>12000)throw Error('材料读取范围无效');
      const m=await json(path.join(project,'materials',material.id+'.json'));
      return {id:material.id,name:m.name,offset,total:m.text.length,text:m.text.slice(offset,offset+limit),next:offset+limit<m.text.length?offset+limit:null};
    },
    async search(query) {
      if(typeof query!=='string'||!query.trim()||query.length>200)throw Error('检索词无效');
      const hits=[];
      for(const m of catalog) {
        const value=await json(path.join(project,'materials',m.id+'.json'));
        let start=0;
        for(let n=0;n<3;n++) {const index=value.text.toLowerCase().indexOf(query.toLowerCase(),start);if(index<0)break;hits.push({id:m.id,name:m.name,offset:Math.max(0,index-200),text:value.text.slice(Math.max(0,index-200),index+600)});start=index+query.length;}
        if(hits.length>=12)break;
      }
      return hits.slice(0,12);
    },
    async event(type,detail) {const event={id:randomUUID(),type,detail,at:new Date().toISOString()};await fs.appendFile(runFile+'.jsonl',JSON.stringify(event)+'\n',{mode:0o600});run.events.push(event);run.events=run.events.slice(-100);await save();},
  };
}
module.exports={createWorkspace,resolveFile,normalizeProjectPath,writeJson,json,key};

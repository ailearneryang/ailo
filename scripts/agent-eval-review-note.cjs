// Optional assistant feedback is an explicit additional input to a NEW assisted
// clone. It never edits the source trial or invents user/device/acceptance events.
const fs=require('node:fs/promises'),path=require('node:path'),{constants}=require('node:fs'),{createHash,randomUUID}=require('node:crypto');
const KIND='assistant_external_review_note',MAX_CHARACTERS=12000,hash=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>Object.assign(Error('Review note rejected: '+message),{code:'EVAL_REVIEW_NOTE_INVALID'});
async function read(file){
 const resolved=path.resolve(file);if(!/\.txt$/i.test(resolved))throw fail('use a UTF-8 .txt file');
 const named=await fs.lstat(resolved);if(!named.isFile()||named.isSymbolicLink()||named.nlink!==1)throw fail('expected a regular single-link file');
 const canonical=await fs.realpath(resolved),fd=await fs.open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await fd.stat();if(!before.isFile()||before.nlink!==1||before.size>MAX_CHARACTERS*4+3)throw fail('expected bounded UTF-8 text');
  const bytes=await fd.readFile(),after=await fd.stat();if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||bytes.length!==before.size||await fs.realpath(resolved)!==canonical)throw fail('file changed during inspection');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw fail('invalid UTF-8 text');}
  const characters=Array.from(text).length;if(characters>MAX_CHARACTERS||bytes.includes(0))throw fail('text exceeds 12000 characters or contains NUL');
  return {file:resolved,canonical,identity:{dev:before.dev,ino:before.ino},bytes,metadata:{kind:KIND,sha256:hash(bytes),bytes:bytes.length,characters,role:'assistant_external_review_feedback',changesOriginalRequest:false,inputEquivalence:'original_inputs_preserved_with_additional_assistant_feedback'}};
 }finally{await fd.close();}
}
async function inspect(file){const inspected=await read(file);return {file:inspected.file,canonical:inspected.canonical,identity:inspected.identity,metadata:inspected.metadata};}
async function verify(inspected){
 const current=await read(inspected.file);
 if(current.canonical!==inspected.canonical||current.identity.dev!==inspected.identity.dev||current.identity.ino!==inspected.identity.ino||current.metadata.sha256!==inspected.metadata.sha256||current.metadata.bytes!==inspected.metadata.bytes)throw fail('file changed after preflight');
 return current.bytes;
}
function assistance(metadata){return {kind:KIND,supplementalInputs:[metadata],inputEquivalence:'additional_assistant_feedback_not_identical_original_input',reviewScope:'assisted_diagnostic_not_original_requirements_or_acceptance',originalRequestAndRequirementsPreserved:true,formalAutonomousSample:false};}
async function append(inspected,{trial,base,task,inputId,readMaterial=require('../apps/desktop/materials.cjs').readMaterial}={}){
 // Verify before any destination write; parse only the verified bytes copied to
 // the new clone, never reread an attacker-swappable source through the parser.
 const bytes=await verify(inspected),root=await fs.realpath(trial),workspace=await fs.realpath(base);
 if(workspace!==path.join(root,'workspace'))throw fail('imports must belong to the new trial workspace');
 const original=task.messages?.filter(m=>m.role==='user'&&m.id===inputId);if(original?.length!==1)throw fail('original user input identity is ambiguous');
 const imports=path.join(workspace,'imports');await fs.mkdir(imports,{recursive:true,mode:0o700});const stat=await fs.lstat(imports);if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('imports must be a real directory');
 const sourceId=randomUUID(),destination=path.join(imports,sourceId);await fs.writeFile(destination,bytes,{mode:0o600,flag:'wx'});
 let parsed;try{parsed=await readMaterial(destination);if(typeof parsed.text!=='string'||hash(await fs.readFile(destination))!==inspected.metadata.sha256)throw fail('imported note differs from its inspected input');}catch(error){await fs.rm(destination,{force:true});throw error;}
 const excerpt=Array.from(parsed.text).slice(0,450).join('');
 const name='助理外部审查反馈.txt',material={...parsed,name,sourceId,summary:'助理外部审查反馈；仅为辅助诊断，不是原始要求或验收，不代表运行、图像或API验证通过。请使用 read_material 读取全文；原始任务与验收要求保持。以下为前450个Unicode字符节选：\n'+excerpt},materialId=hash(JSON.stringify([name,sourceId]));
 const next={...task,materials:[...(task.materials||[]),material],messages:task.messages.map(message=>message===original[0]?{...message,materials:[...(message.materials||[]),material]}:message)};
 const importRecord={...inspected.metadata,sourceId,materialId,materialName:name,storage:'existing_material_pipeline',changesOriginalRequest:false};
 const manifestFile=path.join(root,'resume-manifest.json'),fd=await fs.open(manifestFile,constants.O_RDONLY|constants.O_NOFOLLOW);let manifest;try{const stat=await fd.stat();if(!stat.isFile()||stat.nlink!==1)throw fail('invalid new-clone resume manifest');manifest=JSON.parse(await fd.readFile('utf8'));}finally{await fd.close();}
 if(manifest.kind!=='assisted_resume')throw fail('review notes require an assisted clone');
 await fs.writeFile(manifestFile,JSON.stringify({...manifest,assistance:assistance(inspected.metadata),additionalMaterialImports:[...(manifest.additionalMaterialImports||[]),importRecord]},null,2),{mode:0o600,flag:constants.O_WRONLY|constants.O_TRUNC|constants.O_NOFOLLOW});
 return {task:next,importRecord};
}
module.exports={KIND,MAX_CHARACTERS,inspect,verify,assistance,append};

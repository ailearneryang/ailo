const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
// Capture once, before loading the agent. Packaged ASAR contents are immutable;
// development edits require restarting the process to change this identity.
function capture(root=__dirname){
 const files=[];
 for(const relative of ['', 'agent'])for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){
  if(entry.isFile()&&/\.(?:cjs|mjs)$/.test(entry.name)&&!(relative===''&&['forge.config.cjs','vite.config.mjs'].includes(entry.name)))files.push(relative?relative+'/'+entry.name:entry.name);
 }
 const hashes=Object.fromEntries(files.sort().map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
 const fingerprint=createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
 return {appVersion:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,runtimeFingerprint:fingerprint,
  promptSchemaVersion:hashes['agent/prompt.mjs'],toolSchemaVersion:hashes['agent/protocol.cjs'],capturedAt:new Date().toISOString(),captureKind:'process_start'};
}
const current=capture();
function forModel(model){
 const config=Object.fromEntries(['id','model','baseUrl','contextWindow','maxOutputTokens','imageInput','reasoningEffort','autoRouting'].map(k=>[k,model?.[k]]));
 return {...current,modelConfigFingerprint:createHash('sha256').update(JSON.stringify(config)).digest('hex')};
}
module.exports={current,forModel,capture};

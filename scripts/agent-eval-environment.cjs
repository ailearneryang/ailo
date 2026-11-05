const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {hash}=require('./agent-eval-config.cjs');
function identity(probe,versions=process.versions){return {platform:process.platform,arch:process.arch,osRelease:os.release(),node:versions.node,electron:versions.electron||null,chrome:versions.chrome||null,locale:Intl.DateTimeFormat().resolvedOptions().locale,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,commands:(probe.checks||[]).map(c=>({command:c.command,passed:c.passed,version:c.version})),browserPolicy:'local_only_isolated_partition_800x600',externalEffects:'denied'};}
async function snapshot({source,directory,version,runtimeFingerprint}={}){
 const probe=await require('./agent-eval-preflight.cjs').weatherEnvironment({source}),environment=identity(probe),record={schemaVersion:1,kind:'isolated_public_fixture_environment',passed:probe.passed===true,modelRequests:0,runtimeFingerprint,environment,environmentFingerprint:hash(environment),checks:probe.checks};
 await fs.mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,'environment-'+version+'.json');let prior;try{prior=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(prior&&(prior.environmentFingerprint!==record.environmentFingerprint||prior.runtimeFingerprint!==runtimeFingerprint))throw Error('Frozen evaluation host/tool environment changed');if(!prior)await fs.writeFile(file,JSON.stringify(record,null,2),{flag:'wx',mode:0o600});return record;
}
module.exports={snapshot,identity};

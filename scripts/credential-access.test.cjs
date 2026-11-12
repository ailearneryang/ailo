const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createStorage}=require('../apps/desktop/storage.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-credential-access-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const workspace={models:[{id:'m',name:'model',model:'model',baseUrl:'https://example.test',encryptedKey:Buffer.from('ciphertext').toString('base64')}],tasks:[],projects:[],defaultModelId:'m'};await fs.writeFile(path.join(root,'workspace.json'),JSON.stringify(workspace));let decrypts=0,deny=false;const safeStorage={isEncryptionAvailable(){throw Error('background must not probe keychain');},decryptString(bytes){decrypts++;if(deny)throw Error('permission denied');return 'fixture-private-key-'+bytes.toString();}};return {root,workspace,safeStorage,storage:createStorage(root,safeStorage),calls:()=>decrypts,setDenied:v=>{deny=v;}};}
test('startup metadata and background credential availability never touch OS secrets',async t=>{
 const f=await fixture(t);assert.equal((await f.storage.readWorkspace()).models[0].hasKey,true);assert.equal(await f.storage.modelCredentialsAvailable('m'),false);await assert.rejects(f.storage.modelCredentials('m',{background:true}),{code:'KEYCHAIN_USER_ACTION_REQUIRED'});assert.equal(f.calls(),0);assert.equal((await f.storage.readWorkspace()).models[0].apiKey,undefined);
});
test('normal foreground use unlocks only the matching credential in process memory; restart and logout clear it',async t=>{
 const f=await fixture(t),first=await f.storage.modelCredentials('m');assert.equal(f.calls(),1);assert.equal(await f.storage.modelCredentialsAvailable('m'),true);assert.equal((await f.storage.modelCredentials('m',{background:true})).apiKey,first.apiKey);assert.equal(f.calls(),1);
 const restarted=createStorage(f.root,f.safeStorage);assert.equal(await restarted.modelCredentialsAvailable('m'),false);await assert.rejects(restarted.modelCredentials('m',{background:true}),{code:'KEYCHAIN_USER_ACTION_REQUIRED'});assert.equal(f.calls(),1);
 await f.storage.logout();assert.equal(await f.storage.modelCredentialsAvailable('m'),false);assert.equal(f.calls(),1);const disk=await fs.readFile(path.join(f.root,'workspace.json'),'utf8');assert.ok(!disk.includes('fixture-private-key'));
});
test('rotated credentials and denied access never reuse a stale secret or persist plaintext',async t=>{
 const f=await fixture(t);await f.storage.modelCredentials('m');f.workspace.models[0].encryptedKey=Buffer.from('rotated').toString('base64');await fs.writeFile(path.join(f.root,'workspace.json'),JSON.stringify(f.workspace));assert.equal(await f.storage.modelCredentialsAvailable('m'),false);await assert.rejects(f.storage.modelCredentials('m',{background:true}),{code:'KEYCHAIN_USER_ACTION_REQUIRED'});assert.equal(f.calls(),1);
 f.setDenied(true);await assert.rejects(f.storage.modelCredentials('m'),/无法解密/);assert.equal(await f.storage.modelCredentialsAvailable('m'),false);assert.equal(f.calls(),2);
 f.setDenied(false);const key=await f.storage.modelCredentials('m');assert.match(key.apiKey,/rotated$/);assert.equal(f.calls(),3);assert.ok(!(await fs.readFile(path.join(f.root,'workspace.json'),'utf8')).includes('fixture-private-key'));
});
test('deleting a model removes its cached credential even if the old ciphertext later reappears on disk',async t=>{
 const f=await fixture(t);await f.storage.modelCredentials('m');const state=await f.storage.readWorkspace();await f.storage.saveWorkspace({...state,models:[],defaultModelId:'demo'});await fs.writeFile(path.join(f.root,'workspace.json'),JSON.stringify(f.workspace));assert.equal(await f.storage.modelCredentialsAvailable('m'),false);assert.equal(f.calls(),1);
});
test('OS decryption refusal has a typed non-corruption error and leaves encrypted credentials unchanged for a later unlock',async t=>{
 const f=await fixture(t);f.setDenied(true);const before=await fs.readFile(path.join(f.root,'workspace.json'),'utf8');
 await assert.rejects(f.storage.modelCredentials('m'),error=>error.code==='MODEL_CREDENTIALS_UNAVAILABLE'&&error.message.includes('尚不能判定密钥已失效')&&!error.message.includes('permission denied'));
 assert.equal(await fs.readFile(path.join(f.root,'workspace.json'),'utf8'),before);f.setDenied(false);assert.ok((await f.storage.modelCredentials('m')).apiKey);assert.equal(f.calls(),2);
});

const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
// Code signing changes the signature, not the executable we tested. Compare
// exact unsigned copies; never exclude instruction/data sections from checking.
async function sameExecutable(source,packed){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ailo-unsigned-compare-'));
 try{
  const files=[path.join(directory,'source'),path.join(directory,'packed')];await Promise.all(files.map((file,i)=>fs.writeFile(file,i?packed:source)));
  for(const file of files)execFileSync('/usr/bin/codesign',['--remove-signature',file],{stdio:'pipe',timeout:10000});
  return (await fs.readFile(files[0])).equals(await fs.readFile(files[1]));
 }finally{await fs.rm(directory,{recursive:true,force:true});}
}
module.exports={sameExecutable};

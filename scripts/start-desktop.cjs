// Start the branded app bundle so macOS Dock uses its native Ailo identity.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const desktop=path.resolve(__dirname,'../apps/desktop');
const directory=path.join(desktop,'out',`Ailo-${process.platform}-${process.arch}`);
const executable=process.platform==='darwin'?path.join(directory,'Ailo.app/Contents/MacOS/Ailo'):path.join(directory,process.platform==='win32'?'Ailo.exe':'Ailo');
if(!fs.existsSync(executable))throw Error('未找到 Ailo 应用，请先运行 npm run package。');
const child=spawn(executable,process.argv.slice(2),{cwd:desktop,stdio:'inherit',env:process.env});
child.on('error',error=>{console.error('无法启动 Ailo：',error.message);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});

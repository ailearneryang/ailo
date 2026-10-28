const {execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
function checkDictation(binary,exec=execFileSync){
 const lines=exec(binary,['--check'],{encoding:'utf8',timeout:10000}).trim().split('\n').map(line=>JSON.parse(line));
 const privacy=lines.find(row=>row.type==='privacy');
 if(!privacy||privacy.microphone!==true||privacy.speechRecognition!==true)throw Error('听写组件缺少嵌入的麦克风或语音识别权限说明，不能打包');
 return privacy;
}
function buildDictation({base=path.resolve(__dirname,'../apps/desktop'),out=path.join(base,'.native'),exec=execFileSync}={}){
 if(process.platform!=='darwin')return;
 fs.mkdirSync(out,{recursive:true});const binary=path.join(out,'ailo-dictation');
 exec('/usr/bin/xcrun',['swiftc','-O','-target',(process.arch==='arm64'?'arm64':'x86_64')+'-apple-macos12.0','-module-cache-path',path.join(out,'module-cache'),path.join(base,'native/dictation.swift'),'-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',path.join(base,'native/dictation-info.plist'),'-o',binary],{stdio:'inherit'});
 checkDictation(binary,exec);return binary;
}
if(require.main===module)buildDictation();
module.exports={buildDictation,checkDictation};

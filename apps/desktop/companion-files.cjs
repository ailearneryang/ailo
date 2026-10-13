const fs=require('node:fs/promises');
const companion=require('./companion.cjs');
async function exportFile({dialog,win,store,owner,format,period}){
 const data=await store.read(owner);
 if(!['json','html'].includes(format))throw Error('导出格式无效');
 const body=format==='json'?JSON.stringify(companion.backup(data.record),null,2):companion.albumHtml(data.record,period);
 const choice=await dialog.showSaveDialog(win,{title:format==='json'?'备份陪伴档案':'导出陪伴相册',defaultPath:format==='json'?'Ailo-陪伴备份.json':`Ailo-陪伴相册-${period}.html`,filters:[{name:format==='json'?'JSON':'HTML',extensions:[format]}]});
 if(choice.canceled||!choice.filePath)return false;
 await store.read(owner);
 await fs.writeFile(choice.filePath,body,{mode:0o600});return true;
}
async function importPreview({dialog,win,store,owner}){
 await store.read(owner);
 const choice=await dialog.showOpenDialog(win,{title:'选择陪伴备份',properties:['openFile'],filters:[{name:'Ailo 陪伴备份',extensions:['json']}]});
 if(choice.canceled||!choice.filePaths[0])return null;
 const handle=await fs.open(choice.filePaths[0],'r');
 try{
  if((await handle.stat()).size>5*1024*1024)throw Error('备份文件超过 5 MB');
  const buffer=Buffer.alloc(5*1024*1024+1);let length=0;
  while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
  if(length>5*1024*1024)throw Error('备份文件超过 5 MB');
  let value;try{value=JSON.parse(buffer.subarray(0,length).toString('utf8'));}catch{throw Error('备份文件不是有效的 JSON');}
  const record=companion.validateBackup(value);await store.read(owner);
  return {backup:companion.backup(record),summary:companion.summary(record)};
 }finally{await handle.close();}
}
module.exports={exportFile,importPreview};

const fs=require('node:fs/promises');
const sourceLimit=10*1024*1024;
function normalizeAvatar(buffer,nativeImage){
  if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>sourceLimit)throw Error('请选择不超过 10 MB 的头像图片。');
  const image=nativeImage.createFromBuffer(buffer);
  if(image.isEmpty())throw Error('无法读取这张图片，请选择 PNG 或 JPG 图片。');
  const {width,height}=image.getSize();
  if(!width||!height||width>8192||height>8192)throw Error('图片尺寸过大，请选择较小的头像图片。');
  const size=Math.min(width,height);
  return image.crop({x:Math.floor((width-size)/2),y:Math.floor((height-size)/2),width:size,height:size}).resize({width:256,height:256,quality:'best'}).toDataURL();
}
async function pickAvatar(dialog,win,nativeImage){
  const result=await dialog.showOpenDialog(win,{title:'选择头像图片',buttonLabel:'选择头像',properties:['openFile','dontAddToRecent'],filters:[{name:'头像图片',extensions:['png','jpg','jpeg']}]});
  if(result.canceled||!result.filePaths[0])return null;
  const file=await fs.open(result.filePaths[0],'r');
  try{const stat=await file.stat();if(!stat.isFile()||stat.size>sourceLimit)throw Error('请选择不超过 10 MB 的头像图片。');return normalizeAvatar(await file.readFile(),nativeImage);}finally{await file.close();}
}
module.exports={normalizeAvatar,pickAvatar};

// Native decoding avoids forwarding arbitrary files and bounds visual input cost.
function createImageObserver(nativeImage){
 return {async prepare(bytes,action={}){
  let image=nativeImage.createFromBuffer(bytes);
  if(image.isEmpty())throw Error('无法解码图片；请先将成果渲染为 PNG、JPEG 或 WebP');
  const original=image.getSize();
  if(original.width*original.height>40000000)throw Error('图片像素过多，请分页面或区域渲染');
  if(action.crop!==undefined){
   const crop=action.crop;
   if(!crop||!['x','y','width','height'].every(k=>Number.isSafeInteger(crop[k]))||crop.x<0||crop.y<0||crop.width<=0||crop.height<=0||crop.x+crop.width>original.width||crop.y+crop.height>original.height)throw Error('裁剪区域必须位于图片内，坐标和尺寸须为整数');
   image=image.crop(crop);
  }
  const size=image.getSize(),scale=Math.min(1,1600/Math.max(size.width,size.height));
  if(scale<1)image=image.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale)),quality:'best'});
  return {original,size:image.getSize(),image:{type:'image_url',image_url:{url:'data:image/png;base64,'+image.toPNG().toString('base64')}}};
 }};
}
module.exports={createImageObserver};

// This deliberately detects only very large colour/layout changes. A low score
// is never a visual acceptance result (text, spacing and data can still be wrong).
function compareSamples(reference,actual){
 if(reference.length!==actual.length||reference.length!==64*36*4)throw Error('图片对照采样尺寸无效');
 let difference=0,changed=0;
 for(let i=0;i<reference.length;i+=4){
  const delta=(Math.abs(reference[i]-actual[i])+Math.abs(reference[i+1]-actual[i+1])+Math.abs(reference[i+2]-actual[i+2]))/(3*255);
  difference+=delta;if(delta>.25)changed++;
 }
 const pixels=reference.length/4,meanDifference=difference/pixels,changedFraction=changed/pixels;
 return {metric:'coarse_color_blocks',sampleSize:{width:64,height:36},meanDifference,changedFraction,grossMismatch:meanDifference>.28&&changedFraction>.85,visualAcceptance:'unverified',notice:'粗略色块检查仅识别大面积差异；changedFraction 是采样色块比例，不是设计差异率或还原度。通过不代表布局、字体、资源或视觉还原验收通过，必须逐区域核对。'};
}
// Native decoding avoids forwarding arbitrary files and bounds visual input cost.
function createImageObserver(nativeImage){
 function decode(bytes){
  const image=nativeImage.createFromBuffer(bytes);
  if(image.isEmpty())throw Error('无法解码图片；请先将成果渲染为 PNG、JPEG 或 WebP');
  const size=image.getSize();
  if(size.width*size.height>40000000)throw Error('图片像素过多，请分页面或区域渲染');
  return image;
 }
 return {async compare(reference,actual){
  const sample=bytes=>decode(bytes).resize({width:64,height:36,quality:'best'}).toBitmap();
  return compareSamples(sample(reference),sample(actual));
 },async prepare(bytes,action={}){
  let image=decode(bytes);const original=image.getSize();
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
module.exports={createImageObserver,compareSamples};

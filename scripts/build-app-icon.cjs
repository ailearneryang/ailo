// Rasterize the shared vector face: every size uses the same source as Pet.
const fs=require('node:fs'),path=require('node:path');
const {createCanvas,loadImage}=require('../apps/desktop/node_modules/@napi-rs/canvas');
const {iconSvg,trayIconSvg}=require('../apps/desktop/pet-artwork.cjs');
const root=path.resolve(__dirname,'../apps/desktop');
async function png(size,dest,artwork=iconSvg){const canvas=createCanvas(size,size),image=await loadImage(Buffer.from(artwork(size)));canvas.getContext('2d').drawImage(image,0,0);const data=canvas.toBuffer('image/png');if(dest)fs.writeFileSync(dest,data);return data;}
async function build(){
 fs.writeFileSync(path.join(root,'assets/ailo-icon-source.svg'),iconSvg());
 await png(1024,path.join(root,'assets/ailo-icon-source.png'));
 await png(512,path.join(root,'assets/ailo.png'));
 await png(64,path.join(root,'public/favicon.png'));
 fs.copyFileSync(path.join(root,'assets/ailo.png'),path.join(root,'public/ailo.png'));
 for(const size of [18,36])await png(size,path.join(root,'assets',size===18?'ailo-trayTemplate.png':'ailo-trayTemplate@2x.png'),trayIconSvg);
 if(process.argv.includes('--png-only'))return;
 // Modern macOS ICNS stores independently rasterized PNG representations.
 // Write the container directly so icon generation also works without iconutil.
 const representations=[['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024],['ic11',32],['ic12',64],['ic13',256],['ic14',512]];
 const chunks=[];
 for(const [type,size] of representations){const data=await png(size),header=Buffer.alloc(8);header.write(type,0,4,'ascii');header.writeUInt32BE(data.length+8,4);chunks.push(header,data);}
 const header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(8+chunks.reduce((sum,chunk)=>sum+chunk.length,0),4);
 fs.writeFileSync(path.join(root,'assets/ailo.icns'),Buffer.concat([header,...chunks]));
}
build().catch(error=>{console.error(error);process.exitCode=1;});

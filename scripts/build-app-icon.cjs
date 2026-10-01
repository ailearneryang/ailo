// Convert the approved artwork to macOS icon sizes without changing the design.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../apps/desktop');
const source=path.join(root,'assets/ailo-icon-source.png');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ailo-icon-'));
const iconset=path.join(temp,'ailo.iconset');fs.mkdirSync(iconset);
const resize=(size,dest)=>execFileSync('sips',['-z',String(size),String(size),source,'--out',dest],{stdio:'ignore'});
try {
 for(const size of [16,32,128,256,512]) {
  resize(size,path.join(iconset,`icon_${size}x${size}.png`));
  resize(size*2,path.join(iconset,`icon_${size}x${size}@2x.png`));
 }
 execFileSync('iconutil',['-c','icns',iconset,'-o',path.join(root,'assets/ailo.icns')]);
 resize(512,path.join(root,'assets/ailo.png'));
 resize(64,path.join(root,'public/favicon.png'));
 fs.copyFileSync(path.join(root,'assets/ailo.png'),path.join(root,'public/ailo.png'));
} finally {fs.rmSync(temp,{recursive:true,force:true});}

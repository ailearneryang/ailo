// Finalize our own local development bundle after Forge has renamed Electron
// and replaced its resources. Keep existing entitlements and runtime flags.
const {execFileSync}=require('node:child_process');
function signLocalBundle(bundle,exec=execFileSync){
 exec('/usr/bin/codesign',['--force','--deep','--sign','-','--preserve-metadata=entitlements,flags,runtime',bundle],{stdio:'pipe'});
 exec('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'pipe'});
}
module.exports={signLocalBundle};

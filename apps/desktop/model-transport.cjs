// Lazy Electron access keeps startup before app.ready and Node tests safe.
function createModelTransport(getElectron=()=>require('electron')){
 const fetchModel=async(input,init={})=>{
  const {app,net}=getElectron();
  await app.whenReady();
  init.signal?.throwIfAborted();
  // Electron fetch accepts a string or Request, rather than Node's URL input.
  return net.fetch(input instanceof URL?input.href:input,{...init,credentials:'omit',cache:'no-store',bypassCustomProtocolHandlers:true});
 };
 fetchModel.transport='electron-net';
 return fetchModel;
}
module.exports={createModelTransport};

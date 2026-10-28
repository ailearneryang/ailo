// Hold only during an acquired active execution. Waiting tasks and queued work
// do not keep a computer awake; explicit sleep/lid actions remain OS-controlled.
function createExecutionPower(blocker){
 const held=new Set();
 function stop(id){if(!held.delete(id))return;try{blocker.stop(id);}catch{}}
 return {hold(){let id;try{id=blocker.start('prevent-app-suspension');}catch{return ()=>{};}held.add(id);return ()=>stop(id);},dispose(){for(const id of [...held])stop(id);},get active(){return held.size;}};
}
module.exports={createExecutionPower};
